import { describe, expect, it } from 'vitest'
import { MAX_ACTIVITY_DETAIL_BYTES, sanitizeActivityText } from '../electron/cli/activitySafety'

const byteLength = (value: string | undefined) => new TextEncoder().encode(value ?? '').length

describe('activity detail safety', () => {
  it('redacts common credential values before persisting details', () => {
    const result = sanitizeActivityText(
      'Authorization: Bearer token-value\napi_key="abc123"\npassword = s3cret\nkept=value',
      MAX_ACTIVITY_DETAIL_BYTES
    )

    expect(result.text).toContain('Authorization: Bearer [REDACTED]')
    expect(result.text).toContain('api_key="[REDACTED]')
    expect(result.text).toContain('password = [REDACTED]')
    expect(result.text).toContain('kept=value')
    expect(result.redacted).toBe(true)
  })

  it('redacts private key blocks and keeps the stored result within its byte budget', () => {
    const result = sanitizeActivityText(
      '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
      30
    )

    expect(result.text).toContain('[REDACTED')
    expect(result.redacted).toBe(true)
    expect(result.bytes).toBeLessThanOrEqual(30)
    expect(byteLength(result.text)).toBeLessThanOrEqual(30)
  })

  it('truncates UTF-8 text without exceeding tiny or normal detail budgets', () => {
    const normal = sanitizeActivityText('你好'.repeat(80), 64)
    const tiny = sanitizeActivityText('你好', 1)
    const none = sanitizeActivityText('content', 0)

    expect(normal.truncated).toBe(true)
    expect(normal.text).toContain('[output truncated]')
    expect(normal.bytes).toBeLessThanOrEqual(64)
    expect(byteLength(normal.text)).toBeLessThanOrEqual(64)
    expect(tiny.truncated).toBe(true)
    expect(tiny.bytes).toBeLessThanOrEqual(1)
    expect(none).toEqual({ text: undefined, truncated: true, redacted: false, bytes: 0 })
  })
})
