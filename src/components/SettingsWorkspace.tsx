import { ArrowLeft, CheckCircle2, CircleAlert, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClaudeUserModelConfigPatch } from '../../electron/store/types'
import { useTranslation } from '../i18n'
import { useAppStore } from '../store/appStore'
import {
  ClaudeSettingsViewContent,
  isClaudeModelConfigDirty,
  toClaudeModelPatch,
  validateClaudeModelConfig,
  type ClaudeModelFieldErrors,
} from './ClaudeSettingsView'
import AppearanceSettingsView from './AppearanceSettingsView'
import AboutSettingsView from './AboutSettingsView'
import LanguageSettingsView from './LanguageSettingsView'
import SkillsView from './SkillsView'
import {
  findSettingsSearchResults,
  SETTINGS_CATALOG,
  SETTINGS_GROUPS,
  settingsGroupLabelKeys,
  type SettingsSection,
} from './settingsCatalog'

type PendingNavigation =
  | { type: 'section'; section: SettingsSection; targetId: string }
  | { type: 'return' }

interface Props {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  onReturnToApp: () => void
  searchFocusRequest: number
}

export default function SettingsWorkspace({
  activeSection,
  onSectionChange,
  onReturnToApp,
  searchFocusRequest,
}: Props) {
  const { t } = useTranslation()
  const config = useAppStore((state) => state.claudeUserModelConfig)
  const configLoading = useAppStore((state) => state.claudeUserModelConfigLoading)
  const configSaving = useAppStore((state) => state.claudeUserModelConfigSaving)
  const configError = useAppStore((state) => state.claudeUserModelConfigError)
  const loadConfig = useAppStore((state) => state.loadClaudeUserModelConfig)
  const saveConfig = useAppStore((state) => state.saveClaudeUserModelConfig)
  const cliAvailable = useAppStore((state) => state.cliAvailable)
  const cliVersion = useAppStore((state) => state.cliVersion)
  const cliError = useAppStore((state) => state.cliError)
  const cliRefreshing = useAppStore((state) => state.cliRefreshing)
  const refreshCliAvailability = useAppStore((state) => state.refreshCliAvailability)
  const refreshSkills = useAppStore((state) => state.refreshSkills)

  const [draft, setDraft] = useState<ClaudeUserModelConfigPatch | null>(() => config ? toClaudeModelPatch(config) : null)
  const [fieldErrors, setFieldErrors] = useState<ClaudeModelFieldErrors>({})
  const [saved, setSaved] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedResult, setSelectedResult] = useState(0)
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const isDirty = isClaudeModelConfigDirty(config, draft)
  const results = useMemo(() => findSettingsSearchResults(searchQuery, t), [searchQuery, t])

  useEffect(() => {
    if (config) {
      setDraft(toClaudeModelPatch(config))
      setFieldErrors({})
      setSaved(false)
    }
  }, [config])

  useEffect(() => {
    if (activeSection === 'agent-models') void loadConfig()
    if (activeSection === 'skills') void refreshSkills()
  }, [activeSection, loadConfig, refreshSkills])

  useEffect(() => {
    if (searchFocusRequest > 0) searchInputRef.current?.focus()
  }, [searchFocusRequest])

  useEffect(() => {
    setSelectedResult(0)
  }, [searchQuery])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (focusTarget) {
        const target = document.querySelector<HTMLElement>(`[data-settings-target="${focusTarget}"]`)
        target?.focus()
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSection, focusRequest, focusTarget])

  const performNavigation = (navigation: PendingNavigation) => {
    if (navigation.type === 'return') {
      onReturnToApp()
      return
    }
    onSectionChange(navigation.section)
    setFocusTarget(navigation.targetId)
    setFocusRequest((value) => value + 1)
    setSearchQuery('')
  }

  const requestNavigation = (navigation: PendingNavigation) => {
    const leavingModelSettings = activeSection === 'agent-models'
      && (navigation.type === 'return' || navigation.section !== 'agent-models')
    if (isDirty && leavingModelSettings) {
      setPendingNavigation(navigation)
      return
    }
    performNavigation(navigation)
  }

  const updateDraft = (next: ClaudeUserModelConfigPatch) => {
    setDraft(next)
    setSaved(false)
    setFieldErrors((current) => {
      const errors = { ...current }
      for (const key of Object.keys(next) as Array<keyof ClaudeUserModelConfigPatch>) {
        if (errors[key] && next[key] === draft?.[key]) continue
        delete errors[key]
      }
      return errors
    })
  }

  const saveDraft = async (): Promise<boolean> => {
    if (!draft) return false
    const errors = validateClaudeModelConfig(draft)
    if (Object.keys(errors).length) {
      setFieldErrors(errors)
      return false
    }
    const updated = await saveConfig(draft)
    if (!updated) return false
    setDraft(toClaudeModelPatch(updated))
    setFieldErrors({})
    setSaved(true)
    return true
  }

  const saveAndContinue = async () => {
    if (!pendingNavigation || !(await saveDraft())) return
    const navigation = pendingNavigation
    setPendingNavigation(null)
    performNavigation(navigation)
  }

  const discardAndContinue = () => {
    if (config) setDraft(toClaudeModelPatch(config))
    setFieldErrors({})
    setSaved(false)
    if (!pendingNavigation) return
    const navigation = pendingNavigation
    setPendingNavigation(null)
    performNavigation(navigation)
  }

  const chooseResult = (index: number) => {
    const result = results[index]
    if (!result) return
    requestNavigation({ type: 'section', section: result.section, targetId: result.targetId })
  }

  return (
    <section className="settings-workspace" aria-label={t('settings')}>
      <aside className="settings-workspace-nav">
        <div className="settings-workspace-top">
          <button
            className="settings-return-button"
            onClick={() => requestNavigation({ type: 'return' })}
            title={t('returnToApp')}
          >
            <ArrowLeft size={17} />
            <span>{t('returnToApp')}</span>
          </button>
          <div className="settings-workspace-title">{t('settings')}</div>
        </div>

        <div className="settings-search" role="search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && results.length) {
                event.preventDefault()
                setSelectedResult((index) => (index + 1) % results.length)
              } else if (event.key === 'ArrowUp' && results.length) {
                event.preventDefault()
                setSelectedResult((index) => (index - 1 + results.length) % results.length)
              } else if (event.key === 'Enter' && results.length) {
                event.preventDefault()
                chooseResult(selectedResult)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setSearchQuery('')
                searchInputRef.current?.blur()
              }
            }}
            placeholder={t('searchSettings')}
            aria-label={t('searchSettings')}
            aria-controls="settings-search-results"
            aria-expanded={searchQuery.trim().length > 0}
            aria-activedescendant={results[selectedResult] ? `settings-search-result-${selectedResult}` : undefined}
          />
          {searchQuery && (
            <button
              className="icon-button compact"
              onClick={() => {
                setSearchQuery('')
                searchInputRef.current?.focus()
              }}
              title={t('clearSearch')}
              aria-label={t('clearSearch')}
            >
              <X size={15} />
            </button>
          )}
          {searchQuery.trim() && (
            <div className="settings-search-results" id="settings-search-results" role="listbox" aria-label={t('searchResults')}>
              {results.length ? results.map((result, index) => (
                <button
                  key={`${result.section}:${result.targetId}`}
                  id={`settings-search-result-${index}`}
                  className={`settings-search-result${index === selectedResult ? ' is-active' : ''}`}
                  role="option"
                  aria-selected={index === selectedResult}
                  onMouseEnter={() => setSelectedResult(index)}
                  onClick={() => chooseResult(index)}
                >
                  <span>{result.label}</span>
                  <small>{result.description}</small>
                </button>
              )) : (
                <div className="settings-search-empty" role="status">{t('noMatchingSettings')}</div>
              )}
            </div>
          )}
        </div>

        <nav className="settings-group-navigation" aria-label={t('settingsPages')}>
          {SETTINGS_GROUPS.map((group) => (
            <div className="settings-navigation-group" key={group}>
              <div className="settings-navigation-group-label">{t(settingsGroupLabelKeys[group])}</div>
              {SETTINGS_CATALOG.filter((item) => item.group === group).map(({ id, Icon, labelKey, descriptionKey }) => (
                <button
                  key={id}
                  className={`settings-section-button${activeSection === id ? ' is-active' : ''}`}
                  onClick={() => requestNavigation({ type: 'section', section: id, targetId: `${id}-heading` })}
                  aria-current={activeSection === id ? 'page' : undefined}
                  title={t(descriptionKey)}
                >
                  <Icon size={16} />
                  <span>{t(labelKey)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="settings-panel">
        {activeSection === 'agent-models' && (
          <ClaudeSettingsViewContent
            config={config}
            loading={configLoading}
            saving={configSaving}
            error={configError}
            onRefresh={() => void loadConfig()}
            onSave={saveConfig}
            draft={draft}
            fieldErrors={fieldErrors}
            saved={saved}
            onDraftChange={updateDraft}
            onRequestSave={saveDraft}
            cliAvailable={cliAvailable}
            cliVersion={cliVersion}
            cliError={cliError}
            cliRefreshing={cliRefreshing}
            onRefreshCli={() => void refreshCliAvailability()}
          />
        )}
        {activeSection === 'skills' && <SkillsView />}
        {activeSection === 'appearance' && <AppearanceSettingsView />}
        {activeSection === 'language' && <LanguageSettingsView />}
        {activeSection === 'about' && <AboutSettingsView />}
      </div>

      {pendingNavigation && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="unsaved-settings-title">
            <div className="modal-icon danger"><CircleAlert size={20} /></div>
            <div>
              <h2 id="unsaved-settings-title">{t('unsavedChangesTitle')}</h2>
              <p>{t('unsavedChangesDescription')}</p>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setPendingNavigation(null)}>{t('continueEditing')}</button>
              <button className="danger-button" onClick={discardAndContinue}>{t('discardChanges')}</button>
              <button className="primary-button" onClick={() => void saveAndContinue()} disabled={configSaving}>
                <CheckCircle2 size={16} />{configSaving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
