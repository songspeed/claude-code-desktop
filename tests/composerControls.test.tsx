import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AVAILABLE_MODELS,
  DEFAULT_PERMISSION_MODE,
  PERMISSION_OPTIONS,
  normalizePermissionMode,
} from '../electron/store/types'
import { getModelOptionLabel } from '../src/components/ModelPicker'

describe('组合器模型和授权控件', () => {
  it('只规范化当前可执行的授权模式，并对旧值回退到默认值', () => {
    expect(PERMISSION_OPTIONS.map((option) => option.id)).toEqual([
      'acceptEdits',
      'plan',
      'dontAsk',
      'bypassPermissions',
    ])
    expect(normalizePermissionMode('manual')).toBe(DEFAULT_PERMISSION_MODE)
    expect(normalizePermissionMode('dontAsk')).toBe('dontAsk')
    expect(PERMISSION_OPTIONS.find((option) => option.id === 'plan')?.label).toBe('仅规划')
  })

  it('以紧凑格式展示模型档位和实际模型 ID，并在生成期间锁定模型和授权选择', () => {
    const modelSource = readFileSync(new URL('../src/components/ModelPicker.tsx', import.meta.url), 'utf8')
    const permissionSource = readFileSync(new URL('../src/components/PermissionPicker.tsx', import.meta.url), 'utf8')
    const sonnet = AVAILABLE_MODELS.find((model) => model.id === 'sonnet')!
    const opus = AVAILABLE_MODELS.find((model) => model.id === 'opus')!
    const fable = AVAILABLE_MODELS.find((model) => model.id === 'fable')!

    expect(AVAILABLE_MODELS.map((model) => model.id)).toEqual([
      'sonnet',
      'opus',
      'claude-haiku-4-5-20251001',
      'fable',
    ])
    expect(getModelOptionLabel(sonnet, {
      path: '/tmp/.claude/settings.json',
      defaultModel: 'sonnet',
      sonnetModel: 'claude-sonnet-custom',
      opusModel: '',
      haikuModel: '',
      fableModel: 'claude-fable-custom',
    })).toBe('Sonnet · claude-sonnet-custom')
    expect(getModelOptionLabel(opus, null)).toBe('Opus · opus')
    expect(getModelOptionLabel(fable, {
      path: '/tmp/.claude/settings.json',
      defaultModel: 'sonnet',
      sonnetModel: '',
      opusModel: '',
      haikuModel: '',
      fableModel: 'claude-fable-custom',
    })).toBe('Fable · claude-fable-custom')
    expect(modelSource).toContain('getModelOptionLabel(model, claudeUserModelConfig)')
    expect(modelSource).toContain("taskState?.status === 'running' || taskState?.status === 'queued'")
    expect(modelSource).toContain('disabled={isGeneratingActiveSession}')
    expect(permissionSource).toContain('PERMISSION_OPTIONS.map')
    expect(permissionSource).toContain("taskState?.status === 'running' || taskState?.status === 'queued'")
    expect(permissionSource).toContain('disabled={isGeneratingActiveSession}')
  })

  it('让主进程使用会话保存的授权模式，而非渲染层发送参数', () => {
    const mainSource = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
    const preloadSource = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')

    expect(mainSource).toContain('permissionMode: session.permissionMode')
    expect(preloadSource).not.toContain('permissionMode: PermissionMode')
  })
})
