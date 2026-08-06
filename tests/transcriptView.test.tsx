import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TranscriptView, { getActivityLabel } from '../src/components/TranscriptView'
import { translate } from '../src/i18n'
import type { Transcript, TranscriptActivityEntry } from '../electron/store/types'

const baseTranscript: Transcript = {
  version: 2,
  entries: [
    { id: 'user-1', turnId: 'turn-1', sequence: 0, createdAt: 0, type: 'user', text: 'Review this file.' },
    { id: 'text-1', turnId: 'turn-1', sequence: 1, createdAt: 1, type: 'assistant_markdown', markdown: 'I will inspect it.\n\n```ts\nconst value = 1\n```' },
    {
      id: 'read-1', turnId: 'turn-1', sequence: 2, createdAt: 2, type: 'tool_activity', activityId: 'read-1',
      toolName: 'Read', state: 'running', details: { input: '{"file_path":"src/main.ts"}', output: 'export const value = 1' },
    },
    {
      id: 'grep-1', turnId: 'turn-1', sequence: 3, createdAt: 3, type: 'tool_activity', activityId: 'grep-1',
      toolName: 'Grep', state: 'running', details: { input: '{"pattern":"value"}' },
    },
    { id: 'notice-1', turnId: 'turn-1', sequence: 4, createdAt: 4, type: 'notice', notice: { kind: 'retry', attempt: 1 } },
  ],
}

describe('TranscriptView', () => {
  it('renders ordered markdown, one grouped activity region, details, and copy controls', () => {
    const html = renderToStaticMarkup(
      <TranscriptView transcript={baseTranscript} streamingText="" isGenerating={true} liveStatus={null} />
    )

    expect(html).toContain('I will inspect it.')
    expect(html).toContain('activity-group')
    expect(html.match(/activity-group is-running/g)).toHaveLength(1)
    expect(html).toContain('2 项活动')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('src/main.ts')
    expect(html.match(/copy-button/g)).toHaveLength(1)
    expect(html.indexOf('I will inspect it.')).toBeLessThan(html.indexOf('activity-group'))
  })

  it('localizes client labels without changing tool payloads', () => {
    const html = renderToStaticMarkup(
      <TranscriptView transcript={baseTranscript} streamingText="" isGenerating={false} liveStatus={null} />
    )

    expect(translate('en', 'activityCount')).toBe('{count} activities')
    expect(translate('en', 'activityRead')).toBe('Read files')
    expect(translate('zh-CN', 'activityRead')).toBe('读取文件')
    expect(getActivityLabel(baseTranscript.entries[2] as TranscriptActivityEntry, 'en')).toBe('Read files')
    const unknownTool = {
      ...(baseTranscript.entries[2] as TranscriptActivityEntry),
      toolName: 'VendorTool',
    }
    expect(getActivityLabel(unknownTool, 'en')).toBe('VendorTool')
    expect(getActivityLabel(unknownTool, 'zh-CN')).toBe('VendorTool')
    expect(html).toContain('src/main.ts')
  })

  it('collapses completed activity groups, retains unknown tool names, and exposes failure and interruption states', () => {
    const transcript: Transcript = {
      version: 2,
      entries: [
        {
          id: 'vendor-1', turnId: 'turn-1', sequence: 1, createdAt: 1, type: 'tool_activity',
          activityId: 'vendor-1', toolName: 'VendorTool', state: 'completed', details: { input: '{"path":"/tmp/raw-path"}' },
        },
        {
          id: 'failed-1', turnId: 'turn-1', sequence: 2, createdAt: 2, type: 'tool_activity',
          activityId: 'failed-1', toolName: 'Bash', state: 'failed', details: { input: '{"command":"false"}', error: 'exit 1' },
        },
        { id: 'end-1', turnId: 'turn-1', sequence: 3, createdAt: 3, type: 'terminal', outcome: 'interrupted' },
      ],
    }
    const html = renderToStaticMarkup(
      <TranscriptView transcript={transcript} streamingText="" isGenerating={false} liveStatus={null} />
    )

    expect(html).toContain('VendorTool')
    expect(html).toContain('执行失败')
    expect(html).toContain('本次生成已停止')
    expect(html).toContain('aria-expanded="true"')
  })

  it('defines activity details and notice styling through both theme variable sets', () => {
    const styles = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

    expect(styles).toContain('.activity-group')
    expect(styles).toContain('.activity-detail-block')
    expect(styles).toContain('.jump-latest-button')
    expect(styles).toContain('[data-theme="dark"]')
    expect(styles).toContain('[data-theme="light"]')
  })
})
