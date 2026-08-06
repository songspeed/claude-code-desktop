import { describe, expect, it } from 'vitest'
import { computeLineDiff, DIFF_MAX_LINES } from '../src/components/diffPreview'

describe('computeLineDiff', () => {
  it('returns empty diff for identical inputs', () => {
    expect(computeLineDiff('a\nb', 'a\nb')).toEqual([])
    expect(computeLineDiff('', '')).toEqual([])
  })

  it('marks added and removed lines for a single change', () => {
    expect(computeLineDiff('one\ntwo\nthree', 'one\nTWO\nthree')).toEqual([
      { type: 'equal', text: 'one' },
      { type: 'remove', text: 'two' },
      { type: 'add', text: 'TWO' },
      { type: 'equal', text: 'three' },
    ])
  })

  it('treats Write-style content as a full add block', () => {
    expect(computeLineDiff('', 'hello\nworld')).toEqual([
      { type: 'add', text: 'hello' },
      { type: 'add', text: 'world' },
    ])
  })

  it('trims to changed hunks with two context lines and ellipsis separators', () => {
    const before = Array.from({ length: 25 }, (_, index) => `before-${index}`)
    const after = [...before]
    after[4] = 'CHANGED-A'
    after[20] = 'CHANGED-B'
    const diff = computeLineDiff(before.join('\n'), after.join('\n'))
    expect(diff).toBeDefined()
    expect(diff!.some((line) => line.type === 'remove' && line.text === 'before-4')).toBe(true)
    expect(diff!.some((line) => line.type === 'add' && line.text === 'CHANGED-A')).toBe(true)
    expect(diff!.some((line) => line.type === 'remove' && line.text === 'before-20')).toBe(true)
    expect(diff!.some((line) => line.type === 'add' && line.text === 'CHANGED-B')).toBe(true)
    expect(diff![0]!.text).toBe('before-2')
    expect(diff).toContainEqual({ type: 'equal', text: '…' })
    // 裁剪后应远小于原始 25 行
    expect(diff!.length).toBeLessThan(18)
  })

  it('keeps one contiguous hunk without separators for a single change', () => {
    const before = Array.from({ length: 20 }, (_, index) => `before-${index}`)
    const after = [...before]
    after[10] = 'CHANGED'
    const diff = computeLineDiff(before.join('\n'), after.join('\n'))
    expect(diff).toBeDefined()
    expect(diff![0]!.text).toBe('before-8')
    expect(diff![diff!.length - 1]!.text).toBe('before-12')
    expect(diff).not.toContainEqual({ type: 'equal', text: '…' })
  })

  it('returns null when either side exceeds the line cap', () => {
    const big = Array.from({ length: DIFF_MAX_LINES + 1 }, (_, index) => `line-${index}`).join('\n')
    expect(computeLineDiff(big, 'small')).toBeNull()
    expect(computeLineDiff('small', big)).toBeNull()
  })

  it('handles completely disjoint inputs', () => {
    expect(computeLineDiff('a\nb', 'x\ny')).toEqual([
      { type: 'remove', text: 'a' },
      { type: 'remove', text: 'b' },
      { type: 'add', text: 'x' },
      { type: 'add', text: 'y' },
    ])
  })
})
