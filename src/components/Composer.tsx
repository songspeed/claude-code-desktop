import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, FileText, Sparkles, Square, Terminal } from 'lucide-react'
import type { AppLocale, InstalledSkill, WorkspaceFile } from '../../electron/store/types'
import { DESKTOP_SLASH_COMMANDS } from '../../electron/cli/slashCommands'
import { ipc } from '../ipc'
import { useAppStore } from '../store/appStore'
import { slashCommandDescription, translate, useTranslation } from '../i18n'

interface Props {
  value: string
  onChange: (value: string) => void
  focusToken: number
}

export interface ComposerCompletion {
  kind: 'files' | 'slash'
  query: string
  start: number
  end: number
}

export interface ComposerCompletionOption {
  id: string
  value: string
  description: string
  kind: 'files' | 'commands' | 'skills'
}

export function getComposerState(
  value: string,
  isGenerating: boolean,
  hasActiveSession: boolean,
  hasProjectContext = true,
  cliAvailable = true
): 'is-idle' | 'is-ready' | 'is-generating' {
  if (isGenerating) return 'is-generating'
  return value.trim() && hasActiveSession && hasProjectContext && cliAvailable ? 'is-ready' : 'is-idle'
}

export function getComposerPlaceholder(
  isGenerating: boolean,
  hasActiveSession: boolean,
  hasProjectContext: boolean,
  cliAvailable: boolean,
  locale: AppLocale = 'zh-CN',
  isTaskRunningElsewhere = false
): string {
  if (isGenerating) return translate(locale, 'generatingPlaceholder')
  if (isTaskRunningElsewhere) return translate(locale, 'taskRunningElsewherePlaceholder')
  if (!hasProjectContext) return translate(locale, 'projectRequiredPlaceholder')
  if (!hasActiveSession) return translate(locale, 'conversationRequiredPlaceholder')
  if (!cliAvailable) return translate(locale, 'cliRequiredPlaceholder')
  return translate(locale, 'describeTaskPlaceholder')
}

export function getComposerTaskState(
  isGenerating: boolean,
  generatingSessionId: string | null,
  activeSessionId: string | null
): { isGeneratingCurrentSession: boolean; isTaskRunningElsewhere: boolean; showStopAction: boolean } {
  const isGeneratingCurrentSession = isGenerating && generatingSessionId === activeSessionId
  return {
    isGeneratingCurrentSession,
    isTaskRunningElsewhere: isGenerating && !isGeneratingCurrentSession,
    showStopAction: isGeneratingCurrentSession,
  }
}

/** 根据光标所在词识别 @ 文件引用或行首 /Skill 引用。 */
export function getComposerCompletion(value: string, cursor: number): ComposerCompletion | null {
  const beforeCursor = value.slice(0, Math.max(0, Math.min(cursor, value.length)))
  const fileMatch = /(^|[\s(\[{'",，。；：])@([^\s@]*)$/.exec(beforeCursor)
  if (fileMatch) {
    return {
      kind: 'files',
      query: fileMatch[2] ?? '',
      start: beforeCursor.length - fileMatch[0].length + (fileMatch[1]?.length ?? 0),
      end: beforeCursor.length,
    }
  }

  const lineStart = beforeCursor.lastIndexOf('\n') + 1
  const slashMatch = /^(\s*)\/([^\s/]*)$/.exec(beforeCursor.slice(lineStart))
  if (!slashMatch) return null
  return {
    kind: 'slash',
    query: slashMatch[2] ?? '',
    start: lineStart + (slashMatch[1]?.length ?? 0),
    end: beforeCursor.length,
  }
}

/** 用补全项替换当前触发词，并将光标置于可继续输入参数的位置。 */
export function applyComposerCompletion(
  value: string,
  completion: ComposerCompletion,
  option: string
): { value: string; cursor: number } {
  const token = completion.kind === 'files' ? `@${option}` : `/${option}`
  const suffix = value.slice(completion.end)
  const separator = !suffix || /^\s/.test(suffix) ? ' ' : ''
  const nextValue = `${value.slice(0, completion.start)}${token}${separator}${suffix}`
  return { value: nextValue, cursor: completion.start + token.length + separator.length }
}

export function getSlashCompletionOptions(
  skills: InstalledSkill[],
  query: string,
  locale: AppLocale
): ComposerCompletionOption[] {
  const normalizedQuery = query.toLocaleLowerCase()
  const commands = DESKTOP_SLASH_COMMANDS
    .filter((command) => {
      const description = slashCommandDescription(locale, command.name)
      return !normalizedQuery || `${command.name} ${description}`.toLocaleLowerCase().includes(normalizedQuery)
    })
    .map((command) => ({
      id: `command:${command.name}`,
      value: command.name,
      description: slashCommandDescription(locale, command.name),
      kind: 'commands' as const,
    }))
  const installedSkills = skills
    .filter((skill) => !normalizedQuery || `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(normalizedQuery))
    .slice(0, 12)
    .map((skill) => ({
      id: `skill:${skill.path}`,
      value: skill.name,
      description: skill.description,
      kind: 'skills' as const,
    }))
  return [...commands, ...installedSkills]
}

export default function Composer({ value, onChange, focusToken }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRequestRef = useRef(0)
  const isGenerating = useAppStore((s) => s.isGenerating)
  const generatingSessionId = useAppStore((s) => s.generatingSessionId)
  const sendMessage = useAppStore((s) => s.sendMessage)
  const abortGeneration = useAppStore((s) => s.abortGeneration)
  const skills = useAppStore((s) => s.skills)
  const skillsLoading = useAppStore((s) => s.skillsLoading)
  const refreshSkills = useAppStore((s) => s.refreshSkills)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const cliAvailable = useAppStore((s) => s.cliAvailable)
  const activeSession = useAppStore((s) => s.sessions.find((session) => session.id === s.activeSessionId))
  const { locale, t } = useTranslation()
  const [completion, setCompletion] = useState<ComposerCompletion | null>(null)
  const [fileOptions, setFileOptions] = useState<WorkspaceFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [activeOptionIndex, setActiveOptionIndex] = useState(0)
  const hasProjectContext = Boolean(activeSession?.projectPath)
  const canUseCli = cliAvailable === true
  const { isGeneratingCurrentSession, isTaskRunningElsewhere, showStopAction } = getComposerTaskState(
    isGenerating,
    generatingSessionId,
    activeSessionId
  )
  const composerState = getComposerState(value, isGeneratingCurrentSession, Boolean(activeSessionId), hasProjectContext, canUseCli)
  const placeholder = getComposerPlaceholder(
    isGeneratingCurrentSession,
    Boolean(activeSessionId),
    hasProjectContext,
    canUseCli,
    locale,
    isTaskRunningElsewhere
  )
  const canSend = composerState === 'is-ready' && !isTaskRunningElsewhere

  const resizeTextarea = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    if (!value) {
      textarea.style.height = '28px'
      return
    }
    textarea.style.height = '28px'
    textarea.style.height = `${Math.max(28, Math.min(textarea.scrollHeight, 200))}px`
  }

  useEffect(() => {
    resizeTextarea()
  }, [value])

  useEffect(() => {
    if (focusToken > 0) textareaRef.current?.focus()
  }, [focusToken])

  useEffect(() => {
    if (activeSessionId && hasProjectContext) void refreshSkills(activeSessionId)
  }, [activeSessionId, hasProjectContext, refreshSkills])

  useEffect(() => {
    if (completion?.kind !== 'files' || !activeSessionId || !hasProjectContext) {
      setFilesLoading(false)
      return
    }

    const requestId = ++fileRequestRef.current
    setFilesLoading(true)
    setFileOptions([])
    const timer = window.setTimeout(() => {
      void ipc.listWorkspaceFiles(activeSessionId, completion.query)
        .then((files) => {
          if (fileRequestRef.current === requestId) setFileOptions(files)
        })
        .catch(() => {
          if (fileRequestRef.current === requestId) setFileOptions([])
        })
        .finally(() => {
          if (fileRequestRef.current === requestId) setFilesLoading(false)
        })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [activeSessionId, completion?.kind, completion?.query, hasProjectContext])

  const completionOptions = useMemo<ComposerCompletionOption[]>(() => {
    if (!completion) return []
    if (completion.kind === 'files') {
      return fileOptions.map((file) => ({
        id: `file:${file.path}`,
        value: file.path,
        description: file.path,
        kind: 'files',
      }))
    }
    return getSlashCompletionOptions(skills, completion.query, locale)
  }, [completion, fileOptions, locale, skills])

  useEffect(() => setActiveOptionIndex(0), [completion?.kind, completion?.query, completionOptions.length])

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || isGenerating || !activeSessionId || !hasProjectContext || !canUseCli) return
    sendMessage(trimmed)
    onChange('')
    setCompletion(null)
  }

  const updateCompletion = (nextValue: string, cursor: number) => {
    setCompletion(getComposerCompletion(nextValue, cursor))
  }

  const selectCompletion = (index: number) => {
    const option = completionOptions[index]
    if (!option || !completion) return
    const applied = applyComposerCompletion(value, completion, option.value)
    onChange(applied.value)
    setCompletion(null)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(applied.cursor, applied.cursor)
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (completion && (completionOptions.length > 0 || filesLoading || (completion.kind === 'slash' && skillsLoading))) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (completionOptions.length) {
          event.preventDefault()
          const offset = event.key === 'ArrowDown' ? 1 : -1
          setActiveOptionIndex((index) => (index + offset + completionOptions.length) % completionOptions.length)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setCompletion(null)
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && completionOptions.length) {
        event.preventDefault()
        selectCompletion(activeOptionIndex)
        return
      }
      if (event.key === 'Enter' && filesLoading) {
        event.preventDefault()
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={`composer-shell ${composerState}`}>
      <div className="composer-editor">
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            updateCompletion(event.target.value, event.currentTarget.selectionStart)
          }}
          onKeyDown={handleKeyDown}
          onSelect={(event) => updateCompletion(event.currentTarget.value, event.currentTarget.selectionStart)}
          onFocus={(event) => updateCompletion(event.currentTarget.value, event.currentTarget.selectionStart)}
          onBlur={() => setCompletion(null)}
          placeholder={placeholder}
          disabled={isGenerating || !activeSessionId || !hasProjectContext || !canUseCli}
          rows={1}
          aria-label={t('messageInput')}
          aria-autocomplete="list"
          aria-expanded={Boolean(completion)}
          aria-controls={completion ? 'composer-completion-list' : undefined}
          aria-activedescendant={completionOptions[activeOptionIndex]?.id}
        />
      </div>
      <div className="composer-action-area">
        {showStopAction ? (
          <button
            className="composer-action stop"
            onClick={() => abortGeneration(activeSessionId ?? undefined)}
            title={t('stopGenerating')}
            aria-label={t('stopGenerating')}
          >
            <Square size={15} fill="currentColor" />
          </button>
        ) : (
          <button
            className="composer-action"
            onClick={handleSend}
            disabled={!canSend}
            title={t('sendMessage')}
            aria-label={t('sendMessage')}
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        )}
      </div>
      {completion && (
        <div className="composer-autocomplete" id="composer-completion-list" role="listbox" aria-label={t(completion.kind === 'files' ? 'fileSuggestions' : 'slashSuggestions')}>
          <div className="composer-autocomplete-heading">
            {t(completion.kind === 'files' ? 'fileSuggestions' : 'slashSuggestions')}
          </div>
          {completion.kind === 'files' && filesLoading && (
            <div className="composer-autocomplete-status">{t('loadingFiles')}</div>
          )}
          {!filesLoading && completionOptions.length === 0 && (
            <div className="composer-autocomplete-status">
              {t(completion.kind === 'files' ? 'noMatchingFiles' : 'noMatchingSlashOptions')}
            </div>
          )}
          {completionOptions.map((option, index) => (
            <button
              key={option.id}
              id={option.id}
              type="button"
              role="option"
              aria-selected={index === activeOptionIndex}
              className={`composer-autocomplete-option${index === activeOptionIndex ? ' is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectCompletion(index)}
            >
              {option.kind === 'files' ? <FileText size={15} /> : option.kind === 'commands' ? <Terminal size={15} /> : <Sparkles size={15} />}
              <span>{option.kind === 'files' ? `@${option.value}` : `/${option.value}`}</span>
              {option.description && option.description !== option.value && <small>{option.description}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
