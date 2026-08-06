import { describe, expect, it } from 'vitest'
import { DESKTOP_SLASH_COMMANDS, parseDesktopSlashCommand } from '../electron/cli/slashCommands'

describe('desktop slash commands', () => {
  it('maps supported MCP and plugin queries to a fixed argument allowlist', () => {
    expect(parseDesktopSlashCommand('/mcp')).toEqual({
      kind: 'cli', name: 'mcp', args: ['mcp', 'list'],
    })
    expect(parseDesktopSlashCommand('/mcp get "local server"')).toEqual({
      kind: 'cli', name: 'mcp', args: ['mcp', 'get', 'local server'],
    })
    expect(parseDesktopSlashCommand('/plugin marketplace list')).toEqual({
      kind: 'cli', name: 'plugin', args: ['plugin', 'marketplace', 'list'],
    })
  })

  it('blocks configuration-changing commands instead of passing them to the shell', () => {
    expect(parseDesktopSlashCommand('/mcp add local npx server')).toEqual(expect.objectContaining({
      kind: 'blocked', name: 'mcp',
    }))
    expect(parseDesktopSlashCommand('/plugin install example@marketplace')).toEqual(expect.objectContaining({
      kind: 'blocked', name: 'plugin',
    }))
  })

  it('recognizes local status commands and keeps unknown native Skills untouched', () => {
    for (const command of ['help', 'memory', 'skills', 'status', 'compact', 'context', 'permissions', 'model', 'config']) {
      expect(parseDesktopSlashCommand(`/${command}`)).toEqual({ kind: 'local', name: command })
    }
    expect(parseDesktopSlashCommand('/review-workspace')).toBeNull()
    expect(parseDesktopSlashCommand('/mcp\nlist')).toBeNull()
  })

  it('advertises the main desktop command set in the composer catalog', () => {
    expect(DESKTOP_SLASH_COMMANDS.map((command) => command.name)).toEqual(expect.arrayContaining([
      'mcp', 'plugin', 'memory', 'doctor', 'agents', 'context', 'permissions', 'model',
    ]))
  })
})
