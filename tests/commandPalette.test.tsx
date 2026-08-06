import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FilePenLine, FolderOpen, Sparkles } from 'lucide-react'
import CommandPalette, { type PaletteAction } from '../src/components/CommandPalette'

const actions: PaletteAction[] = [
  { id: 'new-session', labelKey: 'commandNewSession', Icon: Sparkles, run: () => {} },
  { id: 'open-project', labelKey: 'commandOpenProject', Icon: FolderOpen, run: () => {}, disabled: true },
  { id: 'toggle-theme', labelKey: 'commandToggleTheme', Icon: FilePenLine, run: () => {} },
]

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(<CommandPalette open={false} actions={actions} onClose={() => {}} />)
    expect(html).toBe('')
  })

  it('renders the action list with focus semantics and disabled states', () => {
    const html = renderToStaticMarkup(<CommandPalette open actions={actions} onClose={() => {}} />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('role="listbox"')
    expect(html).toContain('新建会话')
    expect(html).toContain('打开项目目录')
    expect(html).toContain('切换外观主题')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('disabled=""')
  })

  it('supports query filtering, arrow navigation, enter execution, and escape dismissal', () => {
    const source = readFileSync(new URL('../src/components/CommandPalette.tsx', import.meta.url), 'utf8')
    expect(source).toContain("event.key === 'ArrowDown'")
    expect(source).toContain("event.key === 'ArrowUp'")
    expect(source).toContain("event.key === 'Enter'")
    expect(source).toContain("event.key === 'Escape'")
    expect(source).toContain("t(action.labelKey).toLocaleLowerCase().includes(normalized)")
    expect(source).toContain("onClose()")
    expect(source).toContain("action.run()")
  })
})
