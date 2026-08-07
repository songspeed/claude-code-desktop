/**
 * 渲染层全局状态（Zustand）
 *
 * 管理：会话列表、激活会话、消息流、生成状态、权限模式。
 */
import { create } from 'zustand'
import { ipc } from '../ipc'
import { DEFAULT_APP_LOCALE } from '../../electron/store/types'
import type {
  AppInfo,
  AppLocale,
  AppearancePreference,
  ClaudeUserModelConfig,
  ClaudeUserModelConfigPatch,
  EffectiveTheme,
  InstalledSkill,
  Message,
  ModelId,
  PermissionMode,
  Session,
  SessionTaskState,
  Transcript,
  TranscriptUserEntry,
} from '../../electron/store/types'
import { transcriptFromLegacyMessages } from '../../electron/store/types'
import { TurnAssembler, type TranscriptCommit } from '../../electron/cli/turnAssembler'
import type { AgentEvent } from '../../electron/cli/agentTransport'
import { v4 as uuidv4 } from 'uuid'

// React StrictMode 会重复执行挂载 effect。初始化和 IPC 订阅属于应用生命周期，
// 因此共享同一个进行中的 Promise，避免同一事件被注册多个监听器。
let initialization: Promise<void> | null = null

// 当前回合的组装器（与主进程共用同一份组装逻辑）。单实例 Runner 仍然
// 需要以会话和回合双重校验事件，避免迟到事件写入已切换或新开启的对话。
const taskAssemblers = new Map<string, { turnId: string; assembler: TurnAssembler }>()

function isActiveTask(task: SessionTaskState | undefined): boolean {
  return task?.status === 'running' || task?.status === 'queued'
}

function isVisibleTaskOutput(event: AgentEvent): boolean {
  return event.type !== 'session_init' && event.type !== 'usage'
}

function applyTranscriptCommits(transcript: Transcript, commits: TranscriptCommit[]): Transcript {
  const entries = [...transcript.entries]
  for (const commit of commits) {
    if (commit.kind === 'append') {
      if (!entries.some((entry) => entry.id === commit.entry.id)) entries.push(commit.entry)
    } else if (commit.kind === 'update') {
      const index = entries.findIndex((entry) => entry.id === commit.entryId)
      if (index >= 0 && entries[index]?.type === 'tool_activity') {
        entries[index] = { ...entries[index], ...commit.patch }
      }
    }
  }
  return { ...transcript, entries }
}

function compatibilityMessages(messages: Message[], commits: TranscriptCommit[]): Message[] {
  const next = [...messages]
  for (const commit of commits) {
    if (commit.kind === 'append' && commit.compatibilityMessage) {
      if (!next.some((message) => message.id === commit.compatibilityMessage?.id)) next.push(commit.compatibilityMessage)
    } else if (commit.kind === 'update' && commit.compatibilityPatch) {
      const index = next.findIndex((message) => message.id === commit.entryId)
      if (index >= 0) next[index] = { ...next[index], ...commit.compatibilityPatch }
    }
  }
  return next
}

function getInitialEffectiveTheme(): EffectiveTheme {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export interface AppState {
  // ── 会话 ──────────────────────────────────────────────
  sessions: Session[]
  activeSessionId: string | null
  messages: Record<string, Message[]>   // sessionId → Message[]
  transcripts: Record<string, Transcript>
  taskStates: Record<string, SessionTaskState>

  // ── 外观 ────────────────────────────────────────────────
  appearancePreference: AppearancePreference
  effectiveTheme: EffectiveTheme
  appearanceError: string | null

  // ── 语言与应用信息 ─────────────────────────────────────
  locale: AppLocale
  localeError: string | null
  appInfo: AppInfo | null
  appInfoError: string | null

  // ── 项目上下文 / Skills ────────────────────────────────────
  projectError: string | null
  skills: InstalledSkill[]
  skillsLoading: boolean
  skillsError: string | null

  // ── Claude 用户模型配置 ────────────────────────────────
  claudeUserModelConfig: ClaudeUserModelConfig | null
  claudeUserModelConfigLoading: boolean
  claudeUserModelConfigSaving: boolean
  claudeUserModelConfigError: string | null

  // ── CLI 可用性 ─────────────────────────────────────────
  cliAvailable: boolean | null   // null=未检测
  cliVersion: string | null
  cliError: string | null
  cliRefreshing: boolean

  // ── Actions ───────────────────────────────────────────
  init: () => Promise<void>
  createSession: () => Promise<Session>
  switchSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  setSessionModel: (id: string, model: ModelId) => Promise<void>
  setSessionPermissionMode: (id: string, permissionMode: PermissionMode) => Promise<void>
  chooseProjectDirectory: (id?: string) => Promise<void>
  revealProjectDirectory: (id?: string) => Promise<void>
  refreshSkills: (sessionId?: string | null) => Promise<void>
  loadClaudeUserModelConfig: () => Promise<void>
  saveClaudeUserModelConfig: (
    patch: ClaudeUserModelConfigPatch
  ) => Promise<ClaudeUserModelConfig | null>
  refreshCliAvailability: () => Promise<void>
  sendMessage: (prompt: string) => Promise<void>
  abortGeneration: (sessionId?: string) => Promise<void>
  retryLastTurn: (sessionId: string) => Promise<void>
  setAppearancePreference: (preference: AppearancePreference) => Promise<void>
  setLocale: (locale: AppLocale) => Promise<void>
  loadAppInfo: () => Promise<void>
  handleSessionTitleUpdate: (sessionId: string, title: string) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: {},
  transcripts: {},
  taskStates: {},
  appearancePreference: 'system',
  effectiveTheme: getInitialEffectiveTheme(),
  appearanceError: null,
  locale: DEFAULT_APP_LOCALE,
  localeError: null,
  appInfo: null,
  appInfoError: null,
  projectError: null,
  skills: [],
  skillsLoading: false,
  skillsError: null,
  claudeUserModelConfig: null,
  claudeUserModelConfigLoading: false,
  claudeUserModelConfigSaving: false,
  claudeUserModelConfigError: null,
  cliAvailable: null,
  cliVersion: null,
  cliError: null,
  cliRefreshing: false,

  // ── 初始化：加载会话列表、检测 CLI 可用性 ─────────────────
  init: () => {
    if (initialization) return initialization

    set({ claudeUserModelConfigLoading: true, claudeUserModelConfigError: null })

    initialization = (async () => {
      const [sessions, availability, appearance, configResult, localeResult] = await Promise.all([
        ipc.listSessions(),
        ipc.checkAvailability(),
        ipc.getAppearance(),
        ipc.getClaudeUserModelConfig()
          .then((config) => ({ config, error: null }))
          .catch((error) => ({ config: null, error: String(error) })),
        ipc.getLocale()
          .then((locale) => ({ locale, error: null }))
          .catch((error) => ({ locale: DEFAULT_APP_LOCALE, error: String(error) })),
      ])
      applyEffectiveTheme(appearance.effectiveTheme)
      set({
        sessions,
        cliAvailable: availability.available,
        cliVersion: availability.version ?? null,
        cliError: availability.error ?? null,
        appearancePreference: appearance.preference,
        effectiveTheme: appearance.effectiveTheme,
        claudeUserModelConfig: configResult.config,
        claudeUserModelConfigLoading: false,
        claudeUserModelConfigError: configResult.error,
        locale: localeResult.locale,
        localeError: localeResult.error,
      })

      // 如有会话，激活第一个并加载消息
      if (sessions.length > 0) {
        await get().switchSession(sessions[0].id)
      }

      // 订阅主进程的 claude:event 推送。组装规则由 TurnAssembler 统一承担，
      // Apply one task's commits and live stream only to its originating session.
      ipc.onClaudeEvent((sessionId, envelope) => {
        const task = taskAssemblers.get(sessionId)
        const taskState = get().taskStates[sessionId]
        if (!task || task.turnId !== envelope.turnId || taskState?.turnId !== envelope.turnId) return

        const commits = task.assembler.feed(envelope)
        const isTerminal =
          envelope.event.type === 'done' || envelope.event.type === 'aborted' || envelope.event.type === 'error'
        const completesTask = isTerminal

        set((s) => {
          let sessions = s.sessions
          for (const commit of commits) {
            if (commit.kind === 'session') {
              sessions = sessions.map((ss) =>
                ss.id === sessionId ? { ...ss, claudeSessionId: commit.claudeSessionId } : ss
              )
            }
          }

          const currentTranscript = s.transcripts[sessionId]
            ?? transcriptFromLegacyMessages(s.messages[sessionId] ?? [])
          const nextTranscript = applyTranscriptCommits(currentTranscript, commits)

          return {
            // 冲刷提交与 liveText 归零在同一次 set 内完成，避免临时内容与正式条目重影。
            sessions,
            taskStates: {
              ...s.taskStates,
              [sessionId]: {
                ...(s.taskStates[sessionId] ?? { sessionId, turnId: envelope.turnId, status: 'running', unreadOutputCount: 0 }),
                status: isTerminal ? (envelope.event.type === 'done' ? 'completed' : envelope.event.type === 'error' ? 'error' : 'interrupted') : 'running',
                unreadOutputCount: s.activeSessionId === sessionId
                  ? 0
                  : (s.taskStates[sessionId]?.unreadOutputCount ?? 0) + (isVisibleTaskOutput(envelope.event) ? 1 : 0),
                streamingText: task.assembler.liveText,
                streamingThinking: task.assembler.liveThinking,
                streamingThinkingTokens: task.assembler.liveThinkingTokens ?? null,
                streamingPhase: task.assembler.livePhase ?? null,
                liveStatus: task.assembler.liveStatus,
              },
            },
            transcripts: { ...s.transcripts, [sessionId]: nextTranscript },
            messages: { ...s.messages, [sessionId]: compatibilityMessages(s.messages[sessionId] ?? [], commits) },
          }
        })

        if (completesTask) taskAssemblers.delete(sessionId)
      })

      ipc.onTaskStatus?.(({ sessionId, turnId, status, queuePosition, externalProcessBoundary }) => {
        const existing = get().taskStates[sessionId]
        if (existing && existing.turnId !== turnId) return
        if (status === 'cancelled') taskAssemblers.delete(sessionId)
        set((state) => ({
          taskStates: {
            ...state.taskStates,
            [sessionId]: {
              ...(existing ?? { sessionId, turnId, unreadOutputCount: 0, streamingText: '', streamingThinking: '', streamingThinkingTokens: null, streamingPhase: null, liveStatus: null }),
              status,
              queuePosition,
              externalProcessBoundary,
            },
          },
        }))
      })

      // 订阅 sessions:updated 推送（标题自动生成）
      ipc.onSessionUpdated((sessionId, title) => {
        get().handleSessionTitleUpdate(sessionId, title)
      })

      ipc.onAppearanceChanged((appearance) => {
        applyEffectiveTheme(appearance.effectiveTheme)
        set({
          appearancePreference: appearance.preference,
          effectiveTheme: appearance.effectiveTheme,
        })
      })

      ipc.onLocaleChanged((locale) => {
        set({ locale, localeError: null })
      })
    })().catch((error) => {
      initialization = null
      throw error
    })

    return initialization
  },

  createSession: async () => {
    const session = await ipc.createSession()
    set((s) => ({ sessions: [session, ...s.sessions] }))
    await get().switchSession(session.id)
    return session
  },

  switchSession: async (id: string) => {
    const existing = get().transcripts[id]
    set((state) => {
      const task = state.taskStates[id]
      return {
        activeSessionId: id,
        ...(task?.unreadOutputCount
          ? { taskStates: { ...state.taskStates, [id]: { ...task, unreadOutputCount: 0 } } }
          : {}),
      }
    })
    if (existing) return

    const data = await ipc.getSessionData(id)
    set((s) => ({
      messages: { ...s.messages, [id]: data?.messages ?? [] },
      transcripts: {
        ...s.transcripts,
        [id]: data?.transcript ?? transcriptFromLegacyMessages(data?.messages ?? []),
      },
    }))
  },

  renameSession: async (id: string, title: string) => {
    await ipc.updateSession(id, { title, updatedAt: Date.now() })
    set((s) => ({
      sessions: s.sessions.map((ss) => (ss.id === id ? { ...ss, title } : ss)),
    }))
  },

  deleteSession: async (id: string) => {
    await ipc.deleteSession(id)
    set((s) => {
      const sessions = s.sessions.filter((ss) => ss.id !== id)
      const messages = { ...s.messages }
      delete messages[id]
      const transcripts = { ...s.transcripts }
      delete transcripts[id]
      const activeSessionId =
        s.activeSessionId === id ? (sessions[0]?.id ?? null) : s.activeSessionId
      return { sessions, messages, transcripts, activeSessionId }
    })
    // 如切换到新激活会话，加载其消息
    const newActive = get().activeSessionId
    if (newActive && !get().transcripts[newActive]) {
      await get().switchSession(newActive)
    }
  },

  setSessionModel: async (id: string, model: ModelId) => {
    if (isActiveTask(get().taskStates[id])) return
    const updated = await ipc.updateSession(id, { model, updatedAt: Date.now() })
    if (!updated) return
    set((s) => ({
      sessions: s.sessions.map((session) => (session.id === id ? updated : session)),
    }))
  },

  setSessionPermissionMode: async (id: string, permissionMode: PermissionMode) => {
    if (isActiveTask(get().taskStates[id])) return
    const updated = await ipc.updateSession(id, { permissionMode, updatedAt: Date.now() })
    if (!updated) return
    set((s) => ({
      sessions: s.sessions.map((session) => (session.id === id ? updated : session)),
    }))
  },

  chooseProjectDirectory: async (id = get().activeSessionId ?? undefined) => {
    if (!id || isActiveTask(get().taskStates[id])) return
    try {
      const updated = await ipc.chooseProjectDirectory(id)
      if (!updated) return
      set((state) => ({
        sessions: state.sessions.map((session) => session.id === updated.id ? updated : session),
        projectError: null,
      }))
    } catch (error) {
      set({ projectError: String(error) })
    }
  },

  revealProjectDirectory: async (id = get().activeSessionId ?? undefined) => {
    if (!id) return
    try {
      await ipc.revealProjectDirectory(id)
      set({ projectError: null })
    } catch (error) {
      set({ projectError: String(error) })
    }
  },

  refreshSkills: async (sessionId = get().activeSessionId) => {
    set({ skillsLoading: true, skillsError: null })
    try {
      const skills = await ipc.listInstalledSkills(sessionId ?? null)
      set({ skills, skillsLoading: false })
    } catch (error) {
      set({ skillsLoading: false, skillsError: String(error) })
    }
  },

  loadClaudeUserModelConfig: async () => {
    set({ claudeUserModelConfigLoading: true, claudeUserModelConfigError: null })
    try {
      const config = await ipc.getClaudeUserModelConfig()
      set({
        claudeUserModelConfig: config,
        claudeUserModelConfigLoading: false,
        claudeUserModelConfigError: null,
      })
    } catch (error) {
      set({
        claudeUserModelConfig: null,
        claudeUserModelConfigLoading: false,
        claudeUserModelConfigError: String(error),
      })
    }
  },

  saveClaudeUserModelConfig: async (patch) => {
    set({ claudeUserModelConfigSaving: true, claudeUserModelConfigError: null })
    try {
      const config = await ipc.saveClaudeUserModelConfig(patch)
      set({
        claudeUserModelConfig: config,
        claudeUserModelConfigSaving: false,
        claudeUserModelConfigError: null,
      })
      return config
    } catch (error) {
      set({
        claudeUserModelConfigSaving: false,
        claudeUserModelConfigError: String(error),
      })
      return null
    }
  },

  refreshCliAvailability: async () => {
    set({ cliRefreshing: true })
    try {
      const availability = await ipc.checkAvailability()
      set({
        cliAvailable: availability.available,
        cliVersion: availability.version ?? null,
        cliError: availability.error ?? null,
        cliRefreshing: false,
      })
    } catch (error) {
      set({
        cliAvailable: false,
        cliVersion: null,
        cliError: String(error),
        cliRefreshing: false,
      })
    }
  },

  sendMessage: async (prompt: string) => {    const state = get()
    if (!prompt.trim()) return

    const sessionId = state.activeSessionId
    if (!sessionId) return

    const session = state.sessions.find((s) => s.id === sessionId)
    if (!session) return
    if (isActiveTask(state.taskStates[sessionId])) return
    if (!session.projectPath) {
      set({ projectError: '请先为此对话选择本地项目目录。' })
      return
    }
    if (state.cliAvailable !== true) {
      set({ cliError: '请先安装并登录 Claude Code CLI。' })
      return
    }

    // 立即将用户消息添加到 UI 状态
    const turnId = uuidv4()
    const createdAt = Date.now()
    const userMsg: Message = {
      id: uuidv4(),
      role: 'user',
      text: prompt,
      turnId,
      createdAt,
    }
    // 新建本回合组装器，承接随后的 claude:event 事件
    taskAssemblers.set(sessionId, { turnId, assembler: new TurnAssembler(turnId) })
    const userEntry: TranscriptUserEntry = {
      id: userMsg.id,
      turnId,
      sequence: 0,
      createdAt,
      type: 'user',
      text: prompt,
    }

    set((s) => ({
      taskStates: {
        ...s.taskStates,
        [sessionId]: { sessionId, turnId, status: 'running', unreadOutputCount: 0, streamingText: '', streamingThinking: '', streamingThinkingTokens: null, streamingPhase: null, liveStatus: null },
      },
      projectError: null,
      messages: {
        ...s.messages,
        [sessionId]: [...(s.messages[sessionId] ?? []), userMsg],
      },
      transcripts: {
        ...s.transcripts,
        [sessionId]: {
          ...(s.transcripts[sessionId] ?? transcriptFromLegacyMessages(s.messages[sessionId] ?? [])),
          entries: [
            ...(s.transcripts[sessionId] ?? transcriptFromLegacyMessages(s.messages[sessionId] ?? [])).entries,
            userEntry,
          ],
        },
      },
    }))

    try {
      await ipc.sendMessage({
        sessionId,
        prompt,
        turnId,
        messageId: userMsg.id,
        createdAt,
      })
    } catch (err) {
      // IPC 调用本身失败（无事件流），直接落一条错误并复位
      const errorEnvelope = {
        turnId,
        sequence: Number.MAX_SAFE_INTEGER,
        createdAt: Date.now(),
        event: { type: 'error' as const, message: String(err) },
      }
      const task = taskAssemblers.get(sessionId)
      if (!task || task.turnId !== turnId) return
      const commits = task.assembler.feed(errorEnvelope)
      taskAssemblers.delete(sessionId)
      set((s) => ({
        taskStates: { ...s.taskStates, [sessionId]: { ...s.taskStates[sessionId], status: 'error', streamingText: '', streamingThinking: '', streamingThinkingTokens: null, streamingPhase: null, liveStatus: null } },
        transcripts: {
          ...s.transcripts,
          [sessionId]: applyTranscriptCommits(s.transcripts[sessionId], commits),
        },
        messages: { ...s.messages, [sessionId]: compatibilityMessages(s.messages[sessionId] ?? [], commits) },
      }))
    }
  },

  retryLastTurn: async (sessionId: string) => {
    const state = get()
    if (isActiveTask(state.taskStates[sessionId])) return
    const transcript = state.transcripts[sessionId]
    if (!transcript) return
    const terminals = transcript.entries.filter((entry) => entry.type === 'terminal')
    const last = terminals[terminals.length - 1]
    if (!last || last.outcome === 'completed') return
    let lastUserText: string | null = null
    for (const entry of transcript.entries) {
      if (entry.turnId !== last.turnId) continue
      if (entry.type === 'user') lastUserText = entry.text
    }
    if (!lastUserText) return
    if (state.activeSessionId !== sessionId) set({ activeSessionId: sessionId })
    await get().sendMessage(lastUserText)
  },

  abortGeneration: async (sessionId = get().activeSessionId ?? undefined) => {
    if (!sessionId) return
    const task = get().taskStates[sessionId]
    if (!task || (task.status !== 'running' && task.status !== 'queued')) return
    await ipc.abortGeneration({ sessionId, turnId: task.turnId })
  },

  setAppearancePreference: async (preference: AppearancePreference) => {
    try {
      const appearance = await ipc.setAppearance(preference)
      applyEffectiveTheme(appearance.effectiveTheme)
      set({
        appearancePreference: appearance.preference,
        effectiveTheme: appearance.effectiveTheme,
        appearanceError: appearance.persisted ? null : '外观已临时应用，但无法保存为默认设置。',
      })
    } catch (error) {
      set({ appearanceError: `无法更新外观设置：${String(error)}` })
    }
  },

  setLocale: async (locale: AppLocale) => {
    try {
      const result = await ipc.setLocale(locale)
      set({
        locale: result.locale,
        localeError: result.persisted ? null : '无法将语言偏好保存到本地。',
      })
    } catch (error) {
      set({ localeError: String(error) })
    }
  },

  loadAppInfo: async () => {
    try {
      const appInfo = await ipc.getAppInfo()
      set({ appInfo, appInfoError: null })
    } catch (error) {
      set({ appInfoError: String(error) })
    }
  },

  handleSessionTitleUpdate: (sessionId: string, title: string) => {
    set((s) => ({
      sessions: s.sessions.map((ss) => (ss.id === sessionId ? { ...ss, title } : ss)),
    }))
  },
}))

function applyEffectiveTheme(theme: EffectiveTheme): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
}
