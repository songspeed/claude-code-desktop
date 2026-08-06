import { CircleAlert, Cpu, Info, TerminalSquare } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from '../i18n'
import { useAppStore } from '../store/appStore'
import type { AppInfo } from '../../electron/store/types'

function platformLabel(platform: string, arch: string): string {
  const platformName = platform === 'darwin'
    ? 'macOS'
    : platform === 'win32'
      ? 'Windows'
      : platform === 'linux'
        ? 'Linux'
        : platform
  return `${platformName} · ${arch}`
}

export interface AboutSettingsViewContentProps {
  appInfo: AppInfo | null
  appInfoError: string | null
  cliAvailable: boolean | null
  cliVersion: string | null
}

export function AboutSettingsViewContent({
  appInfo,
  appInfoError,
  cliAvailable,
  cliVersion,
}: AboutSettingsViewContentProps) {
  const { t } = useTranslation()

  const appRows = appInfo ? [
    { label: t('appVersion'), value: appInfo.version },
    { label: t('electronVersion'), value: appInfo.electronVersion },
    { label: t('platform'), value: platformLabel(appInfo.platform, appInfo.arch) },
  ] : []
  const cliValue = cliAvailable === null
    ? t('loading')
    : cliAvailable
      ? `${t('cliAvailable')}${cliVersion ? ` · ${cliVersion}` : ''}`
      : t('cliUnavailable')

  return (
    <section className="about-settings-view" aria-label={t('about')}>
      <header className="workspace-heading" data-settings-target="about-heading" tabIndex={-1}>
        <div className="workspace-title-group">
          <h1>{t('about')}</h1>
          <span>{t('aboutDescription')}</span>
        </div>
      </header>

      <div className="about-settings-scroll">
        <div className="about-settings-content">
          <div className="about-product">
            <div className="about-product-icon"><Info size={21} /></div>
            <div>
              <strong>{appInfo?.name ?? 'Claude Code Desktop'}</strong>
              <span>{appInfo ? `v${appInfo.version}` : t('loading')}</span>
            </div>
          </div>

          <dl className="about-info-list">
            {appRows.map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd><Cpu size={15} />{value}</dd>
              </div>
            ))}
            <div>
              <dt>{t('claudeCli')}</dt>
              <dd className={cliAvailable === false ? 'is-unavailable' : undefined}>
                <TerminalSquare size={15} />{cliValue}
              </dd>
            </div>
          </dl>

          {appInfoError && (
            <p className="about-settings-error" role="alert">
              <CircleAlert size={17} />
              <span>{t('unableToReadAppInfo')}{appInfoError}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

export default function AboutSettingsView() {
  const appInfo = useAppStore((state) => state.appInfo)
  const appInfoError = useAppStore((state) => state.appInfoError)
  const loadAppInfo = useAppStore((state) => state.loadAppInfo)
  const cliAvailable = useAppStore((state) => state.cliAvailable)
  const cliVersion = useAppStore((state) => state.cliVersion)

  useEffect(() => {
    void loadAppInfo()
  }, [loadAppInfo])

  return (
    <AboutSettingsViewContent
      appInfo={appInfo}
      appInfoError={appInfoError}
      cliAvailable={cliAvailable}
      cliVersion={cliVersion}
    />
  )
}
