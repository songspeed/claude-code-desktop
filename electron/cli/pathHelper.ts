/**
 * 可执行文件定位工具
 *
 * 解决以下跨平台问题：
 * 1. Windows 上 `claude` 可能是 `claude.cmd`（需按 PATHEXT 探测）
 * 2. macOS GUI 进程的 PATH 与终端 PATH 不同（从 Dock 启动时缺少 ~/.local/bin、/opt/homebrew/bin 等）
 * 3. Linux 常见 PATH 路径
 */

import { execSync, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/** 从登录 shell 获取完整的 PATH 环境变量（macOS / Linux） */
function getLoginShellPath(): string | undefined {
  if (process.platform === 'win32') return undefined
  const shell = process.env.SHELL || '/bin/sh'
  try {
    // -l = 登录 shell，读取 .bashrc/.zshrc 等 profile
    const result = execSync(`${shell} -lc 'echo $PATH'`, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return result.trim()
  } catch {
    return undefined
  }
}

/** 合并当前进程 PATH 与登录 shell PATH，确保不重复 */
function buildMergedPath(): string {
  const current = process.env.PATH || ''
  const loginPath = getLoginShellPath()
  if (!loginPath) return current

  const currentParts = current.split(':').filter(Boolean)
  const loginParts = loginPath.split(':').filter(Boolean)
  const merged = [...new Set([...loginParts, ...currentParts])]
  return merged.join(':')
}

/** 在给定的 PATH 中查找 `claude` 可执行文件，返回绝对路径或 null */
function findInPath(pathEnv: string): string | null {
  const separator = process.platform === 'win32' ? ';' : ':'
  const dirs = pathEnv.split(separator).filter(Boolean)

  // Windows: 按 PATHEXT 中的扩展名依次尝试
  if (process.platform === 'win32') {
    const pathext = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    for (const dir of dirs) {
      for (const ext of pathext) {
        const full = join(dir, `claude${ext}`)
        if (existsSync(full)) return full
      }
      // 也尝试无扩展名
      const plain = join(dir, 'claude')
      if (existsSync(plain)) return plain
    }
    return null
  }

  // macOS / Linux
  for (const dir of dirs) {
    const full = join(dir, 'claude')
    if (existsSync(full)) return full
  }
  return null
}

export interface ResolvedExecutable {
  /** 可执行文件绝对路径 */
  execPath: string
  /** 用于 spawn 的 PATH 环境变量（已合并登录 shell PATH） */
  spawnPath: string
}

/** 探测 claude 可执行文件，返回绝对路径和用于 spawn 的 PATH */
export function resolveClaudeExecutable(): ResolvedExecutable | null {
  // 1. 先用合并了登录 shell PATH 的路径搜索
  const mergedPath = buildMergedPath()
  const found = findInPath(mergedPath)
  if (found) return { execPath: found, spawnPath: mergedPath }

  // 2. 常见兜底路径（macOS homebrew / 系统路径）
  const fallbackPaths =
    process.platform === 'win32'
      ? [
          join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
          join(process.env.APPDATA || '', 'npm', 'claude'),
        ]
      : [
          '/opt/homebrew/bin/claude',      // macOS ARM homebrew
          '/usr/local/bin/claude',         // macOS Intel homebrew / Linux
          '/usr/bin/claude',
          join(process.env.HOME || '', '.local', 'bin', 'claude'),
          join(process.env.HOME || '', '.npm-global', 'bin', 'claude'),
        ]

  for (const p of fallbackPaths) {
    if (existsSync(p)) {
      return { execPath: p, spawnPath: mergedPath }
    }
  }

  return null
}

/** 检查 claude 认证状态（通过运行 `claude --version`，非零退出视为未认证/不可用） */
export function checkClaudeAvailability(execPath: string, spawnPath: string): {
  available: boolean
  version?: string
  error?: string
} {
  try {
    const result = spawnSync(execPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, PATH: spawnPath },
    })
    if (result.status === 0) {
      return { available: true, version: result.stdout.trim() }
    }
    return { available: false, error: result.stderr?.trim() || 'non-zero exit' }
  } catch (err) {
    return { available: false, error: String(err) }
  }
}
