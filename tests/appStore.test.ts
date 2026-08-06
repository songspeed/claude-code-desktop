import { describe, expect, it, vi } from 'vitest'
import type { AgentEventEnvelope } from '../electron/cli/agentTransport'

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

describe('appStore initialization', () => {
  it('shares concurrent initialization, keeps a running task in its originating session, and registers stream listeners once', async () => {
    mockIpc.listSessions.mockResolvedValue([])
    mockIpc.checkAvailability.mockResolvedValue({ available: true })
    mockIpc.getAppearance.mockResolvedValue({ preference: 'light', effectiveTheme: 'light' })
    mockIpc.getLocale.mockResolvedValue('en')
    mockIpc.getClaudeUserModelConfig.mockResolvedValue({
      path: '/tmp/.claude/settings.json',
      defaultModel: '',
      sonnetModel: '',
      opusModel: '',
      haikuModel: '',
      fableModel: '',
    })

    let claudeEventHandler: ((sessionId: string, event: AgentEventEnvelope) => void) | undefined
    let appearanceChangedHandler: ((appearance: { preference: 'light' | 'dark' | 'system'; effectiveTheme: 'light' | 'dark' }) => void) | undefined
    let localeChangedHandler: ((locale: 'zh-CN' | 'en') => void) | undefined
    mockIpc.onClaudeEvent.mockImplementation((handler) => {
      claudeEventHandler = handler
      return vi.fn()
    })
    mockIpc.onSessionUpdated.mockReturnValue(vi.fn())
    mockIpc.onAppearanceChanged.mockImplementation((handler) => {
      appearanceChangedHandler = handler
      return vi.fn()
    })
    mockIpc.onLocaleChanged.mockImplementation((handler) => {
      localeChangedHandler = handler
      return vi.fn()
    })

    mockIpc.sendMessage.mockResolvedValue(undefined)

    const { useAppStore } = await import('../src/store/appStore')
    const { init } = useAppStore.getState()

    await Promise.all([init(), init()])

    expect(mockIpc.listSessions).toHaveBeenCalledTimes(1)
    expect(mockIpc.checkAvailability).toHaveBeenCalledTimes(1)
    expect(mockIpc.onClaudeEvent).toHaveBeenCalledTimes(1)
    expect(mockIpc.onSessionUpdated).toHaveBeenCalledTimes(1)
    expect(mockIpc.onLocaleChanged).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().locale).toBe('en')

    // 无进行中回合时，事件被安全忽略（组装器尚未创建）
    claudeEventHandler?.('session-1', {
      turnId: 'ignored-turn', sequence: 1, createdAt: 1, event: { type: 'text_delta', delta: 'ignored' },
    })
    expect(useAppStore.getState().streamingText).toBe('')

    // 开启一个回合（sendMessage 内部新建组装器），事件方才流入 streamingText
    useAppStore.setState({
      activeSessionId: 'session-1',
      sessions: [{
        id: 'session-1', title: '新对话', claudeSessionId: null,
        projectPath: '/tmp/project', model: 'sonnet', permissionMode: 'acceptEdits', createdAt: 0, updatedAt: 0,
      }],
    })
    await useAppStore.getState().sendMessage('hi')

    const sent = mockIpc.sendMessage.mock.calls[0]?.[0] as { turnId: string }
    claudeEventHandler?.('session-1', {
      turnId: sent.turnId, sequence: 1, createdAt: 1, event: { type: 'text_delta', delta: 'once' },
    })
    expect(useAppStore.getState().streamingText).toBe('once')

    const messagesBeforeThemeChange = useAppStore.getState().messages
    appearanceChangedHandler?.({ preference: 'system', effectiveTheme: 'dark' })

    expect(useAppStore.getState()).toMatchObject({
      appearancePreference: 'system',
      effectiveTheme: 'dark',
      streamingText: 'once',
      messages: messagesBeforeThemeChange,
    })

    // 切换会话只改变导航目标：运行中的任务仍属于 session-1，且不会将流式
    // 结果或终止状态写到 session-2。
    useAppStore.setState((state) => ({
      sessions: [...state.sessions, {
        id: 'session-2', title: '另一个对话', claudeSessionId: null,
        projectPath: '/tmp/other-project', model: 'opus', permissionMode: 'plan', createdAt: 0, updatedAt: 0,
      }],
      messages: { ...state.messages, 'session-2': [] },
      transcripts: { ...state.transcripts, 'session-2': { version: 2, entries: [] } },
    }))
    await useAppStore.getState().switchSession('session-2')
    expect(useAppStore.getState()).toMatchObject({
      activeSessionId: 'session-2',
      isGenerating: true,
      generatingSessionId: 'session-1',
    })

    claudeEventHandler?.('session-1', {
      turnId: sent.turnId, sequence: 2, createdAt: 2, event: { type: 'done', sessionId: 'claude-session-1' },
    })
    const completedState = useAppStore.getState()
    expect(completedState).toMatchObject({
      activeSessionId: 'session-2',
      isGenerating: false,
      generatingSessionId: null,
    })
    expect(completedState.messages['session-1']?.some((message) => message.role === 'assistant' && message.text === 'once')).toBe(true)
    expect(completedState.messages['session-2']).toEqual([])
    expect(completedState.transcripts['session-2']?.entries).toEqual([])

    mockIpc.setLocale.mockResolvedValue({ locale: 'zh-CN', persisted: true })
    await useAppStore.getState().setLocale('zh-CN')
    expect(mockIpc.setLocale).toHaveBeenCalledWith('zh-CN')
    expect(useAppStore.getState().locale).toBe('zh-CN')

    localeChangedHandler?.('en')
    expect(useAppStore.getState().locale).toBe('en')
  })

  it('loads and saves the restricted Claude model configuration without destabilizing the app state', async () => {
    const config = {
      path: '/tmp/.claude/settings.json',
      defaultModel: 'sonnet',
      sonnetModel: 'claude-sonnet-custom',
      opusModel: '',
      haikuModel: '',
      fableModel: '',
    }
    mockIpc.getClaudeUserModelConfig.mockResolvedValue(config)
    mockIpc.saveClaudeUserModelConfig.mockResolvedValue({ ...config, opusModel: 'claude-opus-custom' })

    const { useAppStore } = await import('../src/store/appStore')
    await useAppStore.getState().loadClaudeUserModelConfig()
    expect(useAppStore.getState()).toMatchObject({
      claudeUserModelConfig: config,
      claudeUserModelConfigLoading: false,
      claudeUserModelConfigError: null,
    })

    const saved = await useAppStore.getState().saveClaudeUserModelConfig({
      defaultModel: 'sonnet',
      sonnetModel: 'claude-sonnet-custom',
      opusModel: 'claude-opus-custom',
      haikuModel: '',
      fableModel: '',
    })
    expect(saved?.opusModel).toBe('claude-opus-custom')
    expect(mockIpc.saveClaudeUserModelConfig).toHaveBeenCalledWith(expect.objectContaining({
      opusModel: 'claude-opus-custom',
    }))

    mockIpc.saveClaudeUserModelConfig.mockRejectedValueOnce(new Error('配置文件格式错误'))
    const failed = await useAppStore.getState().saveClaudeUserModelConfig({
      defaultModel: 'sonnet', sonnetModel: '', opusModel: '', haikuModel: '', fableModel: '',
    })
    expect(failed).toBeNull()
    expect(useAppStore.getState().claudeUserModelConfigError).toContain('配置文件格式错误')
  })

  it('refreshes CLI health independently of the rest of settings state', async () => {
    mockIpc.checkAvailability.mockResolvedValueOnce({
      available: false,
      error: 'Claude executable was not found',
    })
    const { useAppStore } = await import('../src/store/appStore')
    useAppStore.setState({
      claudeUserModelConfig: {
        path: '/tmp/.claude/settings.json',
        defaultModel: 'sonnet', sonnetModel: '', opusModel: '', haikuModel: '', fableModel: '',
      },
    })

    await useAppStore.getState().refreshCliAvailability()

    expect(mockIpc.checkAvailability).toHaveBeenCalled()
    expect(useAppStore.getState()).toMatchObject({
      cliAvailable: false,
      cliVersion: null,
      cliError: 'Claude executable was not found',
      cliRefreshing: false,
      claudeUserModelConfig: expect.objectContaining({ defaultModel: 'sonnet' }),
    })
  })
})
