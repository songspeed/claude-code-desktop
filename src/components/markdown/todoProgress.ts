/**
 * 正文 todo 清单提取：从 markdown 文本中识别 `- [ ]`/`- [x]` 任务列表，
 * 聚合为「已完成/总数」。单行任务列表（可能为散文误伤）不产生指示器。
 * 纯函数，可独立单测；流式文本与已落盘正文共用。
 */

export interface TodoProgress {
  done: number
  total: number
}

const TODO_LINE_PATTERN = /^\s*[-*]\s*\[([ xX])\]\s*\S.*$/

/** 提取文本中的 todo 清单进度；无有效清单返回 null。 */
export function extractTodoProgress(text: string): TodoProgress | null {
  if (!text) return null
  const blocks: Array<{ done: number; total: number }> = []
  let current: { done: number; total: number } | null = null

  for (const line of text.split('\n')) {
    const match = TODO_LINE_PATTERN.exec(line)
    if (match) {
      if (!current) current = { done: 0, total: 0 }
      current.total += 1
      if (match[1] === 'x' || match[1] === 'X') current.done += 1
    } else if (current) {
      blocks.push(current)
      current = null
    }
  }
  if (current) blocks.push(current)

  const valid = blocks.filter((block) => block.total >= 2)
  if (valid.length === 0) return null
  const total = valid.reduce((sum, block) => sum + block.total, 0)
  const done = valid.reduce((sum, block) => sum + block.done, 0)
  return { done: Math.max(0, Math.min(total, done)), total }
}
