import { useEffect, useRef, useState } from 'react'
import { PanelLeftClose, Pencil, Plus, Search, Settings2, Trash2 } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useTranslation } from '../i18n'
import SessionSearchDialog from './SessionSearchDialog'
import BrandMark from './BrandMark'

interface Props {
  isSettings: boolean
  onOpenSettings: () => void
  onOpenChat: () => void
  onCollapse: () => void
}

function formatSessionTime(updatedAt: number, locale: string): string {
  const date = new Date(updatedAt)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })
}

export default function SessionList({ isSettings, onOpenSettings, onOpenChat, onCollapse }: Props) {
  const sessions = useAppStore((s) => s.sessions)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const isGenerating = useAppStore((s) => s.isGenerating)
  const createSession = useAppStore((s) => s.createSession)
  const switchSession = useAppStore((s) => s.switchSession)
  const renameSession = useAppStore((s) => s.renameSession)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const { locale, t } = useTranslation()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) editInputRef.current?.focus()
  }, [editingId])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      } else if (event.key === 'Escape') {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  const commitEdit = () => {
    if (editingId && editTitle.trim()) renameSession(editingId, editTitle.trim())
    setEditingId(null)
  }

  const sessionToDelete = sessions.find((session) => session.id === deleteConfirmId)

  return (
    <div className="session-list">
      <div className="sidebar-top">
          <div className="sidebar-brand-row">
            <div className="sidebar-brand" aria-label="Claude Code Desktop">
              <BrandMark />
            <span>Claude Code</span>
          </div>
          <div className="sidebar-brand-actions">
            <button
              className="icon-button compact"
              onClick={() => setSearchOpen(true)}
              title={t('searchConversations')}
              aria-label={t('searchConversations')}
            >
              <Search size={16} />
            </button>
            <button
              className="icon-button compact"
              onClick={() => {
                setSearchOpen(false)
                onCollapse()
              }}
              title={t('collapseSidebar')}
              aria-label={t('collapseSidebar')}
            >
              <PanelLeftClose size={17} />
            </button>
          </div>
        </div>
        <button
          className="new-session-button"
          onClick={async () => {
            await createSession()
            onOpenChat()
          }}
          disabled={isGenerating}
          title={t('newConversation')}
        >
          <Plus size={16} />
          <span>{t('newConversation')}</span>
        </button>
      </div>

      <div className="session-section-heading">
        <span>{t('recentConversations')}</span>
        <span>{sessions.length}</span>
      </div>

      <div className="session-list-scroll">
        {sessions.length === 0 && (
          <div className="sidebar-empty">{t('createConversationToStart')}</div>
        )}

        {sessions.map((session) => {
          const isActive = session.id === activeSessionId
          const isEditing = editingId === session.id
          const projectName = session.projectPath?.split(/[\\/]/).filter(Boolean).pop()

          return (
            <div
              key={session.id}
              className={`session-item${isActive ? ' is-active' : ''}${isEditing ? ' is-editing' : ''}`}
              onClick={() => {
                if (!isEditing) {
                  void switchSession(session.id)
                  onOpenChat()
                }
              }}
              role="button"
              tabIndex={isEditing ? -1 : 0}
              onKeyDown={(event) => {
                if (!isEditing && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  void switchSession(session.id)
                  onOpenChat()
                }
              }}
            >
              <div className="session-item-content">
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    className="session-title-input"
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitEdit()
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={t('conversationTitle')}
                  />
                ) : (
                  <>
                    <div className="session-title">{session.title}</div>
                    <div className="session-time" title={session.projectPath ?? undefined}>
                      {projectName ? `${projectName} · ${formatSessionTime(session.updatedAt, locale)}` : t('noProjectLinked')}
                    </div>
                  </>
                )}
              </div>

              {!isEditing && (
                <div className="session-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    className="icon-button compact"
                    onClick={() => {
                      setEditingId(session.id)
                      setEditTitle(session.title)
                    }}
                    title={t('renameConversation')}
                    aria-label={t('renameConversation')}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="icon-button compact danger"
                    onClick={() => setDeleteConfirmId(session.id)}
                    title={t('deleteConversation')}
                    aria-label={t('deleteConversation')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="sidebar-bottom">
        <button
          className={`sidebar-settings-button${isSettings ? ' is-active' : ''}`}
          onClick={onOpenSettings}
          aria-current={isSettings ? 'page' : undefined}
          title={t('settings')}
        >
          <Settings2 size={18} />
          <span>{t('settings')}</span>
        </button>
      </div>

      {deleteConfirmId && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
            <div className="modal-icon danger"><Trash2 size={20} /></div>
            <div>
              <h2 id="delete-dialog-title">{t('deleteConversationQuestion')}</h2>
              <p>“{sessionToDelete?.title}”{t('deleteConversationDescription')}</p>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setDeleteConfirmId(null)}>{t('cancel')}</button>
              <button
                className="danger-button"
                onClick={() => {
                  deleteSession(deleteConfirmId)
                  setDeleteConfirmId(null)
                }}
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      <SessionSearchDialog
        open={searchOpen}
        sessions={sessions}
        onClose={() => setSearchOpen(false)}
        onSelect={(session) => {
          setSearchOpen(false)
          void switchSession(session.id).then(onOpenChat)
        }}
      />
    </div>
  )
}
