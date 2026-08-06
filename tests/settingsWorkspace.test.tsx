import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AboutSettingsViewContent } from '../src/components/AboutSettingsView'
import SettingsWorkspace from '../src/components/SettingsWorkspace'
import {
  findSettingsSearchResults,
  SETTINGS_CATALOG,
  SETTINGS_SECTIONS,
} from '../src/components/settingsCatalog'
import { translate } from '../src/i18n'

describe('settings workspace', () => {
  it('uses an independent settings shell with grouped entries that have real content', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        activeSection="agent-models"
        onSectionChange={() => {}}
        onReturnToApp={() => {}}
        searchFocusRequest={0}
      />
    )

    expect(SETTINGS_SECTIONS).toEqual(['agent-models', 'appearance', 'language', 'skills', 'about'])
    expect(SETTINGS_CATALOG.map((item) => item.group)).toEqual([
      'application', 'application', 'application', 'agent-models', 'tools-integrations',
    ])
    expect(html).toContain('返回应用')
    expect(html).toContain('应用')
    expect(html).toContain('Agent 与模型')
    expect(html).toContain('工具与集成')
    expect(html).toContain('搜索设置')
    expect(html).toContain('aria-current="page"')
  })

  it('searches only localized directory metadata for pages, fields, and actions', () => {
    const t = (key: Parameters<typeof translate>[1]) => translate('zh-CN', key)

    expect(findSettingsSearchResults('Sonnet', t)).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: 'agent-models', targetId: 'claude-model-sonnetModel' }),
    ]))
    expect(findSettingsSearchResults('重新读取', t)).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: 'agent-models', targetId: 'claude-refresh' }),
    ]))
    expect(findSettingsSearchResults('刷新', t)).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: 'skills', targetId: 'skills-refresh' }),
    ]))
    expect(findSettingsSearchResults('/tmp/.claude/settings.json', t)).toEqual([])
    expect(findSettingsSearchResults('conversation content', t)).toEqual([])
  })

  it('keeps existing settings pages available under the workspace', () => {
    const about = renderToStaticMarkup(
      <AboutSettingsViewContent
        appInfo={{
          name: 'Claude Code Desktop',
          version: '0.1.0',
          electronVersion: '36.4.0',
          platform: 'darwin',
          arch: 'arm64',
        }}
        appInfoError={null}
        cliAvailable
        cliVersion="2.1.0"
      />
    )
    expect(about).toContain('Claude Code Desktop')
    expect(about).toContain('应用版本')
    expect(about).toContain('2.1.0')
  })

  it('defines a responsive shell, target focus, guarded leave flow, and application shortcut', () => {
    const styles = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
    const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
    const workspaceSource = readFileSync(new URL('../src/components/SettingsWorkspace.tsx', import.meta.url), 'utf8')

    expect(styles).toContain('.settings-workspace')
    expect(styles).toContain('.settings-workspace-nav')
    expect(styles).toContain('.settings-workspace { flex-direction: column; }')
    expect(workspaceSource).toContain('data-settings-target')
    expect(workspaceSource).toContain('pendingNavigation')
    expect(workspaceSource).toContain('discardAndContinue')
    expect(workspaceSource).toContain('continueEditing')
    expect(appSource).toContain("event.key === ','")
    expect(appSource).toContain("view === 'chat' && <aside")
    expect(appSource).toContain('<SettingsWorkspace')
  })

  it('keeps fixed setting copy localized in English', () => {
    expect(translate('en', 'agentAndModels')).toBe('Agent and models')
    expect(translate('en', 'languageDescription')).toBe('Choose the display language for client controls and settings.')
    expect(translate('en', 'cliHealthRepair')).toContain('Install and sign in')
  })
})
