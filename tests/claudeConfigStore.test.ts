import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  normalizeClaudeUserModelConfigPatch,
  readClaudeUserModelConfigFromFile,
  saveClaudeUserModelConfigToFile,
} from '../electron/store/claudeConfigStore'

let temporaryDirectory = ''

function settingsPath(): string {
  return join(temporaryDirectory, '.claude', 'settings.json')
}

describe('claudeConfigStore', () => {
  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'ccd-claude-config-'))
  })

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  it('returns an empty, limited projection when settings.json does not exist', () => {
    expect(readClaudeUserModelConfigFromFile(settingsPath())).toEqual({
      path: settingsPath(),
      defaultModel: '',
      sonnetModel: '',
      opusModel: '',
      haikuModel: '',
      fableModel: '',
    })
  })

  it('extracts only model fields without exposing sensitive env values', () => {
    const filePath = settingsPath()
    const directory = join(temporaryDirectory, '.claude')
    mkdirSync(directory, { recursive: true })
    writeFileSync(filePath, JSON.stringify({
      model: 'opus[1m]',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'secret-token',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-custom',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-custom',
      },
      hooks: { PreToolUse: [{ matcher: 'Bash' }] },
    }), 'utf8')

    expect(readClaudeUserModelConfigFromFile(filePath)).toEqual({
      path: filePath,
      defaultModel: 'opus[1m]',
      sonnetModel: 'claude-sonnet-custom',
      opusModel: '',
      haikuModel: 'claude-haiku-custom',
      fableModel: '',
    })
  })

  it('merges model updates without changing unrelated configuration', () => {
    const filePath = settingsPath()
    const config = saveClaudeUserModelConfigToFile(filePath, {
      defaultModel: ' opus[1m] ',
      sonnetModel: 'claude-sonnet-custom',
      opusModel: 'claude-opus-custom',
      haikuModel: '',
      fableModel: '',
    })
    const root = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>

    expect(config).toMatchObject({ defaultModel: 'opus[1m]', sonnetModel: 'claude-sonnet-custom' })
    expect((root.env as Record<string, unknown>).ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-custom')
    expect((root.env as Record<string, unknown>).ANTHROPIC_DEFAULT_SONNET_MODEL_NAME).toBe('claude-sonnet-custom')
    expect(existsSync(`${filePath}.claude-code-desktop.tmp`)).toBe(false)

    const preserved = {
      env: { ANTHROPIC_AUTH_TOKEN: 'secret-token', ANTHROPIC_DEFAULT_OPUS_MODEL: 'old-opus' },
      hooks: { PreToolUse: [{ matcher: 'Bash' }] },
      permissions: { allow: ['Read'] },
      unknown: true,
    }
    writeFileSync(filePath, JSON.stringify(preserved), 'utf8')
    saveClaudeUserModelConfigToFile(filePath, {
      defaultModel: 'sonnet',
      sonnetModel: '',
      opusModel: 'new-opus',
      haikuModel: 'new-haiku',
      fableModel: 'new-fable',
    })

    const updated = JSON.parse(readFileSync(filePath, 'utf8')) as {
      env: Record<string, unknown>
      hooks: unknown
      permissions: unknown
      unknown: unknown
      model?: string
    }
    expect(updated.model).toBe('sonnet')
    expect(updated.env.ANTHROPIC_AUTH_TOKEN).toBe('secret-token')
    expect(updated.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('new-opus')
    expect(updated.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(updated.hooks).toEqual(preserved.hooks)
    expect(updated.permissions).toEqual(preserved.permissions)
    expect(updated.unknown).toBe(true)
  })

  it('removes cleared fields and rejects malformed values without overwriting files', () => {
    const filePath = settingsPath()
    saveClaudeUserModelConfigToFile(filePath, {
      defaultModel: 'sonnet',
      sonnetModel: 'sonnet-custom',
      opusModel: '',
      haikuModel: '',
      fableModel: '',
    })
    saveClaudeUserModelConfigToFile(filePath, {
      defaultModel: '',
      sonnetModel: '',
      opusModel: '',
      haikuModel: '',
      fableModel: '',
    })
    const cleared = JSON.parse(readFileSync(filePath, 'utf8')) as { env: Record<string, unknown>; model?: string }
    expect(cleared.model).toBeUndefined()
    expect(cleared.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(cleared.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME).toBeUndefined()

    writeFileSync(filePath, '{not json', 'utf8')
    expect(() => readClaudeUserModelConfigFromFile(filePath)).toThrow('无法解析 Claude 用户配置')
    expect(() => saveClaudeUserModelConfigToFile(filePath, {
      defaultModel: 'sonnet', sonnetModel: '', opusModel: '', haikuModel: '', fableModel: '',
    })).toThrow('无法解析 Claude 用户配置')
    expect(readFileSync(filePath, 'utf8')).toBe('{not json')

    expect(() => normalizeClaudeUserModelConfigPatch({
      defaultModel: 'line\nbreak', sonnetModel: '', opusModel: '', haikuModel: '', fableModel: '',
    })).toThrow('模型名称')
    expect(() => normalizeClaudeUserModelConfigPatch({
      defaultModel: 'x'.repeat(201), sonnetModel: '', opusModel: '', haikuModel: '', fableModel: '',
    })).toThrow('模型名称')
  })

  it.each([
    ['array root', '[]'],
    ['non-object env', JSON.stringify({ env: 'invalid' })],
  ])('rejects a %s without overwriting it', (_name, content) => {
    const filePath = settingsPath()
    mkdirSync(join(temporaryDirectory, '.claude'), { recursive: true })
    writeFileSync(filePath, content, 'utf8')

    expect(() => readClaudeUserModelConfigFromFile(filePath)).toThrow()
    expect(() => saveClaudeUserModelConfigToFile(filePath, {
      defaultModel: 'sonnet', sonnetModel: '', opusModel: '', haikuModel: '', fableModel: '',
    })).toThrow()
    expect(readFileSync(filePath, 'utf8')).toBe(content)
  })
})
