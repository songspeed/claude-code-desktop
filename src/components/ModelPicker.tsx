import { useAppStore } from '../store/appStore'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '../../electron/store/types'
import type { ClaudeUserModelConfig, ModelId } from '../../electron/store/types'
import { useTranslation } from '../i18n'

export function getConfiguredModelId(
  modelId: ModelId,
  config: ClaudeUserModelConfig | null
): string {
  if (!config) return ''
  const model = AVAILABLE_MODELS.find((candidate) => candidate.id === modelId)
  return model ? config[model.configField] : ''
}

export function getModelOptionLabel(
  model: (typeof AVAILABLE_MODELS)[number],
  config: ClaudeUserModelConfig | null
): string {
  const configuredModel = getConfiguredModelId(model.id, config)
  return `${model.pickerLabel} · ${configuredModel || model.id}`
}

export default function ModelPicker() {
  const sessions = useAppStore((s) => s.sessions)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const setSessionModel = useAppStore((s) => s.setSessionModel)
  const taskState = useAppStore((s) => s.taskStates[s.activeSessionId ?? ''])
  const claudeUserModelConfig = useAppStore((s) => s.claudeUserModelConfig)
  const { t } = useTranslation()
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const isGeneratingActiveSession = taskState?.status === 'running' || taskState?.status === 'queued'
  const currentModel: ModelId = activeSession?.model ?? DEFAULT_MODEL

  if (!activeSessionId) return null

  const isKnown = AVAILABLE_MODELS.some((model) => model.id === currentModel)

  return (
    <select
      className="model-picker"
      value={currentModel}
      onChange={(event) => setSessionModel(activeSessionId, event.target.value as ModelId)}
      disabled={isGeneratingActiveSession}
      title={t('selectModel')}
      aria-label={t('selectModel')}
    >
      {!isKnown && <option value={currentModel}>{t('modelUnavailable').replace('{model}', currentModel)}</option>}
      {AVAILABLE_MODELS.map((model) => (
        <option key={model.id} value={model.id} title={model.description}>
          {getModelOptionLabel(model, claudeUserModelConfig)}
        </option>
      ))}
    </select>
  )
}
