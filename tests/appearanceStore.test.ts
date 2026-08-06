import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { mockUserData } = vi.hoisted(() => ({ mockUserData: { dir: '' } }))

vi.mock('electron', () => ({
  app: { getPath: () => mockUserData.dir },
}))

import {
  DEFAULT_APPEARANCE_PREFERENCE,
  readAppearancePreference,
  readAppearancePreferenceFromFile,
  resolveEffectiveTheme,
  writeAppearancePreference,
  writeAppearancePreferenceToFile,
} from '../electron/store/appearanceStore'

describe('appearanceStore', () => {
  beforeEach(() => {
    mockUserData.dir = mkdtempSync(join(tmpdir(), 'ccd-appearance-'))
  })

  afterEach(() => {
    rmSync(mockUserData.dir, { recursive: true, force: true })
  })

  it('defaults to system when a preference is missing or invalid', () => {
    const filePath = join(mockUserData.dir, 'invalid.json')
    expect(readAppearancePreferenceFromFile(filePath)).toBe(DEFAULT_APPEARANCE_PREFERENCE)
    writeFileSync(filePath, JSON.stringify({ appearancePreference: 'sepia' }), 'utf8')
    expect(readAppearancePreferenceFromFile(filePath)).toBe(DEFAULT_APPEARANCE_PREFERENCE)
    writeAppearancePreferenceToFile(filePath, 'dark')
    expect(readAppearancePreferenceFromFile(filePath)).toBe('dark')
  })

  it('persists the selected preference in the user data directory', () => {
    expect(readAppearancePreference()).toBe('system')
    expect(writeAppearancePreference('system')).toBe(true)
    expect(readAppearancePreference()).toBe('system')
    expect(readFileSync(join(mockUserData.dir, 'appearance-preferences.json'), 'utf8')).toContain('system')
  })

  it('resolves the system preference and preserves manual choices', () => {
    expect(resolveEffectiveTheme('system', true)).toBe('dark')
    expect(resolveEffectiveTheme('system', false)).toBe('light')
    expect(resolveEffectiveTheme('dark', false)).toBe('dark')
    expect(resolveEffectiveTheme('light', true)).toBe('light')
  })
})
