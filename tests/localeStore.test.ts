import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { mockUserData } = vi.hoisted(() => ({ mockUserData: { dir: '' } }))

vi.mock('electron', () => ({
  app: { getPath: () => mockUserData.dir },
}))

import {
  readAppLocale,
  readAppLocaleFromFile,
  writeAppLocale,
  writeAppLocaleToFile,
} from '../electron/store/localeStore'

describe('localeStore', () => {
  beforeEach(() => {
    mockUserData.dir = mkdtempSync(join(tmpdir(), 'ccd-locale-'))
  })

  afterEach(() => {
    rmSync(mockUserData.dir, { recursive: true, force: true })
  })

  it('defaults to Simplified Chinese when the preference is missing, invalid, or corrupted', () => {
    const filePath = join(mockUserData.dir, 'invalid.json')
    expect(readAppLocaleFromFile(filePath)).toBe('zh-CN')
    writeFileSync(filePath, JSON.stringify({ locale: 'fr-FR' }), 'utf8')
    expect(readAppLocaleFromFile(filePath)).toBe('zh-CN')
    writeFileSync(filePath, '{', 'utf8')
    expect(readAppLocaleFromFile(filePath)).toBe('zh-CN')
  })

  it('persists a selected language in the Electron user data directory', () => {
    expect(readAppLocale()).toBe('zh-CN')
    expect(writeAppLocale('en')).toBe(true)
    expect(readAppLocale()).toBe('en')
    expect(readFileSync(join(mockUserData.dir, 'language-preferences.json'), 'utf8')).toContain('"en"')

    const alternatePath = join(mockUserData.dir, 'alternate.json')
    expect(writeAppLocaleToFile(alternatePath, 'zh-CN')).toBe(true)
    expect(readAppLocaleFromFile(alternatePath)).toBe('zh-CN')
  })
})
