import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkCodePathLinks from '../src/components/markdown/remarkCodePathLinks'
import {
  FILE_REFERENCE_PATTERN,
  isPathLike,
  parseFileLink,
} from '../src/components/markdown/pathUtils'

/** 用统一管线跑插件（transform 阶段），返回 mdast 树中的链接节点 url 列表。 */
async function extractLinks(text: string): Promise<string[]> {
  const tree = unified().use(remarkParse).parse(text)
  await unified().use(remarkCodePathLinks).run(tree)
  const links: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const item = node as { type?: string; url?: string; children?: unknown[] }
    if (item.type === 'link' && item.url) links.push(item.url)
    if (Array.isArray(item.children)) item.children.forEach(walk)
  }
  walk(tree as unknown)
  return links
}

describe('isPathLike', () => {
  it('accepts candidates with separators', () => {
    expect(isPathLike('src/main.ts')).toBe(true)
    expect(isPathLike('docs/api/index.md')).toBe(true)
    expect(isPathLike('C:\\Users\\me\\file.ts')).toBe(true)
  })

  it('accepts candidates with a code extension', () => {
    expect(isPathLike('main.ts')).toBe(true)
    expect(isPathLike('README.md')).toBe(true)
    expect(isPathLike('package.json')).toBe(true)
  })

  it('rejects domain-like or extensionless fragments', () => {
    expect(isPathLike('example.com')).toBe(false)
    expect(isPathLike('localhost')).toBe(false)
    expect(isPathLike('v1.2')).toBe(false)
    expect(isPathLike('12')).toBe(false)
  })
})

describe('remarkCodePathLinks', () => {
  it('converts a path:line reference into a ccd-file link', async () => {
    const links = await extractLinks('请修改 src/main.ts:12 处的函数。')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatch(/^ccd-file:\/\//)
    const parsed = parseFileLink(links[0]!)
    expect(parsed).toEqual({ path: 'src/main.ts', line: 12 })
  })

  it('does not match time-like fragments', async () => {
    expect(await extractLinks('请在 12:30 之前完成')).toEqual([])
  })

  it('does not match version numbers', async () => {
    expect(await extractLinks('依赖版本升级到 v2.3:14 即可')).toEqual([])
    expect(await extractLinks('升级到 2.5:20 版本')).toEqual([])
  })

  it('does not match domain hosts or URLs with ports', async () => {
    expect(await extractLinks('访问 https://example.com:8080/api 获取数据')).toEqual([])
    expect(await extractLinks('请求 localhost:8080')).toEqual([])
  })

  it('does not match extensionless fragments', async () => {
    expect(await extractLinks('参照 readme:10 的说明')).toEqual([])
  })

  it('preserves surrounding text and multiple references', async () => {
    const links = await extractLinks('先看 a.ts:1，再看 b.ts:2。')
    expect(links).toHaveLength(2)
  })

  it('supports Windows absolute paths', async () => {
    const links = await extractLinks('问题在 C:\\repo\\src\\app.ts:42')
    const parsed = parseFileLink(links[0]!)
    expect(parsed?.path).toBe('C:\\repo\\src\\app.ts')
    expect(parsed?.line).toBe(42)
  })

  it('supports backslash-relative paths', async () => {
    const links = await extractLinks('参考 src\\util\\format.ts:7')
    const parsed = parseFileLink(links[0]!)
    expect(parsed?.path).toBe('src\\util\\format.ts')
    expect(parsed?.line).toBe(7)
  })
})

describe('FILE_REFERENCE_PATTERN', () => {
  it('requires a non-digit boundary after the line number', () => {
    FILE_REFERENCE_PATTERN.lastIndex = 0
    const match = FILE_REFERENCE_PATTERN.exec('src/main.ts:1234a')
    expect(match).not.toBeNull()
    expect(match![3]).toBe('1234')
  })

  it('supports drive-letter prefixes in absolute paths', () => {
    FILE_REFERENCE_PATTERN.lastIndex = 0
    const match = FILE_REFERENCE_PATTERN.exec('C:\\repo\\src\\app.ts:42')
    expect(match).not.toBeNull()
    expect(match![2]).toBe('C:\\repo\\src\\app.ts')
    expect(match![3]).toBe('42')
  })
})
