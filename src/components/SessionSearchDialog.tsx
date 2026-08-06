import { Folder, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Session } from '../../electron/store/types'
import { useTranslation } from '../i18n'

function projectName(projectPath: string | null): string {
  return projectPath?.split(/[\\/]/).filter(Boolean).pop() ?? ''
}

function formatSessionTime(updatedAt: number, locale: string): string {
  const date = new Date(updatedAt)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })
}

export function filterSessions(sessions: Session[], query: string): Session[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return sessions
  return sessions.filter((session) => {
    const searchable = `${session.title} ${projectName(session.projectPath)}`.toLocaleLowerCase()
    return searchable.includes(normalizedQuery)
  })
}

interface Props {
  open: boolean
  sessions: Session[]
  onClose: () => void
  onSelect: (session: Session) => void
}

export default function SessionSearchDialog({ open, sessions, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => filterSessions(sessions, query), [query, sessions])
  const { locale, t } = useTranslation()

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, sessions])

  if (!open) return null

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (results.length) setActiveIndex((index) => Math.min(index + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault()
      onSelect(results[activeIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="session-search-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <div className="session-search-dialog" role="dialog" aria-modal="true" aria-label={t('searchConversations')}>
        <div className="session-search-input-row">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('searchConversationOrProject')}
            aria-label={t('searchConversationOrProject')}
          />
          <button className="icon-button compact" onClick={onClose} title={t('closeSearch')} aria-label={t('closeSearch')}>
            <X size={16} />
          </button>
        </div>
        <div className="session-search-result-header">
          {query.trim() ? t('searchResults') : t('recentConversations')}
        </div>
        <div className="session-search-results" role="listbox" aria-label={t('searchResults')}>
          {results.length ? results.map((session, index) => {
            const name = projectName(session.projectPath)
            return (
              <button
                key={session.id}
                className={`session-search-result${index === activeIndex ? ' is-active' : ''}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onSelect(session)}
              >
                <span className="session-search-result-icon"><Search size={15} /></span>
                <span className="session-search-result-copy">
                  <strong>{session.title}</strong>
                  <small>
                    <Folder size={12} />
                    <span>{name || t('noProjectLinked')}</span>
                    <time>{formatSessionTime(session.updatedAt, locale)}</time>
                  </small>
                </span>
              </button>
            )
          }) : (
            <div className="session-search-empty">{t('noMatchingConversations')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
