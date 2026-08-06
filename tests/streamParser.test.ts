import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

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

import { ClaudeRunner } from '../electron/cli/claudeRunner'
import { parseLine, splitLines } from '../electron/cli/streamParser'
import { CLAUDE_STREAM_JSON_CAPABILITIES, type AgentEvent } from '../electron/cli/agentTransport'

describe('stream-json parser', () => {
  it('declares the verified stream-json capability boundary', () => {
    expect(CLAUDE_STREAM_JSON_CAPABILITIES).toEqual({
      'basic-activity': true,
      'activity-results': true,
      'task-progress': false,
      'system-notices': true,
    })
  })

  it('takes tool_use IDs from assistant events (text comes from stream_event deltas)', () => {
    // 开启 --include-partial-messages 后，文本走 stream_event，assistant 只出 tool_use
    expect(parseLine(JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'hidden' },
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', id: 'tooluse-read', name: 'Read', input: { file_path: 'README.md' } },
        ],
      },
    }))).toEqual([
      {
        type: 'activity_started',
        activityId: 'tooluse-read',
        toolName: 'Read',
        input: '{\n  "file_path": "README.md"\n}',
      },
    ])

    expect(parseLine(JSON.stringify({
      type: 'result',
      is_error: false,
      session_id: 'session-1',
    }))).toEqual([{ type: 'done', sessionId: 'session-1' }])
  })

  it('parses linked user tool results and ignores unconfirmed transport statuses', () => {
    expect(parseLine(JSON.stringify({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tooluse-read', content: 'file contents' }],
      },
    }))).toEqual([{
      type: 'activity_result', activityId: 'tooluse-read', output: 'file contents', isError: false,
    }])
    expect(parseLine(JSON.stringify({ type: 'system', subtype: 'status', status: 'requesting' }))).toEqual([])
    expect(parseLine(JSON.stringify({ type: 'system', subtype: 'compact_boundary' }))).toEqual([])
  })

  it('keeps a sanitized Claude Code 2.1.222 stream-json sample as the parser fixture', () => {
    const fixture = readFileSync(new URL('./fixtures/claude-stream-json-2.1.222.jsonl', import.meta.url), 'utf8')
    const events = fixture.trim().split('\n').flatMap(parseLine)

    expect(events).toEqual(expect.arrayContaining([
      { type: 'session_init', sessionId: 'session-fixture' },
      { type: 'text_delta', delta: 'Inspecting the project.' },
      {
        type: 'activity_started',
        activityId: 'tooluse_fixture_read',
        toolName: 'Read',
        input: '{\n  "file_path": "/workspace/package.json"\n}',
      },
      {
        type: 'activity_result',
        activityId: 'tooluse_fixture_read',
        output: '{"name":"desktop-app"}',
        isError: false,
      },
      { type: 'status', notice: { kind: 'retry', attempt: 1, maxRetries: 10, status: 503 } },
      { type: 'error', message: 'Service unavailable', errorSubtype: 'error_during_execution' },
    ]))
  })

  it('parses real streaming text_delta from stream_event content_block_delta', () => {
    expect(parseLine(JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: '你好' },
      },
      session_id: 'session-1',
    }))).toEqual([{ type: 'text_delta', delta: '你好' }])
  })

  it('ignores thinking_delta and non-text stream events', () => {
    expect(parseLine(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'x' } },
    }))).toEqual([])
    expect(parseLine(JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_stop' },
    }))).toEqual([])
  })

  it('surfaces session_id from system/init as a session_init event (single parse)', () => {
    expect(parseLine(JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'init-sid',
      permissionMode: 'acceptEdits',
    }))).toEqual([{ type: 'session_init', sessionId: 'init-sid' }])
  })

  it('ignores thinking_tokens flood and unknown types', () => {
    expect(parseLine(JSON.stringify({
      type: 'system', subtype: 'thinking_tokens', estimated_tokens: 42,
    }))).toEqual([])
    expect(parseLine(JSON.stringify({ type: 'user', message: {} }))).toEqual([])
    expect(parseLine('not json at all')).toEqual([])
    expect(parseLine('')).toEqual([])
  })

  it('returns an error event for a CLI result failure', () => {
    expect(parseLine(JSON.stringify({
      type: 'result',
      is_error: true,
      result: 'Service unavailable',
      session_id: 'session-1',
    }))).toEqual([{ type: 'error', message: 'Service unavailable', errorSubtype: undefined }])
  })

  it('emits an empty-message error carrying subtype when result text is missing', () => {
    // 真实场景：error_during_execution 的 result 为空，错因在 stderr（由 runner 兜底）
    expect(parseLine(JSON.stringify({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      session_id: 'session-1',
    }))).toEqual([{ type: 'error', message: '', errorSubtype: 'error_during_execution' }])
  })

  it('converts system/api_retry into a structured status event', () => {
    expect(parseLine(JSON.stringify({
      type: 'system',
      subtype: 'api_retry',
      attempt: 3,
      max_retries: 10,
      error_status: 503,
    }))).toEqual([{
      type: 'status', notice: { kind: 'retry', attempt: 3, maxRetries: 10, status: 503 },
    }])
  })

  it('splits both Unix and Windows line endings while retaining partial input', () => {
    expect(splitLines('one\r\ntwo\npartial')).toEqual({
      lines: ['one', 'two'],
      remainder: 'partial',
    })
  })
})

describe('ClaudeRunner', () => {
  it('turns a child-process signal into a retained aborted event', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      pid: number
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 990

    mockResolveClaudeExecutable.mockReturnValue({ execPath: '/tmp/claude', spawnPath: '/tmp' })
    mockSpawn.mockReturnValue(proc as unknown as ChildProcess)

    const events: AgentEvent[] = []
    const runner = new ClaudeRunner()
    const completed = runner.send(
      { prompt: 'stop', model: 'claude-sonnet-5', permissionMode: 'acceptEdits' },
      (event) => events.push(event)
    )
    proc.emit('close', null, 'SIGTERM')

    await completed

    expect(events).toEqual([{ type: 'aborted' }])
    expect(runner.isRunning).toBe(false)
  })

  it('starts Claude in the project directory supplied by the main process', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      pid: number
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 991

    mockResolveClaudeExecutable.mockReturnValue({ execPath: '/tmp/claude', spawnPath: '/tmp' })
    mockSpawn.mockReturnValue(proc as unknown as ChildProcess)

    const runner = new ClaudeRunner()
    const completed = runner.send(
      { prompt: 'inspect project', model: 'sonnet', permissionMode: 'acceptEdits', cwd: '/tmp/project' },
      () => {}
    )

    expect(mockSpawn).toHaveBeenLastCalledWith(
      '/tmp/claude',
      expect.any(Array),
      expect.objectContaining({ cwd: '/tmp/project' })
    )
    proc.emit('close', 0, null)
    await completed
  })

  it('does not emit a second generic error after stream-json already reported one', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      pid: number
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 4242

    mockResolveClaudeExecutable.mockReturnValue({
      execPath: '/tmp/claude',
      spawnPath: '/tmp',
    })
    mockSpawn.mockReturnValue(proc as unknown as ChildProcess)

    const events: AgentEvent[] = []
    const runner = new ClaudeRunner()
    const completed = runner.send(
      {
        prompt: 'test',
        model: 'claude-sonnet-5',
        permissionMode: 'acceptEdits',
      },
      (event) => events.push(event)
    )

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({
      type: 'result',
      is_error: true,
      result: 'Service unavailable',
      session_id: 'session-1',
    })}\n`))
    proc.stderr.emit('data', Buffer.from('Service unavailable'))
    proc.emit('close', 1, null)

    await completed

    expect(events).toEqual([{ type: 'error', message: 'Service unavailable' }])
    expect(runner.isRunning).toBe(false)
  })

  it('streams text deltas and falls back to init session_id when result omits it', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      pid: number
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 777

    mockResolveClaudeExecutable.mockReturnValue({
      execPath: '/tmp/claude',
      spawnPath: '/tmp',
    })
    mockSpawn.mockReturnValue(proc as unknown as ChildProcess)

    const events: AgentEvent[] = []
    const runner = new ClaudeRunner()
    const completed = runner.send(
      { prompt: 'hi', model: 'claude-sonnet-5', permissionMode: 'acceptEdits' },
      (event) => events.push(event)
    )

    // init 先到（携带 session_id），随后增量文本，最后 result 不带 session_id
    proc.stdout.emit('data', Buffer.from(
      `${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sid-from-init' })}\n` +
      `${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '你' } } })}\n` +
      `${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '好' } } })}\n` +
      `${JSON.stringify({ type: 'result', is_error: false, session_id: '' })}\n`
    ))
    proc.emit('close', 0, null)

    await completed

    // session_init 不外发；文本逐 token；done 用 init 的 session_id 兜底
    expect(events).toEqual([
      { type: 'text_delta', delta: '你' },
      { type: 'text_delta', delta: '好' },
      { type: 'done', sessionId: 'sid-from-init' },
    ])
    expect(runner.isRunning).toBe(false)
  })

  it('enriches an empty-result error with stderr detail', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      pid: number
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 555

    mockResolveClaudeExecutable.mockReturnValue({ execPath: '/tmp/claude', spawnPath: '/tmp' })
    mockSpawn.mockReturnValue(proc as unknown as ChildProcess)

    const events: AgentEvent[] = []
    const runner = new ClaudeRunner()
    const completed = runner.send(
      { prompt: 'hi', model: 'claude-sonnet-5', permissionMode: 'acceptEdits' },
      (event) => events.push(event)
    )

    // result 报错但 result 文本为空；真正错因随 stderr 到达；进程 code 0 退出
    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      session_id: 'session-1',
    })}\n`))
    proc.stderr.emit('data', Buffer.from('Error: --resume requires a valid session ID'))
    proc.emit('close', 0, null)

    await completed

    expect(events).toEqual([
      { type: 'error', message: 'Error: --resume requires a valid session ID' },
    ])
    expect(runner.isRunning).toBe(false)
  })

  it('falls back to a friendly subtype message when result and stderr are both empty', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      pid: number
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 556

    mockResolveClaudeExecutable.mockReturnValue({ execPath: '/tmp/claude', spawnPath: '/tmp' })
    mockSpawn.mockReturnValue(proc as unknown as ChildProcess)

    const events: AgentEvent[] = []
    const runner = new ClaudeRunner()
    const completed = runner.send(
      { prompt: 'hi', model: 'claude-sonnet-5', permissionMode: 'acceptEdits' },
      (event) => events.push(event)
    )

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      session_id: 'session-1',
    })}\n`))
    proc.emit('close', 0, null)

    await completed

    expect(events).toEqual([
      { type: 'error', message: '对话执行失败：可能是服务暂时不可用或多次重试后仍失败，请稍后重试。' },
    ])
  })

  it('forwards api_retry status events during generation', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      pid: number
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 557

    mockResolveClaudeExecutable.mockReturnValue({ execPath: '/tmp/claude', spawnPath: '/tmp' })
    mockSpawn.mockReturnValue(proc as unknown as ChildProcess)

    const events: AgentEvent[] = []
    const runner = new ClaudeRunner()
    const completed = runner.send(
      { prompt: 'hi', model: 'claude-sonnet-5', permissionMode: 'acceptEdits' },
      (event) => events.push(event)
    )

    proc.stdout.emit('data', Buffer.from(
      `${JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, error_status: 503 })}\n` +
      `${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } })}\n` +
      `${JSON.stringify({ type: 'result', is_error: false, session_id: 's1' })}\n`
    ))
    proc.emit('close', 0, null)

    await completed

    expect(events).toEqual([
      { type: 'status', notice: { kind: 'retry', attempt: 1, maxRetries: 10, status: 503 } },
      { type: 'text_delta', delta: 'hi' },
      { type: 'done', sessionId: 's1' },
    ])
  })

  it('passes --include-partial-messages to the spawned CLI', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      pid: number
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 888

    mockResolveClaudeExecutable.mockReturnValue({ execPath: '/tmp/claude', spawnPath: '/tmp' })
    mockSpawn.mockReturnValue(proc as unknown as ChildProcess)

    const runner = new ClaudeRunner()
    const completed = runner.send(
      { prompt: 'hi', model: 'claude-sonnet-5', permissionMode: 'acceptEdits' },
      () => {}
    )
    proc.emit('close', 0, null)
    await completed

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
    expect(spawnArgs).toContain('--include-partial-messages')
  })
})
