import { memo, useEffect, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clipboard,
  ExternalLink,
  FilePenLine,
  FileSearch,
  FileText,
  LoaderCircle,
  RotateCcw,
  ShieldX,
  Sparkles,
  TerminalSquare,
  Wrench,
  XCircle,
} from 'lucide-react'
import type {
  AppLocale,
  TokenUsage,
  Transcript,
  TranscriptActivityEntry,
  TranscriptActivityState,
  TranscriptEntry,
  TranscriptNotice,
} from '../../electron/store/types'
import { translate, useTranslation, type TranslationKey } from '../i18n'
import { useAppStore } from '../store/appStore'
import { CopyButton, MarkdownContent } from './MessageBubble'
import DiffView from './DiffView'
import { computeLineDiff, type DiffLine } from './diffPreview'
import { extractTodoProgress, type TodoProgress } from './markdown/todoProgress'
import { useTodoProgress } from './useTodoProgress'
import { resolveAbsolutePath } from './markdown/pathUtils'
import { ipc } from '../ipc'

interface Props {
  transcript: Transcript
  streamingText: string
  streamingThinking: string
  streamingThinkingTokens: number | null
  streamingPhase: string | null
  isGenerating: boolean
  liveStatus: TranscriptNotice | null
  /** 会话关联的工作区根目录；无关联时 diff 定位按钮禁用 */
  projectPath: string | null
}

type RenderItem =
  | { kind: 'entry'; entry: Exclude<TranscriptEntry, TranscriptActivityEntry> }
  | { kind: 'activities'; entries: TranscriptActivityEntry[] }

function format(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template)
}

function parseToolInput(input?: string): Record<string, unknown> | null {
  if (!input) return null
  try {
    const parsed: unknown = JSON.parse(input)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function activityKind(entry: TranscriptActivityEntry): TranslationKey {
  const name = entry.toolName.toLowerCase()
  if (name === 'read') return 'activityRead'
  if (name === 'grep' || name === 'glob') return 'activitySearch'
  if (name === 'edit' || name === 'write' || name === 'notebookedit') return 'activityEdit'
  if (name === 'bash') return 'activityRunCommand'
  return 'toolCall'
}

export function getActivityLabel(entry: TranscriptActivityEntry, locale: AppLocale): string {
  const key = activityKind(entry)
  // 未知工具没有可验证的本地化分类，保留传输提供的原始工具名。
  return key === 'toolCall' ? entry.toolName : translate(locale, key)
}

function activityTarget(entry: TranscriptActivityEntry): string | null {
  const input = parseToolInput(entry.details.input)
  if (!input) return null
  const candidate = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.query
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

function stateKey(state: TranscriptActivityState): TranslationKey {
  switch (state) {
    case 'completed': return 'activityCompleted'
    case 'failed': return 'activityFailed'
    case 'permission_denied': return 'activityPermissionDenied'
    case 'details_unavailable': return 'activityUnavailable'
    case 'interrupted': return 'activityInterrupted'
    default: return 'activityRunning'
  }
}

function activityIcon(entry: TranscriptActivityEntry) {
  if (entry.state === 'permission_denied') return ShieldX
  const name = entry.toolName.toLowerCase()
  if (name === 'read') return FileText
  if (name === 'grep' || name === 'glob') return FileSearch
  if (name === 'edit' || name === 'write' || name === 'notebookedit') return FilePenLine
  if (name === 'bash') return TerminalSquare
  return Wrench
}

function noticeText(notice: TranscriptNotice, t: (key: TranslationKey) => string): string {
  switch (notice.kind) {
    case 'retry':
      return notice.attempt
        ? `${t('retrying')} ${notice.attempt}${notice.maxRetries ? `/${notice.maxRetries}` : ''}`
        : t('retrying')
    case 'context_compacted': return t('contextCompacted')
    case 'task_progress': return format(t('taskProgress'), notice)
    case 'requesting': return t('claudeProcessing')
    case 'permission_denied':
      return notice.toolName
        ? format(t('permissionDeniedNotice'), { tool: notice.toolName })
        : t('permissionDenied')
  }
}

/** 估算 token 缩写：≥1000 显示一位小数 k，否则原值。 */
export function formatThinkingTokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
}

/** memo 化：流式期间已落盘的 thinking 快照跳过重渲，仅实时内容参与。 */
export const ThinkingBlock = memo(function ThinkingBlock({ text, tokens }: { text: string; tokens: number | null }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  return (
    <div className={`thinking-block${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="thinking-block-trigger"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Sparkles size={12} />
        <span>{t('thinking')}</span>
        {tokens != null && (
          <small className="thinking-block-tokens">{format(t('thinkingTokens'), { count: formatThinkingTokens(tokens) })}</small>
        )}
        <small>{firstLine}</small>
      </button>
      {expanded && <div className="thinking-block-body">{text}</div>}
    </div>
  )
})

function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

/** 回合结束的 token 用量、成本与模型小字（参考 opencode 的消息元数据行）。 */
export function UsageLine({ usage }: { usage: TokenUsage }) {
  const { t } = useTranslation()
  const parts: string[] = []
  if (usage.model) parts.push(usage.model)
  if (usage.inputTokens != null) parts.push(`↑ ${formatNumber(usage.inputTokens)} ${t('usageIn')}`)
  if (usage.outputTokens != null) parts.push(`↓ ${formatNumber(usage.outputTokens)} ${t('usageOut')}`)
  if (usage.cacheReadTokens != null && usage.cacheReadTokens > 0) {
    parts.push(`${t('usageCacheRead')} ${formatNumber(usage.cacheReadTokens)}`)
  }
  if (usage.cacheWriteTokens != null && usage.cacheWriteTokens > 0) {
    parts.push(`${t('usageCacheWrite')} ${formatNumber(usage.cacheWriteTokens)}`)
  }
  if (usage.costUsd != null) parts.push(`${t('usageCost')} $${usage.costUsd.toFixed(4)}`)
  if (usage.durationMs != null) parts.push(`${formatNumber(Math.round(usage.durationMs / 100) / 10)}s`)
  if (parts.length === 0) return null
  return <div className="usage-line" aria-label={t('usageLabel')}>{parts.join(' · ')}</div>
}

/** 详情块：JSON 输入走语法高亮，其余保留等宽 pre。 */
export function DetailBlock({ label, value }: { label: TranslationKey; value: string }) {
  const { t } = useTranslation()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(value)
  } catch {
    parsed = null
  }
  const isJson = parsed != null && (typeof parsed === 'object' || Array.isArray(parsed))
  return (
    <section className="activity-detail-block">
      <div>
        <span>{t(label)}</span>
        <CopyButton text={value} />
      </div>
      {isJson
        ? <div className="activity-detail-json"><MarkdownContent content={`\`\`\`json\n${value}\n\`\`\``} /></div>
        : <pre>{value}</pre>}
    </section>
  )
}

/** 编辑类活动（Edit/Write）从工具输入计算差异；不可计算时返回 null 走原始展示。 */
function computeActivityDiff(entry: TranscriptActivityEntry): DiffLine[] | null {
  const name = entry.toolName.toLowerCase()
  if (name !== 'edit' && name !== 'write') return null
  const input = parseToolInput(entry.details.input)
  if (!input) return null
  if (name === 'edit') {
    const before = typeof input.old_string === 'string' ? input.old_string : ''
    const after = typeof input.new_string === 'string' ? input.new_string : ''
    return computeLineDiff(before, after)
  }
  const content = typeof input.content === 'string' ? input.content : ''
  return computeLineDiff('', content)
}

/** 从工具输入提取文件路径（Edit/Write 的 file_path）。 */
function activityFilePath(entry: TranscriptActivityEntry): string | null {
  const input = parseToolInput(entry.details.input)
  if (!input) return null
  const candidate = input.file_path ?? input.path
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

export function EditDiffBlock({ diff, filePath, projectPath }: {
  diff: DiffLine[]
  filePath: string | null
  projectPath: string | null
}) {
  const { t } = useTranslation()
  const text = diff.map((line) => `${line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}${line.text}`).join('\n')
  const absolutePath = filePath ? resolveAbsolutePath(filePath, projectPath) : null
  const openFile = () => {
    if (!absolutePath) return
    ipc.openPath(absolutePath).catch(() => {})
  }
  return (
    <section className="activity-detail-block">
      <div className="activity-detail-header">
        <span>{t('activityDiffPreview')}</span>
        {filePath && <code className="activity-diff-path">{filePath}</code>}
        <CopyButton text={text} />
        <button
          type="button"
          className="activity-open-button"
          onClick={openFile}
          disabled={!absolutePath}
          title={t('openFile')}
          aria-label={t('openFile')}
        >
          <ExternalLink size={13} />
        </button>
      </div>
      <div className="activity-detail-diff"><DiffView lines={diff} /></div>
    </section>
  )
}

function groupEntries(entries: TranscriptEntry[]): RenderItem[] {
  const items: RenderItem[] = []
  for (let index = 0; index < entries.length;) {
    const entry = entries[index]!
    if (entry.type !== 'tool_activity') {
      items.push({ kind: 'entry', entry })
      index += 1
      continue
    }

    const activities: TranscriptActivityEntry[] = []
    while (entries[index]?.type === 'tool_activity') {
      activities.push(entries[index] as TranscriptActivityEntry)
      index += 1
    }
    items.push({ kind: 'activities', entries: activities })
  }
  return items
}

function ActivityGroup({ entries, projectPath }: { entries: TranscriptActivityEntry[]; projectPath: string | null }) {
  const { locale, t } = useTranslation()
  const running = entries.some((entry) => entry.state === 'running')
  const failed = entries.some((entry) => entry.state === 'failed')
  const permissionDenied = entries.some((entry) => entry.state === 'permission_denied')
  const interrupted = entries.some((entry) => entry.state === 'interrupted')
  const unavailable = entries.some((entry) => entry.state === 'details_unavailable')
  const attentionRequired = failed || permissionDenied || interrupted || unavailable
  const [expanded, setExpanded] = useState(() => running || attentionRequired)

  useEffect(() => {
    if (!running && !attentionRequired) setExpanded(false)
  }, [running, attentionRequired])

  const first = entries[0]!
  const summary = entries.length === 1
    ? [getActivityLabel(first, locale), activityTarget(first)].filter(Boolean).join(' ')
    : format(t('activityCount'), { count: entries.length })
  const groupState: TranscriptActivityState = running
    ? 'running'
    : failed
      ? 'failed'
      : permissionDenied
        ? 'permission_denied'
        : interrupted
          ? 'interrupted'
          : unavailable
            ? 'details_unavailable'
            : 'completed'

  return (
    <section className={`activity-group is-${groupState}`}>
      <button
        type="button"
        className="activity-group-trigger"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={expanded ? t('hideActivityDetails') : t('showActivityDetails')}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {running ? <LoaderCircle className="is-spinning" size={15} /> : <Wrench size={15} />}
        <span>{summary}</span>
        <small>{t(stateKey(groupState))}</small>
      </button>
      {expanded && (
        <div className="activity-group-entries">
          {entries.map((entry) => <ActivityRow key={entry.id} entry={entry} projectPath={projectPath} />)}
        </div>
      )}
    </section>
  )
}

function ActivityRow({ entry, projectPath }: { entry: TranscriptActivityEntry; projectPath: string | null }) {
  const { locale, t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const Icon = activityIcon(entry)
  const target = activityTarget(entry)
  const diff = computeActivityDiff(entry)
  const hasDetails = Boolean(entry.details.input || entry.details.output || entry.details.error)
  const detailPairs: Array<[TranslationKey, string | undefined]> = [
    ['activityOutput', entry.details.output],
    ['activityErrorOutput', entry.details.error],
  ]

  return (
    <div className={`activity-row is-${entry.state}`}>
      <button
        type="button"
        className="activity-row-trigger"
        onClick={() => hasDetails && setExpanded((value) => !value)}
        disabled={!hasDetails}
        aria-expanded={hasDetails ? expanded : undefined}
      >
        <Icon size={15} />
        <span className="activity-row-title">{getActivityLabel(entry, locale)}</span>
        {target && <code>{target}</code>}
        <small>{t(stateKey(entry.state))}</small>
        {hasDetails && (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
      </button>
      {expanded && (
        <div className="activity-row-details">
          {diff
            ? <EditDiffBlock diff={diff} filePath={activityFilePath(entry)} projectPath={projectPath} />
            : entry.details.input && <DetailBlock label="activityInput" value={entry.details.input} />}
          {detailPairs.map(([label, value]) => value && (
            <DetailBlock key={label} label={label} value={value} />
          ))}
          {(entry.details.truncated || entry.details.redacted) && (
            <p className="activity-detail-notice">
              {entry.details.truncated && t('activityTruncated')}
              {entry.details.truncated && entry.details.redacted && ' · '}
              {entry.details.redacted && t('activityRedacted')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface TurnContext {
  copyText: string
  todo: TodoProgress | null
  lastUserText: string | null
}

/** 从 transcript 聚合某回合的正文与最后用户消息（按 turnId）。 */
function computeTurnContext(transcript: Transcript, turnId: string): TurnContext {
  const markdowns: string[] = []
  let lastUserText: string | null = null
  for (const entry of transcript.entries) {
    if (entry.turnId !== turnId) continue
    if (entry.type === 'assistant_markdown') markdowns.push(entry.markdown)
    if (entry.type === 'terminal' && entry.partialMarkdown) markdowns.push(entry.partialMarkdown)
    if (entry.type === 'user') lastUserText = entry.text
  }
  const copyText = markdowns.join('\n\n')
  return { copyText, todo: extractTodoProgress(copyText), lastUserText }
}

/** 生成中：从流式正文提取 todo 清单，显示实时进度条；无清单不渲染。 */
export function TodoProgressBar({ text }: { text: string }) {
  const { t } = useTranslation()
  const todo = useTodoProgress(text)
  if (!todo) return null
  const percent = todo.total > 0 ? Math.round((todo.done / todo.total) * 100) : 0
  const label = format(t('todoCount'), { done: todo.done, total: todo.total })
  return (
    <div className="todo-progress" role="status" aria-label={label}>
      <div className="todo-progress-track">
        <div className="todo-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="todo-progress-label">{label}</span>
    </div>
  )
}

/** 回合结束操作行：todo 徽章、复制整回合、重试。 */function TurnActions({ turn, onRetry, canRetry }: {
  turn: TurnContext
  onRetry: (() => void) | null
  canRetry: boolean
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const hasText = turn.copyText.length > 0
  const copy = () => {
    if (!hasText) return
    navigator.clipboard.writeText(turn.copyText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="terminal-meta-row">
      {turn.todo && (
        <span className="todo-badge" title={t('todoSummary')}>
          <Check size={12} />
          {format(t('todoCount'), { done: turn.todo.done, total: turn.todo.total })}
        </span>
      )}
      <button
        type="button"
        className="terminal-action-button"
        onClick={copy}
        disabled={!hasText}
        title={t('copyTurn')}
        aria-label={t('copyTurn')}
      >
        {copied ? <Check size={12} /> : <Clipboard size={12} />}
        <span>{copied ? t('copied') : t('copyTurn')}</span>
      </button>
      {onRetry && (
        <button
          type="button"
          className="terminal-action-button"
          onClick={onRetry}
          disabled={!canRetry}
          title={t('retryTurn')}
          aria-label={t('retryTurn')}
        >
          <RotateCcw size={12} />
          <span>{t('retryTurn')}</span>
        </button>
      )}
    </div>
  )
}

function EntryView({ entry, turn, onRetry, canRetry, projectPath }: {
  entry: Exclude<TranscriptEntry, TranscriptActivityEntry>
  turn: TurnContext
  onRetry: (() => void) | null
  canRetry: boolean
  projectPath: string | null
}) {
  const { t } = useTranslation()
  if (entry.type === 'user') {
    return <div className="message-row user-row"><div className="message-content user-message">{entry.text}</div></div>
  }
  if (entry.type === 'assistant_markdown') {
    return <div className="message-row assistant-row"><div className="message-content assistant-message"><MarkdownContent content={entry.markdown} projectPath={projectPath} /></div></div>
  }
  if (entry.type === 'notice') {
    return <div className="transcript-notice" role="status"><CircleAlert size={15} /><span>{noticeText(entry.notice, t)}</span></div>
  }
  if (entry.outcome === 'completed') {
    return (
      <div className="terminal-usage">
        {entry.usage && <UsageLine usage={entry.usage} />}
        <TurnActions turn={turn} onRetry={null} canRetry={false} />
      </div>
    )
  }
  if (entry.outcome === 'error') {
    return (
      <div>
        <div className="error-message" role="alert"><XCircle size={17} /><span>{entry.errorMessage}</span></div>
        <TurnActions turn={turn} onRetry={onRetry} canRetry={canRetry} />
      </div>
    )
  }
  return (
    <div>
      <div className="interrupted-message">
        <span>{t('generationStopped')}</span>
        {entry.partialMarkdown && <div className="interrupted-content"><MarkdownContent content={entry.partialMarkdown} projectPath={projectPath} /></div>}
      </div>
      <TurnActions turn={turn} onRetry={onRetry} canRetry={canRetry} />
    </div>
  )
}

/** CLI 实时阶段 → 本地化文案；未知阶段回退显示原文。 */
function phaseLabel(phase: string, t: (key: TranslationKey) => string): string {
  const key = PHASE_LABELS[phase]
  return key ? t(key) : phase
}

const PHASE_LABELS: Record<string, TranslationKey> = {
  'reading workspace': 'phaseReadingWorkspace',
  'creating context': 'phaseCreatingContext',
  thinking: 'phaseThinking',
  'executing tools': 'phaseExecutingTools',
  'waiting for tool result': 'phaseWaitingToolResult',
}

export default function TranscriptView({ transcript, streamingText, streamingThinking, streamingThinkingTokens, streamingPhase, isGenerating, liveStatus, projectPath }: Props) {
  const { t } = useTranslation()
  const retryLastTurn = useAppStore((s) => s.retryLastTurn)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const hasRunningActivity = transcript.entries.some(
    (entry) => entry.type === 'tool_activity' && entry.state === 'running'
  )
  const emptyTurn: TurnContext = { copyText: '', todo: null, lastUserText: null }

  const handleRetry = () => {
    if (!activeSessionId || isGenerating) return
    void retryLastTurn(activeSessionId)
  }

  return (
    <>
      {groupEntries(transcript.entries).map((item) => (
        item.kind === 'activities'
          ? <ActivityGroup key={item.entries.map((entry) => entry.id).join(':')} entries={item.entries} projectPath={projectPath} />
          : item.entry.type === 'terminal'
            ? <EntryView
                key={item.entry.id}
                entry={item.entry}
                turn={computeTurnContext(transcript, item.entry.turnId)}
                onRetry={item.entry.outcome === 'error' || item.entry.outcome === 'interrupted' ? handleRetry : null}
                canRetry={!isGenerating}
                projectPath={projectPath}
              />
            : <EntryView key={item.entry.id} entry={item.entry} turn={emptyTurn} onRetry={null} canRetry={false} projectPath={projectPath} />
      ))}
      {isGenerating && streamingThinking && (
        <ThinkingBlock key="live-thinking" text={streamingThinking} tokens={streamingThinkingTokens} />
      )}
      {isGenerating && streamingText && (
        <div className="message-row assistant-row">
          <div className="message-content assistant-message streaming-message">
            <TodoProgressBar text={streamingText} />
            <MarkdownContent content={streamingText} projectPath={projectPath} />
            <span className="streaming-cursor" aria-label={t('generatingPlaceholder')} />
          </div>
        </div>
      )}
      {isGenerating && !streamingText && !hasRunningActivity && (
        <div className="generation-status">
          <span className="status-spinner" aria-hidden="true" />
          <span className={streamingPhase && !liveStatus ? 'status-phase' : undefined}>
            {liveStatus ? noticeText(liveStatus, t) : streamingPhase ? phaseLabel(streamingPhase, t) : t('claudeProcessing')}
          </span>
        </div>
      )}
    </>
  )
}
