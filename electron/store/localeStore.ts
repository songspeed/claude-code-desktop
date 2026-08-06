import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { DEFAULT_APP_LOCALE, type AppLocale } from './types'

function isAppLocale(value: unknown): value is AppLocale {
  return value === 'zh-CN' || value === 'en'
}

export function normalizeAppLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_APP_LOCALE
}

export function readAppLocaleFromFile(filePath: string): AppLocale {
  try {
    if (!existsSync(filePath)) return DEFAULT_APP_LOCALE
    const data = JSON.parse(readFileSync(filePath, 'utf8')) as { locale?: unknown }
    return normalizeAppLocale(data.locale)
  } catch {
    return DEFAULT_APP_LOCALE
  }
}

export function writeAppLocaleToFile(filePath: string, locale: AppLocale): boolean {
  const temporaryPath = `${filePath}.tmp`
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(temporaryPath, JSON.stringify({ locale }, null, 2), 'utf8')
    renameSync(temporaryPath, filePath)
    return true
  } catch (error) {
    console.error('[localeStore] 写入语言偏好失败', error)
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    } catch {
      // Ignore cleanup failures; the original preference file remains intact.
    }
    return false
  }
}

function localePreferencesPath(): string {
  return join(app.getPath('userData'), 'language-preferences.json')
}

export function readAppLocale(): AppLocale {
  return readAppLocaleFromFile(localePreferencesPath())
}

export function writeAppLocale(locale: AppLocale): boolean {
  return writeAppLocaleToFile(localePreferencesPath(), locale)
}
