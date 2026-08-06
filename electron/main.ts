/**
 * Electron 主进程入口
 *
 * 职责：
 *  - 创建 BrowserWindow（contextIsolation=true, nodeIntegration=false）
 *  - 注册 IPC 处理器（Claude CLI 调用、会话 CRUD）
 *  - 管理 ClaudeRunner 生命周期
 */

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { existsSync, realpathSync, statSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { ClaudeRunner } from './cli/claudeRunner'
import { runReadonlyClaudeCommand } from './cli/commandRunner'
import { formatDesktopCommandResponse } from './cli/desktopCommandResponses'
import { parseDesktopSlashCommand } from './cli/slashCommands'
import { listInstalledSkills } from './skills'
import { listWorkspaceFiles } from './workspaceFiles'
import { TurnAssembler } from './cli/turnAssembler'
import type { AgentEvent, AgentEventEnvelope } from './cli/agentTransport'
import { resolveClaudeExecutable, checkClaudeAvailability } from './cli/pathHelper'
import {
  listSessions,
  getSessionData,
  createSession,
  updateSession,
  deleteSession,
  appendTranscriptUserMessage,
  applyTranscriptCommits,
} from './store/sessionStore'
import type {
  AppInfo,
  AppLocale,
  AppearancePreference,
  AppearanceState,
  AppearanceUpdateResult,
  LocaleUpdateResult,
  Message,
  Session,
  TranscriptUserEntry,
} from './store/types'
import { DEFAULT_MODEL, DEFAULT_PERMISSION_MODE, normalizePermissionMode } from './store/types'
import {
  normalizeAppearancePreference,
  readAppearancePreference,
  resolveEffectiveTheme,
  writeAppearancePreference,
} from './store/appearanceStore'
import { normalizeAppLocale, readAppLocale, writeAppLocale } from './store/localeStore'
import {
  normalizeClaudeUserModelConfigPatch,
  claudeUserSettingsPath,
  readClaudeUserModelConfig,
  saveClaudeUserModelConfig,
} from './store/claudeConfigStore'

// ─── 窗口 ──────────────────────────────────────────────────────────────────

function getAppIconPath(): string {
  return join(app.getAppPath(), 'resources', 'app-icon.png')
}

function createWindow(): BrowserWindow {
  const iconPath = getAppIconPath()
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 500,
    title: 'Claude Code Desktop',
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,    // 安全：隔离渲染层与 Node 上下文
      nodeIntegration: false,    // 安全：渲染层无 Node 权限
      sandbox: false,            // preload 需要 Node（但不暴露给渲染层）
    },
  })

  // 外部链接在系统浏览器中打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ─── Claude Runner（单例，每次 send 共用）──────────────────────────────────

const runner = new ClaudeRunner()

function requireProjectDirectory(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('请先为此对话选择本地项目目录。')
  }
  try {
    const resolved = realpathSync(value)
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new Error('not a directory')
    }
    return resolved
  } catch {
    throw new Error('关联的项目目录不存在或不可访问，请重新选择。')
  }
}

let appearancePreference: AppearancePreference | null = null
let appLocale: AppLocale | null = null

function getAppearanceState(): AppearanceState {
  const preference = appearancePreference ?? readAppearancePreference()
  appearancePreference = preference
  return {
    preference,
    effectiveTheme: resolveEffectiveTheme(preference, nativeTheme.shouldUseDarkColors),
  }
}

function broadcastAppearanceState(): void {
  const appearance = getAppearanceState()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('appearance:changed', appearance)
  }
}

function getAppLocale(): AppLocale {
  appLocale ??= readAppLocale()
  return appLocale
}

function broadcastAppLocale(): void {
  const locale = getAppLocale()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('locale:changed', locale)
  }
}

// ─── IPC 处理器 ─────────────────────────────────────────────────────────────

/** claude:check-availability → { available, version?, error? } */
ipcMain.handle('claude:check-availability', () => {
  const resolved = resolveClaudeExecutable()
  if (!resolved) {
    return { available: false, error: 'claude not found in PATH' }
  }
  return checkClaudeAvailability(resolved.execPath, resolved.spawnPath)
})

/**
 * claude:send → void (streaming via claude:event push)
 * args: { sessionId, prompt, turnId, messageId, createdAt }
 */
ipcMain.handle(
  'claude:send',
  async (
    event,
    args: {
      sessionId: string
      prompt: string
      turnId: string
      messageId: string
      createdAt: number
    }
  ) => {
    const { sessionId, prompt, turnId, messageId, createdAt } = args
    const sender = event.sender
    const session = getSessionData(sessionId)?.session
    if (!session) throw new Error('找不到当前对话。')
    const projectPath = requireProjectDirectory(session.projectPath)

    // 持久化用户消息
    const userMsg: Message = {
      id: messageId,
      role: 'user',
      text: prompt,
      turnId,
      createdAt,
    }
    const userEntry: TranscriptUserEntry = {
      id: messageId,
      turnId,
      sequence: 0,
      createdAt,
      type: 'user',
      text: prompt,
    }
    if (!appendTranscriptUserMessage(sessionId, userMsg, userEntry)) {
      throw new Error('无法保存用户消息。')
    }

    // 组装器为唯一的「事件 → 有序记录」规则来源；序列号由主进程统一分配。
    const assembler = new TurnAssembler(turnId)
    let sequence = 0
    const desktopCommand = parseDesktopSlashCommand(prompt)

    const emitEvent = (ev: AgentEvent) => {
      const envelope: AgentEventEnvelope = {
        turnId,
        sequence: ++sequence,
        createdAt: Date.now(),
        event: ev,
      }
      const commits = assembler.feed(envelope)

      // 主进程先持久化，再向渲染层转发同一个带稳定标识的事件包。
      applyTranscriptCommits(sessionId, commits)
      for (const commit of commits) {
        if (commit.kind === 'session') {
          updateSession(sessionId, {
            claudeSessionId: commit.claudeSessionId,
            updatedAt: Date.now(),
          })
        }
      }
      if (!sender.isDestroyed()) sender.send('claude:event', { sessionId, envelope })

      // 只有普通 Agent 请求会建立 Claude 会话和使用消息内容自动命名。
      if (!desktopCommand && ev.type === 'done') {
        const currentSession = listSessions().find((candidate) => candidate.id === sessionId)
        if (currentSession && currentSession.title === '新对话') {
          const title = prompt.slice(0, 30) + (prompt.length > 30 ? '…' : '')
          updateSession(sessionId, { title, updatedAt: Date.now() })
          if (!sender.isDestroyed()) sender.send('sessions:updated', { sessionId, title })
        }
      }
    }

    if (desktopCommand?.kind === 'cli') {
      await runReadonlyClaudeCommand(desktopCommand.args, projectPath, emitEvent)
    } else if (desktopCommand?.kind === 'local') {
      const skills = desktopCommand.name === 'skills' || desktopCommand.name === 'context'
        ? listInstalledSkills(projectPath)
        : []
      emitEvent({
        type: 'text_delta',
        delta: formatDesktopCommandResponse(desktopCommand, {
          locale: getAppLocale(),
          projectPath,
          session,
          skills,
          configPath: claudeUserSettingsPath(),
        }),
      })
      emitEvent({ type: 'done', sessionId: '' })
    } else if (desktopCommand?.kind === 'blocked') {
      emitEvent({ type: 'text_delta', delta: `## /${desktopCommand.name}\n\n${desktopCommand.reason}` })
      emitEvent({ type: 'done', sessionId: '' })
    } else {
      await runner.send(
        {
          prompt,
          model: session.model,
          claudeSessionId: session.claudeSessionId ?? undefined,
          permissionMode: session.permissionMode,
          cwd: projectPath,
        },
        emitEvent
      )
    }
  }
)

/** claude:abort → void */
ipcMain.handle('claude:abort', () => {
  runner.abort()
})

// ─── Appearance ──────────────────────────────────────────

ipcMain.handle('appearance:get', (): AppearanceState => getAppearanceState())

ipcMain.handle('appearance:set', (_event, value: unknown): AppearanceUpdateResult => {
  const preference = normalizeAppearancePreference(value)
  if (preference !== value) throw new Error('无效的外观偏好')

  appearancePreference = preference
  const persisted = writeAppearancePreference(preference)
  const appearance = getAppearanceState()
  broadcastAppearanceState()
  return { ...appearance, persisted }
})

// ─── Language and app information ─────────────────────────

ipcMain.handle('locale:get', (): AppLocale => getAppLocale())

ipcMain.handle('locale:set', (_event, value: unknown): LocaleUpdateResult => {
  const locale = normalizeAppLocale(value)
  if (locale !== value) throw new Error('Invalid application locale')

  appLocale = locale
  const persisted = writeAppLocale(locale)
  broadcastAppLocale()
  return { locale, persisted }
})

ipcMain.handle('app:info', (): AppInfo => ({
  name: 'Claude Code Desktop',
  version: app.getVersion(),
  electronVersion: process.versions.electron,
  platform: process.platform,
  arch: process.arch,
}))

/** 仅向渲染层提供 Claude 用户模型配置的受限投影。 */
ipcMain.handle('claude-config:get', () => readClaudeUserModelConfig())

/** 主进程重新验证请求，避免渲染层越权写入用户配置的其他字段。 */
ipcMain.handle('claude-config:save', (_event, patch: unknown) => {
  return saveClaudeUserModelConfig(normalizeClaudeUserModelConfigPatch(patch))
})

/** sessions:list → Session[] */
ipcMain.handle('sessions:list', () => listSessions())

/** sessions:get-data → SessionData | null */
ipcMain.handle('sessions:get-data', (_e, id: string) => getSessionData(id))

/** sessions:create → Session */
ipcMain.handle('sessions:create', (_e, title?: string) => {
  const session: Session = {
    id: uuidv4(),
    title: title || '新对话',
    claudeSessionId: null,
    projectPath: null,
    model: DEFAULT_MODEL,
    permissionMode: DEFAULT_PERMISSION_MODE,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  if (!createSession(session)) throw new Error('无法创建本地会话。')
  return session
})

/** sessions:choose-project-directory → Session | null */
ipcMain.handle('sessions:choose-project-directory', async (event, id: string): Promise<Session | null> => {
  const session = getSessionData(id)?.session
  if (!session) throw new Error('找不到要关联项目目录的对话。')

  const defaultPath = session.projectPath && existsSync(session.projectPath) ? session.projectPath : undefined
  const options: Electron.OpenDialogOptions = {
    title: '选择项目目录',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  }
  const parentWindow = BrowserWindow.fromWebContents(event.sender)
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null

  const projectPath = requireProjectDirectory(result.filePaths[0])
  const updated = updateSession(id, {
    projectPath,
    claudeSessionId: null,
    updatedAt: Date.now(),
  })
  if (!updated) throw new Error('无法保存项目目录关联。')
  return updated
})

/** sessions:reveal-project-directory → void */
ipcMain.handle('sessions:reveal-project-directory', async (_event, id: string): Promise<void> => {
  const session = getSessionData(id)?.session
  if (!session) throw new Error('找不到当前对话。')
  const projectPath = requireProjectDirectory(session.projectPath)
  const failure = await shell.openPath(projectPath)
  if (failure) throw new Error(`无法在系统文件管理器中打开项目目录：${failure}`)
})

/** shell:open-path → void：按绝对路径用系统默认应用打开文件。 */
ipcMain.handle('shell:open-path', async (_event, filePath: string): Promise<void> => {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('无效的文件路径。')
  const failure = await shell.openPath(filePath)
  if (failure) throw new Error(`无法打开文件：${failure}`)
})

/** shell:path-exists → boolean：渲染层校验 file:line 引用指向的文件是否存在。 */
ipcMain.handle('shell:path-exists', async (_event, filePath: string): Promise<boolean> => {
  if (typeof filePath !== 'string' || !filePath.trim()) return false
  try {
    return existsSync(filePath)
  } catch {
    return false
  }
})

/** skills:list → InstalledSkill[] */
ipcMain.handle('skills:list', (_event, sessionId: string | null) => {
  const projectPath = sessionId ? getSessionData(sessionId)?.session.projectPath ?? null : null
  return listInstalledSkills(projectPath)
})

/** workspace:list-files → 当前项目内的相对文件路径，供输入框 @ 补全使用。 */
ipcMain.handle('workspace:list-files', (_event, sessionId: string, query: unknown) => {
  if (typeof sessionId !== 'string') throw new Error('无效的会话标识。')
  const session = getSessionData(sessionId)?.session
  if (!session) throw new Error('找不到当前对话。')
  const projectPath = requireProjectDirectory(session.projectPath)
  return listWorkspaceFiles(projectPath, typeof query === 'string' ? query : '')
})

/** sessions:update → Session | null */
ipcMain.handle(
  'sessions:update',
  (_e, id: string, patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new Error('无效的会话更新。')
    const candidate = patch as Record<string, unknown>
    const safePatch: Partial<Pick<Session, 'title' | 'model' | 'permissionMode' | 'updatedAt'>> = {}
    if (typeof candidate.title === 'string') safePatch.title = candidate.title
    if (typeof candidate.model === 'string') safePatch.model = candidate.model as Session['model']
    if (typeof candidate.permissionMode === 'string') {
      const permissionMode = normalizePermissionMode(candidate.permissionMode)
      if (permissionMode !== candidate.permissionMode) throw new Error('无效的授权模式。')
      safePatch.permissionMode = permissionMode
    }
    if (typeof candidate.updatedAt === 'number') safePatch.updatedAt = candidate.updatedAt
    return updateSession(id, safePatch)
  }
)

/** sessions:delete → void */
ipcMain.handle('sessions:delete', (_e, id: string) => deleteSession(id))

// ─── App 生命周期 ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const iconPath = getAppIconPath()
  if (process.platform === 'darwin' && existsSync(iconPath)) {
    app.dock?.setIcon(iconPath)
  }

  nativeTheme.on('updated', () => {
    if (getAppearanceState().preference === 'system') broadcastAppearanceState()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
