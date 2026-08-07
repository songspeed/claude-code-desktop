import { useEffect, useMemo, useState } from 'react'
import {
  CircleAlert,
  FolderOpen,
  Languages,
  MessageSquarePlus,
  Palette,
  PanelLeftOpen,
  Search,
  Settings,
} from 'lucide-react'
import { useAppStore } from './store/appStore'
import { useTranslation } from './i18n'
import SessionList from './components/SessionList'
import ChatView from './components/ChatView'
import SettingsWorkspace from './components/SettingsWorkspace'
import CommandPalette, { type PaletteAction } from './components/CommandPalette'
import SessionSearchDialog from './components/SessionSearchDialog'
import { useRoundEndNotifications } from './components/useRoundEndNotifications'
import type { SettingsSection } from './components/settingsCatalog'

type WorkspaceView = 'chat' | 'settings'

const THEME_CYCLE = ['light', 'dark', 'system'] as const
const LOCALE_CYCLE = ['zh-CN', 'en'] as const

export default function App() {
  const init = useAppStore((s) => s.init)
  const cliAvailable = useAppStore((s) => s.cliAvailable)
  const cliError = useAppStore((s) => s.cliError)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const activeTask = useAppStore((s) => s.taskStates[s.activeSessionId ?? ''])
  const createSession = useAppStore((s) => s.createSession)
  const switchSession = useAppStore((s) => s.switchSession)
  const chooseProjectDirectory = useAppStore((s) => s.chooseProjectDirectory)
  const setAppearancePreference = useAppStore((s) => s.setAppearancePreference)
  const appearancePreference = useAppStore((s) => s.appearancePreference)
  const setLocale = useAppStore((s) => s.setLocale)
  const locale = useAppStore((s) => s.locale)
  const [view, setView] = useState<WorkspaceView>('chat')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('agent-models')
  const [settingsSearchFocusRequest, setSettingsSearchFocusRequest] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { t } = useTranslation()

  useRoundEndNotifications()

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
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleSettingsShortcut)
    return () => window.removeEventListener('keydown', handleSettingsShortcut)
  }, [])

  // 窗口标题反映生成状态
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const isGenerating = activeTask?.status === 'running'
  useEffect(() => {
    const base = activeSession?.title || t('conversation')
    document.title = isGenerating ? `${base} · ${t('generatingTitleSuffix')}` : base
  }, [activeSession?.title, isGenerating, t])

  const paletteActions = useMemo<PaletteAction[]>(() => [
    {
      id: 'new-session',
      labelKey: 'commandNewSession',
      Icon: MessageSquarePlus,
      run: () => { void createSession() },
    },
    {
      id: 'search-sessions',
      labelKey: 'commandSearchSessions',
      Icon: Search,
      run: () => setSearchOpen(true),
    },
    {
      id: 'open-settings',
      labelKey: 'commandOpenSettings',
      Icon: Settings,
      run: () => {
        setView('settings')
        setSettingsSearchFocusRequest((request) => request + 1)
      },
    },
    {
      id: 'toggle-theme',
      labelKey: 'commandToggleTheme',
      Icon: Palette,
      run: () => {
        const currentIndex = THEME_CYCLE.indexOf(appearancePreference as (typeof THEME_CYCLE)[number])
        const next = THEME_CYCLE[(currentIndex + 1) % THEME_CYCLE.length]
        void setAppearancePreference(next)
      },
    },
    {
      id: 'toggle-language',
      labelKey: 'commandToggleLanguage',
      Icon: Languages,
      run: () => {
        const currentIndex = LOCALE_CYCLE.indexOf(locale)
        const next = LOCALE_CYCLE[(currentIndex + 1) % LOCALE_CYCLE.length]
        void setLocale(next)
      },
    },
    {
      id: 'open-project',
      labelKey: 'commandOpenProject',
      Icon: FolderOpen,
      disabled: !activeSessionId || !activeSession?.projectPath,
      run: () => {
        if (activeSessionId) void chooseProjectDirectory(activeSessionId)
      },
    },
  ], [activeSession?.projectPath, activeSessionId, appearancePreference, createSession, locale, setAppearancePreference, setLocale])

  const handleSearchSelect = (sessionId: string) => {
    setSearchOpen(false)
    if (view !== 'chat') setView('chat')
    void switchSession(sessionId)
  }

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
      <CommandPalette
        open={paletteOpen}
        actions={paletteActions}
        onClose={() => setPaletteOpen(false)}
      />
      <SessionSearchDialog
        open={searchOpen}
        sessions={sessions}
        onClose={() => setSearchOpen(false)}
        onSelect={(session) => handleSearchSelect(session.id)}
      />
    </div>
  )
}
