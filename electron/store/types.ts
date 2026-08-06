// 会话与消息的数据类型定义（主进程 + 渲染层共享）

/** 支持的模型列表（以 CLI --model 参数值为准）。
 *
 * 使用 CLI 的稳定别名而不是猜测的未来完整模型名。Claude Code 会将别名
 * 解析到当前账号可用的实际模型版本，避免客户端升级滞后导致请求失败。
 */
export const AVAILABLE_MODELS = [
  {
    id: 'sonnet',
    label: 'Claude Sonnet',
    pickerLabel: 'Sonnet',
    configField: 'sonnetModel',
    description: '兼顾速度与能力的日常选择',
  },
  {
    id: 'opus',
    label: 'Claude Opus',
    pickerLabel: 'Opus',
    configField: 'opusModel',
    description: '适合复杂推理与高难度任务',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    pickerLabel: 'Haiku',
    configField: 'haikuModel',
    description: '适合快速、轻量的任务',
  },
  {
    id: 'fable',
    label: 'Claude Fable',
    pickerLabel: 'Fable',
    configField: 'fableModel',
    description: '使用 Claude 用户配置中定义的 Fable 模型',
  },
] as const

export type ModelId = (typeof AVAILABLE_MODELS)[number]['id']
export const DEFAULT_MODEL: ModelId = 'sonnet'

/** 旧版客户端曾保存过的模型名，读取时无缝迁移到稳定 CLI 别名。 */
const LEGACY_MODEL_IDS: Record<string, ModelId> = {
  'claude-opus-5': 'opus',
  'claude-sonnet-5': 'sonnet',
}

/** 将磁盘中可能过时或损坏的模型值规范为当前可用模型。 */
export function normalizeModelId(model: unknown): ModelId {
  if (typeof model === 'string') {
    const known = AVAILABLE_MODELS.find((candidate) => candidate.id === model)
    if (known) return known.id
    if (model in LEGACY_MODEL_IDS) return LEGACY_MODEL_IDS[model]
  }
  return DEFAULT_MODEL
}

/** Claude Code CLI 可由当前无头传输可靠执行的会话级授权模式。 */
export const PERMISSION_OPTIONS = [
  { id: 'acceptEdits', label: '自动接受编辑', description: '自动接受文件编辑，其余操作仍遵循 Claude Code 的权限策略' },
  { id: 'plan', label: '仅规划', description: '只分析和规划，不执行修改' },
  { id: 'dontAsk', label: '拒绝未授权工具', description: '无法自动执行的工具操作将被拒绝' },
  { id: 'bypassPermissions', label: '全部放行', description: '跳过权限检查，可能直接执行命令或修改文件' },
] as const

export type PermissionMode = (typeof PERMISSION_OPTIONS)[number]['id']
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'acceptEdits'

/** 将磁盘中缺失、过时或无效的授权模式规范为当前默认值。 */
export function normalizePermissionMode(mode: unknown): PermissionMode {
  if (typeof mode === 'string') {
    const known = PERMISSION_OPTIONS.find((candidate) => candidate.id === mode)
    if (known) return known.id
  }
  return DEFAULT_PERMISSION_MODE
}

/** 用户选择的应用外观。system 表示跟随操作系统深浅色设置。 */
export type AppearancePreference = 'light' | 'dark' | 'system'
export type EffectiveTheme = Exclude<AppearancePreference, 'system'>

export interface AppearanceState {
  preference: AppearancePreference
  effectiveTheme: EffectiveTheme
}

export interface AppearanceUpdateResult extends AppearanceState {
  persisted: boolean
}

/** 客户端界面语言。用户内容、项目路径和 Claude 输出不受此设置影响。 */
export type AppLocale = 'zh-CN' | 'en'
export const DEFAULT_APP_LOCALE: AppLocale = 'zh-CN'

export interface LocaleUpdateResult {
  locale: AppLocale
  persisted: boolean
}

/** 关于页面可显示的非敏感运行时信息。 */
export interface AppInfo {
  name: string
  version: string
  electronVersion: string
  platform: string
  arch: string
}

/** 从 Claude 用户级 settings.json 投影出的可编辑模型配置。 */
export interface ClaudeUserModelConfig {
  path: string
  defaultModel: string
  sonnetModel: string
  opusModel: string
  haikuModel: string
  fableModel: string
}

export type ClaudeUserModelConfigPatch = Omit<ClaudeUserModelConfig, 'path'>

/** 单条消息 */
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'error' | 'interrupted'
  /** 纯文本内容（assistant / user）*/
  text?: string
  /** 工具调用名称（tool 条目）*/
  toolName?: string
  /** 工具调用输入（JSON string）*/
  toolInput?: string
  /** 错误信息（error 条目）*/
  errorMessage?: string
  createdAt: number
  /** 是否已被中断 */
  aborted?: boolean
  /** 所属的新式输出回合；旧记录可缺省。 */
  turnId?: string
  /** 兼容投影中的工具生命周期信息；旧界面可安全忽略。 */
  toolState?: TranscriptActivityState
  toolOutput?: string
  detailsTruncated?: boolean
  detailsRedacted?: boolean
}

export const TRANSCRIPT_VERSION = 2 as const

export type TranscriptActivityState =
  | 'running'
  | 'completed'
  | 'failed'
  | 'permission_denied'
  | 'details_unavailable'
  | 'interrupted'

export type TranscriptNotice =
  | { kind: 'retry'; attempt?: number; maxRetries?: number; status?: number }
  | { kind: 'context_compacted' }
  | { kind: 'task_progress'; completed: number; total: number }
  | { kind: 'requesting' }
  | { kind: 'permission_denied'; toolName?: string; detail?: string }

export interface TranscriptDetails {
  input?: string
  output?: string
  error?: string
  truncated?: boolean
  redacted?: boolean
}

interface TranscriptEntryBase {
  id: string
  turnId: string
  sequence: number
  createdAt: number
  legacy?: boolean
}

export interface TranscriptUserEntry extends TranscriptEntryBase {
  type: 'user'
  text: string
}

export interface TranscriptAssistantEntry extends TranscriptEntryBase {
  type: 'assistant_markdown'
  markdown: string
}

export interface TranscriptActivityEntry extends TranscriptEntryBase {
  type: 'tool_activity'
  activityId: string
  toolName: string
  state: TranscriptActivityState
  details: TranscriptDetails
  durationMs?: number
}

export interface TranscriptNoticeEntry extends TranscriptEntryBase {
  type: 'notice'
  notice: TranscriptNotice
}

export interface TranscriptTerminalEntry extends TranscriptEntryBase {
  type: 'terminal'
  outcome: 'completed' | 'error' | 'interrupted'
  errorMessage?: string
  partialMarkdown?: string
  /** 回合结束的 token 用量与耗时（CLI result.usage） */
  usage?: TokenUsage
}

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** CLI 端到端耗时（毫秒） */
  durationMs?: number
  /** 回合成本（美元），CLI total_cost_usd 优先、modelUsage 回退求和 */
  costUsd?: number
  /** 回合主导模型名（modelUsage 的首个 key） */
  model?: string
}

export type TranscriptEntry =
  | TranscriptUserEntry
  | TranscriptAssistantEntry
  | TranscriptActivityEntry
  | TranscriptNoticeEntry
  | TranscriptTerminalEntry

export interface Transcript {
  version: typeof TRANSCRIPT_VERSION
  entries: TranscriptEntry[]
}

/** 将旧版平铺消息转换为只读 transcript，不修改磁盘直到有新版写入。 */
export function transcriptFromLegacyMessages(messages: Message[]): Transcript {
  const entries: TranscriptEntry[] = []

  messages.forEach((message, index) => {
    const turnId = message.turnId ?? `legacy:${message.id}`
    const base = {
      id: `legacy:${message.id}`,
      turnId,
      sequence: index,
      createdAt: message.createdAt,
      legacy: true,
    } as const

    if (message.role === 'user') {
      entries.push({ ...base, type: 'user', text: message.text ?? '' })
    } else if (message.role === 'assistant') {
      entries.push({ ...base, type: 'assistant_markdown', markdown: message.text ?? '' })
    } else if (message.role === 'tool') {
      entries.push({
        ...base,
        type: 'tool_activity',
        activityId: message.id,
        toolName: message.toolName ?? 'Tool',
        state: message.toolState ?? 'details_unavailable',
        details: {
          input: message.toolInput,
          output: message.toolOutput,
          truncated: message.detailsTruncated,
          redacted: message.detailsRedacted,
        },
      })
    } else {
      entries.push({
        ...base,
        type: 'terminal',
        outcome: message.role === 'error' ? 'error' : 'interrupted',
        errorMessage: message.errorMessage,
        partialMarkdown: message.text,
      })
    }
  })

  return { version: TRANSCRIPT_VERSION, entries }
}

/** 会话元信息 */
export interface Session {
  id: string                    // GUI 会话 UUID（与 claudeSessionId 不同）
  title: string
  claudeSessionId: string | null // CLI 返回的 session_id，用于 --resume
  /** Claude CLI 执行此会话时使用的本地项目目录；旧会话可为空。 */
  projectPath: string | null
  model: ModelId
  /** 当前会话后续 Claude CLI 请求使用的授权模式。 */
  permissionMode: PermissionMode
  createdAt: number
  updatedAt: number
}

/** 存储于磁盘的会话数据（含消息） */
export interface SessionData {
  session: Session
  messages: Message[]
  /** 新式回合输出记录；缺失时由 messages 惰性转换以兼容旧会话。 */
  transcript?: Transcript
}

/** 会话索引条目 */
export interface SessionIndex {
  sessions: Array<Pick<Session, 'id' | 'title' | 'model' | 'permissionMode' | 'projectPath' | 'createdAt' | 'updatedAt'>>
}

export type SkillScope = 'project' | 'user' | 'plugin'

/** 本地发现到的 Claude Code Skill 元数据。 */
export interface InstalledSkill {
  name: string
  description: string
  path: string
  scope: SkillScope
  source: string
}

/** 可由输入框引用的、位于当前项目根目录内的相对文件路径。 */
export interface WorkspaceFile {
  path: string
}
