/**
 * useRoundEndNotifications — 回合结束系统通知
 * Watch each session task independently and notify on its terminal transition.
 * Session navigation alone does not trigger notifications.
 */
import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { useTranslation } from '../i18n'

type TaskSnapshot = Record<string, { turnId: string; status: string }>

export function useRoundEndNotifications() {
  const taskStates = useAppStore((s) => s.taskStates)
  const { t } = useTranslation()
  const previousTasksRef = useRef<TaskSnapshot>({})

  useEffect(() => {
    const previous = previousTasksRef.current
    const next: TaskSnapshot = {}
    const terminal = new Set(['cancelled', 'completed', 'error', 'interrupted'])

    for (const [sessionId, task] of Object.entries(taskStates)) {
      next[sessionId] = { turnId: task.turnId, status: task.status }
      const prior = previous[sessionId]
      if (!prior || prior.turnId !== task.turnId || !terminal.has(task.status) || terminal.has(prior.status)) continue
      if (typeof Notification === 'undefined') continue

      const state = useAppStore.getState()
      const session = state.sessions.find((item) => item.id === sessionId)
      const body = task.status === 'error'
        ? t('notificationFailed')
        : task.status === 'completed'
          ? t('notificationGenerated')
          : t('notificationInterrupted')
      const notification = new Notification(session?.title || t('conversation'), { body })
      notification.onclick = () => window.focus()
    }

    previousTasksRef.current = next
  }, [taskStates, t])
}
