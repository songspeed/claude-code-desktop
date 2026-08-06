import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../electron/cli/agentTransport'

const { mockResolveClaudeExecutable, mockSpawn } = vi.hoisted(() => ({
  mockResolveClaudeExecutable: vi.fn(),
  mockSpawn: vi.fn(),
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, spawn: mockSpawn }
})

vi.mock('../electron/cli/pathHelper', () => ({
  resolveClaudeExecutable: mockResolveClaudeExecutable,
}))

import { runReadonlyClaudeCommand } from '../electron/cli/commandRunner'

function createProcess(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  return proc
}

describe('readonly Claude command runner', () => {
  it('uses argument-array spawning and redacts persisted command output', async () => {
    const proc = createProcess()
    mockResolveClaudeExecutable.mockReturnValue({ execPath: '/tmp/claude', spawnPath: '/tmp' })
    mockSpawn.mockReturnValue(proc as unknown as ChildProcess)
    const events: AgentEvent[] = []

    const completed = runReadonlyClaudeCommand(['mcp', 'list'], '/tmp/project', (event) => events.push(event))

    expect(mockSpawn).toHaveBeenLastCalledWith(
      '/tmp/claude',
      ['mcp', 'list'],
      expect.objectContaining({ cwd: '/tmp/project', shell: false })
    )
    proc.stdout.emit('data', Buffer.from('api_key=secret-value'))
    proc.emit('close', 0, null)
    await completed

    expect(events).toEqual([
      expect.objectContaining({ type: 'text_delta', delta: expect.stringContaining('api_key=[REDACTED]') }),
      { type: 'done', sessionId: '' },
    ])
  })

  it('emits only one terminal event when spawn error is followed by close', async () => {
    const proc = createProcess()
    mockResolveClaudeExecutable.mockReturnValue({ execPath: '/tmp/claude', spawnPath: '/tmp' })
    mockSpawn.mockReturnValue(proc as unknown as ChildProcess)
    const events: AgentEvent[] = []

    const completed = runReadonlyClaudeCommand(['doctor'], '/tmp/project', (event) => events.push(event))
    proc.emit('error', new Error('missing executable'))
    proc.emit('close', 1, null)
    await completed

    expect(events).toEqual([{ type: 'error', message: '无法启动 Claude CLI：missing executable' }])
  })
})
