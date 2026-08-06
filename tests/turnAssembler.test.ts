import { describe, expect, it } from 'vitest'
import { TurnAssembler, type TranscriptCommit } from '../electron/cli/turnAssembler'
import type { AgentEvent, AgentEventEnvelope } from '../electron/cli/agentTransport'
import { MAX_ACTIVITY_DETAIL_BYTES, MAX_TURN_DETAIL_BYTES } from '../electron/cli/activitySafety'

const turnId = 'turn-1'

function envelope(sequence: number, event: AgentEvent): AgentEventEnvelope {
  return { turnId, sequence, createdAt: 1_000 + sequence * 10, event }
}

function run(events: AgentEvent[]): { commits: TranscriptCommit[]; assembler: TurnAssembler } {
  const assembler = new TurnAssembler(turnId)
  const commits = events.flatMap((event, index) => assembler.feed(envelope(index + 1, event)))
  return { commits, assembler }
}

describe('TurnAssembler', () => {
  it('flushes streamed markdown and appends a stable terminal/session sequence', () => {
    const { commits, assembler } = run([
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' world' },
      { type: 'done', sessionId: 'claude-session' },
    ])

    expect(assembler.liveText).toBe('')
    expect(commits).toMatchObject([
      { kind: 'append', entry: { id: 'turn-1:text:3', type: 'assistant_markdown', markdown: 'Hello world', sequence: 3 } },
      { kind: 'append', entry: { id: 'turn-1:terminal:3', type: 'terminal', outcome: 'completed' } },
      { kind: 'session', claudeSessionId: 'claude-session' },
    ])
  })

  it('accumulates thinking deltas into liveThinking without persisting entries', () => {
    const assembler = new TurnAssembler(turnId)
    const commits = [
      ...assembler.feed(envelope(1, { type: 'thinking_delta', delta: '先检查' })),
      ...assembler.feed(envelope(2, { type: 'thinking_delta', delta: '依赖。' })),
    ]
    expect(commits).toEqual([])
    expect(assembler.liveThinking).toBe('先检查依赖。')
    assembler.feed(envelope(3, { type: 'done', sessionId: 's1' }))
    expect(assembler.liveThinking).toBe('')
  })

  it('tracks live thinking tokens by absolute value and clears them at the turn end', () => {
    const assembler = new TurnAssembler(turnId)
    expect(assembler.liveThinkingTokens).toBeUndefined()
    assembler.feed(envelope(1, { type: 'thinking_count', estimatedTokens: 42 }))
    expect(assembler.liveThinkingTokens).toBe(42)
    // 覆盖式更新：绝对值为 1250，不做增量累加
    assembler.feed(envelope(2, { type: 'thinking_count', estimatedTokens: 1250 }))
    expect(assembler.liveThinkingTokens).toBe(1250)
    assembler.feed(envelope(3, { type: 'done', sessionId: 's1' }))
    expect(assembler.liveThinkingTokens).toBeUndefined()
  })

  it('clears live thinking state on abort as well', () => {
    const assembler = new TurnAssembler(turnId)
    assembler.feed(envelope(1, { type: 'thinking_count', estimatedTokens: 88 }))
    assembler.feed(envelope(2, { type: 'thinking_delta', delta: '正在思考' }))
    assembler.feed(envelope(3, { type: 'aborted' }))
    expect(assembler.liveThinkingTokens).toBeUndefined()
    expect(assembler.liveThinking).toBe('')
  })

  it('tracks live phase by overwrite and clears it at every turn end', () => {
    const assembler = new TurnAssembler(turnId)
    expect(assembler.livePhase).toBeUndefined()
    assembler.feed(envelope(1, { type: 'phase_update', phase: 'reading workspace' }))
    expect(assembler.livePhase).toBe('reading workspace')
    // 覆盖式更新：后续阶段替换前值
    assembler.feed(envelope(2, { type: 'phase_update', phase: 'executing tools' }))
    expect(assembler.livePhase).toBe('executing tools')
    assembler.feed(envelope(3, { type: 'done', sessionId: 's1' }))
    expect(assembler.livePhase).toBeUndefined()
  })

  it('clears live phase on error and abort as well', () => {
    const errored = new TurnAssembler(turnId)
    errored.feed(envelope(1, { type: 'phase_update', phase: 'creating context' }))
    errored.feed(envelope(2, { type: 'error', message: 'boom' }))
    expect(errored.livePhase).toBeUndefined()

    const aborted = new TurnAssembler(turnId)
    aborted.feed(envelope(1, { type: 'phase_update', phase: 'thinking' }))
    aborted.feed(envelope(2, { type: 'aborted' }))
    expect(aborted.livePhase).toBeUndefined()
  })

  it('marks a permission-denied tool result as permission_denied', () => {
    const { commits } = run([
      { type: 'activity_started', activityId: 'tooluse-denied', toolName: 'Write', input: '{"file_path":"demo.txt"}' },
      {
        type: 'activity_result',
        activityId: 'tooluse-denied',
        output: 'Claude requested permissions to write to demo.txt, but you have not granted them yet.',
        isError: true,
      },
      { type: 'done', sessionId: 's1' },
    ])

    expect(commits).toContainEqual(expect.objectContaining({
      kind: 'update', entryId: 'turn-1:activity:tooluse-denied', patch: expect.objectContaining({ state: 'permission_denied' }),
    }))
  })

  it('keeps failed state for errors that are not about permissions', () => {
    const { commits } = run([
      { type: 'activity_started', activityId: 'tooluse-crash', toolName: 'Bash', input: '{}' },
      { type: 'activity_result', activityId: 'tooluse-crash', output: 'exit code 1', isError: true },
      { type: 'done', sessionId: 's1' },
    ])

    expect(commits).toContainEqual(expect.objectContaining({
      kind: 'update', entryId: 'turn-1:activity:tooluse-crash', patch: expect.objectContaining({ state: 'failed' }),
    }))
  })

  it('persists turn-level permission-denied notices through the notice flow', () => {
    const { commits } = run([
      { type: 'status', notice: { kind: 'permission_denied', toolName: 'Write' } },
      { type: 'done', sessionId: 's1' },
    ])

    expect(commits).toContainEqual(expect.objectContaining({
      kind: 'append', entry: expect.objectContaining({
        type: 'notice', notice: { kind: 'permission_denied', toolName: 'Write' },
      }),
    }))
  })

  it('attaches the CLI usage to the completed terminal entry', () => {
    const { commits } = run([
      { type: 'text_delta', delta: 'done' },
      {
        type: 'usage',
        usage: {
          inputTokens: 22827, outputTokens: 23, cacheReadTokens: 1200, durationMs: 2940,
          costUsd: 0.146481, model: 'deepseek-v4-pro',
        },
      },
      { type: 'done', sessionId: 's1' },
    ])

    expect(commits).toContainEqual(expect.objectContaining({
      kind: 'append',
      entry: expect.objectContaining({
        type: 'terminal',
        outcome: 'completed',
        usage: {
          inputTokens: 22827, outputTokens: 23, cacheReadTokens: 1200, durationMs: 2940,
          costUsd: 0.146481, model: 'deepseek-v4-pro',
        },
      }),
    }))
  })

  it('keeps text, linked activity updates, and later text in their actual order', () => {
    const { commits } = run([
      { type: 'text_delta', delta: 'I will inspect it.' },
      { type: 'activity_started', activityId: 'tooluse-1', toolName: 'Read', input: '{"file_path":"a.ts"}' },
      { type: 'activity_result', activityId: 'tooluse-1', output: 'export {}', isError: false },
      { type: 'text_delta', delta: 'It is empty.' },
      { type: 'done', sessionId: 's1' },
    ])

    expect(commits).toMatchObject([
      { kind: 'append', entry: { id: 'turn-1:text:2', type: 'assistant_markdown', markdown: 'I will inspect it.' } },
      { kind: 'append', entry: { id: 'turn-1:activity:tooluse-1', type: 'tool_activity', state: 'running' } },
      {
        kind: 'update', entryId: 'turn-1:activity:tooluse-1',
        patch: { state: 'completed', details: { input: '{"file_path":"a.ts"}', output: 'export {}' }, durationMs: 10 },
      },
      { kind: 'append', entry: { id: 'turn-1:text:5', type: 'assistant_markdown', markdown: 'It is empty.' } },
      { kind: 'append', entry: { id: 'turn-1:terminal:5', type: 'terminal', outcome: 'completed' } },
      { kind: 'session', claudeSessionId: 's1' },
    ])
  })

  it('renders retry as a persisted notice and clears live status with new text', () => {
    const assembler = new TurnAssembler(turnId)
    const commits = assembler.feed(envelope(1, {
      type: 'status', notice: { kind: 'retry', attempt: 1, maxRetries: 3, status: 503 },
    }))

    expect(commits).toMatchObject([
      { kind: 'append', entry: { type: 'notice', notice: { kind: 'retry', attempt: 1 } } },
    ])
    expect(assembler.liveStatus).toEqual({ kind: 'retry', attempt: 1, maxRetries: 3, status: 503 })
    assembler.feed(envelope(2, { type: 'text_delta', delta: 'Retry succeeded.' }))
    expect(assembler.liveStatus).toBeNull()
  })

  it('does not infer completion when a started activity has no linked result', () => {
    const { commits } = run([
      { type: 'activity_started', activityId: 'tooluse-1', toolName: 'Bash', input: '{"command":"npm test"}' },
      { type: 'done', sessionId: 's1' },
    ])

    expect(commits).toContainEqual(expect.objectContaining({
      kind: 'update', entryId: 'turn-1:activity:tooluse-1', patch: expect.objectContaining({ state: 'details_unavailable' }),
    }))
  })

  it('only marks activities failed when a linked result explicitly reports an error', () => {
    const failed = run([
      { type: 'activity_started', activityId: 'tooluse-fail', toolName: 'Bash', input: '{}' },
      { type: 'activity_result', activityId: 'tooluse-fail', output: 'exit code 1', isError: true },
      { type: 'error', message: 'The task stopped.' },
    ]).commits
    const unavailable = run([
      { type: 'activity_started', activityId: 'tooluse-unknown', toolName: 'Read', input: '{}' },
      { type: 'error', message: 'Network failed.' },
    ]).commits

    expect(failed).toContainEqual(expect.objectContaining({
      kind: 'update', entryId: 'turn-1:activity:tooluse-fail', patch: expect.objectContaining({ state: 'failed' }),
    }))
    expect(unavailable).toContainEqual(expect.objectContaining({
      kind: 'update', entryId: 'turn-1:activity:tooluse-unknown', patch: expect.objectContaining({ state: 'details_unavailable' }),
    }))
  })

  it('preserves partial text and marks pending activities interrupted after an abort', () => {
    const { commits } = run([
      { type: 'text_delta', delta: 'Partial answer' },
      { type: 'activity_started', activityId: 'tooluse-running', toolName: 'Read', input: '{}' },
      { type: 'aborted' },
    ])

    expect(commits).toContainEqual(expect.objectContaining({
      kind: 'append', entry: expect.objectContaining({ type: 'assistant_markdown', markdown: 'Partial answer' }),
    }))
    expect(commits).toContainEqual(expect.objectContaining({
      kind: 'update', entryId: 'turn-1:activity:tooluse-running', patch: expect.objectContaining({ state: 'interrupted' }),
    }))
    expect(commits).toContainEqual(expect.objectContaining({
      kind: 'append', entry: expect.objectContaining({ type: 'terminal', outcome: 'interrupted' }),
    }))
  })

  it('produces identical stable commits for main-process and renderer consumers', () => {
    const events: AgentEvent[] = [
      { type: 'text_delta', delta: 'First.' },
      { type: 'activity_started', activityId: 'tooluse-1', toolName: 'Read', input: '{}' },
      { type: 'activity_result', activityId: 'tooluse-1', output: 'ok' },
      { type: 'done', sessionId: 's1' },
    ]
    const mainAssembler = new TurnAssembler(turnId)
    const rendererAssembler = new TurnAssembler(turnId)
    const main = events.flatMap((event, index) => mainAssembler.feed(envelope(index + 1, event)))
    const renderer = events.flatMap((event, index) => rendererAssembler.feed(envelope(index + 1, event)))

    expect(renderer).toEqual(main)
  })

  it('enforces the detail budget across every activity in a turn', () => {
    const assembler = new TurnAssembler(turnId)
    const commits = Array.from({ length: 5 }, (_, index) => assembler.feed(envelope(index + 1, {
      type: 'activity_started',
      activityId: `tooluse-${index + 1}`,
      toolName: 'Read',
      input: 'x'.repeat(MAX_ACTIVITY_DETAIL_BYTES),
    }))).flat()
    const activities = commits.flatMap((commit) => (
      commit.kind === 'append' && commit.entry.type === 'tool_activity' ? [commit.entry] : []
    ))
    const detailBytes = activities.reduce(
      (total, entry) => total + new TextEncoder().encode(entry.details.input ?? '').length,
      0
    )

    expect(detailBytes).toBeLessThanOrEqual(MAX_TURN_DETAIL_BYTES)
    expect(activities.at(-1)?.details).toMatchObject({ truncated: true })
    expect(activities.at(-1)?.details.input).toBeUndefined()
  })
})
