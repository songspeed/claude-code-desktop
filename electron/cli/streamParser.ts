/**
 * Claude CLI stream-json 事件解析器。
 *
 * 夹具基于 Claude Code 2.1.222 的只读 Read 调用：完整工具输入位于
 * assistant.tool_use，关联结果位于 user.tool_result。未知事件仍安全忽略。
 */

import type { AgentEvent } from './agentTransport'

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

function stringifyValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') return item.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
    return text || undefined
  }
  if (value == null) return undefined
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
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
    }
    return events
  }

  if (type === 'stream_event') {
    const partial = obj as unknown as StreamPartial
    const event = partial.event
    if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
      events.push({ type: 'text_delta', delta: event.delta.text })
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
    if (result.is_error) {
      events.push({ type: 'error', message: result.result?.trim() ?? '', errorSubtype: result.subtype })
    } else {
      events.push({ type: 'done', sessionId: result.session_id })
    }
  }

  return events
}

/** 将 stdout 缓冲区按行切分（兼容 \n 与 \r\n）。 */
export function splitLines(buffer: string): { lines: string[]; remainder: string } {
  const parts = buffer.split(/\r?\n/)
  const remainder = parts.pop() ?? ''
  return { lines: parts, remainder }
}
