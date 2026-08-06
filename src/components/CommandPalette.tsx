/**
 * CommandPalette — Ctrl+K 全局面板
 * 聚合新建会话、会话搜索、设置、主题、语言、项目目录等动作。
 * 动作由 App 注入；面板仅负责过滤、键盘导航与执行。
 */
import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation, type TranslationKey } from '../i18n'

export interface PaletteAction {
  id: string
  labelKey: TranslationKey
  Icon: typeof Search
  run: () => void
  disabled?: boolean
}

interface Props {
  open: boolean
  actions: PaletteAction[]
  onClose: () => void
}

export default function CommandPalette({ open, actions, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return actions
    return actions.filter((action) => t(action.labelKey).toLocaleLowerCase().includes(normalized))
  }, [actions, query, t])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, actions])

  if (!open) return null

  const execute = (action: PaletteAction | undefined) => {
    if (!action || action.disabled) return
    onClose()
    action.run()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (results.length) setActiveIndex((index) => Math.min(index + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      execute(results[activeIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <div className="command-palette" role="dialog" aria-modal="true" aria-label={t('commandPalette')}>
        <div className="command-palette-input-row">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            className="command-palette-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPalettePlaceholder')}
            aria-label={t('commandPalettePlaceholder')}
          />
        </div>
        <div className="command-palette-list" role="listbox" aria-label={t('commandPalette')}>
          {results.length ? results.map((action, index) => {
            const Icon = action.Icon
            return (
              <button
                key={action.id}
                type="button"
                className={`command-palette-option${index === activeIndex ? ' is-active' : ''}`}
                role="option"
                aria-selected={index === activeIndex}
                disabled={action.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => execute(action)}
              >
                <Icon size={16} />
                <span>{t(action.labelKey)}</span>
              </button>
            )
          }) : (
            <div className="command-palette-empty">{t('noMatchingCommands')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
