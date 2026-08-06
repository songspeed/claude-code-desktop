/**
 * Preload 脚本
 *
 * 通过 contextBridge 向渲染层暴露最小化、类型化的 API。
 * contextIsolation=true，渲染层无法直接访问 Node/Electron API。
 */

import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  AppLocale,
  AppearancePreference,
  AppearanceState,
  AppearanceUpdateResult,
  ClaudeUserModelConfig,
  ClaudeUserModelConfigPatch,
  InstalledSkill,
  LocaleUpdateResult,
  Session,
  SessionData,
  WorkspaceFile,
} from './store/types'
import type { AgentEventEnvelope } from './cli/agentTransport'

export type ElectronAPI = typeof api

const api = {
  // ─── Claude CLI ──────────────────────────────────────────
  checkAvailability: (): Promise<{ available: boolean; version?: string; error?: string }> =>
    ipcRenderer.invoke('claude:check-availability'),

  sendMessage: (args: {
    sessionId: string
    prompt: string
    turnId: string
    messageId: string
    createdAt: number
  }): Promise<void> => ipcRenderer.invoke('claude:send', args),

  abortGeneration: (): Promise<void> => ipcRenderer.invoke('claude:abort'),

  // ─── Appearance ─────────────────────────────────────────
  getAppearance: (): Promise<AppearanceState> => ipcRenderer.invoke('appearance:get'),

  setAppearance: (preference: AppearancePreference): Promise<AppearanceUpdateResult> =>
    ipcRenderer.invoke('appearance:set', preference),

  onAppearanceChanged: (handler: (appearance: AppearanceState) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, appearance: AppearanceState) => handler(appearance)
    ipcRenderer.on('appearance:changed', listener)
    return () => ipcRenderer.off('appearance:changed', listener)
  },

  // ─── Language and app information ───────────────────────
  getLocale: (): Promise<AppLocale> => ipcRenderer.invoke('locale:get'),

  setLocale: (locale: AppLocale): Promise<LocaleUpdateResult> =>
    ipcRenderer.invoke('locale:set', locale),

  onLocaleChanged: (handler: (locale: AppLocale) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, locale: AppLocale) => handler(locale)
    ipcRenderer.on('locale:changed', listener)
    return () => ipcRenderer.off('locale:changed', listener)
  },

  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),

  // ─── Claude 用户模型配置 ────────────────────────────────
  getClaudeUserModelConfig: (): Promise<ClaudeUserModelConfig> =>
    ipcRenderer.invoke('claude-config:get'),

  saveClaudeUserModelConfig: (patch: ClaudeUserModelConfigPatch): Promise<ClaudeUserModelConfig> =>
    ipcRenderer.invoke('claude-config:save', patch),

  /** 订阅 claude:event 推送（返回取消订阅函数） */
  onClaudeEvent: (
    handler: (sessionId: string, envelope: AgentEventEnvelope) => void
  ): (() => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      payload: { sessionId: string; envelope: AgentEventEnvelope }
    ) => handler(payload.sessionId, payload.envelope)
    ipcRenderer.on('claude:event', listener)
    return () => ipcRenderer.off('claude:event', listener)
  },

  /** 订阅 sessions:updated 推送（返回取消订阅函数） */
  onSessionUpdated: (
    handler: (sessionId: string, title: string) => void
  ): (() => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      payload: { sessionId: string; title: string }
    ) => handler(payload.sessionId, payload.title)
    ipcRenderer.on('sessions:updated', listener)
    return () => ipcRenderer.off('sessions:updated', listener)
  },

  // ─── Sessions ────────────────────────────────────────────
  listSessions: (): Promise<Session[]> => ipcRenderer.invoke('sessions:list'),

  getSessionData: (id: string): Promise<SessionData | null> =>
    ipcRenderer.invoke('sessions:get-data', id),

  createSession: (title?: string): Promise<Session> =>
    ipcRenderer.invoke('sessions:create', title),

  chooseProjectDirectory: (id: string): Promise<Session | null> =>
    ipcRenderer.invoke('sessions:choose-project-directory', id),

  revealProjectDirectory: (id: string): Promise<void> =>
    ipcRenderer.invoke('sessions:reveal-project-directory', id),

  openPath: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('shell:open-path', filePath),

  pathExists: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('shell:path-exists', filePath),

  updateSession: (
    id: string,
    patch: Partial<Pick<Session, 'title' | 'model' | 'permissionMode' | 'updatedAt'>>
  ): Promise<Session | null> =>
    ipcRenderer.invoke('sessions:update', id, patch),

  deleteSession: (id: string): Promise<void> => ipcRenderer.invoke('sessions:delete', id),

  // ─── Skills ──────────────────────────────────────────────
  listInstalledSkills: (sessionId: string | null): Promise<InstalledSkill[]> =>
    ipcRenderer.invoke('skills:list', sessionId),

  listWorkspaceFiles: (sessionId: string, query: string): Promise<WorkspaceFile[]> =>
    ipcRenderer.invoke('workspace:list-files', sessionId, query),
}

contextBridge.exposeInMainWorld('electronAPI', api)
