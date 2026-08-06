import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ChatView, {
  CHAT_FOLLOW_THRESHOLD,
  getTranscriptOutputSignature,
  getStarterPrompts,
  isNearChatBottom,
  nextUnseenOutputCount,
  starterPrompts,
} from '../src/components/ChatView'
import type { Transcript } from '../electron/store/types'

describe('ChatView empty-session suggestions', () => {
  it('provides Claude Code workflows with editable task prompts', () => {
    expect(starterPrompts.map(({ title }) => title)).toEqual([
      '探索当前项目',
      '规划一次改动',
      '定位并修复问题',
      '审查当前工作区',
    ])
    expect(starterPrompts.every(({ description, prompt }) => Boolean(description && prompt))).toBe(true)
  })

  it('provides English suggestion labels and prompts without modifying session content', () => {
    expect(getStarterPrompts('en').map(({ title }) => title)).toEqual([
      'Explore this project',
      'Plan a change',
      'Find and fix an issue',
      'Review this workspace',
    ])
  })

  it('renders compact suggestion content for an empty session', () => {
    const html = renderToStaticMarkup(<ChatView sessionId="empty-session" />)
    const styles = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

    expect(html).toContain('关联本地项目')
    expect(html).toContain('选择项目目录')
    expect(styles).toContain('.project-setup-state')
    expect(styles).toContain('.choose-project-button')
  })

  it('uses a stable empty message value while a newly created session loads', () => {
    const source = readFileSync(new URL('../src/components/ChatView.tsx', import.meta.url), 'utf8')

    expect(source).toContain('const EMPTY_MESSAGES: Message[] = []')
    expect(source).toContain('s.messages[sessionId] ?? EMPTY_MESSAGES')
  })

  it('guides an unlinked session to choose a project directory before composing', () => {
    const html = renderToStaticMarkup(<ChatView sessionId="unlinked-session" />)

    expect(html).toContain('关联本地项目')
    expect(html).toContain('选择项目目录')
    expect(html).toContain('请先选择项目目录')
  })

  it('uses a 96px threshold before following streamed output', () => {
    expect(CHAT_FOLLOW_THRESHOLD).toBe(96)
    expect(isNearChatBottom(1_000, 500, 405)).toBe(true)
    expect(isNearChatBottom(1_000, 500, 403)).toBe(false)
  })

  it('treats an activity result update as unread output without counting the user request', () => {
    const initial: Transcript = {
      version: 2,
      entries: [
        { id: 'user-1', turnId: 'turn-1', sequence: 0, createdAt: 0, type: 'user', text: 'Run tests' },
        {
          id: 'activity-1', turnId: 'turn-1', sequence: 1, createdAt: 1, type: 'tool_activity',
          activityId: 'tool-1', toolName: 'Bash', state: 'running', details: { input: '{"command":"npm test"}' },
        },
        { id: 'later-text', turnId: 'turn-1', sequence: 2, createdAt: 2, type: 'assistant_markdown', markdown: 'Waiting.' },
      ],
    }
    const completed: Transcript = {
      ...initial,
      entries: initial.entries.map((entry) => entry.type === 'tool_activity'
        ? { ...entry, state: 'completed' as const, details: { ...entry.details, output: 'passed' } }
        : entry),
    }
    const userTextChanged: Transcript = {
      ...initial,
      entries: initial.entries.map((entry) => entry.type === 'user' ? { ...entry, text: 'Run all tests' } : entry),
    }

    const signature = getTranscriptOutputSignature(initial, '', null)
    expect(getTranscriptOutputSignature(completed, '', null)).not.toBe(signature)
    expect(getTranscriptOutputSignature(userTextChanged, '', null)).toBe(signature)
    expect(nextUnseenOutputCount(2, true, false)).toBe(3)
    expect(nextUnseenOutputCount(2, true, true)).toBe(0)
    expect(nextUnseenOutputCount(2, false, false)).toBe(0)
  })
})
