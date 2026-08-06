import { Check, CircleAlert, Languages } from 'lucide-react'
import type { AppLocale } from '../../electron/store/types'
import { useTranslation } from '../i18n'
import { useAppStore } from '../store/appStore'

const localeOptions: Array<{
  value: AppLocale
  nameKey: 'chineseSimplified' | 'english'
  descriptionKey: 'chineseDescription' | 'englishDescription'
}> = [
  { value: 'zh-CN', nameKey: 'chineseSimplified', descriptionKey: 'chineseDescription' },
  { value: 'en', nameKey: 'english', descriptionKey: 'englishDescription' },
]

export default function LanguageSettingsView() {
  const locale = useAppStore((state) => state.locale)
  const error = useAppStore((state) => state.localeError)
  const setLocale = useAppStore((state) => state.setLocale)
  const { t } = useTranslation()

  return (
    <section className="language-settings-view" aria-label={t('language')}>
      <header className="workspace-heading" data-settings-target="language-heading" tabIndex={-1}>
        <div className="workspace-title-group">
          <h1>{t('language')}</h1>
          <span>{t('languageDescription')}</span>
        </div>
      </header>

      <div className="language-settings-scroll">
        <div className="language-settings-content">
          <div className="locale-options" role="radiogroup" aria-label={t('language')} data-settings-target="language-options" tabIndex={-1}>
            {localeOptions.map(({ value, nameKey, descriptionKey }) => (
              <button
                key={value}
                className={`locale-option${locale === value ? ' is-selected' : ''}`}
                role="radio"
                aria-checked={locale === value}
                onClick={() => void setLocale(value)}
              >
                <Languages size={18} />
                <span className="locale-option-copy">
                  <strong>{t(nameKey)}</strong>
                  <small>{t(descriptionKey)}</small>
                </span>
                {locale === value && <Check size={17} className="locale-option-check" />}
              </button>
            ))}
          </div>
          {error && (
            <p className="language-settings-error" role="alert">
              <CircleAlert size={17} />
              <span>{t('unableToSaveLanguage')}{error}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
