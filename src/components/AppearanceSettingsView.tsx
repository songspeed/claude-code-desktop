import { Check, CircleAlert, Monitor, Moon, Sun } from 'lucide-react'
import type { AppearancePreference } from '../../electron/store/types'
import { useTranslation } from '../i18n'
import { useAppStore } from '../store/appStore'

const appearanceOptions: Array<{
  value: AppearancePreference
  labelKey: 'light' | 'dark' | 'system'
  Icon: typeof Sun
}> = [
  { value: 'light', labelKey: 'light', Icon: Sun },
  { value: 'dark', labelKey: 'dark', Icon: Moon },
  { value: 'system', labelKey: 'system', Icon: Monitor },
]

export default function AppearanceSettingsView() {
  const preference = useAppStore((state) => state.appearancePreference)
  const effectiveTheme = useAppStore((state) => state.effectiveTheme)
  const error = useAppStore((state) => state.appearanceError)
  const setAppearancePreference = useAppStore((state) => state.setAppearancePreference)
  const { t } = useTranslation()

  const effectiveThemeLabel = effectiveTheme === 'dark' ? t('currentThemeDark') : t('currentThemeLight')

  return (
    <section className="appearance-settings-view" aria-label={t('appearance')}>
      <header className="workspace-heading" data-settings-target="appearance-heading" tabIndex={-1}>
        <div className="workspace-title-group">
          <h1>{t('appearance')}</h1>
          <span>{preference === 'system' ? effectiveThemeLabel : t('theme')}</span>
        </div>
      </header>

      <div className="appearance-settings-scroll">
        <div className="appearance-settings-content">
          <div className="theme-options" role="radiogroup" aria-label={t('theme')} data-settings-target="appearance-theme" tabIndex={-1}>
            {appearanceOptions.map(({ value, labelKey, Icon }) => (
              <button
                key={value}
                className={`theme-option${preference === value ? ' is-selected' : ''}`}
                role="radio"
                aria-checked={preference === value}
                onClick={() => void setAppearancePreference(value)}
              >
                <Icon size={18} />
                <span>{t(labelKey)}</span>
                {preference === value && <Check size={17} className="theme-option-check" />}
              </button>
            ))}
          </div>
          {error && (
            <p className="appearance-settings-error" role="alert">
              <CircleAlert size={17} />
              <span>{error}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
