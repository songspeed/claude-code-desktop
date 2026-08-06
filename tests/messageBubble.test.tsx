import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MessageBubble, { MarkdownContent } from '../src/components/MessageBubble'

const { mockIpc } = vi.hoisted(() => ({
  mockIpc: {
    openPath: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(true),
  },
}))

vi.mock('../src/ipc', () => ({ ipc: mockIpc }))

describe('MessageBubble 主题化代码块', () => {
  it('renders a highlighted code block with an accessible copy control', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'assistant-code',
          role: 'assistant',
          text: '```ts\nconst theme = "dark"\n```',
          createdAt: 0,
        }}
      />
    )

    expect(html).toContain('code-block')
    expect(html).toContain('copy-button')
    expect(html).toContain('aria-label="复制代码"')
  })

  it('defines syntax colors for both effective themes', () => {
    const styles = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
    expect(styles).toContain('.hljs-keyword')
    expect(styles).toContain('[data-theme="dark"] .hljs-keyword')
  })
})

describe('MarkdownContent GFM 渲染', () => {
  const gfmMarkdown = [
    '| 列 A | 列 B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '- [x] 已完成项',
    '- [ ] 待办项',
    '',
    '~~删除线文本~~ 与脚注[^1]。',
    '',
    '[^1]: 脚注说明。',
  ].join('\n')

  it('renders tables, task lists, strikethrough, and footnotes without leaking raw markers', () => {
    const html = renderToStaticMarkup(<MarkdownContent content={gfmMarkdown} />)

    expect(html).toContain('<table>')
    expect(html).toContain('<th>')
    expect(html).toContain('<del>')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('<sup>')
    expect(html).toContain('脚注说明')
    expect(html).not.toContain('~~删除线文本~~')
    expect(html).not.toContain('- [ ]')
    expect(html).not.toContain('[^1]')
  })

  it('leaves the source table pipes out of rendered cells', () => {
    const html = renderToStaticMarkup(<MarkdownContent content={gfmMarkdown} />)
    const tableRegion = html.slice(html.indexOf('<table>'), html.indexOf('</table>'))
    expect(tableRegion).toContain('1')
    expect(tableRegion).toContain('2')
    expect(tableRegion).not.toMatch(/\| 列 A/)
  })
})

describe('MarkdownContent 文件路径引用', () => {
  it('renders a clickable link for an existing file path with workspace context', async () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content="见 src/main.ts:42 处。" projectPath="C:\\repo" />
    )
    expect(html).toContain('class="code-path-link"')
    expect(html).toMatch(/title="[^"]*main\.ts"/)
    expect(html).toContain('>src/main.ts:42</a>')
  })

  it('degrades to a non-clickable reference without a workspace or on missing files', async () => {
    const withoutWorkspace = renderToStaticMarkup(
      <MarkdownContent content="见 src/main.ts:42 处。" projectPath={null} />
    )
    expect(withoutWorkspace).toContain('class="code-path-reference"')
    expect(withoutWorkspace).not.toContain('class="code-path-link"')

    const source = readFileSync(new URL('../src/components/MessageBubble.tsx', import.meta.url), 'utf8')
    expect(source).toContain("ipc.pathExists(absolutePath)")
    expect(source).toContain("ipc.openPath(absolutePath)")
  })
})
