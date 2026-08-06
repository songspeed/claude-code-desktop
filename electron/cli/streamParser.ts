/**
 * Claude CLI stream-json 事件解析器。
 *
 * 夹具基于 Claude Code 2.1.222 的只读 Read 调用：完整工具输入位于
 * assistant.tool_use，关联结果位于 user.tool_result。未知事件仍安全忽略。
 *
 * 已覆盖的事件：system/init、system/api_retry、system/status（实时阶段）、
 * system/thinking_tokens、stream_event 的 text_delta / thinking_delta、
 * assistant tool_use、user tool_result、result（用量/成本/模型/权限拒绝清单）。
 * 有意忽略：input_json_delta（完整 input 随 assistant 到达）、
 * signature_delta、message_delta 的 usage（result 才是回合权威值）、
 * message_start/stop 与 content_block_start/stop。
 */

import type { AgentEvent, TokenUsage } from './agentTransport'

interface StreamInit {
  type: 'system'
  subtype: 'init'
  session_id: string
}

interface StreamAssistant {
  type: 'assistant'
  message: {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'thinking'; thinking: string }
      | { type: 'tool_use'; id?: string; name: string; input: unknown }
    >
  }
}

interface StreamResult {
  type: 'result'
  subtype?: string
  is_error: boolean
  result?: string
  session_id: string
  duration_ms?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  /** 回合总成本（美元），CLI 报告的权威值 */
  total_cost_usd?: number
  /** 按模型统计的用量与成本（key 为模型名） */
  modelUsage?: Record<string, { costUSD?: number }>
  /** 回合内被权限拒绝的请求清单 */
  permission_denials?: unknown[]
}

interface StreamPartial {
  type: 'stream_event'
  event: {
    type: string
    delta?: { type: string; text?: string; thinking?: string }
  }
}

interface StreamToolResult {
  type: 'tool_result'
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface StreamUser {
  type: 'user'
  message?: { content?: StreamToolResult[] }
}

/**
 * 剥离 ANSI 转义序列（颜色/样式/光标控制），零依赖。
 * 标准 CSI/OSC 形态正则：ESC(0x1B) 或 CSI(0x9B) 起始、可选参数串、最终字节。
 */
const ANSI_ESCAPE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

/** 移除文本中的 ANSI 转义序列，保留有效文本。 */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE, '')
}

function stringifyValue(value: unknown): string | undefined {
  if (typeof value === 'string') return stripAnsi(value)
  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') return item.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
    return stripAnsi(text) || undefined
  }
  if (value == null) return undefined
  try {
    return stripAnsi(JSON.stringify(value, null, 2))
  } catch {
    return stripAnsi(String(value))
  }
}

/** 解析单行 JSON，返回对应的内部事件列表（可能为空）。 */
export function parseLine(line: string): AgentEvent[] {
  const trimmed = line.replace(/\r$/, '').trim()
  if (!trimmed) return []

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return []
  }

  const events: AgentEvent[] = []
  const type = obj.type

  if (type === 'system') {
    const subtype = obj.subtype
    if (subtype === 'init') {
      const init = obj as unknown as StreamInit
      if (init.session_id) events.push({ type: 'session_init', sessionId: init.session_id })
    } else if (subtype === 'api_retry') {
      const attempt = typeof obj.attempt === 'number' ? obj.attempt : undefined
      const maxRetries = typeof obj.max_retries === 'number' ? obj.max_retries : undefined
      const status = typeof obj.error_status === 'number' ? obj.error_status : undefined
      events.push({ type: 'status', notice: { kind: 'retry', attempt, maxRetries, status } })
    } else if (subtype === 'status') {
      if (typeof obj.value === 'string' && obj.value) {
        events.push({ type: 'phase_update', phase: obj.value })
      }
    } else if (subtype === 'thinking_tokens') {
      const estimated = typeof obj.estimated_tokens === 'number' ? obj.estimated_tokens : undefined
      if (estimated != null) events.push({ type: 'thinking_count', estimatedTokens: estimated })
    }
    return events
  }

  if (type === 'stream_event') {
    const partial = obj as unknown as StreamPartial
    const event = partial.event
    if (event?.type === 'content_block_delta') {
      if (event.delta?.type === 'text_delta' && event.delta.text) {
        events.push({ type: 'text_delta', delta: event.delta.text })
      } else if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
        events.push({ type: 'thinking_delta', delta: event.delta.thinking })
      }
    }
    return events
  }

  if (type === 'assistant') {
    const assistant = obj as unknown as StreamAssistant
    for (const block of assistant.message?.content ?? []) {
      if (block.type !== 'tool_use') continue
      const input = stringifyValue(block.input) ?? ''
      // v2.1.222 提供 block.id；缺失时仍保留基础活动，但无法可靠关联结果。
      const activityId = block.id || `unlinked:${block.name}:${input}`
      events.push({ type: 'activity_started', activityId, toolName: block.name, input })
    }
    return events
  }

  if (type === 'user') {
    const user = obj as unknown as StreamUser
    for (const block of user.message?.content ?? []) {
      if (block.type !== 'tool_result' || !block.tool_use_id) continue
      events.push({
        type: 'activity_result',
        activityId: block.tool_use_id,
        output: stringifyValue(block.content),
        isError: block.is_error === true,
      })
    }
    return events
  }

  if (type === 'result') {
    const result = obj as unknown as StreamResult
    const usage = toTokenUsage(result)
    if (usage) events.push({ type: 'usage', usage })
    for (const denied of toPermissionNotices(result)) {
      events.push({ type: 'status', notice: { kind: 'permission_denied', ...denied } })
    }
    if (result.is_error) {
      events.push({ type: 'error', message: result.result?.trim() ?? '', errorSubtype: result.subtype })
    } else {
      events.push({ type: 'done', sessionId: result.session_id })
    }
  }

  return events
}

/** 将 CLI result 的 usage 字段映射为内部结构（缺字段时不发事件）。 */
function toTokenUsage(result: StreamResult): TokenUsage | undefined {
  const usage = result.usage
  const hasTokens = usage && [usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens]
    .some((value) => typeof value === 'number')
  const modelInfo = toModelInfo(result)
  const hasAnything = hasTokens === true
    || typeof result.duration_ms === 'number'
    || typeof result.total_cost_usd === 'number'
    || modelInfo.model !== undefined
    || modelInfo.costUsd !== undefined
  if (!hasAnything) return undefined
  return {
    ...(usage && typeof usage.input_tokens === 'number' ? { inputTokens: usage.input_tokens } : {}),
    ...(usage && typeof usage.output_tokens === 'number' ? { outputTokens: usage.output_tokens } : {}),
    ...(usage && typeof usage.cache_read_input_tokens === 'number' ? { cacheReadTokens: usage.cache_read_input_tokens } : {}),
    ...(usage && typeof usage.cache_creation_input_tokens === 'number' ? { cacheWriteTokens: usage.cache_creation_input_tokens } : {}),
    ...(typeof result.duration_ms === 'number' ? { durationMs: result.duration_ms } : {}),
    ...(typeof result.total_cost_usd === 'number' ? { costUsd: result.total_cost_usd } : {}),
    ...modelInfo,
  }
}

/** 从 result.modelUsage 提取主导模型名与总成本（total_cost_usd 缺失时的回退）。 */
function toModelInfo(result: StreamResult): { model?: string; costUsd?: number } {
  const entries = Object.entries(result.modelUsage ?? {})
  if (entries.length === 0) return {}
  const sum = entries.reduce((acc, [, value]) => acc + (typeof value?.costUSD === 'number' ? value.costUSD : 0), 0)
  const hasAnyCost = entries.some(([, value]) => typeof value?.costUSD === 'number')
  return {
    model: entries[0]![0],
    ...(hasAnyCost ? { costUsd: sum } : {}),
  }
}

/** 将 result.permission_denials 映射为可展示的拒绝摘要（无权限拒绝时返回空数组）。 */
function toPermissionNotices(result: StreamResult): Array<{ toolName?: string; detail?: string }> {
  if (!Array.isArray(result.permission_denials) || result.permission_denials.length === 0) return []
  return result.permission_denials.flatMap((item) => {
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      const toolName = typeof record.tool_name === 'string'
        ? record.tool_name
        : typeof record.toolName === 'string'
          ? record.toolName
          : undefined
      let detail: string | undefined
      if (typeof record.message === 'string') detail = record.message
      else if (typeof record.reason === 'string') detail = record.reason
      else if (typeof record.input === 'string') detail = record.input
      if (!toolName && !detail) return []
      return [{ ...(toolName ? { toolName } : {}), ...(detail ? { detail } : {}) }]
    }
    return typeof item === 'string' ? [{ detail: item }] : []
  })
}

/** 将 stdout 缓冲区按行切分（兼容 \n 与 \r\n）。 */
export function splitLines(buffer: string): { lines: string[]; remainder: string } {
  const parts = buffer.split(/\r?\n/)
  const remainder = parts.pop() ?? ''
  return { lines: parts, remainder }
}
