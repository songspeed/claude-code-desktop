/**
 * sessionStore：会话与消息的本地 JSON 持久化
 *
 * 存储位置：app.getPath('userData')/sessions/
 *   - index.json            会话索引（快速列表加载）
 *   - <session-id>.json     单会话数据（含消息）
 *
 * 写入策略：先写临时文件，再原子替换（rename），避免写坏已有数据。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { normalizeModelId, normalizePermissionMode } from './types'
import type { Session, SessionData, SessionIndex, Message, Transcript, TranscriptEntry } from './types'
import { transcriptFromLegacyMessages } from './types'
import type { TranscriptCommit } from '../cli/turnAssembler'

function normalizeProjectPath(projectPath: unknown): string | null {
  return typeof projectPath === 'string' && projectPath.trim() ? projectPath : null
}

function normalizeSession(session: Session): Session {
  return {
    ...session,
    model: normalizeModelId(session.model),
    permissionMode: normalizePermissionMode(session.permissionMode),
    projectPath: normalizeProjectPath(session.projectPath),
  }
}

function getSessionsDir(): string {
  const dir = join(app.getPath('userData'), 'sessions')
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch (err) {
    console.error('[sessionStore] 创建 sessions 目录失败', err)
  }
  return dir
}

function indexPath(): string {
  return join(getSessionsDir(), 'index.json')
}

function sessionPath(id: string): string {
  return join(getSessionsDir(), `${id}.json`)
}

/**
 * 原子写入：写临时文件 → rename。
 * 捕获所有失败（磁盘满 / 权限拒绝 / 路径异常），返回是否成功，
 * 绝不向上抛异常——避免在 stdout 事件回调内崩溃主进程（tasks.md 3.4）。
 */
function atomicWrite(filePath: string, data: unknown): boolean {
  const tmp = `${filePath}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmp, filePath)
    return true
  } catch (err) {
    console.error(`[sessionStore] atomicWrite 失败: ${filePath}`, err)
    // 清理可能残留的临时文件，避免污染
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch { /* ignore */ }
    return false
  }
}

/** 读取并解析 JSON 文件；失败返回 null */
function safeReadJson<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

// ─── 索引操作 ───────────────────────────────────────────

function readIndex(): SessionIndex {
  return safeReadJson<SessionIndex>(indexPath()) ?? { sessions: [] }
}

function writeIndex(index: SessionIndex): boolean {
  return atomicWrite(indexPath(), index)
}

function ensureTranscript(data: SessionData): Transcript {
  data.transcript ??= transcriptFromLegacyMessages(data.messages)
  return data.transcript
}

function updateIndexTimestamp(session: Session): void {
  const idx = readIndex()
  const entry = idx.sessions.find((item) => item.id === session.id)
  if (entry) {
    entry.updatedAt = session.updatedAt
    writeIndex(idx)
  }
}

// ─── 公开 API ────────────────────────────────────────────

/** 列出所有会话（按 updatedAt 降序） */
export function listSessions(): Session[] {
  const idx = readIndex()
  // 索引只存轻量元信息；按 updatedAt 降序
  return idx.sessions
    .map((session) => normalizeSession(session as Session))
    .sort((a, b) => b.updatedAt - a.updatedAt) as Session[]
}

/** 读取单个会话（含消息） */
export function getSessionData(id: string): SessionData | null {
  const data = safeReadJson<SessionData>(sessionPath(id))
  if (!data) return null

  // 旧会话可能缺少 projectPath / permissionMode 或含已失效模型名；调用方随后写入时会将其持久化。
  data.session = normalizeSession(data.session)
  ensureTranscript(data)
  return data
}

/** 创建新会话；返回是否写入成功 */
export function createSession(session: Session): boolean {
  const normalizedSession = normalizeSession(session)
  const data: SessionData = { session: normalizedSession, messages: [] }
  if (!atomicWrite(sessionPath(session.id), data)) return false

  const idx = readIndex()
  idx.sessions.push({
    id: normalizedSession.id,
    title: normalizedSession.title,
    model: normalizedSession.model,
    permissionMode: normalizedSession.permissionMode,
    projectPath: normalizedSession.projectPath,
    createdAt: normalizedSession.createdAt,
    updatedAt: normalizedSession.updatedAt,
  })
  return writeIndex(idx)
}

/** 更新会话元信息（title / model / permissionMode / projectPath / claudeSessionId / updatedAt） */
export function updateSession(id: string, patch: Partial<Session>): Session | null {
  const data = getSessionData(id)
  if (!data) return null

  const updated = normalizeSession({ ...data.session, ...patch, id })
  data.session = updated
  if (!atomicWrite(sessionPath(id), data)) return null

  const idx = readIndex()
  const entry = idx.sessions.find((s) => s.id === id)
  if (entry) {
    entry.title = updated.title
    entry.model = updated.model
    entry.permissionMode = updated.permissionMode
    entry.projectPath = updated.projectPath
    entry.updatedAt = updated.updatedAt
    writeIndex(idx)
  }
  return updated
}

/** 删除会话 */
export function deleteSession(id: string): void {
  const filePath = sessionPath(id)
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath)
    } catch { /* ignore */ }
  }

  const idx = readIndex()
  idx.sessions = idx.sessions.filter((s) => s.id !== id)
  writeIndex(idx)
}

/** 追加一条消息到会话 */
export function appendMessage(sessionId: string, message: Message): Message | null {
  const data = getSessionData(sessionId)
  if (!data) return null

  data.messages.push(message)
  data.session.updatedAt = Date.now()
  if (!atomicWrite(sessionPath(sessionId), data)) return null

  // 同步更新索引的 updatedAt
  const idx = readIndex()
  const entry = idx.sessions.find((s) => s.id === sessionId)
  if (entry) {
    entry.updatedAt = data.session.updatedAt
    writeIndex(idx)
  }
  return message
}

/** 原子写入一条用户消息及其规范 transcript 起始条目。 */
export function appendTranscriptUserMessage(
  sessionId: string,
  message: Message,
  entry: Extract<TranscriptEntry, { type: 'user' }>
): boolean {
  const data = getSessionData(sessionId)
  if (!data) return false

  data.messages.push(message)
  const transcript = ensureTranscript(data)
  transcript.entries.push(entry)
  data.session.updatedAt = Date.now()
  if (!atomicWrite(sessionPath(sessionId), data)) return false
  updateIndexTimestamp(data.session)
  return true
}

/** 应用一个事件包产生的 transcript 提交，并同步更新旧版 messages 兼容投影。 */
export function applyTranscriptCommits(sessionId: string, commits: TranscriptCommit[]): Transcript | null {
  const relevant = commits.filter((commit) => commit.kind === 'append' || commit.kind === 'update')
  if (relevant.length === 0) return getSessionData(sessionId)?.transcript ?? null

  const data = getSessionData(sessionId)
  if (!data) return null
  const transcript = ensureTranscript(data)

  for (const commit of relevant) {
    if (commit.kind === 'append') {
      if (!transcript.entries.some((entry) => entry.id === commit.entry.id)) {
        transcript.entries.push(commit.entry)
      }
      if (commit.compatibilityMessage && !data.messages.some((message) => message.id === commit.compatibilityMessage?.id)) {
        data.messages.push(commit.compatibilityMessage)
      }
      continue
    }

    const entry = transcript.entries.find((item) => item.id === commit.entryId)
    if (entry?.type === 'tool_activity') Object.assign(entry, commit.patch)
    const message = data.messages.find((item) => item.id === commit.entryId)
    if (message && commit.compatibilityPatch) Object.assign(message, commit.compatibilityPatch)
  }

  data.session.updatedAt = Date.now()
  if (!atomicWrite(sessionPath(sessionId), data)) return null
  updateIndexTimestamp(data.session)
  return transcript
}

/** 更新某条消息（例如追加流式 delta 后落盘） */
export function updateMessage(
  sessionId: string,
  messageId: string,
  patch: Partial<Message>
): void {
  const data = getSessionData(sessionId)
  if (!data) return

  const msg = data.messages.find((m) => m.id === messageId)
  if (!msg) return

  Object.assign(msg, patch)
  if (!atomicWrite(sessionPath(sessionId), data)) return
}
