/**
 * AgentTransport 内部接口
 *
 * 上层（渲染/会话/持久化）只依赖此接口，不绑定具体实现。
 * MVP 实现：方案 A（裸 CLI --print + stream-json）。
 * 升级口：方案 B（ACP 桥）或方案 C（Agent SDK）可无缝替换。
 *
 * 权限说明（方案 A 的结论）：
 *   CLI 的权限通过 --permission-mode 标志统一控制，stream-json 中没有
 *   per-operation 的权限请求事件。因此授权模式必须在每次调用前确定，
 *   并由会话配置保存后在下一次调用中生效。
 *   如需 per-operation 权限确认，需升级到方案 B/C。
 */

import type { PermissionMode } from '../store/types'
import type { TranscriptNotice } from '../store/types'

export type { PermissionMode } from '../store/types'

/** 当前传输经实际事件验证后可提供的输出能力。 */
export type AgentCapability =
  | 'basic-activity'
  | 'activity-results'
  | 'task-progress'
  | 'system-notices'

/**
 * 由已固定的 Claude Code stream-json 夹具验证的当前适配器能力。
 * 进度与压缩事件保留在共享契约中，但在其字段形态被确认前不能向 UI 宣称支持。
 */
export const CLAUDE_STREAM_JSON_CAPABILITIES = {
  'basic-activity': true,
  'activity-results': true,
  'task-progress': false,
  'system-notices': true,
} as const satisfies Record<AgentCapability, boolean>

/** 推向渲染层的内部事件类型。 */
export type AgentEvent =
  | { type: 'session_init'; sessionId: string }       // init：提前拿到 CLI session_id（runner 内部消费）
  | { type: 'text_delta'; delta: string }            // 增量文本
  | { type: 'activity_started'; activityId: string; toolName: string; input: string }
  | { type: 'activity_result'; activityId: string; output?: string; isError?: boolean }
  | { type: 'status'; notice: TranscriptNotice }
  | { type: 'done'; sessionId: string }               // 完成，携带 CLI 会话 ID
  | { type: 'aborted' }                               // 已中断
  | { type: 'error'; message: string; errorSubtype?: string } // 错误（errorSubtype 为 CLI result.subtype 线索）

/** 主进程为每个事件补充回合、顺序和时间，供持久化与渲染层共同消费。 */
export interface AgentEventEnvelope {
  turnId: string
  sequence: number
  createdAt: number
  event: AgentEvent
}

export interface SendOptions {
  prompt: string
  model: string
  /** GUI 会话对应的 CLI session_id，有则 --resume，无则新建 */
  claudeSessionId?: string
  permissionMode: PermissionMode
  /** 已由主进程验证的项目目录，作为 Claude CLI 的工作目录。 */
  cwd?: string
}

/** AgentTransport 接口 */
export interface AgentTransport {
  /** 发送一条用户消息，通过 onEvent 回调推送事件 */
  send(opts: SendOptions, onEvent: (e: AgentEvent) => void): Promise<void>
  /** 中断当前生成 */
  abort(): void
  /** 当前是否正在生成 */
  readonly isRunning: boolean
}
