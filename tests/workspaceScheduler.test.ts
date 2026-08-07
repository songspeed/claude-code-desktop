import { describe, expect, it } from 'vitest'
import { WorkspaceScheduler, accessForPermissionMode, canonicalWorkspaceKey } from '../electron/cli/workspaceScheduler'

describe('WorkspaceScheduler', () => {
  it('normalizes Windows workspace keys and classifies plan as read-only', () => {
    expect(accessForPermissionMode('plan')).toBe('read')
    expect(accessForPermissionMode('acceptEdits')).toBe('write')
    expect(canonicalWorkspaceKey('C:\\Repo')).toBe(process.platform === 'win32' ? 'c:\\repo' : 'C:\\Repo')
  })

  it('runs different workspaces concurrently and serializes writers in one workspace', () => {
    const scheduler = new WorkspaceScheduler()
    const started: string[] = []
    expect(scheduler.schedule({ id: 'a', workspaceKey: 'one', access: 'write', start: () => started.push('a') })).toMatchObject({ status: 'running' })
    expect(scheduler.schedule({ id: 'b', workspaceKey: 'two', access: 'write', start: () => started.push('b') })).toMatchObject({ status: 'running' })
    expect(scheduler.schedule({ id: 'c', workspaceKey: 'one', access: 'write', start: () => started.push('c') })).toMatchObject({ status: 'queued', queuePosition: 1 })
    expect(started).toEqual(['a', 'b'])
    scheduler.release('a')
    expect(started).toEqual(['a', 'b', 'c'])
  })

  it('allows readers with a writer until a writer is waiting, then preserves writer priority', () => {
    const scheduler = new WorkspaceScheduler()
    const started: string[] = []
    scheduler.schedule({ id: 'writer-1', workspaceKey: 'repo', access: 'write', start: () => started.push('writer-1') })
    scheduler.schedule({ id: 'reader-1', workspaceKey: 'repo', access: 'read', start: () => started.push('reader-1') })
    scheduler.schedule({ id: 'writer-2', workspaceKey: 'repo', access: 'write', start: () => started.push('writer-2') })
    scheduler.schedule({ id: 'reader-2', workspaceKey: 'repo', access: 'read', start: () => started.push('reader-2') })
    expect(started).toEqual(['writer-1', 'reader-1'])
    scheduler.release('writer-1')
    expect(started).toEqual(['writer-1', 'reader-1'])
    scheduler.release('reader-1')
    expect(started).toEqual(['writer-1', 'reader-1', 'writer-2'])
    scheduler.release('writer-2')
    expect(started).toEqual(['writer-1', 'reader-1', 'writer-2', 'reader-2'])
  })

  it('cancels a queued task without releasing the running writer', () => {
    const scheduler = new WorkspaceScheduler()
    const started: string[] = []
    scheduler.schedule({ id: 'writer', workspaceKey: 'repo', access: 'write', start: () => started.push('writer') })
    scheduler.schedule({ id: 'queued', workspaceKey: 'repo', access: 'write', start: () => started.push('queued') })
    expect(scheduler.cancel('queued')).toBe(true)
    scheduler.release('writer')
    expect(started).toEqual(['writer'])
  })

  it('updates queue positions when an earlier task is cancelled', () => {
    const scheduler = new WorkspaceScheduler()
    const positions: number[] = []
    scheduler.schedule({ id: 'writer', workspaceKey: 'repo', access: 'write', start: () => {} })
    scheduler.schedule({ id: 'first', workspaceKey: 'repo', access: 'write', start: () => {} })
    scheduler.schedule({
      id: 'second',
      workspaceKey: 'repo',
      access: 'write',
      start: () => {},
      onQueuePositionChange: (position) => { if (position !== undefined) positions.push(position) },
    })

    scheduler.cancel('first')
    expect(positions.at(-1)).toBe(1)
  })

  it('does not admit another queued task during shutdown cancellation', () => {
    const scheduler = new WorkspaceScheduler()
    const started: string[] = []
    scheduler.schedule({ id: 'active', workspaceKey: 'repo', access: 'write', start: () => started.push('active') })
    scheduler.schedule({ id: 'queued-1', workspaceKey: 'repo', access: 'write', start: () => started.push('queued-1') })
    scheduler.schedule({ id: 'queued-2', workspaceKey: 'repo', access: 'write', start: () => started.push('queued-2') })

    scheduler.cancel('queued-1', false)
    scheduler.cancel('queued-2', false)
    expect(started).toEqual(['active'])
  })
})
