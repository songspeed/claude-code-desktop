import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FilePenLine,
  FileSearch,
  FileText,
  LoaderCircle,
  TerminalSquare,
  Wrench,
  XCircle,
} from 'lucide-react'
import type {
  AppLocale,
  Transcript,
  TranscriptActivityEntry,
  TranscriptActivityState,
  TranscriptEntry,
  TranscriptNotice,
} from '../../electron/store/types'
import { translate, useTranslation, type TranslationKey } from '../i18n'
import { CopyButton, MarkdownContent } from './MessageBubble'

interface Props {
  transcript: Transcript
  streamingText: string
  isGenerating: boolean
  liveStatus: TranscriptNotice | null
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
    case 'details_unavailable': return 'activityUnavailable'
    case 'interrupted': return 'activityInterrupted'
    default: return 'activityRunning'
  }
}

function activityIcon(entry: TranscriptActivityEntry) {
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
  }
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

function ActivityGroup({ entries }: { entries: TranscriptActivityEntry[] }) {
  const { locale, t } = useTranslation()
  const running = entries.some((entry) => entry.state === 'running')
  const failed = entries.some((entry) => entry.state === 'failed')
  const interrupted = entries.some((entry) => entry.state === 'interrupted')
  const unavailable = entries.some((entry) => entry.state === 'details_unavailable')
  const attentionRequired = failed || interrupted || unavailable
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
          {entries.map((entry) => <ActivityRow key={entry.id} entry={entry} />)}
        </div>
      )}
    </section>
  )
}

function ActivityRow({ entry }: { entry: TranscriptActivityEntry }) {
  const { locale, t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const Icon = activityIcon(entry)
  const target = activityTarget(entry)
  const hasDetails = Boolean(entry.details.input || entry.details.output || entry.details.error)
  const detailPairs: Array<[TranslationKey, string | undefined]> = [
    ['activityInput', entry.details.input],
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
          {detailPairs.map(([label, value]) => value && (
            <section key={label} className="activity-detail-block">
              <div>
                <span>{t(label)}</span>
                <CopyButton text={value} />
              </div>
              <pre>{value}</pre>
            </section>
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

function EntryView({ entry }: { entry: Exclude<TranscriptEntry, TranscriptActivityEntry> }) {
  const { t } = useTranslation()
  if (entry.type === 'user') {
    return <div className="message-row user-row"><div className="message-content user-message">{entry.text}</div></div>
  }
  if (entry.type === 'assistant_markdown') {
    return <div className="message-row assistant-row"><div className="message-content assistant-message"><MarkdownContent content={entry.markdown} /></div></div>
  }
  if (entry.type === 'notice') {
    return <div className="transcript-notice" role="status"><CircleAlert size={15} /><span>{noticeText(entry.notice, t)}</span></div>
  }
  if (entry.outcome === 'completed') return null
  if (entry.outcome === 'error') {
    return <div className="error-message" role="alert"><XCircle size={17} /><span>{entry.errorMessage}</span></div>
  }
  return (
    <div className="interrupted-message">
      <span>{t('generationStopped')}</span>
      {entry.partialMarkdown && <div className="interrupted-content"><MarkdownContent content={entry.partialMarkdown} /></div>}
    </div>
  )
}

export default function TranscriptView({ transcript, streamingText, isGenerating, liveStatus }: Props) {
  const { t } = useTranslation()
  const hasRunningActivity = transcript.entries.some(
    (entry) => entry.type === 'tool_activity' && entry.state === 'running'
  )

  return (
    <>
      {groupEntries(transcript.entries).map((item) => (
        item.kind === 'activities'
          ? <ActivityGroup key={item.entries.map((entry) => entry.id).join(':')} entries={item.entries} />
          : <EntryView key={item.entry.id} entry={item.entry} />
      ))}
      {isGenerating && streamingText && (
        <div className="message-row assistant-row">
          <div className="message-content assistant-message streaming-message">
            <MarkdownContent content={streamingText} />
            <span className="streaming-cursor" aria-label={t('generatingPlaceholder')} />
          </div>
        </div>
      )}
      {isGenerating && !streamingText && !hasRunningActivity && (
        <div className="generation-status">
          <span className="status-spinner" aria-hidden="true" />
          <span>{liveStatus ? noticeText(liveStatus, t) : t('claudeProcessing')}</span>
        </div>
      )}
    </>
  )
}
