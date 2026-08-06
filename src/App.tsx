import { useEffect, useState } from 'react'
import { CircleAlert, PanelLeftOpen } from 'lucide-react'
import { useAppStore } from './store/appStore'
import { useTranslation } from './i18n'
import SessionList from './components/SessionList'
import ChatView from './components/ChatView'
import SettingsWorkspace from './components/SettingsWorkspace'
import type { SettingsSection } from './components/settingsCatalog'

type WorkspaceView = 'chat' | 'settings'

export default function App() {
  const init = useAppStore((s) => s.init)
  const cliAvailable = useAppStore((s) => s.cliAvailable)
  const cliError = useAppStore((s) => s.cliError)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const createSession = useAppStore((s) => s.createSession)
  const [view, setView] = useState<WorkspaceView>('chat')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('agent-models')
  const [settingsSearchFocusRequest, setSettingsSearchFocusRequest] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    init()
  }, [init])

  // 若无会话则自动创建一个
  useEffect(() => {
    if (cliAvailable !== null && sessions.length === 0) {
      createSession()
    }
  }, [cliAvailable, sessions.length, createSession])

  useEffect(() => {
    const handleSettingsShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        setView('settings')
        setSettingsSearchFocusRequest((request) => request + 1)
      }
    }
    window.addEventListener('keydown', handleSettingsShortcut)
    return () => window.removeEventListener('keydown', handleSettingsShortcut)
  }, [])

  return (
    <div className={`app-layout${view === 'chat' && sidebarCollapsed ? ' is-sidebar-collapsed' : ''}${view === 'settings' ? ' is-settings-workspace' : ''}`}>
      {view === 'chat' && <aside className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
        <SessionList
          isSettings={false}
          onOpenSettings={() => setView('settings')}
          onOpenChat={() => setView('chat')}
          onCollapse={() => setSidebarCollapsed(true)}
        />
      </aside>}
      <main className="main-area">
        {view === 'chat' && sidebarCollapsed && (
          <button
            className="icon-button sidebar-expand-button"
            onClick={() => setSidebarCollapsed(false)}
            title={t('expandSidebar')}
            aria-label={t('expandSidebar')}
          >
            <PanelLeftOpen size={18} />
          </button>
        )}
        {view === 'chat' && cliAvailable === false && (
          <div className="cli-alert" role="alert">
            <CircleAlert size={18} />
            <div>
              <span>{t('cliUnavailableAlert')}</span>
              {cliError && <div>{cliError}</div>}
            </div>
          </div>
        )}
        {view === 'settings' ? (
          <SettingsWorkspace
            activeSection={settingsSection}
            onSectionChange={setSettingsSection}
            onReturnToApp={() => setView('chat')}
            searchFocusRequest={settingsSearchFocusRequest}
          />
        ) : activeSessionId ? (
          <ChatView sessionId={activeSessionId} />
        ) : (
          <div className="main-empty-state">
            {cliAvailable === null ? t('initializing') : t('chooseOrCreateConversation')}
          </div>
        )}
      </main>
    </div>
  )
}
