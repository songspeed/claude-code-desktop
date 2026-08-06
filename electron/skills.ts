import { existsSync, readFileSync, realpathSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { InstalledSkill, SkillScope } from './store/types'

interface PluginRegistryEntry {
  installPath?: unknown
}

interface PluginRegistry {
  plugins?: Record<string, PluginRegistryEntry[] | unknown>
}

/**
 * 扫描 Claude Code 约定目录中的 Skills。扫描完全在主进程发生，读取失败的
 * 目录和注册表会被跳过，使本地配置问题不影响聊天功能。
 */
export function listInstalledSkills(projectPath: string | null, home = homedir()): InstalledSkill[] {
  const skills: InstalledSkill[] = []
  const seen = new Set<string>()

  if (projectPath) collectDirectory(join(projectPath, '.claude', 'skills'), 'project', '当前项目', seen, skills)
  collectDirectory(join(home, '.claude', 'skills'), 'user', '用户级', seen, skills)
  collectInstalledPluginSkills(home, seen, skills)

  return skills.sort((left, right) => (
    scopeRank(left.scope) - scopeRank(right.scope)
    || left.name.localeCompare(right.name, 'zh-CN', { sensitivity: 'base' })
  ))
}

function collectInstalledPluginSkills(
  home: string,
  seen: Set<string>,
  skills: InstalledSkill[]
): void {
  const registryPath = join(home, '.claude', 'plugins', 'installed_plugins.json')
  let registry: PluginRegistry
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8')) as PluginRegistry
  } catch {
    return
  }

  if (!registry.plugins || typeof registry.plugins !== 'object') return
  for (const [pluginName, installs] of Object.entries(registry.plugins)) {
    if (!Array.isArray(installs)) continue
    for (const install of installs) {
      if (!install || typeof install !== 'object' || typeof install.installPath !== 'string') continue
      collectDirectory(join(install.installPath, 'skills'), 'plugin', pluginName, seen, skills)
    }
  }
}

function collectDirectory(
  root: string,
  scope: SkillScope,
  source: string,
  seen: Set<string>,
  skills: InstalledSkill[]
): void {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return
  }

  for (const entry of entries) {
    const skillPath = join(root, entry, 'SKILL.md')
    try {
      if (!existsSync(skillPath) || !statSync(skillPath).isFile()) continue
      const identity = realpathSync(skillPath)
      if (seen.has(identity)) continue
      seen.add(identity)
      const metadata = readSkillMetadata(skillPath, entry)
      skills.push({ ...metadata, path: skillPath, scope, source })
    } catch {
      // 权限改变或符号链接失效时跳过这一项，其余 Skills 仍应可见。
    }
  }
}

export function readSkillMetadata(path: string, fallbackName: string): Pick<InstalledSkill, 'name' | 'description'> {
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return { name: fallbackName, description: '' }
  }

  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(content)
  if (!match) return { name: fallbackName, description: '' }

  const metadata: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && value) metadata[key] = value
  }

  return {
    name: metadata.name || fallbackName,
    description: metadata.description || '',
  }
}

function scopeRank(scope: SkillScope): number {
  if (scope === 'project') return 0
  if (scope === 'user') return 1
  return 2
}
