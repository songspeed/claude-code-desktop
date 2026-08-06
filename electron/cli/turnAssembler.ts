/**
 * 将带顺序号的 Agent 事件组装为可持久化 transcript 提交。
 * 主进程和渲染层消费同一事件包，因此条目 ID、顺序和活动生命周期保持一致。
 */

import type { AgentEventEnvelope } from './agentTransport'
import { MAX_ACTIVITY_DETAIL_BYTES, MAX_TURN_DETAIL_BYTES, sanitizeActivityText } from './activitySafety'
import type {
  Message,
  TokenUsage,
  TranscriptActivityEntry,
  TranscriptActivityState,
  TranscriptEntry,
  TranscriptNotice,
  TranscriptTerminalEntry,
} from '../store/types'

export type TranscriptCommit =
  | { kind: 'append'; entry: TranscriptEntry; compatibilityMessage?: Message }
  | {
    kind: 'update'
    entryId: string
    patch: Partial<Pick<TranscriptActivityEntry, 'state' | 'details' | 'durationMs'>>
    compatibilityPatch?: Partial<Message>
  }
  | { kind: 'session'; claudeSessionId: string }

interface PendingActivity {
  entryId: string
  startedAt: number
  detailBytes: number
  details: TranscriptActivityEntry['details']
}

/** 权限拒绝模式：工具结果报错且文本命中未授权描述时标记为权限拒绝。 */
function isPermissionDeniedOutput(output: string | undefined): boolean {
  if (!output) return false
  return /permission|authorized|granted|denied/i.test(output)
}

export class TurnAssembler {
  private markdown = ''
  private thinking = ''
  private thinkingTokens: number | undefined
  private phase: string | undefined
  private status: TranscriptNotice | null = null
  private usage: TokenUsage | undefined
  private detailBytes = 0
  private readonly pending = new Map<string, PendingActivity>()

  constructor(private readonly turnId: string) {}

  get liveText(): string {
    return this.markdown
  }

  /** 流式思考过程（实时区折叠显示，不持久化）。 */
  get liveThinking(): string {
    return this.thinking
  }

  /** 流式思考期间的估算 token 绝对值（实时计数，不持久化）。 */
  get liveThinkingTokens(): number | undefined {
    return this.thinkingTokens
  }

  /** CLI 实时阶段信号（如 reading workspace，覆盖式更新，不持久化）。 */
  get livePhase(): string | undefined {
    return this.phase
  }

  get liveStatus(): TranscriptNotice | null {
    return this.status
  }

  feed(envelope: AgentEventEnvelope): TranscriptCommit[] {
    const { event } = envelope

    switch (event.type) {
      case 'text_delta':
        this.markdown += event.delta
        this.status = null
        return []

      case 'thinking_delta':
        this.thinking += event.delta
        return []

      case 'thinking_count':
        this.thinkingTokens = event.estimatedTokens
        return []

      case 'phase_update':
        this.phase = event.phase
        return []

      case 'usage':
        this.usage = event.usage
        return []

      case 'status': {
        const commits = this.flush(envelope)
        this.status = event.notice
        commits.push({
          kind: 'append',
          entry: {
            id: this.entryId('notice', envelope.sequence),
            turnId: this.turnId,
            sequence: envelope.sequence,
            createdAt: envelope.createdAt,
            type: 'notice',
            notice: event.notice,
          },
        })
        return commits
      }

      case 'activity_started': {
        const commits = this.flush(envelope)
        const entryId = this.entryId('activity', event.activityId)
        const safeInput = this.sanitize(event.input, MAX_ACTIVITY_DETAIL_BYTES)
        const details = {
          ...(safeInput.text ? { input: safeInput.text } : {}),
          ...(safeInput.truncated ? { truncated: true } : {}),
          ...(safeInput.redacted ? { redacted: true } : {}),
        }
        const entry: TranscriptActivityEntry = {
          id: entryId,
          turnId: this.turnId,
          sequence: envelope.sequence,
          createdAt: envelope.createdAt,
          type: 'tool_activity',
          activityId: event.activityId,
          toolName: event.toolName,
          state: 'running',
          details,
        }
        this.pending.set(event.activityId, {
          entryId,
          startedAt: envelope.createdAt,
          detailBytes: safeInput.bytes,
          details,
        })
        this.status = null
        commits.push({
          kind: 'append',
          entry,
          compatibilityMessage: {
            id: entryId,
            turnId: this.turnId,
            role: 'tool',
            toolName: event.toolName,
            toolInput: safeInput.text,
            toolState: 'running',
            detailsTruncated: safeInput.truncated || undefined,
            detailsRedacted: safeInput.redacted || undefined,
            createdAt: envelope.createdAt,
          },
        })
        return commits
      }

      case 'activity_result': {
        const pending = this.pending.get(event.activityId)
        if (!pending) return []
        const safeOutput = this.sanitize(event.output, MAX_ACTIVITY_DETAIL_BYTES - pending.detailBytes)
        const detailKey = event.isError ? 'error' : 'output'
        const details = {
          ...pending.details,
          ...(safeOutput.text ? { [detailKey]: safeOutput.text } : {}),
          ...(pending.details.truncated || safeOutput.truncated ? { truncated: true } : {}),
          ...(pending.details.redacted || safeOutput.redacted ? { redacted: true } : {}),
        }
        const state: TranscriptActivityState = event.isError
          ? isPermissionDeniedOutput(safeOutput.text) ? 'permission_denied' : 'failed'
          : 'completed'
        this.pending.delete(event.activityId)
        return [{
          kind: 'update',
          entryId: pending.entryId,
          patch: {
            state,
            details,
            durationMs: Math.max(0, envelope.createdAt - pending.startedAt),
          },
          compatibilityPatch: {
            toolState: state,
            toolOutput: safeOutput.text,
            detailsTruncated: details.truncated,
            detailsRedacted: details.redacted,
          },
        }]
      }

      case 'done': {
        const commits = this.flush(envelope)
        commits.push(...this.finishPending('details_unavailable', envelope))
        commits.push({
          kind: 'append',
          entry: this.terminal(envelope, 'completed'),
        })
        if (event.sessionId) commits.push({ kind: 'session', claudeSessionId: event.sessionId })
        this.status = null
        this.thinking = ''
        this.thinkingTokens = undefined
        this.usage = undefined
        this.phase = undefined
        return commits
      }

      case 'error': {
        const commits = this.flush(envelope)
        // CLI 回合错误不等同于每个未结工具都失败；只有关联 tool_result 才能确定失败。
        commits.push(...this.finishPending('details_unavailable', envelope))
        const terminal = this.terminal(envelope, 'error', event.message)
        commits.push({
          kind: 'append',
          entry: terminal,
          compatibilityMessage: {
            id: terminal.id,
            turnId: this.turnId,
            role: 'error',
            errorMessage: event.message,
            createdAt: envelope.createdAt,
          },
        })
        this.status = null
        this.thinking = ''
        this.thinkingTokens = undefined
        this.usage = undefined
        this.phase = undefined
        return commits
      }

      case 'aborted': {
        const commits = this.flush(envelope)
        commits.push(...this.finishPending('interrupted', envelope))
        const terminal = this.terminal(envelope, 'interrupted')
        commits.push({
          kind: 'append',
          entry: terminal,
          compatibilityMessage: {
            id: terminal.id,
            turnId: this.turnId,
            role: 'interrupted',
            aborted: true,
            createdAt: envelope.createdAt,
          },
        })
        this.status = null
        this.thinking = ''
        this.thinkingTokens = undefined
        this.usage = undefined
        this.phase = undefined
        return commits
      }

      case 'session_init':
      default:
        return []
    }
  }

  private flush(envelope: AgentEventEnvelope): TranscriptCommit[] {
    if (!this.markdown) return []
    const markdown = this.markdown
    this.markdown = ''
    const entry = {
      id: this.entryId('text', envelope.sequence),
      turnId: this.turnId,
      sequence: envelope.sequence,
      createdAt: envelope.createdAt,
      type: 'assistant_markdown' as const,
      markdown,
    }
    return [{
      kind: 'append',
      entry,
      compatibilityMessage: {
        id: entry.id,
        turnId: this.turnId,
        role: 'assistant',
        text: markdown,
        createdAt: envelope.createdAt,
      },
    }]
  }

  private finishPending(state: TranscriptActivityState, envelope: AgentEventEnvelope): TranscriptCommit[] {
    const commits: TranscriptCommit[] = []
    for (const pending of this.pending.values()) {
      commits.push({
        kind: 'update',
        entryId: pending.entryId,
        patch: { state, details: pending.details, durationMs: Math.max(0, envelope.createdAt - pending.startedAt) },
        compatibilityPatch: { toolState: state },
      })
    }
    this.pending.clear()
    return commits
  }

  private terminal(
    envelope: AgentEventEnvelope,
    outcome: TranscriptTerminalEntry['outcome'],
    errorMessage?: string
  ): TranscriptTerminalEntry {
    return {
      id: this.entryId('terminal', envelope.sequence),
      turnId: this.turnId,
      sequence: envelope.sequence,
      createdAt: envelope.createdAt,
      type: 'terminal',
      outcome,
      ...(errorMessage ? { errorMessage } : {}),
      ...(this.usage ? { usage: this.usage } : {}),
    }
  }

  private sanitize(value: string | undefined, activityRemaining: number) {
    const turnRemaining = Math.max(0, MAX_TURN_DETAIL_BYTES - this.detailBytes)
    const safe = sanitizeActivityText(value, Math.min(activityRemaining, turnRemaining))
    this.detailBytes += safe.bytes
    return safe
  }

  private entryId(kind: string, suffix: string | number): string {
    return `${this.turnId}:${kind}:${suffix}`
  }
}
