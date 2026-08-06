import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MessageBubble from '../src/components/MessageBubble'

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
