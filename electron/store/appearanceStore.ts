import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AppearancePreference, EffectiveTheme } from './types'

export const DEFAULT_APPEARANCE_PREFERENCE: AppearancePreference = 'system'

function isAppearancePreference(value: unknown): value is AppearancePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function normalizeAppearancePreference(value: unknown): AppearancePreference {
  return isAppearancePreference(value) ? value : DEFAULT_APPEARANCE_PREFERENCE
}

export function resolveEffectiveTheme(
  preference: AppearancePreference,
  systemUsesDarkColors: boolean
): EffectiveTheme {
  if (preference === 'system') return systemUsesDarkColors ? 'dark' : 'light'
  return preference
}

export function readAppearancePreferenceFromFile(filePath: string): AppearancePreference {
  try {
    if (!existsSync(filePath)) return DEFAULT_APPEARANCE_PREFERENCE
    const data = JSON.parse(readFileSync(filePath, 'utf8')) as { appearancePreference?: unknown }
    return normalizeAppearancePreference(data.appearancePreference)
  } catch {
    return DEFAULT_APPEARANCE_PREFERENCE
  }
}

export function writeAppearancePreferenceToFile(
  filePath: string,
  preference: AppearancePreference
): boolean {
  const temporaryPath = `${filePath}.tmp`
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(temporaryPath, JSON.stringify({ appearancePreference: preference }, null, 2), 'utf8')
    renameSync(temporaryPath, filePath)
    return true
  } catch (error) {
    console.error('[appearanceStore] 写入外观偏好失败', error)
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    } catch {
      // Ignore cleanup failures; the original preference file remains intact.
    }
    return false
  }
}

function appearancePreferencesPath(): string {
  return join(app.getPath('userData'), 'appearance-preferences.json')
}

export function readAppearancePreference(): AppearancePreference {
  return readAppearancePreferenceFromFile(appearancePreferencesPath())
}

export function writeAppearancePreference(preference: AppearancePreference): boolean {
  return writeAppearancePreferenceToFile(appearancePreferencesPath(), preference)
}
