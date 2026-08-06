import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AppLocale, InstalledSkill, Session } from '../store/types'
import type { ParsedDesktopSlashCommand } from './slashCommands'

type LocalCommand = Extract<ParsedDesktopSlashCommand, { kind: 'local' }>

export interface DesktopCommandResponseContext {
  locale: AppLocale
  projectPath: string
  session: Session
  skills: InstalledSkill[]
  configPath: string
}

/** 为不需要 TUI 状态机的命令生成基于本地真实状态的 Markdown 响应。 */
export function formatDesktopCommandResponse(command: LocalCommand, context: DesktopCommandResponseContext): string {
  const zh = context.locale === 'zh-CN'
  switch (command.name) {
    case 'help':
      return zh ? chineseHelp() : englishHelp()
    case 'memory':
      return formatMemory(context.projectPath, zh)
    case 'skills':
      return formatSkills(context.skills, zh)
    case 'status':
      return formatStatus(context, zh)
    case 'compact':
      return zh
        ? '## 上下文压缩\n\n此桌面端以单次 Claude CLI 请求运行，会由 Claude 自动管理上下文压缩；当前没有可安全手动压缩的本地 TUI 缓冲区。'
        : '## Context compaction\n\nThis desktop client runs one-shot Claude CLI requests. Claude manages context compaction automatically; there is no local TUI buffer that can be safely compacted manually.'
    case 'context':
      return formatContext(context, zh)
    case 'permissions':
      return zh
        ? `## 当前授权模式\n\n\`${context.session.permissionMode}\`\n\n可在会话顶部的授权模式控件中修改。`
        : `## Current permission mode\n\n\`${context.session.permissionMode}\`\n\nChange it from the conversation permission control.`
    case 'model':
      return zh
        ? `## 当前模型\n\n\`${context.session.model}\`\n\n可在会话顶部的模型选择器中修改。`
        : `## Current model\n\n\`${context.session.model}\`\n\nChange it from the conversation model selector.`
    case 'config':
      return zh
        ? `## Claude 配置\n\n模型映射配置：${code(context.configPath)}（${existsSync(context.configPath) ? '已找到' : '尚未创建'}）\n\n可在设置的“Agent 与模型”页面修改。`
        : `## Claude configuration\n\nModel mapping configuration: ${code(context.configPath)} (${existsSync(context.configPath) ? 'found' : 'not created yet'})\n\nEdit it from Settings > Agent and models.`
  }
}

function formatMemory(projectPath: string, zh: boolean): string {
  const projectMemory = join(projectPath, 'CLAUDE.md')
  const userMemory = join(homedir(), '.claude', 'CLAUDE.md')
  const found = (value: string) => (existsSync(value) ? (zh ? '已找到' : 'found') : (zh ? '未找到' : 'not found'))
  return zh
    ? `## 记忆文件\n\n- 项目：${code(projectMemory)}（${found(projectMemory)}）\n- 用户：${code(userMemory)}（${found(userMemory)}）\n\n为保护本地内容，此处只显示位置和存在状态。`
    : `## Memory files\n\n- Project: ${code(projectMemory)} (${found(projectMemory)})\n- User: ${code(userMemory)} (${found(userMemory)})\n\nOnly paths and availability are shown here to protect local content.`
}

function formatSkills(skills: InstalledSkill[], zh: boolean): string {
  if (!skills.length) {
    return zh
      ? '## 可用 Skills\n\n当前项目、用户目录和已安装插件中未发现 Skill。'
      : '## Available Skills\n\nNo Skills were found in this project, the user directory, or installed plugins.'
  }
  const list = skills.map((skill) => {
    const description = skill.description || (zh ? '未提供说明' : 'No description')
    return `- ${code(`/${skill.name}`)} · ${skillScopeLabel(skill.scope, zh)}${skill.source ? ` (${skill.source})` : ''}\n  ${description}`
  }).join('\n')
  return zh ? `## 可用 Skills\n\n${list}` : `## Available Skills\n\n${list}`
}

function formatStatus(context: DesktopCommandResponseContext, zh: boolean): string {
  const sessionId = context.session.claudeSessionId ? (zh ? '已建立' : 'available') : (zh ? '尚未建立' : 'not established')
  return zh
    ? `## 当前会话\n\n- 模型：${code(context.session.model)}\n- 授权模式：${code(context.session.permissionMode)}\n- 项目：${code(context.projectPath)}\n- Claude CLI 会话：${sessionId}`
    : `## Current conversation\n\n- Model: ${code(context.session.model)}\n- Permission mode: ${code(context.session.permissionMode)}\n- Project: ${code(context.projectPath)}\n- Claude CLI session: ${sessionId}`
}

function formatContext(context: DesktopCommandResponseContext, zh: boolean): string {
  const projectMemory = join(context.projectPath, 'CLAUDE.md')
  const userMemory = join(homedir(), '.claude', 'CLAUDE.md')
  const state = (path: string) => (existsSync(path) ? (zh ? '已载入 Claude 上下文来源' : 'available Claude context source') : (zh ? '未找到' : 'not found'))
  return zh
    ? `## 当前上下文来源\n\n- 项目目录：${code(context.projectPath)}\n- 项目记忆：${code(projectMemory)}（${state(projectMemory)}）\n- 用户记忆：${code(userMemory)}（${state(userMemory)}）\n- 已发现 Skills：${context.skills.length} 个\n\n实际 token 用量由 Claude CLI 在请求期间管理，桌面端不会猜测数值。`
    : `## Current context sources\n\n- Project directory: ${code(context.projectPath)}\n- Project memory: ${code(projectMemory)} (${state(projectMemory)})\n- User memory: ${code(userMemory)} (${state(userMemory)})\n- Discovered Skills: ${context.skills.length}\n\nClaude CLI manages actual token usage during requests; the desktop client does not guess at it.`
}

function chineseHelp(): string {
  return `## 桌面斜杠命令\n\n**查询**\n- ${code('/mcp [list|get <名称>|help [主题]]')}：查看 MCP\n- ${code('/plugin [list|details <名称>|marketplace list|help [主题]]')}：查看插件\n- ${code('/doctor')}：检查 Claude CLI\n- ${code('/agents')}：查看 Agent 状态\n\n**当前客户端**\n- ${code('/memory')}、${code('/skills')}、${code('/status')}、${code('/context')}\n- ${code('/model')}、${code('/permissions')}、${code('/config')}、${code('/compact')}\n\n**兼容性与安全**\n- ${code('/skill-name')} 保持交给 Claude CLI 解析。\n- MCP 与插件的安装、登录、删除、启用和更新必须在终端或专用设置流中显式确认。`
}

function englishHelp(): string {
  return `## Desktop slash commands\n\n**Queries**\n- ${code('/mcp [list|get <name>|help [topic]]')}: inspect MCP\n- ${code('/plugin [list|details <name>|marketplace list|help [topic]]')}: inspect plugins\n- ${code('/doctor')}: check Claude CLI\n- ${code('/agents')}: inspect agent status\n\n**Current client**\n- ${code('/memory')}, ${code('/skills')}, ${code('/status')}, ${code('/context')}\n- ${code('/model')}, ${code('/permissions')}, ${code('/config')}, ${code('/compact')}\n\n**Compatibility and safety**\n- ${code('/skill-name')} continues to be parsed by Claude CLI.\n- MCP and plugin installation, sign-in, removal, enablement, and updates require explicit confirmation in a terminal or dedicated settings flow.`
}

function skillScopeLabel(scope: InstalledSkill['scope'], zh: boolean): string {
  if (scope === 'project') return zh ? '项目' : 'Project'
  if (scope === 'user') return zh ? '用户' : 'User'
  return zh ? '插件' : 'Plugin'
}

function code(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``
}
