import { describe, expect, it } from 'vitest'
import { extractTodoProgress } from '../src/components/markdown/todoProgress'

describe('extractTodoProgress', () => {
  it('returns null for text without any task lists', () => {
    expect(extractTodoProgress('')).toBeNull()
    expect(extractTodoProgress('普通散文，没有清单')).toBeNull()
    expect(extractTodoProgress('```\n- [ ] not a list\n```')).toBeNull()
  })

  it('ignores a single checklist item (possible prose false positive)', () => {
    expect(extractTodoProgress('- [ ] 单行任务')).toBeNull()
  })

  it('counts checked and unchecked items in a valid block', () => {
    const text = [
      '- [x] 完成第一项',
      '- [ ] 待办第二项',
      '- [ ] 待办第三项',
    ].join('\n')
    expect(extractTodoProgress(text)).toEqual({ done: 1, total: 3 })
  })

  it('clamps the done count into [0, total] even with malformed input', () => {
    const text = [
      '- [x] 已完成',
      '- [x] 已完成',
      '- [ ] 待办',
    ].join('\n')
    const progress = extractTodoProgress(text)
    expect(progress).not.toBeNull()
    expect(progress!.done).toBeGreaterThanOrEqual(0)
    expect(progress!.done).toBeLessThanOrEqual(progress!.total)
  })

  it('aggregates multiple blocks separated by prose', () => {
    const text = [
      '- [x] 块一已办',
      '- [ ] 块一待办',
      '',
      '一段说明文字',
      '',
      '- [x] 块二已办',
      '- [x] 块二已办',
    ].join('\n')
    expect(extractTodoProgress(text)).toEqual({ done: 3, total: 4 })
  })

  it('accepts uppercase X markers and star bullets', () => {
    const text = ['* [X] 完成', '* [ ] 待办'].join('\n')
    expect(extractTodoProgress(text)).toEqual({ done: 1, total: 2 })
  })
})
