import { spawn } from 'child_process'
import { Buffer } from 'buffer'
import type { AgentEvent } from './agentTransport'
import { resolveClaudeExecutable } from './pathHelper'
import { sanitizeActivityText } from './activitySafety'

const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024

/** 在不经过 shell 的前提下运行已校验的 Claude CLI 查询命令。 */
export function runReadonlyClaudeCommand(
  args: string[],
  cwd: string,
  onEvent: (event: AgentEvent) => void,
  onAbortReady?: (abort: () => void) => void
): Promise<void> {
  const resolved = resolveClaudeExecutable()
  if (!resolved) {
    onEvent({ type: 'error', message: '未找到 Claude Code CLI。' })
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const proc = spawn(resolved.execPath, args, {
      cwd,
      env: { ...process.env, PATH: resolved.spawnPath },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: resolved.shell ?? false,
    })
    let aborted = false
    const abort = () => {
      aborted = true
      try {
        proc.kill()
      } catch { /* process may have already exited */ }
    }
    onAbortReady?.(abort)
    let output = ''
    let truncated = false
    let terminalEventSent = false

    const append = (chunk: Buffer) => {
      if (truncated) return
      const text = chunk.toString('utf8')
      const remaining = MAX_COMMAND_OUTPUT_BYTES - Buffer.byteLength(output)
      if (remaining <= 0) {
        truncated = true
        return
      }
      if (Buffer.byteLength(text) > remaining) {
        output += takeUtf8(text, remaining)
        truncated = true
        return
      }
      output += text
    }

    const finish = (callback: () => void) => {
      if (terminalEventSent) return
      terminalEventSent = true
      callback()
      resolve()
    }

    proc.stdout?.on('data', append)
    proc.stderr?.on('data', append)
    proc.on('error', (error) => {
      finish(() => onEvent({ type: 'error', message: `无法启动 Claude CLI：${error.message}` }))
    })
    proc.on('close', (code) => {
      finish(() => {
        if (aborted) {
          onEvent({ type: 'aborted' })
          return
        }
        const result = output.trim() || '命令未返回文本输出。'
        const safe = sanitizeActivityText(result, MAX_COMMAND_OUTPUT_BYTES)
        const annotations = [
          truncated || safe.truncated ? '[输出已截断]' : '',
          safe.redacted ? '[敏感值已脱敏]' : '',
        ].filter(Boolean)
        onEvent({ type: 'text_delta', delta: formatCommandOutput(args, `${safe.text ?? ''}${annotations.length ? `\n${annotations.join('\n')}` : ''}`) })
        if (code === 0) onEvent({ type: 'done', sessionId: '' })
        else onEvent({ type: 'error', message: `claude ${args[0]} 命令退出（code ${code ?? 'unknown'}）。` })
      })
    })
  })
}

function takeUtf8(value: string, limit: number): string {
  let result = ''
  let used = 0
  for (const character of value) {
    const size = Buffer.byteLength(character)
    if (used + size > limit) break
    result += character
    used += size
  }
  return result
}

function formatCommandOutput(args: string[], output: string): string {
  const fence = output.includes('```') ? '````' : '```'
  return `${fence}text\n$ claude ${args.join(' ')}\n${output}\n${fence}`
}
