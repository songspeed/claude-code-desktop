import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { mockUserData, writeFail } = vi.hoisted(() => ({
  mockUserData: { dir: '' },
  writeFail: { enabled: false },
}))

vi.mock('electron', () => ({
  app: { getPath: () => mockUserData.dir },
}))

// 用工厂包装真实 fs，可切换 writeFileSync 失败，模拟磁盘满/权限拒绝
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (writeFail.enabled) throw new Error('ENOSPC: no space left on device')
      return actual.writeFileSync(...args)
    },
  }
})

import {
  createSession,
  appendMessage,
  listSessions,
  getSessionData,
  updateSession,
  appendTranscriptUserMessage,
  applyTranscriptCommits,
} from '../electron/store/sessionStore'
import type { Session, Message, TranscriptUserEntry } from '../electron/store/types'
import type { TranscriptCommit } from '../electron/cli/turnAssembler'

function makeSession(id: string): Session {
  return {
    id,
    title: '新对话',
    claudeSessionId: null,
    projectPath: null,
    model: 'sonnet',
    permissionMode: 'acceptEdits',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('sessionStore 写入异常保护 (BUG-1)', () => {
  beforeEach(() => {
    mockUserData.dir = mkdtempSync(join(tmpdir(), 'ccd-store-'))
    writeFail.enabled = false
  })

  afterEach(() => {
    writeFail.enabled = false
    if (mockUserData.dir) rmSync(mockUserData.dir, { recursive: true, force: true })
  })

  it('正常路径：创建会话并追加消息可读回', () => {
    expect(createSession(makeSession('s1'))).toBe(true)
    const msg: Message = { id: 'm1', role: 'user', text: 'hi', createdAt: Date.now() }
    expect(appendMessage('s1', msg)).toEqual(msg)
    expect(getSessionData('s1')?.messages).toHaveLength(1)
    expect(listSessions().map((s) => s.id)).toContain('s1')
  })

  it('将旧客户端保存的失效模型名迁移为稳定别名', () => {
    const legacySession = {
      ...makeSession('legacy'),
      model: 'claude-sonnet-5',
    } as unknown as Session

    expect(createSession(legacySession)).toBe(true)
    expect(listSessions().find((session) => session.id === 'legacy')?.model).toBe('sonnet')
    expect(getSessionData('legacy')?.session.model).toBe('sonnet')
  })

  it('兼容缺少项目目录和授权模式的旧会话，并持久化后续更新', () => {
    const legacy = {
      id: 'legacy-project',
      title: '旧会话',
      claudeSessionId: null,
      model: 'sonnet',
      createdAt: 1,
      updatedAt: 1,
    }
    const sessionsDir = join(mockUserData.dir, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(join(sessionsDir, 'index.json'), JSON.stringify({ sessions: [legacy] }))
    writeFileSync(join(sessionsDir, 'legacy-project.json'), JSON.stringify({ session: legacy, messages: [] }))

    expect(listSessions()[0]?.projectPath).toBeNull()
    expect(listSessions()[0]?.permissionMode).toBe('acceptEdits')
    expect(getSessionData('legacy-project')?.session.projectPath).toBeNull()
    expect(getSessionData('legacy-project')?.session.permissionMode).toBe('acceptEdits')

    expect(updateSession('legacy-project', {
      projectPath: '/tmp/example-project',
      claudeSessionId: null,
      permissionMode: 'plan',
      updatedAt: 2,
    })).toMatchObject({ projectPath: '/tmp/example-project', permissionMode: 'plan' })
    expect(listSessions()[0]?.projectPath).toBe('/tmp/example-project')
    expect(listSessions()[0]?.permissionMode).toBe('plan')
    expect(getSessionData('legacy-project')?.session.projectPath).toBe('/tmp/example-project')
    expect(getSessionData('legacy-project')?.session.permissionMode).toBe('plan')
  })

  it('惰性读取旧消息，并在首个新版写入时原子保存 transcript 与兼容投影', () => {
    const legacy = makeSession('legacy-transcript')
    const legacyMessage: Message = { id: 'legacy-message', role: 'assistant', text: '旧回复', createdAt: 1 }
    const sessionsDir = join(mockUserData.dir, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(join(sessionsDir, 'index.json'), JSON.stringify({ sessions: [legacy] }))
    writeFileSync(join(sessionsDir, 'legacy-transcript.json'), JSON.stringify({
      session: legacy,
      messages: [legacyMessage],
    }))

    expect(getSessionData('legacy-transcript')?.transcript?.entries).toMatchObject([
      { id: 'legacy:legacy-message', type: 'assistant_markdown', markdown: '旧回复', legacy: true },
    ])
    expect(JSON.parse(readFileSync(join(sessionsDir, 'legacy-transcript.json'), 'utf8')).transcript).toBeUndefined()

    const userMessage: Message = { id: 'new-user', role: 'user', text: '新请求', turnId: 'turn-1', createdAt: 2 }
    const userEntry: TranscriptUserEntry = {
      id: 'new-user', turnId: 'turn-1', sequence: 0, createdAt: 2, type: 'user', text: '新请求',
    }
    expect(appendTranscriptUserMessage('legacy-transcript', userMessage, userEntry)).toBe(true)

    const persisted = JSON.parse(readFileSync(join(sessionsDir, 'legacy-transcript.json'), 'utf8'))
    expect(persisted.transcript.entries).toHaveLength(2)
    expect(persisted.messages).toEqual([legacyMessage, userMessage])
  })

  it('writes activity commits and their legacy-message projection atomically', () => {
    expect(createSession(makeSession('commit-session'))).toBe(true)
    const commits: TranscriptCommit[] = [
      {
        kind: 'append',
        entry: {
          id: 'turn-1:activity:read', turnId: 'turn-1', sequence: 1, createdAt: 1,
          type: 'tool_activity', activityId: 'read', toolName: 'Read', state: 'running', details: { input: '{}' },
        },
        compatibilityMessage: {
          id: 'turn-1:activity:read', turnId: 'turn-1', role: 'tool', toolName: 'Read', toolInput: '{}', toolState: 'running', createdAt: 1,
        },
      },
      {
        kind: 'update', entryId: 'turn-1:activity:read',
        patch: { state: 'completed', details: { input: '{}', output: 'ok' }, durationMs: 5 },
        compatibilityPatch: { toolState: 'completed', toolOutput: 'ok' },
      },
    ]

    expect(applyTranscriptCommits('commit-session', commits)?.entries).toMatchObject([
      { id: 'turn-1:activity:read', state: 'completed', details: { output: 'ok' } },
    ])
    expect(getSessionData('commit-session')?.messages).toMatchObject([
      { id: 'turn-1:activity:read', toolState: 'completed', toolOutput: 'ok' },
    ])
  })

  it('does not partially commit transcript changes when the atomic write fails', () => {
    expect(createSession(makeSession('atomic-transcript'))).toBe(true)
    const before = readFileSync(join(mockUserData.dir, 'sessions', 'atomic-transcript.json'), 'utf8')
    writeFail.enabled = true
    expect(applyTranscriptCommits('atomic-transcript', [{
      kind: 'append',
      entry: {
        id: 'turn-1:terminal:1', turnId: 'turn-1', sequence: 1, createdAt: 1,
        type: 'terminal', outcome: 'completed',
      },
    }])).toBeNull()
    writeFail.enabled = false
    expect(readFileSync(join(mockUserData.dir, 'sessions', 'atomic-transcript.json'), 'utf8')).toBe(before)
  })

  it('磁盘写入失败时返回 false，绝不抛异常', () => {
    writeFail.enabled = true
    // 不抛异常，返回 false
    expect(() => createSession(makeSession('s2'))).not.toThrow()
    expect(createSession(makeSession('s2'))).toBe(false)
  })

  it('appendMessage 在写入失败时返回 null 而非崩溃', () => {
    expect(createSession(makeSession('s3'))).toBe(true)
    writeFail.enabled = true
    const msg: Message = { id: 'm9', role: 'assistant', text: 'x', createdAt: Date.now() }
    expect(() => appendMessage('s3', msg)).not.toThrow()
    expect(appendMessage('s3', msg)).toBeNull()
  })
})
