/**
 * 可在无交互桌面会话中可靠映射的 Claude Code 风格命令。
 * 有副作用、认证或需要 TUI 交互确认的命令不能由聊天输入静默执行。
 */

export const DESKTOP_SLASH_COMMANDS = [
  { name: 'help' },
  { name: 'mcp' },
  { name: 'plugin' },
  { name: 'memory' },
  { name: 'skills' },
  { name: 'doctor' },
  { name: 'agents' },
  { name: 'status' },
  { name: 'compact' },
  { name: 'context' },
  { name: 'permissions' },
  { name: 'model' },
  { name: 'config' },
] as const

export type DesktopSlashCommandName = (typeof DESKTOP_SLASH_COMMANDS)[number]['name']

type LocalDesktopSlashCommandName = Extract<
  DesktopSlashCommandName,
  'help' | 'memory' | 'skills' | 'status' | 'compact' | 'context' | 'permissions' | 'model' | 'config'
>
type CliDesktopSlashCommandName = Extract<DesktopSlashCommandName, 'mcp' | 'plugin' | 'doctor' | 'agents'>

export type ParsedDesktopSlashCommand =
  | { kind: 'local'; name: LocalDesktopSlashCommandName }
  | { kind: 'cli'; name: CliDesktopSlashCommandName; args: string[] }
  | { kind: 'blocked'; name: string; reason: string }

/** 只解析独占整条输入的桌面命令；未知 `/skill-name` 保持原样交给 Claude CLI。 */
export function parseDesktopSlashCommand(prompt: string): ParsedDesktopSlashCommand | null {
  if (!prompt.startsWith('/') || /\r|\n/.test(prompt)) return null
  const tokens = tokenize(prompt.slice(1).trim())
  if (!tokens?.length) return null

  const [rawName, ...rest] = tokens
  const name = rawName!.toLowerCase()
  switch (name) {
    case 'help':
    case 'memory':
    case 'skills':
    case 'status':
    case 'compact':
    case 'context':
    case 'permissions':
    case 'model':
    case 'config':
      return rest.length === 0
        ? { kind: 'local', name }
        : { kind: 'blocked', name, reason: `/${name} 不接受参数。` }
    case 'mcp':
      return parseMcpCommand(rest)
    case 'plugin':
    case 'plugins':
      return parsePluginCommand(rest)
    case 'doctor':
      return rest.length === 0 || (rest.length === 1 && rest[0] === 'help')
        ? { kind: 'cli', name: 'doctor', args: rest.length ? ['doctor', '--help'] : ['doctor'] }
        : { kind: 'blocked', name, reason: '/doctor 仅支持健康检查。' }
    case 'agents':
      return rest.length === 0 || (rest.length === 1 && rest[0] === 'help')
        ? { kind: 'cli', name: 'agents', args: rest.length ? ['agents', '--help'] : ['agents', '--json'] }
        : { kind: 'blocked', name, reason: '/agents 在桌面端仅显示当前 Agent 状态。' }
    default:
      return null
  }
}

function parseMcpCommand(args: string[]): ParsedDesktopSlashCommand {
  const operation = args[0]?.toLowerCase()
  if (args.length === 0 || (args.length === 1 && operation === 'list')) {
    return { kind: 'cli', name: 'mcp', args: ['mcp', 'list'] }
  }
  if (operation === 'get' && args.length === 2) {
    return { kind: 'cli', name: 'mcp', args: ['mcp', 'get', args[1]!] }
  }
  if (operation === 'help' && args.length <= 2) {
    return { kind: 'cli', name: 'mcp', args: ['mcp', 'help', ...args.slice(1)] }
  }
  return {
    kind: 'blocked',
    name: 'mcp',
    reason: 'MCP 新增、登录、删除和重置会改变配置或凭据，请在终端中显式执行。',
  }
}

function parsePluginCommand(args: string[]): ParsedDesktopSlashCommand {
  const operation = args[0]?.toLowerCase()
  if (args.length === 0 || (args.length === 1 && operation === 'list')) {
    return { kind: 'cli', name: 'plugin', args: ['plugin', 'list'] }
  }
  if (operation === 'details' && args.length === 2) {
    return { kind: 'cli', name: 'plugin', args: ['plugin', 'details', args[1]!] }
  }
  if (operation === 'marketplace' && args.length === 2 && args[1]?.toLowerCase() === 'list') {
    return { kind: 'cli', name: 'plugin', args: ['plugin', 'marketplace', 'list'] }
  }
  if (operation === 'help' && args.length <= 2) {
    return { kind: 'cli', name: 'plugin', args: ['plugin', 'help', ...args.slice(1)] }
  }
  return {
    kind: 'blocked',
    name: 'plugin',
    reason: '插件安装、启用、禁用、更新和卸载会改变本地配置，请在终端中显式执行。',
  }
}

/** 最小化、引号感知的参数切分器；结果仅进入预定义的参数允许列表。 */
function tokenize(input: string): string[] | null {
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (const character of input) {
    if (escaped) {
      token += character
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (quote) {
      if (character === quote) quote = null
      else token += character
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token)
        token = ''
      }
    } else {
      token += character
    }
  }

  if (quote || escaped) return null
  if (token) tokens.push(token)
  return tokens
}
