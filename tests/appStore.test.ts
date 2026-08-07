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
    onTaskStatus: vi.fn(),
    onSessionUpdated: vi.fn(),
    sendMessage: vi.fn(),
    abortGeneration: vi.fn(),
  },
}))

let taskStatusHandler: ((status: { sessionId: string; turnId: string; status: 'queued' | 'running' | 'cancelled'; queuePosition?: number; externalProcessBoundary: boolean }) => void) | undefined

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
    mockIpc.onTaskStatus.mockImplementation((handler) => {
      taskStatusHandler = handler
      return vi.fn()
    })
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
    expect(useAppStore.getState().taskStates['session-1']).toBeUndefined()

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
    expect(useAppStore.getState().taskStates['session-1']?.streamingText).toBe('once')

    const messagesBeforeThemeChange = useAppStore.getState().messages
    appearanceChangedHandler?.({ preference: 'system', effectiveTheme: 'dark' })

    expect(useAppStore.getState()).toMatchObject({
      appearancePreference: 'system',
      effectiveTheme: 'dark',
      messages: messagesBeforeThemeChange,
    })
    expect(useAppStore.getState().taskStates['session-1']?.streamingText).toBe('once')

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
    expect(useAppStore.getState().activeSessionId).toBe('session-2')
    expect(useAppStore.getState().taskStates['session-1']?.status).toBe('running')
    expect(useAppStore.getState().taskStates['session-2']).toBeUndefined()

    claudeEventHandler?.('session-1', {
      turnId: sent.turnId, sequence: 2, createdAt: 2, event: { type: 'done', sessionId: 'claude-session-1' },
    })
    const completedState = useAppStore.getState()
    expect(completedState.activeSessionId).toBe('session-2')
    expect(completedState.taskStates['session-1']?.status).toBe('completed')
    expect(completedState.taskStates['session-1']?.unreadOutputCount).toBe(1)
    expect(completedState.messages['session-1']?.some((message) => message.role === 'assistant' && message.text === 'once')).toBe(true)
    expect(completedState.messages['session-2']).toEqual([])
    expect(completedState.transcripts['session-2']?.entries).toEqual([])

    await useAppStore.getState().switchSession('session-1')
    expect(useAppStore.getState().taskStates['session-1']?.unreadOutputCount).toBe(0)

    // A stale turn from the same session cannot mutate the completed retry.
    claudeEventHandler?.('session-1', {
      turnId: 'stale-turn', sequence: 99, createdAt: 99, event: { type: 'text_delta', delta: 'stale' },
    })
    expect(useAppStore.getState().transcripts['session-1']?.entries.some((entry) => entry.type === 'assistant_markdown' && entry.markdown === 'stale')).toBe(false)

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

  it('retries the last interrupted turn with its user prompt and does nothing for completed turns', async () => {
    mockIpc.sendMessage.mockClear()
    const { useAppStore } = await import('../src/store/appStore')
    useAppStore.setState({
      cliAvailable: true,
      activeSessionId: 'session-1',
      sessions: [{
        id: 'session-1', title: '新对话', claudeSessionId: null,
        projectPath: '/tmp/project', model: 'sonnet', permissionMode: 'acceptEdits', createdAt: 0, updatedAt: 0,
      }],
      messages: { 'session-1': [] },
      taskStates: {},
      transcripts: {
        'session-1': {
          version: 2,
          entries: [
            { id: 'user-1', turnId: 'turn-1', sequence: 0, createdAt: 0, type: 'user', text: '帮我修一下登录' },
            { id: 'term-1', turnId: 'turn-1', sequence: 1, createdAt: 1, type: 'terminal', outcome: 'interrupted', errorMessage: null, usage: null, partialMarkdown: '正在查看…' },
          ],
        },
      },
    })
    const pre = useAppStore.getState()
    expect(pre.cliAvailable).toBe(true)
    expect(pre.taskStates['session-1']).toBeUndefined()
    expect(pre.activeSessionId).toBe('session-1')

    await useAppStore.getState().retryLastTurn('session-1')
    expect(mockIpc.sendMessage).toHaveBeenCalledTimes(1)
    expect(mockIpc.sendMessage.mock.calls[0]?.[0]).toMatchObject({ prompt: '帮我修一下登录' })
    const retryTurnId = mockIpc.sendMessage.mock.calls[0]?.[0]?.turnId as string
    taskStatusHandler?.({ sessionId: 'session-1', turnId: retryTurnId, status: 'cancelled', externalProcessBoundary: true })

    mockIpc.sendMessage.mockClear()
    useAppStore.setState((state) => ({
      transcripts: {
        ...state.transcripts,
        'session-1': {
          ...state.transcripts['session-1']!,
          entries: [
            { id: 'user-1', turnId: 'turn-1', sequence: 0, createdAt: 0, type: 'user', text: '已完成' },
            { id: 'term-1', turnId: 'turn-1', sequence: 1, createdAt: 1, type: 'terminal', outcome: 'completed', usage: null },
          ],
        },
      },
    }))

    await useAppStore.getState().retryLastTurn('session-1')
    expect(mockIpc.sendMessage).not.toHaveBeenCalled()
  })

  it('rejects retrying while another turn is generating', async () => {
    mockIpc.sendMessage.mockClear()
    const { useAppStore } = await import('../src/store/appStore')
    useAppStore.setState({
      activeSessionId: 'session-1',
      sessions: [{
        id: 'session-1', title: '新对话', claudeSessionId: null,
        projectPath: '/tmp/project', model: 'sonnet', permissionMode: 'acceptEdits', createdAt: 0, updatedAt: 0,
      }],
      messages: { 'session-1': [] },
      taskStates: {
        'session-1': { sessionId: 'session-1', turnId: 'active-turn', status: 'running', unreadOutputCount: 0, streamingText: '', streamingThinking: '', streamingThinkingTokens: null, streamingPhase: null, liveStatus: null },
      },
      transcripts: {
        'session-1': {
          version: 2,
          entries: [
            { id: 'user-1', turnId: 'turn-1', sequence: 0, createdAt: 0, type: 'user', text: '继续' },
            { id: 'term-1', turnId: 'turn-1', sequence: 1, createdAt: 1, type: 'terminal', outcome: 'error', errorMessage: 'boom', usage: null },
          ],
        },
      },
    })

    await useAppStore.getState().retryLastTurn('session-1')
    expect(mockIpc.sendMessage).not.toHaveBeenCalled()
  })

  it('creates an independent new turn after retry without disturbing the interrupted turn', async () => {
    mockIpc.sendMessage.mockClear()
    const { useAppStore } = await import('../src/store/appStore')

    const claudeEventHandler = mockIpc.onClaudeEvent.mock.calls[0]?.[0] as
      | ((sessionId: string, envelope: AgentEventEnvelope) => void)
      | undefined
    expect(claudeEventHandler).toBeTypeOf('function')

    useAppStore.setState({
      cliAvailable: true,
      activeSessionId: 'session-1',
      sessions: [{
        id: 'session-1', title: '新对话', claudeSessionId: null,
        projectPath: '/tmp/project', model: 'sonnet', permissionMode: 'acceptEdits', createdAt: 0, updatedAt: 0,
      }],
      messages: { 'session-1': [] },
      taskStates: {},
      transcripts: {
        'session-1': {
          version: 2,
          entries: [
            { id: 'user-1', turnId: 'turn-1', sequence: 0, createdAt: 0, type: 'user', text: '修一下登录' },
            { id: 'term-1', turnId: 'turn-1', sequence: 1, createdAt: 1, type: 'terminal', outcome: 'interrupted', errorMessage: null, usage: null, partialMarkdown: '中途被停止' },
          ],
        },
      },
    })

    await useAppStore.getState().retryLastTurn('session-1')
    const retryCall = mockIpc.sendMessage.mock.calls[0]?.[0] as { sessionId: string; prompt: string; turnId: string }
    expect(retryCall).toMatchObject({ sessionId: 'session-1', prompt: '修一下登录' })

    claudeEventHandler?.('session-1', {
      turnId: retryCall.turnId, sequence: 1, createdAt: 1, event: { type: 'text_delta', delta: '重试后正文' },
    })
    claudeEventHandler?.('session-1', {
      turnId: retryCall.turnId, sequence: 2, createdAt: 2, event: { type: 'done', sessionId: 'claude-retry-session' },
    })

    const entries = useAppStore.getState().transcripts['session-1']?.entries ?? []
    const terminals = entries.filter((entry) => entry.type === 'terminal')
    expect(terminals).toHaveLength(2)
    expect(terminals[0]).toMatchObject({ turnId: 'turn-1', outcome: 'interrupted' })
    expect(terminals[1]).toMatchObject({ outcome: 'completed' })
    expect(terminals[1]?.turnId).not.toBe('turn-1')

    const markdown = entries.find((entry) => entry.type === 'assistant_markdown')
    expect(markdown && 'markdown' in markdown ? markdown.markdown : '').toContain('重试后正文')
    expect(useAppStore.getState().taskStates['session-1']?.status).toBe('completed')
  })

  it('targets abort and cancellation state to one session task', async () => {
    const { useAppStore } = await import('../src/store/appStore')
    useAppStore.setState({
      activeSessionId: 'session-1',
      taskStates: {
        'session-1': { sessionId: 'session-1', turnId: 'turn-1', status: 'running', unreadOutputCount: 0, streamingText: '', streamingThinking: '', streamingThinkingTokens: null, streamingPhase: null, liveStatus: null },
        'session-2': { sessionId: 'session-2', turnId: 'turn-2', status: 'running', unreadOutputCount: 0, streamingText: '', streamingThinking: '', streamingThinkingTokens: null, streamingPhase: null, liveStatus: null },
      },
    })
    await useAppStore.getState().abortGeneration('session-1')
    expect(mockIpc.abortGeneration).toHaveBeenCalledWith({ sessionId: 'session-1', turnId: 'turn-1' })
    taskStatusHandler?.({ sessionId: 'session-1', turnId: 'turn-1', status: 'cancelled', externalProcessBoundary: true })
    expect(useAppStore.getState().taskStates['session-2']?.status).toBe('running')
  })

  it('allows a different session to submit while another session is active', async () => {
    mockIpc.sendMessage.mockClear()
    const { useAppStore } = await import('../src/store/appStore')
    useAppStore.setState({
      cliAvailable: true,
      activeSessionId: 'session-2',
      sessions: [
        { id: 'session-1', title: 'First', claudeSessionId: null, projectPath: '/tmp/project-a', model: 'sonnet', permissionMode: 'acceptEdits', createdAt: 0, updatedAt: 0 },
        { id: 'session-2', title: 'Second', claudeSessionId: null, projectPath: '/tmp/project-b', model: 'opus', permissionMode: 'plan', createdAt: 0, updatedAt: 0 },
      ],
      messages: { 'session-1': [], 'session-2': [] },
      transcripts: { 'session-1': { version: 2, entries: [] }, 'session-2': { version: 2, entries: [] } },
      taskStates: {
        'session-1': { sessionId: 'session-1', turnId: 'turn-1', status: 'running', unreadOutputCount: 0, streamingText: '', streamingThinking: '', streamingThinkingTokens: null, streamingPhase: null, liveStatus: null },
      },
    })

    await useAppStore.getState().sendMessage('independent task')

    expect(mockIpc.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-2', prompt: 'independent task' }))
    const turnId = mockIpc.sendMessage.mock.calls[0]?.[0]?.turnId as string
    expect(useAppStore.getState().taskStates['session-1']?.status).toBe('running')
    expect(useAppStore.getState().taskStates['session-2']?.turnId).toBe(turnId)
    taskStatusHandler?.({ sessionId: 'session-2', turnId, status: 'cancelled', externalProcessBoundary: true })
  })
})
