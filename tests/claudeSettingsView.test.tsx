import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ClaudeSettingsViewContent,
  validateClaudeModelConfig,
} from '../src/components/ClaudeSettingsView'

const config = {
  path: '/tmp/.claude/settings.json',
  defaultModel: 'sonnet',
  sonnetModel: 'claude-sonnet-custom',
  opusModel: 'claude-opus-custom',
  haikuModel: 'claude-haiku-custom',
  fableModel: 'claude-fable-custom',
}

describe('ClaudeSettingsView', () => {
  it('renders the limited model form, CLI health, and refresh actions', () => {
    const html = renderToStaticMarkup(
      <ClaudeSettingsViewContent
        config={config}
        loading={false}
        saving={false}
        error={null}
        onRefresh={() => {}}
        onSave={async () => config}
        cliAvailable
        cliVersion="2.1.0"
        onRefreshCli={() => {}}
      />
    )
    expect(html).toContain('Agent 与模型')
    expect(html).toContain('Claude Code CLI')
    expect(html).toContain('2.1.0')
    expect(html).toContain('默认模型')
    expect(html).toContain('Sonnet 映射')
    expect(html).toContain('Opus 映射')
    expect(html).toContain('Haiku 映射')
    expect(html).toContain('Fable 映射')
    expect(html).toContain('aria-label="重新读取配置"')
    expect(html).toContain('aria-label="刷新 CLI 状态"')
    expect(html).not.toContain('ANTHROPIC_AUTH_TOKEN')
  })

  it('shows a readable config error without exposing a form', () => {
    const html = renderToStaticMarkup(
      <ClaudeSettingsViewContent
        config={null}
        loading={false}
        saving={false}
        error="Claude 用户配置根节点必须是对象。"
        onRefresh={() => {}}
        onSave={async () => null}
      />
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('无法读取或保存模型配置')
    expect(html).not.toContain('claude-model-defaultModel')
  })

  it('uses a projection-only IPC surface with main-process validation', () => {
    const mainSource = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
    const preloadSource = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')
    const rendererSource = readFileSync(new URL('../src/ipc.ts', import.meta.url), 'utf8')

    expect(mainSource).toContain("ipcMain.handle('claude-config:get'")
    expect(mainSource).toContain("ipcMain.handle('claude-config:save'")
    expect(mainSource).toContain('normalizeClaudeUserModelConfigPatch(patch)')
    expect(preloadSource).toContain('getClaudeUserModelConfig')
    expect(preloadSource).toContain('saveClaudeUserModelConfig')
    expect(preloadSource).not.toContain('ANTHROPIC_AUTH_TOKEN')
    expect(rendererSource).toContain('api().saveClaudeUserModelConfig(...args)')
  })

  it('flags local model field constraints while allowing empty mappings', () => {
    expect(validateClaudeModelConfig({
      defaultModel: '', sonnetModel: '', opusModel: '', haikuModel: '', fableModel: '',
    })).toEqual({})
    expect(validateClaudeModelConfig({
      defaultModel: ' sonnet', sonnetModel: '', opusModel: '', haikuModel: '', fableModel: '',
    })).toEqual({ defaultModel: 'invalid' })
    expect(validateClaudeModelConfig({
      defaultModel: 'sonnet\ncustom', sonnetModel: '', opusModel: '', haikuModel: '', fableModel: '',
    })).toEqual({ defaultModel: 'invalid' })
  })
})
