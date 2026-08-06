/**
 * useTodoProgress — 从文本（流式正文或已落盘正文）提取 todo 清单进度。
 * 内部复用纯函数 extractTodoProgress；无有效清单时返回 null。
 */
import { useMemo } from 'react'
import { extractTodoProgress, type TodoProgress } from './markdown/todoProgress'

export function useTodoProgress(text: string): TodoProgress | null {
  return useMemo(() => extractTodoProgress(text), [text])
}
