import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { permissionLabel, useTranslation } from '../i18n'
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_OPTIONS,
  type PermissionMode,
} from '../../electron/store/types'

export default function PermissionPicker() {
  const sessions = useAppStore((state) => state.sessions)
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const setSessionPermissionMode = useAppStore((state) => state.setSessionPermissionMode)
  const isGenerating = useAppStore((state) => state.isGenerating)
  const generatingSessionId = useAppStore((state) => state.generatingSessionId)
  const [pendingMode, setPendingMode] = useState<PermissionMode | null>(null)
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const isGeneratingActiveSession = isGenerating && generatingSessionId === activeSessionId
  const currentMode = activeSession?.permissionMode ?? DEFAULT_PERMISSION_MODE
  const { locale, t } = useTranslation()

  if (!activeSessionId) return null

  const setMode = (mode: PermissionMode) => {
    void setSessionPermissionMode(activeSessionId, mode)
  }

  const handleChange = (mode: PermissionMode) => {
    if (mode === currentMode) return
    if (mode === 'bypassPermissions') {
      setPendingMode(mode)
      return
    }
    setMode(mode)
  }

  return (
    <>
      <select
        className={`permission-picker${currentMode === 'bypassPermissions' ? ' is-dangerous' : ''}`}
        value={currentMode}
        onChange={(event) => handleChange(event.target.value as PermissionMode)}
        disabled={isGeneratingActiveSession}
        title={t('selectPermissionMode')}
        aria-label={t('selectPermissionMode')}
      >
        {PERMISSION_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {permissionLabel(locale, option.id)}
          </option>
        ))}
      </select>

      {pendingMode && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card danger-dialog" role="dialog" aria-modal="true" aria-labelledby="permission-dialog-title">
            <div className="modal-icon danger"><ShieldAlert size={20} /></div>
            <div>
              <h2 id="permission-dialog-title">{t('enableBypassQuestion')}</h2>
              <p>{t('enableBypassDescription')}</p>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setPendingMode(null)}>{t('cancel')}</button>
              <button
                className="danger-button"
                onClick={() => {
                  setMode(pendingMode)
                  setPendingMode(null)
                }}
              >
                {t('enableBypass')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
