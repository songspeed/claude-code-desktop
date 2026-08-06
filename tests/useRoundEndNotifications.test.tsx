// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import type { AgentEventEnvelope } from '../electron/cli/agentTransport'
import { useRoundEndNotifications } from '../src/components/useRoundEndNotifications'

const { mockIpc } = vi.hoisted(() => ({
  mockIpc: {
    checkAvailability: vi.fn(),
    getAppearance: vi.fn(),
    setAppearance: vi.fn(),
    getLocale: vi.fn(),
    setLocale: vi.fn(),
    getClaudeUserModelConfig: vi.fn(),
    saveClaudeUserModelConfig: vi.fn(),
    onAppearanceChanged: vi.fn(),
    onLocaleChanged: vi.fn(),
    listSessions: vi.fn(),
    onClaudeEvent: vi.fn(),
    onSessionUpdated: vi.fn(),
    sendMessage: vi.fn(),
  },
}))

vi.mock('../src/ipc', () => ({ ipc: mockIpc }))

class NotificationMock {
  static count = 0
  static lastTitle = ''
  static lastBody = ''
  title: string
  body: string
  onclick: (() => void) | null = null
  constructor(title: string, options?: { body?: string }) {
    NotificationMock.count += 1
    NotificationMock.lastTitle = title
    NotificationMock.lastBody = options?.body ?? ''
    this.title = title
    this.body = options?.body ?? ''
  }
}

let container: HTMLDivElement
let root: Root

function Probe() {
  useRoundEndNotifications()
  return <span data-probe="1" />
}

function renderProbe() {
  root.render(<Probe />)
}

describe('useRoundEndNotifications', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    ;(globalThis as Record<string, unknown>).Notification = NotificationMock
    NotificationMock.count = 0

    mockIpc.listSessions.mockResolvedValue([])
    mockIpc.checkAvailability.mockResolvedValue({ available: true })
    mockIpc.getAppearance.mockResolvedValue({ preference: 'light', effectiveTheme: 'light' })
    mockIpc.getLocale.mockResolvedValue('en')
    mockIpc.getClaudeUserModelConfig.mockResolvedValue({
      path: '/tmp/.claude/settings.json',
      defaultModel: '', sonnetModel: '', opusModel: '', haikuModel: '', fableModel: '',
    })
    mockIpc.onClaudeEvent.mockReturnValue(vi.fn())
    mockIpc.onSessionUpdated.mockReturnValue(vi.fn())
    mockIpc.onAppearanceChanged.mockReturnValue(vi.fn())
    mockIpc.onLocaleChanged.mockReturnValue(vi.fn())

    const { useAppStore } = await import('../src/store/appStore')
    const { init } = useAppStore.getState()
    await Promise.all([init(), init()])
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('fires one notification per completed turn and stays silent on session switches', async () => {
    const { useAppStore } = await import('../src/store/appStore')
    useAppStore.setState({
      locale: 'zh-CN',
      sessions: [{
        id: 'session-1', title: '重构登录', claudeSessionId: 'cli-1',
        projectPath: '/tmp/project', model: 'sonnet', permissionMode: 'acceptEdits', createdAt: 0, updatedAt: 0,
      }],
      messages: { 'session-1': [] },
      transcripts: {
        'session-1': {
          version: 2,
          entries: [
            { id: 'text-1', turnId: 'turn-1', sequence: 0, createdAt: 0, type: 'assistant_markdown', markdown: '完成' },
            { id: 'term-1', turnId: 'turn-1', sequence: 1, createdAt: 1, type: 'terminal', outcome: 'completed', usage: null },
          ],
        },
      },
    })

    act(() => renderProbe())

    // 纯切换会话：无回合开始/结束，不触发
    act(() => useAppStore.setState({ activeSessionId: 'session-1' }))
    expect(NotificationMock.count).toBe(0)

    // 回合结束：isGenerating true → false 触发一条完成通知
    act(() => useAppStore.setState({ isGenerating: true, generatingSessionId: 'session-1' }))
    expect(NotificationMock.count).toBe(0)
    act(() => useAppStore.setState({ isGenerating: false, generatingSessionId: null }))
    expect(NotificationMock.count).toBe(1)
    expect(NotificationMock.lastTitle).toBe('重构登录')
    expect(NotificationMock.lastBody).toContain('生成完成')
  })

  it('distinguishes failed and interrupted outcomes with their own notices', async () => {
    const { useAppStore } = await import('../src/store/appStore')
    useAppStore.setState({
      locale: 'zh-CN',
      sessions: [{
        id: 'session-1', title: '重构登录', claudeSessionId: 'cli-1',
        projectPath: '/tmp/project', model: 'sonnet', permissionMode: 'acceptEdits', createdAt: 0, updatedAt: 0,
      }],
      messages: { 'session-1': [] },
      transcripts: {
        'session-1': {
          version: 2,
          entries: [
            { id: 'term-1', turnId: 'turn-1', sequence: 0, createdAt: 0, type: 'terminal', outcome: 'interrupted', usage: null },
          ],
        },
      },
    })

    act(() => renderProbe())
    act(() => useAppStore.setState({ isGenerating: true, generatingSessionId: 'session-1' }))
    act(() => useAppStore.setState({ isGenerating: false, generatingSessionId: null }))
    expect(NotificationMock.count).toBe(1)
    expect(NotificationMock.lastBody).toContain('已中断')

    // 失败分支：改写 transcript 为 error 后再次走一轮
    act(() => useAppStore.setState((state) => ({
      transcripts: {
        ...state.transcripts,
        'session-1': {
          ...state.transcripts['session-1']!,
          entries: [
            { id: 'term-1', turnId: 'turn-1', sequence: 0, createdAt: 0, type: 'terminal', outcome: 'error', errorMessage: 'boom', usage: null },
          ],
        },
      },
    })))
    act(() => useAppStore.setState({ isGenerating: true, generatingSessionId: 'session-1' }))
    act(() => useAppStore.setState({ isGenerating: false, generatingSessionId: null }))
    expect(NotificationMock.count).toBe(2)
    expect(NotificationMock.lastBody).toContain('失败')
  })

  it('updates the window title while generating and restores it afterwards', () => {
    const source = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8')
    expect(source).toContain("document.title = isGenerating ? `${base} · ${t('generatingTitleSuffix')}` : base")
  })
})
