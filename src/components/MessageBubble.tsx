import { useState } from 'react'
import { Check, ChevronDown, ChevronUp, Clipboard, Wrench, XCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import type { Message } from '../../electron/store/types'
import { useTranslation } from '../i18n'

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

export function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      rehypePlugins={[rehypeHighlight]}
      components={{
        code(props) {
          const { className, children, ...rest } = props
          const isBlock = /language-/.test(className || '')
          const codeText = String(children).replace(/\n$/, '')
          if (isBlock) {
            return (
              <span className="code-block">
                <code className={className} {...rest}>{children}</code>
                <CopyButton text={codeText} />
              </span>
            )
          }
          return <code className={className} {...rest}>{children}</code>
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

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
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{message.text}</ReactMarkdown>
          </div>
        )}
      </div>
    )
  }

  return null
}
