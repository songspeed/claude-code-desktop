import { isValidElement, memo, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp, Clipboard, Wrench, XCircle } from 'lucide-react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import type { Message } from '../../electron/store/types'
import { ipc } from '../ipc'
import { useTranslation } from '../i18n'
import remarkCodePathLinks from './markdown/remarkCodePathLinks'
import { FILE_LINK_PROTOCOL, parseFileLink, resolveAbsolutePath } from './markdown/pathUtils'

interface Props {
  message: Message
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button className="copy-button" onClick={copy} title={t('copyCode')} aria-label={t('copyCode')}>
      {copied ? <Check size={14} /> : <Clipboard size={14} />}
    </button>
  )
}

/** 流式容错：围栏未闭合（奇数个 ``` 行）时补上闭合，保证实时高亮不闪烁。 */
function withClosedFences(content: string): string {
  let fences = 0
  for (const line of content.split('\n')) {
    if (/^```/.test(line.trim())) fences += 1
  }
  return fences % 2 === 1 ? `${content}\n\`\`\`` : content
}

function CodeBlock({ language, children }: { language: string; children: ReactNode }) {
  const codeText = String(children).replace(/\n$/, '')
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{language || 'text'}</span>
        <CopyButton text={codeText} />
      </div>
      <pre>{children}</pre>
    </div>
  )
}

/** 从 pre > code 提取语言；裸围栏或无代码子元素时安全回退。 */
function CodeBlockWrapper({ children }: { children?: ReactNode }) {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) {
    return <pre>{children}</pre>
  }
  const child = children as ReactElement<{ className?: string; children?: ReactNode }>
  if (typeof child.type !== 'string' || child.type !== 'code') {
    return <pre>{children}</pre>
  }
  const language = /language-([\w+-]+)/.exec(child.props.className ?? '')?.[1] ?? ''
  return <CodeBlock language={language}>{child}</CodeBlock>
}

/** 正文中的 `路径:行号` 引用链接：解析、校验文件存在、点击打开；不可用时不触发 IPC。 */
function CodePathLink({ href, projectPath, children }: {
  href: string
  projectPath: string | null
  children: ReactNode
}) {
  const parsed = parseFileLink(href)
  const absolutePath = parsed ? resolveAbsolutePath(parsed.path, projectPath) : null
  const [exists, setExists] = useState<boolean | null>(null)

  useEffect(() => {
    if (!absolutePath) {
      setExists(null)
      return
    }
    let cancelled = false
    ipc.pathExists(absolutePath)
      .then((value) => { if (!cancelled) setExists(value) })
      .catch(() => { if (!cancelled) setExists(false) })
    return () => { cancelled = true }
  }, [absolutePath])

  if (!parsed) return <a href={href}>{children}</a>
  const clickable = absolutePath != null && exists !== false
  if (!clickable) return <span className="code-path-reference" title={parsed.path}>{children}</span>
  return (
    <a
      className="code-path-link"
      href="#"
      title={absolutePath ?? undefined}
      onClick={(event) => {
        event.preventDefault()
        if (absolutePath) ipc.openPath(absolutePath).catch(() => {})
      }}
    >
      {children}
    </a>
  )
}

/** memo 化：流式期间已落盘内容（引用稳定）跳过全量重解析。 */
export const MarkdownContent = memo(function MarkdownContent({ content, projectPath }: { content: string; projectPath?: string | null }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkCodePathLinks]}
      rehypePlugins={[rehypeHighlight]}
      urlTransform={(url) => (url.startsWith(FILE_LINK_PROTOCOL) ? url : defaultUrlTransform(url))}
      components={{
        pre: CodeBlockWrapper,
        a: ({ href, children }) => (
          <CodePathLink href={href ?? ''} projectPath={projectPath ?? null}>{children}</CodePathLink>
        ),
      }}
    >
      {withClosedFences(content)}
    </ReactMarkdown>
  )
})

export default function MessageBubble({ message }: Props) {
  const [toolExpanded, setToolExpanded] = useState(false)
  const { t } = useTranslation()

  if (message.role === 'user') {
    return (
      <div className="message-row user-row">
        <div className="message-content user-message">{message.text}</div>
      </div>
    )
  }

  if (message.role === 'assistant') {
    return (
      <div className="message-row assistant-row">
        <div className="message-content assistant-message">
          <MarkdownContent content={message.text ?? ''} />
        </div>
      </div>
    )
  }

  if (message.role === 'tool') {
    return (
      <div className="tool-message">
        <button className="tool-message-trigger" onClick={() => setToolExpanded((value) => !value)}>
          <Wrench size={15} />
          <span>{message.toolName || t('toolCall')}</span>
          {toolExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {toolExpanded && message.toolInput && (
          <pre className="tool-message-content">{message.toolInput}</pre>
        )}
      </div>
    )
  }

  if (message.role === 'error') {
    return (
      <div className="error-message" role="alert">
        <XCircle size={17} />
        <span>{message.errorMessage}</span>
      </div>
    )
  }

  if (message.role === 'interrupted') {
    return (
      <div className="interrupted-message">
        <span>{t('generationStopped')}</span>
        {message.text && (
          <div className="interrupted-content">
            <MarkdownContent content={message.text} />
          </div>
        )}
      </div>
    )
  }

  return null
}
