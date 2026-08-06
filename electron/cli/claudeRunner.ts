/**
 * claudeRunner：AgentTransport 的裸 CLI 实现（方案 A）
 *
 * 每次 send() 调用 spawn 一个 claude 子进程：
 *   claude -p <prompt> --output-format stream-json --verbose
 *          --model <model> [--resume <session-id>]
 *          --permission-mode <mode>
 *
 * 权限策略（方案 A 结论）：
 *   stream-json 中无 per-operation 权限请求事件；权限通过
 *   --permission-mode 标志统一控制；主进程从会话保存的模式传入，
 *   默认使用 'acceptEdits'，全部放行使用 'bypassPermissions'。
 *
 * 中断：
 *   mac/Linux — SIGTERM → SIGKILL（300ms 后）
 *   Windows   — taskkill /T /F
 */

import { spawn, ChildProcess, execSync } from 'child_process'
import { parseLine, splitLines } from './streamParser'
import type { AgentTransport, AgentEvent, SendOptions } from './agentTransport'
import { resolveClaudeExecutable } from './pathHelper'

/**
 * 将 stream-json 的报错线索与 stderr、退出码合成一条可读错误信息。
 * 优先级：result 文本 > stderr > subtype 友好提示 > 兜底。
 */
function buildErrorMessage(
  pending: { message: string; subtype?: string },
  stderr: string,
  code: number | null
): string {
  const detail = pending.message.trim()
  if (detail) return detail
  if (stderr) return stderr
  // stderr / result 都为空时，用 subtype 给出方向性提示
  switch (pending.subtype) {
    case 'error_during_execution':
      return '对话执行失败：可能是服务暂时不可用或多次重试后仍失败，请稍后重试。'
    case 'error_max_turns':
      return '已达到最大回合数限制。'
    default:
      return pending.subtype
        ? `CLI 返回错误（${pending.subtype}${code != null ? `, code ${code}` : ''}）`
        : 'CLI 返回未知错误。'
  }
}

export class ClaudeRunner implements AgentTransport {
  private proc: ChildProcess | null = null
  private _isRunning = false

  get isRunning(): boolean {
    return this._isRunning
  }

  async send(opts: SendOptions, onEvent: (e: AgentEvent) => void): Promise<void> {
    if (this._isRunning) {
      throw new Error('ClaudeRunner: already running. Call abort() first.')
    }

    const resolved = resolveClaudeExecutable()
    if (!resolved) {
      onEvent({ type: 'error', message: 'claude CLI not found. Please install Claude Code CLI and ensure it is in your PATH.' })
      return
    }

    const { execPath, spawnPath, shell } = resolved

    // 构造 CLI 参数数组（避免 shell 插值，防止注入）
    const args: string[] = [
      '--print',
      opts.prompt,
      '--output-format', 'stream-json',
      '--include-partial-messages',   // 真流式：逐 token 增量（content_block_delta）
      '--verbose',
      '--model', opts.model,
      '--permission-mode', opts.permissionMode,
    ]

    if (opts.claudeSessionId) {
      args.push('--resume', opts.claudeSessionId)
    }

    this._isRunning = true
    let buffer = ''
    let sessionIdFromInit: string | undefined
    let terminalEventSent = false
    // result 报错时 result 文本常为空，真正的错因在 stderr。
    // 因此暂存报错线索，等 close 时结合 stderr 拼出可读信息再统一上报。
    let pendingError: { message: string; subtype?: string } | null = null

    return new Promise<void>((resolve) => {
      const emitEvent = (event: AgentEvent) => {
        if (event.type === 'done' || event.type === 'aborted' || event.type === 'error') {
          if (terminalEventSent) return
          terminalEventSent = true
        }
        onEvent(event)
      }

      // 处理 parseLine 产出的单个事件：session_init 内部消费，error 暂存，其余转发
      const handleParsed = (ev: AgentEvent) => {
        if (ev.type === 'session_init') {
          sessionIdFromInit = ev.sessionId
          return
        }
        if (ev.type === 'error') {
          // 暂存，不立即上报——等 close 时用 stderr 补全错因
          pendingError = { message: ev.message, subtype: ev.errorSubtype }
          return
        }
        if (ev.type === 'done' && !ev.sessionId && sessionIdFromInit) {
          emitEvent({ ...ev, sessionId: sessionIdFromInit })
        } else {
          emitEvent(ev)
        }
      }

      this.proc = spawn(execPath, args, {
        env: { ...process.env, PATH: spawnPath },
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Windows 的 .cmd/.bat 需经 cmd.exe 执行；原生 claude.exe 则直接 spawn
        shell: shell ?? false,
      })

      const proc = this.proc

      // 解析 stdout stream-json
      proc.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const { lines, remainder } = splitLines(buffer)
        buffer = remainder
        for (const line of lines) {
          // 单次解析：session_init 由 parseLine 上抛，无需再 JSON.parse 一遍
          for (const ev of parseLine(line)) handleParsed(ev)
        }
      })

      // stderr 汇总为错误信息
      let stderrBuf = ''
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8')
      })

      proc.on('close', (code, signal) => {
        // 处理残余缓冲
        if (buffer.trim()) {
          for (const ev of parseLine(buffer)) handleParsed(ev)
          buffer = ''
        }

        this._isRunning = false
        this.proc = null

        const stderr = stderrBuf.trim()

        if (signal) {
          // 被 abort() 中断
          emitEvent({ type: 'aborted' })
        } else if (pendingError) {
          // stream-json 报了错：用 stderr / subtype 补全为可读信息
          emitEvent({ type: 'error', message: buildErrorMessage(pendingError, stderr, code) })
        } else if (code !== 0) {
          // 进程非正常退出但 stream-json 未报错（如启动即失败）
          emitEvent({ type: 'error', message: stderr || `claude 进程异常退出（code ${code}）` })
        }
        resolve()
      })

      proc.on('error', (err) => {
        this._isRunning = false
        this.proc = null
        emitEvent({ type: 'error', message: `Failed to spawn claude: ${err.message}` })
        resolve()
      })
    })
  }

  abort(): void {
    if (!this.proc) return
    const pid = this.proc.pid
    if (pid == null) return

    if (process.platform === 'win32') {
      // Windows：taskkill /T /F 杀整棵进程树
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
      } catch { /* 进程可能已退出 */ }
    } else {
      // macOS / Linux：先 SIGTERM，300ms 后 SIGKILL
      try {
        process.kill(pid, 'SIGTERM')
        setTimeout(() => {
          try {
            if (this.proc?.pid === pid) process.kill(pid, 'SIGKILL')
          } catch { /* 已退出 */ }
        }, 300)
      } catch { /* 已退出 */ }
    }
  }
}
