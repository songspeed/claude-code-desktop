/**
 * src/ipc.ts — 对 window.electronAPI 的类型化封装
 * 渲染层所有 IPC 调用都经过此文件，不直接访问 window.electronAPI。
 */
import type { ElectronAPI } from '../electron/preload'

// electron-vite 构建时 preload 通过 contextBridge 注入
const api = (): ElectronAPI => (window as unknown as { electronAPI: ElectronAPI }).electronAPI

export const ipc = {
  checkAvailability: () => api().checkAvailability(),
  getAppearance: () => api().getAppearance(),
  setAppearance: (...args: Parameters<ElectronAPI['setAppearance']>) => api().setAppearance(...args),
  onAppearanceChanged: (...args: Parameters<ElectronAPI['onAppearanceChanged']>) =>
    api().onAppearanceChanged(...args),
  getLocale: () => api().getLocale(),
  setLocale: (...args: Parameters<ElectronAPI['setLocale']>) => api().setLocale(...args),
  onLocaleChanged: (...args: Parameters<ElectronAPI['onLocaleChanged']>) =>
    api().onLocaleChanged(...args),
  getAppInfo: () => api().getAppInfo(),
  getClaudeUserModelConfig: () => api().getClaudeUserModelConfig(),
  saveClaudeUserModelConfig: (...args: Parameters<ElectronAPI['saveClaudeUserModelConfig']>) =>
    api().saveClaudeUserModelConfig(...args),
  sendMessage: (...args: Parameters<ElectronAPI['sendMessage']>) => api().sendMessage(...args),
  abortGeneration: () => api().abortGeneration(),
  onClaudeEvent: (...args: Parameters<ElectronAPI['onClaudeEvent']>) => api().onClaudeEvent(...args),
  onSessionUpdated: (...args: Parameters<ElectronAPI['onSessionUpdated']>) => api().onSessionUpdated(...args),
  listSessions: () => api().listSessions(),
  getSessionData: (id: string) => api().getSessionData(id),
  createSession: (title?: string) => api().createSession(title),
  chooseProjectDirectory: (id: string) => api().chooseProjectDirectory(id),
  revealProjectDirectory: (id: string) => api().revealProjectDirectory(id),
  openPath: (filePath: string) => api().openPath(filePath),
  pathExists: (filePath: string) => api().pathExists(filePath),
  updateSession: (...args: Parameters<ElectronAPI['updateSession']>) => api().updateSession(...args),
  deleteSession: (id: string) => api().deleteSession(id),
  listInstalledSkills: (sessionId: string | null) => api().listInstalledSkills(sessionId),
  listWorkspaceFiles: (sessionId: string, query: string) => api().listWorkspaceFiles(sessionId, query),
}
