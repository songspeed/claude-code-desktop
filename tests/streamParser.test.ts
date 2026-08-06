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
import { parseLine, splitLines, stripAnsi } from '../electron/cli/streamParser'
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
    expect(parseLine(JSON.stringify({ type: 'system', subtype: 'compact_boundary' }))).toEqual([])
  })

  it('converts system/status value into phase_update and ignores non-string values', () => {
    expect(parseLine(JSON.stringify({ type: 'system', subtype: 'status', value: 'reading workspace' }))).toEqual([
      { type: 'phase_update', phase: 'reading workspace' },
    ])
    // 旧形态 status 字段与数值型 value 均不产生阶段事件
    expect(parseLine(JSON.stringify({ type: 'system', subtype: 'status', status: 'requesting' }))).toEqual([])
    expect(parseLine(JSON.stringify({ type: 'system', subtype: 'status', value: 42 }))).toEqual([])
    expect(parseLine(JSON.stringify({ type: 'system', subtype: 'status', value: '' }))).toEqual([])
  })

  it('keeps a sanitized Claude Code 2.1.222 stream-json sample as the parser fixture', () => {
    const fixture = readFileSync(new URL('./fixtures/claude-stream-json-2.1.222.jsonl', import.meta.url), 'utf8')
    const events = fixture.trim().split('\n').flatMap(parseLine)

    expect(events).toEqual(expect.arrayContaining([
      { type: 'session_init', sessionId: 'session-fixture' },
      { type: 'thinking_count', estimatedTokens: 312 },
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

  it('parses thinking_delta increments and ignores non-text stream events', () => {
    expect(parseLine(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '思考' } },
    }))).toEqual([{ type: 'thinking_delta', delta: '思考' }])
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

  it('converts thinking_tokens into thinking_count and ignores unknown types', () => {
    expect(parseLine(JSON.stringify({
      type: 'system', subtype: 'thinking_tokens', estimated_tokens: 42,
    }))).toEqual([{ type: 'thinking_count', estimatedTokens: 42 }])
    // 高频绝对值：第二次估算覆盖前值，不做累加
    expect(parseLine(JSON.stringify({
      type: 'system', subtype: 'thinking_tokens', estimated_tokens: 1250,
    }))).toEqual([{ type: 'thinking_count', estimatedTokens: 1250 }])
    expect(parseLine(JSON.stringify({
      type: 'system', subtype: 'thinking_tokens', estimated_tokens: 'nope',
    }))).toEqual([])
    expect(parseLine(JSON.stringify({ type: 'user', message: {} }))).toEqual([])
    expect(parseLine('not json at all')).toEqual([])
    expect(parseLine('')).toEqual([])
  })

  it('maps result cost and model with total_cost_usd taking priority', () => {
    expect(parseLine(JSON.stringify({
      type: 'result',
      is_error: false,
      session_id: 'session-1',
      duration_ms: 5931,
      total_cost_usd: 0.146481,
      modelUsage: {
        'deepseek-v4-pro': { inputTokens: 23390, outputTokens: 275, costUSD: 0.146481 },
      },
      usage: {
        input_tokens: 22956,
        output_tokens: 231,
        cache_read_input_tokens: 45312,
        cache_creation_input_tokens: 0,
      },
    }))).toEqual([
      { type: 'usage', usage: {
        inputTokens: 22956,
        outputTokens: 231,
        cacheReadTokens: 45312,
        cacheWriteTokens: 0,
        durationMs: 5931,
        costUsd: 0.146481,
        model: 'deepseek-v4-pro',
      } },
      { type: 'done', sessionId: 'session-1' },
    ])
  })

  it('falls back to summing modelUsage cost when total_cost_usd is absent', () => {
    expect(parseLine(JSON.stringify({
      type: 'result',
      is_error: false,
      session_id: 'session-1',
      modelUsage: {
        'claude-sonnet-4-5': { costUSD: 0.01 },
        'claude-opus-4-1': { costUSD: 0.02 },
      },
    }))).toEqual([
      { type: 'usage', usage: { costUsd: 0.03, model: 'claude-sonnet-4-5' } },
      { type: 'done', sessionId: 'session-1' },
    ])
  })

  it('emits permission-denied notices for each denied request', () => {
    expect(parseLine(JSON.stringify({
      type: 'result',
      is_error: false,
      session_id: 'session-1',
      permission_denials: [
        { tool_name: 'Write', message: 'Claude requested permissions to write to demo.txt, but you have not granted them yet.' },
        { tool_name: 'Bash' },
      ],
    }))).toEqual([
      { type: 'status', notice: { kind: 'permission_denied', toolName: 'Write', detail: 'Claude requested permissions to write to demo.txt, but you have not granted them yet.' } },
      { type: 'status', notice: { kind: 'permission_denied', toolName: 'Bash' } },
      { type: 'done', sessionId: 'session-1' },
    ])
    // 空数组不产生通知
    expect(parseLine(JSON.stringify({
      type: 'result',
      is_error: false,
      session_id: 'session-1',
      permission_denials: [],
    }))).toEqual([{ type: 'done', sessionId: 'session-1' }])
  })

  it('returns an error event for a CLI result failure', () => {
    expect(parseLine(JSON.stringify({
      type: 'result',
      is_error: true,
      result: 'Service unavailable',
      session_id: 'session-1',
    }))).toEqual([{ type: 'error', message: 'Service unavailable', errorSubtype: undefined }])
  })

  it('emits usage before done when the result carries token counts and duration', () => {
    expect(parseLine(JSON.stringify({
      type: 'result',
      is_error: false,
      session_id: 'session-1',
      duration_ms: 2940,
      usage: {
        input_tokens: 22827,
        output_tokens: 23,
        cache_read_input_tokens: 1200,
        cache_creation_input_tokens: 0,
      },
    }))).toEqual([
      { type: 'usage', usage: {
        inputTokens: 22827,
        outputTokens: 23,
        cacheReadTokens: 1200,
        cacheWriteTokens: 0,
        durationMs: 2940,
      } },
      { type: 'done', sessionId: 'session-1' },
    ])
  })

  it('omits the usage event when the result has neither tokens nor duration', () => {
    expect(parseLine(JSON.stringify({
      type: 'result',
      is_error: false,
      session_id: 'session-1',
      usage: {},
    }))).toEqual([{ type: 'done', sessionId: 'session-1' }])
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

  it('strips ANSI escape sequences from tool results while keeping valid text', () => {
    expect(parseLine(JSON.stringify({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tooluse-bash',
          content: '\x1b[31mError: build failed\x1b[0m',
          is_error: true,
        }],
      },
    }))).toEqual([{
      type: 'activity_result', activityId: 'tooluse-bash', output: 'Error: build failed', isError: true,
    }])

    expect(stripAnsi('\x1b[32mok\x1b[0m')).toBe('ok')
    expect(stripAnsi('\x1b]8;;https://example.com\x07link\x1b]8;;\x07')).toBe('link')
    expect(stripAnsi('\x1b[1;3;4mstyled\x1b[0m')).toBe('styled')
    // 无 ANSI 的文本原样保留
    expect(stripAnsi('plain text 中文')).toBe('plain text 中文')
    // 不完整的转义序列（无终止字节）安全剥离或原样保留，均不抛错
    expect(() => stripAnsi('half \x1b[31')).not.toThrow()
    // 空输入安全返回
    expect(stripAnsi('')).toBe('')
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
