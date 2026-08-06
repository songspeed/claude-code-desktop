/** 限制并脱敏会话中可持久化的工具详情，避免原始终端输出无限增长。 */

export const MAX_ACTIVITY_DETAIL_BYTES = 64 * 1024
export const MAX_TURN_DETAIL_BYTES = 256 * 1024

export interface SafeActivityText {
  text?: string
  truncated: boolean
  redacted: boolean
  bytes: number
}

const secretPatterns: Array<[RegExp, string]> = [
  [/(authorization\s*:\s*bearer\s+)[^\s'"`]+/gi, '$1[REDACTED]'],
  [/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[=:]\s*["']?)[^\s'"`,;]+/gi, '$1[REDACTED]'],
  [/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]'],
]

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}

function takeUtf8(value: string, limit: number): string {
  let result = ''
  let used = 0
  for (const character of value) {
    const size = utf8Bytes(character)
    if (used + size > limit) break
    result += character
    used += size
  }
  return result
}

/** 按 UTF-8 字节上限截断，避免切断多字节字符。 */
function truncateUtf8(value: string, limit: number): { text: string; truncated: boolean } {
  if (utf8Bytes(value) <= limit) return { text: value, truncated: false }
  if (limit <= 0) return { text: '', truncated: true }

  const marker = '\n[output truncated]'
  const markerBytes = utf8Bytes(marker)
  if (markerBytes > limit) return { text: takeUtf8(value, limit), truncated: true }
  return { text: `${takeUtf8(value, limit - markerBytes)}${marker}`, truncated: true }
}

export function sanitizeActivityText(value: string | undefined, budget: number): SafeActivityText {
  if (!value || budget <= 0) {
    return { text: undefined, truncated: Boolean(value), redacted: false, bytes: 0 }
  }

  let text = value
  let redacted = false
  for (const [pattern, replacement] of secretPatterns) {
    const next = text.replace(pattern, replacement)
    if (next !== text) redacted = true
    text = next
  }

  const clipped = truncateUtf8(text, Math.min(MAX_ACTIVITY_DETAIL_BYTES, budget))
  return {
    text: clipped.text,
    truncated: clipped.truncated,
    redacted,
    bytes: utf8Bytes(clipped.text),
  }
}
