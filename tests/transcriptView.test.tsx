import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TranscriptView, {
  DetailBlock,
  EditDiffBlock,
  getActivityLabel,
  ThinkingBlock,
  UsageLine,
  formatThinkingTokens,
} from '../src/components/TranscriptView'
import { computeLineDiff } from '../src/components/diffPreview'
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

const noStreamProps = {
  streamingText: '',
  streamingThinking: '',
  streamingThinkingTokens: null,
  streamingPhase: null,
}

describe('TranscriptView', () => {
  it('renders ordered markdown, one grouped activity region, details, and copy controls', () => {
    const html = renderToStaticMarkup(
      <TranscriptView transcript={baseTranscript} isGenerating={true} liveStatus={null} {...noStreamProps} />
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
      <TranscriptView transcript={baseTranscript} isGenerating={false} liveStatus={null} {...noStreamProps} />
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
      <TranscriptView transcript={transcript} isGenerating={false} liveStatus={null} {...noStreamProps} />
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

  it('renders turn metadata with model, tokens, cost, and duration in the usage line', () => {
    const html = renderToStaticMarkup(
      <UsageLine usage={{
        model: 'deepseek-v4-pro',
        inputTokens: 22956,
        outputTokens: 231,
        cacheReadTokens: 45312,
        cacheWriteTokens: 1280,
        costUsd: 0.146481,
        durationMs: 5931,
      }} />
    )

    expect(html).toContain('deepseek-v4-pro')
    expect(html).toContain('22,956')
    expect(html).toContain('$0.1465')
    expect(html).toContain('45,312')
    expect(html).toContain('缓存写入 1,280')
    expect(html).toContain('5.9s')
  })

  it('omits missing usage fields and zero cache tokens from the line and renders nothing when empty', () => {
    const partial = renderToStaticMarkup(<UsageLine usage={{ inputTokens: 100 }} />)
    expect(partial).not.toContain('$')
    expect(partial).toContain('100')
    // 缓存写入为零或缺省时不显示
    expect(renderToStaticMarkup(<UsageLine usage={{ cacheWriteTokens: 0, inputTokens: 1 }} />)).not.toContain('缓存写入')
    expect(renderToStaticMarkup(<UsageLine usage={{ cacheWriteTokens: 1, inputTokens: 2 }} />)).toContain('缓存写入 1')

    expect(renderToStaticMarkup(<UsageLine usage={{}} />)).toBe('')
  })

  it('renders a live thinking block with the estimated token counter and hides it when count is absent', () => {
    const withTokens = renderToStaticMarkup(<ThinkingBlock text="先检查依赖。" tokens={1250} />)
    expect(withTokens).toContain('思考过程')
    expect(withTokens).toContain('约 1.3k tokens')
    expect(withTokens).toContain('thinking-block-tokens')
    expect(withTokens).toContain('先检查依赖。')

    const noTokens = renderToStaticMarkup(<ThinkingBlock text="先检查依赖。" tokens={null} />)
    expect(noTokens).not.toContain('thinking-block-tokens')
    expect(noTokens).not.toContain('约')

    expect(formatThinkingTokens(950)).toBe('950')
    expect(formatThinkingTokens(1250)).toBe('1.3k')
    expect(formatThinkingTokens(1000)).toBe('1.0k')
  })

  it('expands an edit activity to a diff preview instead of raw JSON input', () => {
    const diff = computeLineDiff('line two', 'line TWO')
    expect(diff).toBeDefined()
    const html = renderToStaticMarkup(
      <EditDiffBlock diff={diff!} filePath="demo.txt" projectPath="C:\\work" />
    )

    expect(html).toContain('变更预览')
    expect(html).toContain('diff-line is-remove')
    expect(html).toContain('diff-line is-add')
    expect(html).not.toContain('old_string')
    expect(html).toContain('<span class="diff-line-marker">-</span>')
    expect(html).toContain('<code>line two</code>')
    // 路径展示与打开按钮（有工作区时可用）
    expect(html).toContain('demo.txt')
    expect(html).toContain('activity-open-button')
    expect(html).not.toContain('activity-open-button" disabled')
  })

  it('disables the open button when no workspace is linked or no path exists', () => {
    const diff = computeLineDiff('a', 'b')
    expect(diff).toBeDefined()
    const withoutWorkspace = renderToStaticMarkup(
      <EditDiffBlock diff={diff!} filePath="demo.txt" projectPath={null} />
    )
    expect(withoutWorkspace).toContain('disabled')
    expect(withoutWorkspace).toContain('demo.txt')

    const withoutPath = renderToStaticMarkup(
      <EditDiffBlock diff={diff!} filePath={null} projectPath="C:\\work" />
    )
    expect(withoutPath).not.toContain('demo.txt')
    expect(withoutPath).toContain('disabled')
  })

  it('falls back to raw input when an edit diff cannot be computed', () => {
    const html = renderToStaticMarkup(
      <DetailBlock label="activityInput" value='{"cell_index":0}' />
    )

    expect(html).not.toContain('diff-line')
    expect(html).toContain('cell_index')
  })

  it('renders permission-denied activities and turn-level notices distinctly', () => {
    const transcript: Transcript = {
      version: 2,
      entries: [
        {
          id: 'denied-1', turnId: 'turn-1', sequence: 1, createdAt: 1, type: 'tool_activity',
          activityId: 'denied-1', toolName: 'Write', state: 'permission_denied',
          details: { input: '{"file_path":"demo.txt"}' },
        },
        { id: 'notice-1', turnId: 'turn-1', sequence: 2, createdAt: 2, type: 'notice', notice: { kind: 'permission_denied', toolName: 'Write' } },
        { id: 'end-1', turnId: 'turn-1', sequence: 3, createdAt: 3, type: 'terminal', outcome: 'completed' },
      ],
    }
    const html = renderToStaticMarkup(
      <TranscriptView transcript={transcript} isGenerating={false} liveStatus={null} {...noStreamProps} />
    )

    expect(html).toContain('activity-group is-permission_denied')
    expect(html).toContain('权限被拒绝')
    expect(html).toContain('Write 的权限请求被拒绝')
  })

  it('shows a localized phase badge during generation and falls back to the raw value for unknown phases', () => {    const transcript: Transcript = {
      version: 2,
      entries: [{ id: 'user-1', turnId: 'turn-1', sequence: 0, createdAt: 0, type: 'user', text: 'Go' }],
    }
    const known = renderToStaticMarkup(
      <TranscriptView
        transcript={transcript}
        isGenerating={true}
        liveStatus={null}
        {...noStreamProps}
        streamingPhase="reading workspace"
      />
    )
    expect(known).toContain('status-phase')
    expect(known).toContain('读取工作区')

    const unknown = renderToStaticMarkup(
      <TranscriptView
        transcript={transcript}
        isGenerating={true}
        liveStatus={null}
        {...noStreamProps}
        streamingPhase="compacting history"
      />
    )
    expect(unknown).toContain('status-phase')
    expect(unknown).toContain('compacting history')

    const withoutPhase = renderToStaticMarkup(
      <TranscriptView transcript={transcript} isGenerating={true} liveStatus={null} {...noStreamProps} />
    )
    expect(withoutPhase).not.toContain('status-phase')
    expect(withoutPhase).toContain('Claude 正在处理任务')
  })

  it('prioritizes liveStatus over the phase badge while generating', () => {
    const transcript: Transcript = {
      version: 2,
      entries: [{ id: 'user-1', turnId: 'turn-1', sequence: 0, createdAt: 0, type: 'user', text: 'Go' }],
    }
    const html = renderToStaticMarkup(
      <TranscriptView
        transcript={transcript}
        isGenerating={true}
        liveStatus={{ kind: 'retry', attempt: 1 }}
        {...noStreamProps}
        streamingPhase="reading workspace"
      />
    )
    expect(html).not.toContain('读取工作区')
    expect(html).toContain('服务繁忙，正在重试')
  })

  it('derives a consistent todo badge from persisted transcript text after reload', () => {
    const transcript: Transcript = {
      version: 2,
      entries: [
        { id: 'user-1', turnId: 'turn-1', sequence: 0, createdAt: 0, type: 'user', text: '重构登录流程' },
        {
          id: 'text-1', turnId: 'turn-1', sequence: 1, createdAt: 1, type: 'assistant_markdown',
          markdown: [
            '计划如下：',
            '',
            '- [x] 拆分认证模块',
            '- [ ] 补充单元测试',
            '- [ ] 更新文档',
          ].join('\n'),
        },
        { id: 'end-1', turnId: 'turn-1', sequence: 2, createdAt: 2, type: 'terminal', outcome: 'completed', usage: null },
      ],
    }
    const html = renderToStaticMarkup(
      <TranscriptView transcript={transcript} isGenerating={false} liveStatus={null} {...noStreamProps} />
    )

    expect(html).toContain('todo-badge')
    expect(html).toContain('待办 1/3')
  })
})
