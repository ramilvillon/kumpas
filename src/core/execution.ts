import type { Db } from './db.js'
import type { Ticket } from './types.js'
import { dispatch, type DispatchDeps } from './dispatch.js'
import {
  addTaskWorktree, commitAll, ensureEpicBranch, mergeTaskBranch, removeTaskWorktree,
  type MergeResult,
} from './git.js'

// The git seam exists so the orchestrator tests don't need a real repo; the
// helpers themselves are covered by git.test.ts against real temp repos.
export interface ExecGit {
  ensureEpicBranch(repoPath: string, epicId: number): string
  addTaskWorktree(repoPath: string, epicId: number, taskId: number): string
  removeTaskWorktree(repoPath: string, taskId: number): void
  mergeTaskBranch(repoPath: string, epicId: number, taskId: number): MergeResult
  commitAll(worktreePath: string, message: string): boolean
}

const realGit: ExecGit = {
  ensureEpicBranch, addTaskWorktree, removeTaskWorktree, mergeTaskBranch, commitAll,
}

export interface ExecutionDeps extends DispatchDeps {
  git?: ExecGit
}

// Comments Kumpas writes itself. Deliberately NOT 'human': a human comment is
// the blocked-resume trigger (resumeIfBlocked), so this author must differ.
const SYSTEM_AUTHOR = 'kumpas'

// ponytail: in-memory guards, matching planning.ts — one window, one process.
// The DB columns remain the source of truth, so a restart just clears them.
const batchesInFlight = new Set<number>()
const inFlightTasks = new Set<number>()

function autoMerge(db: Db): boolean {
  return (db.getSetting('exec:autoMerge') ?? '1') !== '0'
}

function parallelism(db: Db): number {
  const n = Number(db.getSetting('exec:parallelism') ?? '3')
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 3
}

function readyChildren(db: Db, epic: Ticket): Ticket[] {
  const todo = db.getColumnByRole(epic.projectId, 'todo').id
  return db.listTickets(epic.projectId).filter(
    (t) =>
      t.parentId === epic.id && t.kind === 'task' && t.columnId === todo &&
      !t.blocked && t.assigneeAgentId !== null && !inFlightTasks.has(t.id),
  )
}

function commitMessage(t: Ticket): string {
  return `kumpas: task ${t.id} — ${t.title}`
}

// Never rejects: one child blowing up must not abort the batch.
async function runChild(deps: ExecutionDeps, git: ExecGit, repoPath: string, child: Ticket): Promise<void> {
  const { db } = deps
  inFlightTasks.add(child.id)
  try {
    const wt = git.addTaskWorktree(repoPath, child.parentId as number, child.id)
    const run = await dispatch(deps, child.id, child.assigneeAgentId as number, wt)
    if (run.status === 'success') {
      // A failed commit must not rewind a ticket dispatch already moved to
      // review — the work is done, only the commit step failed.
      try {
        git.commitAll(wt, commitMessage(child))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        db.addComment(child.id, SYSTEM_AUTHOR, `Could not commit this task's worktree: ${message}`, 'note')
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    db.addComment(child.id, SYSTEM_AUTHOR, `Batch could not run this task: ${message}`, 'note')
    db.setTicketColumn(child.id, db.getColumnByRole(child.projectId, 'todo').id)
  } finally {
    inFlightTasks.delete(child.id)
  }
}

export async function runBatch(
  deps: ExecutionDeps, epicId: number,
): Promise<{ dispatched: number }> {
  const { db } = deps
  const git = deps.git ?? realGit
  const epic = db.getTicket(epicId)
  if (epic.kind !== 'epic') throw new Error('run batch works on an epic ticket')
  if (batchesInFlight.has(epicId)) throw new Error('a batch is already running for this epic')
  const project = db.getProject(epic.projectId)
  // Before any ticket is touched: a repo problem must fail the batch, not half-run it.
  git.ensureEpicBranch(project.repoPath, epicId)

  batchesInFlight.add(epicId)
  // No auto-retry: a child that failed returns to todo, so without this the
  // loop would pick it up again forever.
  const attempted = new Set<number>()
  const running = new Set<Promise<void>>()
  let dispatched = 0
  try {
    for (;;) {
      while (running.size < parallelism(db)) {
        const next = readyChildren(db, epic).find((t) => !attempted.has(t.id))
        if (!next) break
        attempted.add(next.id)
        dispatched++
        const p = runChild(deps, git, project.repoPath, next).finally(() => running.delete(p))
        running.add(p)
      }
      if (running.size === 0) break
      await Promise.race(running)
    }
  } finally {
    batchesInFlight.delete(epicId)
  }
  return { dispatched }
}
