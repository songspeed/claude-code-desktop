import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '../electron/store/types'
import SessionSearchDialog, { filterSessions } from '../src/components/SessionSearchDialog'

const sessions: Session[] = [
  {
    id: 'session-1', title: '修复登录问题', claudeSessionId: null,
    projectPath: '/work/Portal', model: 'sonnet', permissionMode: 'acceptEdits', createdAt: 0, updatedAt: 1,
  },
  {
    id: 'session-2', title: '规划发布流程', claudeSessionId: null,
    projectPath: '/work/desktop-client', model: 'opus', permissionMode: 'plan', createdAt: 0, updatedAt: 2,
  },
  {
    id: 'session-3', title: '无项目对话', claudeSessionId: null,
    projectPath: null, model: 'sonnet', permissionMode: 'acceptEdits', createdAt: 0, updatedAt: 3,
  },
]

describe('侧栏搜索与收放', () => {
  it('filters loaded sessions by title or project name without reading message content', () => {
    expect(filterSessions(sessions, '发布').map((session) => session.id)).toEqual(['session-2'])
    expect(filterSessions(sessions, 'PORTAL').map((session) => session.id)).toEqual(['session-1'])
    expect(filterSessions(sessions, '   ').map((session) => session.id)).toEqual([
      'session-1', 'session-2', 'session-3',
    ])
    expect(filterSessions(sessions, '不存在')).toEqual([])
  })

  it('renders an accessible local search dialog with keyboard-oriented results', () => {
    const html = renderToStaticMarkup(
      <SessionSearchDialog open sessions={sessions} onClose={() => {}} onSelect={() => {}} />
    )
    const source = readFileSync(new URL('../src/components/SessionSearchDialog.tsx', import.meta.url), 'utf8')

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="搜索对话或项目"')
    expect(html).toContain('role="listbox"')
    expect(html).toContain('修复登录问题')
    expect(html).toContain('desktop-client')
    expect(source).toContain("event.key === 'ArrowDown'")
    expect(source).toContain("event.key === 'Enter'")
    expect(source).toContain("event.key === 'Escape'")
    expect(source).not.toContain('ipc.')
  })

  it('connects search, Command/Ctrl+K, and the sidebar collapse controls', () => {
    const sidebarSource = readFileSync(new URL('../src/components/SessionList.tsx', import.meta.url), 'utf8')
    const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
    const styles = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

    expect(sidebarSource).toContain("title={t('searchConversations')}")
    expect(sidebarSource).toContain("title={t('collapseSidebar')}")
    expect(sidebarSource).toContain("event.metaKey || event.ctrlKey")
    expect(sidebarSource).toContain('<SessionSearchDialog')
    expect(sidebarSource).toContain('void switchSession(session.id)')
    expect(sidebarSource).toContain('void switchSession(session.id).then(onOpenChat)')
    expect(sidebarSource).not.toMatch(/if\s*\(\s*!isGenerating\s*\)\s*\{\s*void switchSession/)
    expect(appSource).toContain('const [sidebarCollapsed, setSidebarCollapsed] = useState(false)')
    expect(appSource).toContain("aria-label={t('expandSidebar')}")
    expect(styles).toContain('.sidebar.is-collapsed')
    expect(styles).toContain('.sidebar-expand-button')
  })
})
