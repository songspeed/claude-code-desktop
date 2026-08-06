import { readdirSync, realpathSync, type Dirent } from 'fs'
import { basename, join, relative, sep } from 'path'
import type { WorkspaceFile } from './store/types'

const MAX_SCAN_ENTRIES = 20_000
const MAX_RESULTS = 80
const MAX_DEPTH = 16

const excludedDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.cache',
  '.turbo',
])

/**
 * 返回当前项目内可被 @ 引用的文件。符号链接、依赖和构建产物不会进入候选，
 * 因此渲染层无法借此枚举项目根目录之外的路径。
 */
export function listWorkspaceFiles(projectPath: string, query = '', limit = MAX_RESULTS): WorkspaceFile[] {
  const root = realpathSync(projectPath)
  const normalizedQuery = query.trim().replace(/\\/g, '/').toLocaleLowerCase().slice(0, 200)
  const paths: string[] = []
  let scanned = 0

  const visit = (directory: string, depth: number): void => {
    if (scanned >= MAX_SCAN_ENTRIES || depth > MAX_DEPTH) return

    let entries: Dirent<string>[]
    try {
      entries = readdirSync(directory, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return
    }

    for (const entry of entries) {
      if (scanned >= MAX_SCAN_ENTRIES) return
      scanned += 1
      if (entry.isSymbolicLink()) continue

      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) visit(absolutePath, depth + 1)
        continue
      }
      if (!entry.isFile() || entry.name === '.DS_Store') continue

      const path = relative(root, absolutePath).split(sep).join('/')
      if (path && !path.startsWith('../')) paths.push(path)
    }
  }

  visit(root, 0)
  return paths
    .filter((path) => !normalizedQuery || path.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => rankPath(left, normalizedQuery) - rankPath(right, normalizedQuery)
      || left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
    .slice(0, Math.max(1, Math.min(limit, MAX_RESULTS)))
    .map((path) => ({ path }))
}

function rankPath(path: string, query: string): number {
  if (!query) return 2
  const normalized = path.toLocaleLowerCase()
  if (normalized.startsWith(query)) return 0
  if (basename(normalized).startsWith(query)) return 1
  return 2
}
