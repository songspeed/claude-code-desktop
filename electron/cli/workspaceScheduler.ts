import type { PermissionMode } from '../store/types'

export type TaskAccess = 'read' | 'write'

export interface ScheduledTask {
  id: string
  workspaceKey: string
  access: TaskAccess
  start: () => void
  onQueuePositionChange?: (queuePosition: number | undefined) => void
}

interface WorkspaceState {
  readers: Set<string>
  writer: string | null
  queue: ScheduledTask[]
}

export function accessForPermissionMode(mode: PermissionMode): TaskAccess {
  return mode === 'plan' ? 'read' : 'write'
}

export function canonicalWorkspaceKey(realPath: string): string {
  return process.platform === 'win32' ? realPath.toLowerCase() : realPath
}

/** Coordinates only tasks launched by this desktop process. */
export class WorkspaceScheduler {
  private readonly workspaces = new Map<string, WorkspaceState>()
  private readonly tasks = new Map<string, ScheduledTask>()

  schedule(task: ScheduledTask): { status: 'running' | 'queued'; queuePosition?: number } {
    if (this.tasks.has(task.id)) throw new Error(`Task ${task.id} already exists`)
    const state = this.stateFor(task.workspaceKey)
    this.tasks.set(task.id, task)

    // A queued writer forms a fairness barrier for later readers.
    const canRead = task.access === 'read' && state.queue.length === 0
    const canWrite = task.access === 'write' && !state.writer && state.readers.size === 0 && state.queue.length === 0
    if (canRead || canWrite) {
      this.start(state, task)
      return { status: 'running' }
    }

    state.queue.push(task)
    this.notifyQueuePositions(state)
    return { status: 'queued', queuePosition: state.queue.length }
  }

  release(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    const state = this.workspaces.get(task.workspaceKey)
    if (!state) return
    state.readers.delete(taskId)
    if (state.writer === taskId) state.writer = null
    this.tasks.delete(taskId)
    this.drain(task.workspaceKey, state)
  }

  cancel(taskId: string, drain = true): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false
    const state = this.workspaces.get(task.workspaceKey)
    if (!state) return false
    const index = state.queue.findIndex((candidate) => candidate.id === taskId)
    if (index < 0) return false
    state.queue.splice(index, 1)
    this.tasks.delete(taskId)
    if (drain) this.drain(task.workspaceKey, state)
    this.notifyQueuePositions(state)
    return true
  }

  queuePosition(taskId: string): number | undefined {
    const task = this.tasks.get(taskId)
    const state = task && this.workspaces.get(task.workspaceKey)
    if (!task || !state) return undefined
    const index = state.queue.findIndex((candidate) => candidate.id === taskId)
    return index < 0 ? undefined : index + 1
  }

  private stateFor(workspaceKey: string): WorkspaceState {
    let state = this.workspaces.get(workspaceKey)
    if (!state) {
      state = { readers: new Set(), writer: null, queue: [] }
      this.workspaces.set(workspaceKey, state)
    }
    return state
  }

  private drain(workspaceKey: string, state: WorkspaceState): void {
    if (state.writer || state.readers.size) return
    const next = state.queue.shift()
    if (!next) {
      this.workspaces.delete(workspaceKey)
      return
    }
    this.start(state, next)
    // Consecutive queued readers can start together, until the next writer.
    while (!state.writer && state.queue[0]?.access === 'read') {
      this.start(state, state.queue.shift()!)
    }
    this.notifyQueuePositions(state)
  }

  private start(state: WorkspaceState, task: ScheduledTask): void {
    if (task.access === 'write') state.writer = task.id
    else state.readers.add(task.id)
    task.start()
  }

  private notifyQueuePositions(state: WorkspaceState): void {
    state.queue.forEach((task, index) => task.onQueuePositionChange?.(index + 1))
  }
}
