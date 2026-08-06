import { useEffect, useRef, useState } from 'react'

/** 流式渲染节流窗口（毫秒）：窗口内合并多次更新，至多每 60ms 提交一次。 */
const THROTTLE_WINDOW_MS = 60

/**
 * 对高频流式值做节流合并，降低每帧全量 Markdown 解析成本。
 * 空串（终态/未生成）立即提交，回合结束不留尾帧；
 * 窗口内有挂起定时器时只更新待提交值，不重置定时器。
 */
export function useThrottledStream(value: string, windowMs = THROTTLE_WINDOW_MS): string {
  const [display, setDisplay] = useState(value)
  const pending = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    pending.current = value
    if (value === '') {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      setDisplay('')
      return
    }
    if (timer.current != null) return
    timer.current = setTimeout(() => {
      timer.current = null
      setDisplay(pending.current)
    }, windowMs)
  }, [value, windowMs])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return display
}
