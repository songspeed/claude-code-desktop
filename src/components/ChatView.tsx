import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Bot, Bug, CircleAlert, Code2, FolderOpen, FolderSearch, ShieldCheck, Wrench, X } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { translate, useTranslation, type TranslationKey } from '../i18n'
import Composer from './Composer'
import ModelPicker from './ModelPicker'
import PermissionPicker from './PermissionPicker'
import TranscriptView from './TranscriptView'
import { useThrottledStream } from './useThrottledStream'
import {
  transcriptFromLegacyMessages,
  type Message,
  type Transcript,
  type TranscriptNotice,
} from '../../electron/store/types'

interface Props {
  sessionId: string
}

const starterPromptDefinitions: Array<{
  titleKey: TranslationKey
  descriptionKey: TranslationKey
  promptKey: TranslationKey
  Icon: typeof FolderSearch
}> = [
  {
    titleKey: 'exploreProject',
    descriptionKey: 'exploreProjectDescription',
    promptKey: 'exploreProjectPrompt',
    Icon: FolderSearch,
  },
  {
    titleKey: 'planChange',
    descriptionKey: 'planChangeDescription',
    promptKey: 'planChangePrompt',
    Icon: Code2,
  },
  {
    titleKey: 'fixIssue',
    descriptionKey: 'fixIssueDescription',
    promptKey: 'fixIssuePrompt',
    Icon: Bug,
  },
  {
    titleKey: 'reviewWorkspace',
    descriptionKey: 'reviewWorkspaceDescription',
    promptKey: 'reviewWorkspacePrompt',
    Icon: Wrench,
  },
]

export function getStarterPrompts(locale: 'zh-CN' | 'en') {
  return starterPromptDefinitions.map(({ titleKey, descriptionKey, promptKey, Icon }) => ({
    title: translate(locale, titleKey),
    description: translate(locale, descriptionKey),
    prompt: translate(locale, promptKey),
    Icon,
  }))
}

export const starterPrompts = getStarterPrompts('zh-CN')
export const CHAT_FOLLOW_THRESHOLD = 96
const EMPTY_MESSAGES: Message[] = []

export function isNearChatBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= CHAT_FOLLOW_THRESHOLD
}

/**
 * 只跟踪来自 Agent 的可见输出。用户消息不应被计入“新输出”，而活动结果更新
 * 必须参与签名，即使该活动并非 transcript 中最后一个条目。
 */
export function getTranscriptOutputSignature(
  transcript: Transcript,
  streamingText: string,
  liveStatus: TranscriptNotice | null,
  streamingThinking = '',
  streamingThinkingTokens: number | null = null
): string {
  const outputEntries = transcript.entries.filter((entry) => entry.type !== 'user')
  return JSON.stringify({ outputEntries, streamingText, streamingThinking, streamingThinkingTokens, liveStatus })
}

export function nextUnseenOutputCount(
  currentCount: number,
  outputChanged: boolean,
  nearBottom: boolean
): number {
  if (!outputChanged || nearBottom) return 0
  return currentCount + 1
}

export default function ChatView({ sessionId }: Props) {
  const messages = useAppStore((s) => s.messages[sessionId] ?? EMPTY_MESSAGES)
  const transcript = useAppStore((s) => s.transcripts[sessionId])
  const taskState = useAppStore((s) => s.taskStates[sessionId])
  const isGenerating = taskState?.status === 'running'
  const streamingText = taskState?.streamingText ?? ''
  const streamingThinking = taskState?.streamingThinking ?? ''
  const streamingThinkingTokens = taskState?.streamingThinkingTokens ?? null
  const streamingPhase = taskState?.streamingPhase ?? null
  const liveStatus = taskState?.liveStatus ?? null
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const projectError = useAppStore((s) => s.projectError)
  const chooseProjectDirectory = useAppStore((s) => s.chooseProjectDirectory)
  const revealProjectDirectory = useAppStore((s) => s.revealProjectDirectory)
  const abortGeneration = useAppStore((s) => s.abortGeneration)
  const { locale, t } = useTranslation()

  const [draft, setDraft] = useState('')
  const [focusToken, setFocusToken] = useState(0)
  const [nearBottom, setNearBottom] = useState(true)
  const [unseenOutputCount, setUnseenOutputCount] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastOutputRef = useRef<string | null>(null)
  const viewedSessionRef = useRef<string | null>(null)
  const session = sessions.find((item) => item.id === sessionId)
  const isActiveSession = activeSessionId === sessionId
  const isGeneratingSession = isGenerating
  // 节流后的流式值同时驱动输出签名与渲染，保证「未读输出」计数不与显示错位。
  const visibleStreamingText = useThrottledStream(isGeneratingSession ? streamingText : '')
  const visibleStreamingThinking = useThrottledStream(isGeneratingSession ? streamingThinking : '')
  const visibleStreamingThinkingTokens = isGeneratingSession ? streamingThinkingTokens : null
  const visibleStreamingPhase = isGeneratingSession ? streamingPhase : null
  const visibleLiveStatus = isGeneratingSession ? liveStatus : null
  const visibleTranscript = useMemo(
    () => transcript ?? transcriptFromLegacyMessages(messages),
    [messages, transcript]
  )
  const isEmptySession = visibleTranscript.entries.length === 0 && !isGeneratingSession
  const projectPath = session?.projectPath ?? null
  const projectName = projectPath?.split(/[\\/]/).filter(Boolean).pop() ?? null
  const translatedStarterPrompts = getStarterPrompts(locale)

  const outputSignature = useMemo(() => {
    return getTranscriptOutputSignature(
      visibleTranscript,
      visibleStreamingText,
      visibleLiveStatus,
      visibleStreamingThinking,
      visibleStreamingThinkingTokens
    )
  }, [visibleLiveStatus, visibleStreamingText, visibleStreamingThinking, visibleStreamingThinkingTokens, visibleTranscript])

  const scrollToLatest = (behavior: ScrollBehavior = 'smooth') => {
    const container = scrollRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
    setNearBottom(true)
    setUnseenOutputCount(0)
  }

  const updateReadingPosition = () => {
    const container = scrollRef.current
    if (!container) return
    const isNearBottom = isNearChatBottom(container.scrollHeight, container.scrollTop, container.clientHeight)
    setNearBottom(isNearBottom)
    if (isNearBottom) setUnseenOutputCount(0)
  }

  useEffect(() => {
    const isNewSession = viewedSessionRef.current !== sessionId
    const outputChanged = lastOutputRef.current !== outputSignature
    viewedSessionRef.current = sessionId
    lastOutputRef.current = outputSignature

    if (isNewSession) {
      setNearBottom(true)
      setUnseenOutputCount(0)
      requestAnimationFrame(() => scrollToLatest('instant'))
      return
    }
    if (!outputChanged || !isActiveSession) return
    if (nearBottom) {
      requestAnimationFrame(() => scrollToLatest('smooth'))
    } else {
      setUnseenOutputCount((count) => nextUnseenOutputCount(count, outputChanged, nearBottom))
    }
  }, [isActiveSession, nearBottom, outputSignature, sessionId])

  useEffect(() => {
    setDraft('')
    setFocusToken((value) => value + 1)
  }, [sessionId])

  const useStarterPrompt = (prompt: string) => {
    setDraft(prompt)
    setFocusToken((value) => value + 1)
  }

  return (
    <div className="chat-view">
      <header className="workspace-heading">
        <div className="workspace-title-group">
          <h1>{session?.title ?? t('conversation')}</h1>
          <span>{projectName ?? t('noProjectLinked')}</span>
        </div>
        <div className="workspace-heading-actions">
          {projectPath && (
            <button
              className="icon-button workspace-icon-action"
              onClick={() => revealProjectDirectory(sessionId)}
              title={t('openProjectDirectory')}
              aria-label={t('openProjectDirectory')}
            >
              <FolderOpen size={17} />
            </button>
          )}
            <button
              className="icon-button workspace-icon-action"
              onClick={() => chooseProjectDirectory(sessionId)}
            disabled={isGeneratingSession}
            title={projectPath ? t('changeProjectDirectory') : t('selectProjectDirectory')}
            aria-label={projectPath ? t('changeProjectDirectory') : t('selectProjectDirectory')}
          >
            <FolderSearch size={17} />
          </button>
        </div>
      </header>

      <div className="chat-scroll" ref={scrollRef} onScroll={updateReadingPosition}>
        <div className="chat-column">
          {isEmptySession && !projectPath && (
            <section className="empty-state project-setup-state" aria-label={t('linkLocalProject')}>
              <div className="empty-state-symbol"><FolderOpen size={30} strokeWidth={1.6} /></div>
              <h2>{t('linkLocalProject')}</h2>
              <p>{t('linkLocalProjectDescription')}</p>
              <button
                className="choose-project-button"
                onClick={() => chooseProjectDirectory(sessionId)}
                disabled={isGeneratingSession}
              >
                <FolderOpen size={17} />
                <span>{t('selectProjectDirectory')}</span>
              </button>
              {projectError && <p className="project-context-error" role="alert">{projectError}</p>}
            </section>
          )}

          {isEmptySession && projectPath && (
            <section className="empty-state" aria-label={t('startNewTask')}>
              <div className="empty-state-symbol"><Code2 size={32} strokeWidth={1.6} /></div>
              <h2>{t('startFromProjectName').replace('{project}', projectName ?? '')}</h2>
              <div className="starter-grid">
                {translatedStarterPrompts.map(({ title, description, prompt, Icon }) => (
                  <button
                    key={title}
                    className="starter-card"
                    onClick={() => useStarterPrompt(prompt)}
                  >
                    <Icon size={20} />
                    <div className="starter-card-copy">
                      <span className="starter-card-title">{title}</span>
                      <p className="starter-card-description">{description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {!isEmptySession && (
            <TranscriptView
              transcript={visibleTranscript}
              streamingText={visibleStreamingText}
              streamingThinking={visibleStreamingThinking}
              streamingThinkingTokens={visibleStreamingThinkingTokens}
              streamingPhase={visibleStreamingPhase}
              isGenerating={isGeneratingSession}
              liveStatus={visibleLiveStatus}
              projectPath={projectPath}
            />
          )}
          {taskState?.status === 'queued' && (
            <div className="generation-status queued-task-status" role="status">
              <span>{taskState.queuePosition ? t('queuedTaskPosition').replace('{position}', String(taskState.queuePosition)) : t('queuedTask')}</span>
              <button className="icon-button compact" onClick={() => void abortGeneration(sessionId)} title={t('cancelQueuedTask')} aria-label={t('cancelQueuedTask')}><X size={15} /></button>
            </div>
          )}
          {taskState && (taskState.status === 'queued' || taskState.status === 'running') && taskState.externalProcessBoundary && (
            <div className="task-boundary-notice" role="note" title={t('externalProcessBoundary')}><CircleAlert size={13} /> {t('externalProcessBoundary')}</div>
          )}
        </div>
      </div>

      {unseenOutputCount > 0 && (
        <button
          type="button"
          className="jump-latest-button"
          onClick={() => scrollToLatest()}
          aria-label={t('jumpToLatest')}
        >
          <ArrowDown size={16} />
          <span>{t('jumpToLatest')}</span>
          <small>{t('newOutputCount').replace('{count}', String(unseenOutputCount))}</small>
        </button>
      )}

      <div className="composer-region">
        <div className="composer-context">
          <div className="context-meta">
            <button
              className={`project-context-control${projectPath ? '' : ' is-empty'}`}
              onClick={() => chooseProjectDirectory(sessionId)}
              disabled={isGeneratingSession}
              title={projectPath ?? t('selectProjectDirectory')}
            >
              <FolderOpen size={14} />
              <span>{projectName ?? t('selectProjectDirectory')}</span>
            </button>
          </div>
          <div className="context-controls">
            <div className="composer-context-control" title={t('selectModel')}>
              <Bot size={14} aria-hidden="true" />
              <ModelPicker />
            </div>
            <div className="composer-context-control" title={t('selectPermissionMode')}>
              <ShieldCheck size={14} aria-hidden="true" />
              <PermissionPicker />
            </div>
          </div>
        </div>
        {projectError && projectPath && <div className="project-context-error composer-project-error" role="alert">{projectError}</div>}
        <Composer value={draft} onChange={setDraft} focusToken={focusToken} />
      </div>
    </div>
  )
}
