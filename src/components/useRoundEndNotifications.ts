/**
 * useRoundEndNotifications — 回合结束系统通知
 * 订阅 isGenerating 的下降沿，按结果（完成/失败/中断）发送 HTML5 Notification。
 * 纯切换会话（无回合开始/结束）不触发。
 */
import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { useTranslation } from '../i18n'

interface GenerationWindow {
  isGenerating: boolean
  sessionId: string | null
}

export function useRoundEndNotifications() {
  const isGenerating = useAppStore((s) => s.isGenerating)
  const generatingSessionId = useAppStore((s) => s.generatingSessionId)
  const { t } = useTranslation()
  const windowRef = useRef<GenerationWindow>({ isGenerating: false, sessionId: null })

  useEffect(() => {
    const prev = windowRef.current
    const started = prev.isGenerating
    const finishedNow = !isGenerating
    const sessionId = isGenerating ? generatingSessionId : prev.sessionId
    windowRef.current = { isGenerating, sessionId }

    if (!started || !finishedNow || !sessionId) return
    if (typeof Notification === 'undefined') return

    const state = useAppStore.getState()
    const session = state.sessions.find((item) => item.id === sessionId)
    const transcript = state.transcripts[sessionId]
    let outcome: 'completed' | 'error' | 'interrupted' = 'completed'
    if (transcript) {
      for (const entry of transcript.entries) {
        if (entry.type === 'terminal') outcome = entry.outcome
      }
    }
    const body = outcome === 'error'
      ? t('notificationFailed')
      : outcome === 'interrupted'
        ? t('notificationInterrupted')
        : t('notificationGenerated')
    const title = session?.title || t('conversation')
    const notification = new Notification(title, { body })
    notification.onclick = () => window.focus()
  }, [isGenerating, generatingSessionId, t])
}
