// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useThrottledStream } from '../src/components/useThrottledStream'

let container: HTMLDivElement
let root: Root

function Probe({ value }: { value: string }) {
  const out = useThrottledStream(value)
  return <span data-out={out} />
}

function renderProbe(value: string) {
  root.render(<Probe value={value} />)
}

function currentText(): string {
  return container.querySelector('span')?.getAttribute('data-out') ?? ''
}

describe('useThrottledStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('shows the initial value immediately on mount', () => {
    act(() => renderProbe('初始'))
    expect(currentText()).toBe('初始')
  })

  it('merges rapid updates within the window and commits the latest value once', () => {
    act(() => renderProbe('a'))
    act(() => renderProbe('b'))
    act(() => renderProbe('c'))
    // 窗口未结束：仍显示旧值，但更新已合并
    expect(currentText()).toBe('a')
    act(() => { vi.advanceTimersByTime(60) })
    expect(currentText()).toBe('c')
    // 提交后窗口重置，后续更新可再次合并
    act(() => renderProbe('d'))
    act(() => { vi.advanceTimersByTime(60) })
    expect(currentText()).toBe('d')
  })

  it('commits an empty terminal value immediately without waiting for the window', () => {
    act(() => renderProbe('进行中'))
    act(() => renderProbe(''))
    expect(currentText()).toBe('')
  })

  it('does not lose updates arriving while the timer is pending', () => {
    act(() => renderProbe('one'))
    act(() => renderProbe('two'))
    act(() => { vi.advanceTimersByTime(30) })
    act(() => renderProbe('three'))
    act(() => { vi.advanceTimersByTime(60) })
    expect(currentText()).toBe('three')
  })
})
