import { CheckCircle2, CircleAlert, RefreshCw, Save, TerminalSquare } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ClaudeUserModelConfig, ClaudeUserModelConfigPatch } from '../../electron/store/types'
import type { TranslationKey } from '../i18n'
import { useTranslation } from '../i18n'
import { useAppStore } from '../store/appStore'

export const CLAUDE_MODEL_FIELDS: Array<{
  key: keyof ClaudeUserModelConfigPatch
  labelKey: TranslationKey
  placeholderKey: TranslationKey
}> = [
  { key: 'defaultModel', labelKey: 'defaultModel', placeholderKey: 'defaultModelPlaceholder' },
  { key: 'sonnetModel', labelKey: 'sonnetMapping', placeholderKey: 'sonnetModelPlaceholder' },
  { key: 'opusModel', labelKey: 'opusMapping', placeholderKey: 'opusModelPlaceholder' },
  { key: 'haikuModel', labelKey: 'haikuMapping', placeholderKey: 'haikuModelPlaceholder' },
  { key: 'fableModel', labelKey: 'fableMapping', placeholderKey: 'fableModelPlaceholder' },
]

export type ClaudeModelFieldErrors = Partial<Record<keyof ClaudeUserModelConfigPatch, string>>

export function toClaudeModelPatch(config: ClaudeUserModelConfig): ClaudeUserModelConfigPatch {
  const { path: _path, ...patch } = config
  return patch
}

export function isClaudeModelConfigDirty(
  config: ClaudeUserModelConfig | null,
  draft: ClaudeUserModelConfigPatch | null,
): boolean {
  return Boolean(config && draft && CLAUDE_MODEL_FIELDS.some(({ key }) => config[key] !== draft[key]))
}

export function validateClaudeModelConfig(draft: ClaudeUserModelConfigPatch): ClaudeModelFieldErrors {
  return CLAUDE_MODEL_FIELDS.reduce<ClaudeModelFieldErrors>((errors, { key }) => {
    const value = draft[key]
    if (value.length > 200 || value !== value.trim() || /[\r\n]/.test(value)) errors[key] = 'invalid'
    return errors
  }, {})
}

export interface ClaudeSettingsViewContentProps {
  config: ClaudeUserModelConfig | null
  loading: boolean
  saving: boolean
  error: string | null
  onRefresh: () => void
  onSave: (patch: ClaudeUserModelConfigPatch) => Promise<ClaudeUserModelConfig | null>
  draft?: ClaudeUserModelConfigPatch | null
  fieldErrors?: ClaudeModelFieldErrors
  saved?: boolean
  onDraftChange?: (draft: ClaudeUserModelConfigPatch) => void
  onRequestSave?: () => Promise<boolean>
  cliAvailable?: boolean | null
  cliVersion?: string | null
  cliError?: string | null
  cliRefreshing?: boolean
  onRefreshCli?: () => void
}

export function ClaudeSettingsViewContent({
  config,
  loading,
  saving,
  error,
  onRefresh,
  onSave,
  draft: controlledDraft,
  fieldErrors = {},
  saved: controlledSaved,
  onDraftChange,
  onRequestSave,
  cliAvailable,
  cliVersion,
  cliError,
  cliRefreshing = false,
  onRefreshCli,
}: ClaudeSettingsViewContentProps) {
  const [internalDraft, setInternalDraft] = useState<ClaudeUserModelConfigPatch | null>(() => config ? toClaudeModelPatch(config) : null)
  const [internalSaved, setInternalSaved] = useState(false)
  const { t } = useTranslation()
  const draft = controlledDraft === undefined ? internalDraft : controlledDraft
  const saved = controlledSaved ?? internalSaved

  useEffect(() => {
    if (controlledDraft === undefined && config) {
      setInternalDraft(toClaudeModelPatch(config))
      setInternalSaved(false)
    }
  }, [config, controlledDraft])

  const isDirty = useMemo(() => isClaudeModelConfigDirty(config, draft), [config, draft])

  const handleRefresh = () => {
    setInternalSaved(false)
    onRefresh()
  }

  const updateDraft = (key: keyof ClaudeUserModelConfigPatch, value: string) => {
    if (!draft) return
    const next = { ...draft, [key]: value }
    if (onDraftChange) onDraftChange(next)
    else {
      setInternalSaved(false)
      setInternalDraft(next)
    }
  }

  const handleSave = async () => {
    if (!draft || !isDirty) return
    if (onRequestSave) {
      await onRequestSave()
      return
    }
    const updated = await onSave(draft)
    if (updated) {
      setInternalDraft(toClaudeModelPatch(updated))
      setInternalSaved(true)
    }
  }

  const cliStatus = cliAvailable === null
    ? t('loading')
    : cliAvailable
      ? `${t('cliAvailable')}${cliVersion ? ` · ${cliVersion}` : ''}`
      : t('cliUnavailable')

  return (
    <section className="claude-settings-view" aria-label={t('agentAndModels')}>
      <header className="workspace-heading" data-settings-target="agent-models-heading" tabIndex={-1}>
        <div className="workspace-title-group">
          <h1>{t('agentAndModels')}</h1>
          <span>{t('agentAndModelsDescription')}</span>
        </div>
        <div className="workspace-heading-actions">
          <button
            className="icon-button workspace-icon-action"
            onClick={handleRefresh}
            disabled={loading || saving}
            title={t('refreshConfiguration')}
            aria-label={t('refreshConfiguration')}
            data-settings-target="claude-refresh"
          >
            <RefreshCw className={loading ? 'is-spinning' : undefined} size={17} />
          </button>
        </div>
      </header>

      <div className="claude-settings-scroll">
        {loading && !config ? (
          <div className="settings-feedback">
            <RefreshCw className="is-spinning" size={20} />
            <span>{t('loadingConfiguration')}</span>
          </div>
        ) : error && !config ? (
          <div className="settings-feedback is-error" role="alert">
            <CircleAlert size={18} />
            <span>{t('unableToReadConfiguration')}{error}</span>
          </div>
        ) : config && draft ? (
          <div className="claude-settings-content">
            <section className="cli-health-card" aria-label={t('claudeCli')} data-settings-target="cli-health" tabIndex={-1}>
              <div className="cli-health-copy">
                <TerminalSquare size={18} />
                <div>
                  <strong>{t('claudeCli')}</strong>
                  <span className={cliAvailable === false ? 'is-unavailable' : undefined}>{cliStatus}</span>
                </div>
              </div>
              <button
                className="icon-button compact"
                onClick={onRefreshCli}
                disabled={!onRefreshCli || cliRefreshing}
                title={t('refreshCliStatus')}
                aria-label={t('refreshCliStatus')}
              >
                <RefreshCw className={cliRefreshing ? 'is-spinning' : undefined} size={16} />
              </button>
              {cliAvailable === false && (
                <p>{t('cliHealthRepair')}</p>
              )}
              {cliAvailable === false && cliError && <small>{cliError}</small>}
            </section>

            <form
              className="settings-form"
              onSubmit={(event) => {
                event.preventDefault()
                void handleSave()
              }}
            >
              {CLAUDE_MODEL_FIELDS.map(({ key, labelKey, placeholderKey }) => {
                const id = `claude-model-${key}`
                const fieldError = fieldErrors[key]
                return (
                  <label className={`settings-field${fieldError ? ' has-error' : ''}`} htmlFor={id} key={key}>
                    <span>{t(labelKey)}</span>
                    <span className="settings-field-control">
                      <input
                        id={id}
                        value={draft[key]}
                        onChange={(event) => updateDraft(key, event.target.value)}
                        placeholder={t(placeholderKey)}
                        maxLength={200}
                        autoComplete="off"
                        disabled={saving}
                        aria-invalid={fieldError ? true : undefined}
                        aria-describedby={fieldError ? `${id}-error` : undefined}
                        data-settings-target={id}
                      />
                      {fieldError && <small id={`${id}-error`} className="settings-field-error">{t('invalidModelValue')}</small>}
                    </span>
                  </label>
                )
              })}

              {error && <p className="settings-inline-error" role="alert"><CircleAlert size={16} />{t('unableToReadConfiguration')}{error}</p>}

              <div className="settings-form-actions">
                {saved && !isDirty && (
                  <span className="settings-save-feedback" role="status">
                    <CheckCircle2 size={16} /> {t('saved')}
                  </span>
                )}
                <button
                  className="primary-button settings-save-button"
                  type="submit"
                  disabled={!isDirty || saving}
                >
                  <Save size={16} />
                  <span>{saving ? t('saving') : t('save')}</span>
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export default function ClaudeSettingsView() {
  const config = useAppStore((state) => state.claudeUserModelConfig)
  const loading = useAppStore((state) => state.claudeUserModelConfigLoading)
  const saving = useAppStore((state) => state.claudeUserModelConfigSaving)
  const error = useAppStore((state) => state.claudeUserModelConfigError)
  const loadConfig = useAppStore((state) => state.loadClaudeUserModelConfig)
  const saveConfig = useAppStore((state) => state.saveClaudeUserModelConfig)
  const cliAvailable = useAppStore((state) => state.cliAvailable)
  const cliVersion = useAppStore((state) => state.cliVersion)
  const cliError = useAppStore((state) => state.cliError)
  const refreshCliAvailability = useAppStore((state) => state.refreshCliAvailability)

  return (
    <ClaudeSettingsViewContent
      config={config}
      loading={loading}
      saving={saving}
      error={error}
      onRefresh={() => void loadConfig()}
      onSave={saveConfig}
      cliAvailable={cliAvailable}
      cliVersion={cliVersion}
      cliError={cliError}
      onRefreshCli={() => void refreshCliAvailability()}
    />
  )
}
