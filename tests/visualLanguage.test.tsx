import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import BrandMark from '../src/components/BrandMark'

const read = (path: string) => readFileSync(new URL(path, import.meta.url))

describe('product visual language', () => {
  it('ships a single brand source in native desktop icon formats', () => {
    const svg = read('../resources/app-icon.svg').toString('utf8')
    const png = read('../resources/app-icon.png')
    const icns = read('../resources/app-icon.icns')
    const ico = read('../resources/app-icon.ico')
    const packageJson = JSON.parse(read('../package.json').toString('utf8')) as {
      build: { icon: string; mac: { icon: string }; win: { icon: string }; linux: { icon: string } }
    }

    expect(svg).toContain('#F06432')
    expect(svg).toContain('#27313B')
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(1)
    expect(packageJson.build).toMatchObject({
      icon: 'resources/app-icon.png',
      mac: { icon: 'resources/app-icon.icns' },
      win: { icon: 'resources/app-icon.ico' },
      linux: { icon: 'resources/icons' },
    })
  })

  it('uses a compact orange ray-and-terminal mark in the sidebar', () => {
    const html = renderToStaticMarkup(<BrandMark />)
    const styles = read('../src/App.css').toString('utf8')

    expect(html).toContain('brand-mark-rays')
    expect(html.match(/<i/g)).toHaveLength(10)
    expect(html).toContain('brand-mark-terminal')
    expect(styles).toContain('--brand: #f06432')
    expect(styles).toContain('[data-theme="dark"] .brand-mark-terminal')
  })

  it('defines readable glass tokens and fallback surfaces for both themes', () => {
    const styles = read('../src/App.css').toString('utf8')
    const mainSource = read('../electron/main.ts').toString('utf8')

    expect(styles).toContain('--glass-blur: 18px')
    expect(styles).toContain('--glass-blur: 20px')
    expect(styles).toContain('background: var(--surface)')
    expect(styles).toContain('backdrop-filter: blur(var(--glass-blur))')
    expect(styles).toContain('.assistant-message pre')
    expect(mainSource).toContain("'resources', 'app-icon.png'")
    expect(mainSource).toContain("app.dock?.setIcon(iconPath)")
  })
})
