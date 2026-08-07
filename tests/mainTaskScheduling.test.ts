import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SendOptions } from '../electron/cli/agentTransport'
import type { Session } from '../electron/store/types'

type IpcHandler = (event: { sender: FakeSender }, args: ClaudeSendArgs) => Promise<void>
type ClaudeSendArgs = {
  sessionId: string
  prompt: string
  turnId: string
  messageId: string
  createdAt: number
}
type FakeSender = {
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  appHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  userDataPath: { value: '' },
  runnerSend: vi.fn<(opts: SendOptions, onEvent: (event: AgentEvent) => void) => Promise<void>>(),
  runnerAbort: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => mocks.userDataPath.value,
    getAppPath: () => process.cwd(),
    getVersion: () => '0.1.0-test',
    whenReady: () => new Promise<void>(() => {}),
    on: (name: string, handler: (...args: unknown[]) => unknown) => {
      mocks.appHandlers.set(name, handler)
    },
    quit: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
    fromWebContents: () => null,
  },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) => {
      mocks.ipcHandlers.set(name, handler)
    },
  },
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}))

vi.mock('../electron/cli/claudeRunner', () => ({
  ClaudeRunner: class {
    send = mocks.runnerSend
    abort = mocks.runnerAbort
  },
}))

import '../electron/main'
import { createSession, getSessionData } from '../electron/store/sessionStore'

function makeSession(id: string, projectPath: string): Session {
  return {
    id,
    title: 'New conversation',
    claudeSessionId: null,
    projectPath,
    model: 'sonnet',
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('main-process session task scheduling', () => {
  let projectPath = ''

  beforeAll(() => {
    mocks.userDataPath.value = mkdtempSync(join(tmpdir(), 'ccd-main-tasks-'))
    projectPath = mkdtempSync(join(tmpdir(), 'ccd-main-project-'))
    mocks.runnerSend.mockImplementation(() => new Promise<void>(() => {}))
  })

  afterAll(() => {
    rmSync(mocks.userDataPath.value, { recursive: true, force: true })
    rmSync(projectPath, { recursive: true, force: true })
  })

  it('rejects duplicates before persistence and interrupts queued work on shutdown', async () => {
    expect(createSession(makeSession('session-1', projectPath))).toBe(true)
    expect(createSession(makeSession('session-2', projectPath))).toBe(true)

    const send = mocks.ipcHandlers.get('claude:send') as IpcHandler
    const sender: FakeSender = { isDestroyed: () => false, send: vi.fn() }

    await send({ sender }, {
      sessionId: 'session-1', prompt: 'first writer', turnId: 'turn-1', messageId: 'message-1', createdAt: 1,
    })
    await send({ sender }, {
      sessionId: 'session-2', prompt: 'queued writer', turnId: 'turn-2', messageId: 'message-2', createdAt: 2,
    })

    await expect(send({ sender }, {
      sessionId: 'session-1', prompt: 'duplicate', turnId: 'turn-3', messageId: 'message-3', createdAt: 3,
    })).rejects.toThrow('already has a running or queued task')

    expect(getSessionData('session-1')?.messages.map((message) => message.id)).toEqual(['message-1'])
    expect(mocks.runnerSend).toHaveBeenCalledTimes(1)

    const beforeQuit = mocks.appHandlers.get('before-quit')
    expect(beforeQuit).toBeTypeOf('function')
    beforeQuit?.()

    const queuedData = getSessionData('session-2')
    expect(queuedData?.messages.map((message) => message.id)).toEqual(['message-2', 'turn-2:terminal:1'])
    expect(queuedData?.transcript?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ turnId: 'turn-2', type: 'terminal', outcome: 'interrupted' }),
    ]))
    expect(mocks.runnerSend).toHaveBeenCalledTimes(1)
    expect(mocks.runnerAbort).toHaveBeenCalledTimes(1)
  })
})
