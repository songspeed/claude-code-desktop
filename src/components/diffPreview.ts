/**
 * 轻量行级差异计算（不引入 diff 库）。
 * 从 Edit 工具的 old_string/new_string（或 Write 的 content）得到差异行序列，
 * 供编辑活动展开时的增删高亮展示。
 */

export type DiffLine = { type: 'equal' | 'add' | 'remove'; text: string }

/** 参与差异计算的最大行数；超过时回退原始展示。 */
export const DIFF_MAX_LINES = 200

/** 差异上下文行数（每个变更块前后的等行保留数量）。 */
const DIFF_CONTEXT_LINES = 2

/** 行级 LCS 差异：返回带上下文的 +/-/= 行序列。 */
export function computeLineDiff(before: string, after: string): DiffLine[] | null {
  const beforeLines = splitLines(before)
  const afterLines = splitLines(after)
  if (beforeLines.length === 0 && afterLines.length === 0) return []
  if (beforeLines.length > DIFF_MAX_LINES || afterLines.length > DIFF_MAX_LINES) return null

  const operations = lcsOperations(beforeLines, afterLines)
  const marked = operations.map(([type, line]) => ({ type, text: line }))
  return applyContext(marked)
}

/** 追加一行（保证路径总有末行，便于 LCS 统一处理空输入）。 */
function splitLines(content: string): string[] {
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** 标准 LCS 动态规划，返回「删除/保留/新增」的行序列。 */
function lcsOperations(before: string[], after: string[]): Array<['remove' | 'equal' | 'add', string]> {
  const rows = before.length + 1
  const cols = after.length + 1
  const table = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))

  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i]![j] = before[i] === after[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }

  const operations: Array<['remove' | 'equal' | 'add', string]> = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      operations.push(['equal', before[i]!])
      i += 1
      j += 1
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      operations.push(['remove', before[i]!])
      i += 1
    } else {
      operations.push(['add', after[j]!])
      j += 1
    }
  }
  while (i < before.length) {
    operations.push(['remove', before[i]!])
    i += 1
  }
  while (j < after.length) {
    operations.push(['add', after[j]!])
    j += 1
  }
  return operations
}

/** 裁剪为仅含变更块（每块前后保留 2 行上下文）。 */
function applyContext(marked: Array<DiffLine>): DiffLine[] {
  const changeIndexes: number[] = []
  for (let index = 0; index < marked.length; index += 1) {
    if (marked[index]!.type !== 'equal') changeIndexes.push(index)
  }
  if (changeIndexes.length === 0) return []

  const keep = new Set<number>()
  for (const index of changeIndexes) {
    for (let offset = -DIFF_CONTEXT_LINES; offset <= DIFF_CONTEXT_LINES; offset += 1) {
      const target = index + offset
      if (target >= 0 && target < marked.length) keep.add(target)
    }
  }

  const result: DiffLine[] = []
  let lastKept = -1
  for (const index of [...keep].sort((a, b) => a - b)) {
    if (result.length > 0 && index > lastKept + 1) result.push({ type: 'equal', text: '…' })
    result.push(marked[index]!)
    lastKept = index
  }
  return result
}
