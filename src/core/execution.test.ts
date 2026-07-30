import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from 'vitest'
import { Db, MIGRATIONS } from './db.js'
import { execApprove, resumeIfBlocked, runBatch, type ExecGit } from './execution.js'
import type { AgentProvider } from './types.js'

export function fakeGit(log: string[] = []): ExecGit {
  return {
    ensureEpicBranch: (_r, id) => { log.push(`ensureEpic:${id}`); return `/wt/epic-${id}` },
    addTaskWorktree: (_r, _e, id) => { log.push(`addWt:${id}`); return `/wt/task-${id}` },
    removeTaskWorktree: (_r, id) => { log.push(`rmWt:${id}`) },
    mergeTaskBranch: (_r, _e, id) => { log.push(`merge:${id}`); return { ok: true } },
    commitAll: (path, _m) => { log.push(`commit:${path}`); return true },
  }
}

export function setup(childCount: number) {
  const db = new Db(':memory:')
  const p = db.createProject('demo', '/repo/demo')
  const epic = db.createTicket(p.id, 'Epic', 'spec', { kind: 'epic' })
  const agent = db.createAgent('Dev', 'claude', 'claude-sonnet-5', 'sp', 'edit')
  const children = Array.from({ length: childCount }, (_, i) =>
    db.createTicket(p.id, `task ${i}`, 'do it', {
      parentId: epic.id, assigneeAgentId: agent.id,
    }),
  )
  return { db, projectId: p.id, epicId: epic.id, agentId: agent.id, children }
}

const okProvider: AgentProvider = {
  run: async () => ({ resultText: 'implemented', tokensIn: 1, tokensOut: 1 }),
}

function deps(db: Db, provider: AgentProvider, git: ExecGit = fakeGit()) {
  return { db, providers: { claude: provider }, captureDiff: () => '', git }
}

test('runBatch dispatches every ready child and lands them in review', async () => {
  const { db, projectId, epicId, children } = setup(3)
  const res = await runBatch(deps(db, okProvider), epicId)
  expect(res.dispatched).toBe(3)
  const review = db.getColumnByRole(projectId, 'review').id
  for (const c of children) expect(db.getTicket(c.id).columnId).toBe(review)
})

test('runBatch never runs more children at once than exec:parallelism', async () => {
  const { db, epicId } = setup(5)
  db.setSetting('exec:parallelism', '2')
  let live = 0
  let peak = 0
  const provider: AgentProvider = {
    run: async () => {
      live++
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, 5))
      live--
      return { resultText: 'implemented', tokensIn: 1, tokensOut: 1 }
    },
  }
  const res = await runBatch(deps(db, provider), epicId)
  expect(peak).toBe(2)
  expect(res.dispatched).toBe(5)
})

test('runBatch defaults to a cap of 3', async () => {
  const { db, epicId } = setup(6)
  let live = 0
  let peak = 0
  const provider: AgentProvider = {
    run: async () => {
      live++
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, 5))
      live--
      return { resultText: 'implemented', tokensIn: 1, tokensOut: 1 }
    },
  }
  await runBatch(deps(db, provider), epicId)
  expect(peak).toBe(3)
})

test('runBatch commits the worktree after a successful run', async () => {
  const { db, epicId, children } = setup(1)
  const log: string[] = []
  await runBatch(deps(db, okProvider, fakeGit(log)), epicId)
  expect(log).toContain(`addWt:${children[0].id}`)
  expect(log).toContain(`commit:/wt/task-${children[0].id}`)
})

test('runBatch skips children that are not ready', async () => {
  const { db, projectId, epicId, children, agentId } = setup(3)
  db.updateTicketFields(children[0].id, { assigneeAgentId: null }) // unassigned
  db.setTicketBlocked(children[1].id, true) // blocked
  const other = db.createTicket(projectId, 'unrelated', 'x', { assigneeAgentId: agentId })

  const res = await runBatch(deps(db, okProvider), epicId)
  expect(res.dispatched).toBe(1)
  const todo = db.getColumnByRole(projectId, 'todo').id
  expect(db.getTicket(children[0].id).columnId).toBe(todo)
  expect(db.getTicket(children[1].id).columnId).toBe(todo)
  expect(db.getTicket(other.id).columnId).toBe(todo) // not a child of this epic
})

test('runBatch is idempotent: a re-run skips children already past todo', async () => {
  const { db, epicId, children } = setup(3)
  await runBatch(deps(db, okProvider), epicId) // all 3 → review
  const again = await runBatch(deps(db, okProvider), epicId)
  expect(again.dispatched).toBe(0)
  expect(children).toHaveLength(3)
})

test('a failing child does not abort the batch and is not retried in it', async () => {
  const { db, projectId, epicId, children } = setup(3)
  let calls = 0
  const provider: AgentProvider = {
    run: async () => {
      calls++
      if (calls === 1) throw new Error('claude exited with code 1: boom')
      return { resultText: 'implemented', tokensIn: 1, tokensOut: 1 }
    },
  }
  const res = await runBatch(deps(db, provider), epicId)
  expect(res.dispatched).toBe(3)
  expect(calls).toBe(3) // the failure is NOT re-attempted
  const todo = db.getColumnByRole(projectId, 'todo').id
  const back = children.filter((c) => db.getTicket(c.id).columnId === todo)
  expect(back).toHaveLength(1)
})

test('a worktree failure comments on the child and leaves it in todo', async () => {
  const { db, projectId, epicId, children } = setup(1)
  const git = fakeGit()
  git.addTaskWorktree = () => { throw new Error('not a git repository') }
  const res = await runBatch(deps(db, okProvider, git), epicId)
  expect(res.dispatched).toBe(1)
  expect(db.getTicket(children[0].id).columnId).toBe(db.getColumnByRole(projectId, 'todo').id)
  const c = db.listComments(children[0].id)[0]
  expect(c.author).toBe('kumpas') // never 'human' — that would trigger a resume
  expect(c.body).toContain('not a git repository')
})

test('a commit failure after a successful run leaves the child in review', async () => {
  const { db, projectId, epicId, children } = setup(1)
  const git = fakeGit()
  git.commitAll = () => { throw new Error('worktree is locked') }
  const res = await runBatch(deps(db, okProvider, git), epicId)
  expect(res.dispatched).toBe(1)
  const review = db.getColumnByRole(projectId, 'review').id
  expect(db.getTicket(children[0].id).columnId).toBe(review)
  const comments = db.listComments(children[0].id)
  const commitComment = comments.find((c) => c.body.includes('worktree is locked'))
  expect(commitComment).toBeDefined()
  expect(commitComment?.author).toBe('kumpas')
})

test('runBatch refuses a ticket that is not an epic', async () => {
  const { db, children } = setup(1)
  await expect(runBatch(deps(db, okProvider), children[0].id)).rejects.toThrow(/epic/)
})

test('runBatch refuses a second concurrent batch on the same epic', async () => {
  const { db, epicId } = setup(2)
  const provider: AgentProvider = {
    run: async () => {
      await new Promise((r) => setTimeout(r, 10))
      return { resultText: 'implemented', tokensIn: 1, tokensOut: 1 }
    },
  }
  const first = runBatch(deps(db, provider), epicId)
  await expect(runBatch(deps(db, provider), epicId)).rejects.toThrow(/already running/)
  await first
})

test('a batch that fails to start leaves no ticket touched', async () => {
  const { db, projectId, epicId, children } = setup(2)
  const git = fakeGit()
  git.ensureEpicBranch = () => { throw new Error('not a git repository') }
  await expect(runBatch(deps(db, okProvider, git), epicId)).rejects.toThrow(/not a git repository/)
  const todo = db.getColumnByRole(projectId, 'todo').id
  for (const c of children) expect(db.getTicket(c.id).columnId).toBe(todo)
})

async function toReview(db: Db, epicId: number, git: ExecGit = fakeGit()) {
  await runBatch(deps(db, okProvider, git), epicId)
}

test('approve with auto-merge on: merges, moves to done, removes the worktree', async () => {
  const { db, projectId, epicId, children } = setup(1)
  const log: string[] = []
  const git = fakeGit(log)
  await toReview(db, epicId, git)

  const res = await execApprove(deps(db, okProvider, git), children[0].id)
  expect(res).toEqual({ merged: true, conflict: false })
  expect(db.getTicket(children[0].id).columnId).toBe(db.getColumnByRole(projectId, 'done').id)
  expect(log).toContain(`merge:${children[0].id}`)
  expect(log).toContain(`rmWt:${children[0].id}`)
})

test('approve with auto-merge off: closes the ticket without merging', async () => {
  const { db, projectId, epicId, children } = setup(1)
  const log: string[] = []
  const git = fakeGit(log)
  await toReview(db, epicId, git)
  db.setSetting('exec:autoMerge', '0')

  const res = await execApprove(deps(db, okProvider, git), children[0].id)
  expect(res).toEqual({ merged: false, conflict: false })
  expect(db.getTicket(children[0].id).columnId).toBe(db.getColumnByRole(projectId, 'done').id)
  expect(log).not.toContain(`merge:${children[0].id}`)
  expect(log).toContain(`rmWt:${children[0].id}`)
})

test('approve on a conflict blocks the ticket in review and keeps the worktree', async () => {
  const { db, projectId, epicId, children } = setup(1)
  const log: string[] = []
  const git = fakeGit(log)
  await toReview(db, epicId, git)
  git.mergeTaskBranch = () => ({ ok: false, conflict: true })

  const res = await execApprove(deps(db, okProvider, git), children[0].id)
  expect(res).toEqual({ merged: false, conflict: true })
  const t = db.getTicket(children[0].id)
  expect(t.blocked).toBe(1)
  expect(t.columnId).toBe(db.getColumnByRole(projectId, 'review').id)
  expect(log).not.toContain(`rmWt:${children[0].id}`)
  const last = db.listComments(children[0].id).at(-1)!
  expect(last.kind).toBe('question')
  expect(last.author).toBe('kumpas')
})

test('approve falls back to review when no column carries the done role', async () => {
  // A project that renamed its Done column before v8 has no done-role column.
  // Build a genuine v7 db whose last column is named 'Finished', then open it:
  // the v8 name match does not claim it.
  const file = join(mkdtempSync(join(tmpdir(), 'kumpas-nodone-')), 'v7.db')
  const raw = new Database(file)
  for (const sql of MIGRATIONS.slice(0, 7)) raw.exec(sql)
  raw.pragma('user_version = 7')
  raw.prepare(`INSERT INTO projects (name, repo_path) VALUES ('demo', '/repo/demo')`).run()
  const cols: [string, string | null][] = [
    ['Backlog', 'todo'], ['In Progress', 'in_progress'], ['Review', 'review'], ['Finished', null],
  ]
  cols.forEach(([name, role], i) =>
    raw.prepare('INSERT INTO columns (project_id, name, position, role) VALUES (1, ?, ?, ?)')
      .run(name, i, role),
  )
  raw.close()

  const db = new Db(file)
  const epic = db.createTicket(1, 'Epic', 'spec', { kind: 'epic' })
  const agent = db.createAgent('Dev', 'claude', 'claude-sonnet-5', 'sp', 'edit')
  const child = db.createTicket(1, 'task', 'do it', {
    parentId: epic.id, assigneeAgentId: agent.id,
  })
  const git = fakeGit()
  await runBatch(deps(db, okProvider, git), epic.id)

  const res = await execApprove(deps(db, okProvider, git), child.id)
  expect(res.conflict).toBe(false)
  expect(db.getTicket(child.id).columnId).toBe(db.getColumnByRole(1, 'review').id)
  expect(db.listComments(child.id).at(-1)!.body).toContain('done')
})

test('approve refuses a ticket that is not in review', async () => {
  const { db, children } = setup(1)
  await expect(execApprove(deps(db, okProvider), children[0].id)).rejects.toThrow(/review/)
})

test('approve refuses a ticket with no parent epic', async () => {
  const { db, projectId, agentId } = setup(1)
  const loose = db.createTicket(projectId, 'loose', 'x', { assigneeAgentId: agentId })
  db.setTicketColumn(loose.id, db.getColumnByRole(projectId, 'review').id)
  await expect(execApprove(deps(db, okProvider), loose.id)).rejects.toThrow(/child task/)
})

const blockedProvider: AgentProvider = {
  run: async () => ({ resultText: 'BLOCKED: which database?', tokensIn: 1, tokensOut: 1 }),
}

test('resumeIfBlocked re-dispatches a blocked task in its worktree', async () => {
  const { db, projectId, epicId, children } = setup(1)
  const log: string[] = []
  const git = fakeGit(log)
  await runBatch(deps(db, blockedProvider, git), epicId)
  const child = children[0]
  expect(db.getTicket(child.id).blocked).toBe(1)

  db.addComment(child.id, 'human', 'Use SQLite.', 'note')
  let seenDir = ''
  const answering: AgentProvider = {
    run: async (prompt, repoPath) => {
      seenDir = repoPath
      expect(prompt).toContain('Use SQLite.')
      return { resultText: 'implemented', tokensIn: 1, tokensOut: 1 }
    },
  }
  const run = await resumeIfBlocked(deps(db, answering, git), child.id)
  expect(run?.status).toBe('success')
  expect(seenDir).toBe(`/wt/task-${child.id}`)
  const after = db.getTicket(child.id)
  expect(after.blocked).toBe(0)
  expect(after.columnId).toBe(db.getColumnByRole(projectId, 'review').id)
})

test('resumeIfBlocked ignores tickets that are not blocked children', async () => {
  const { db, projectId, epicId, children, agentId } = setup(1)
  await runBatch(deps(db, okProvider), epicId) // success → review, not blocked
  expect(await resumeIfBlocked(deps(db, okProvider), children[0].id)).toBeNull()

  const loose = db.createTicket(projectId, 'loose', 'x', { assigneeAgentId: agentId })
  db.setTicketBlocked(loose.id, true)
  expect(await resumeIfBlocked(deps(db, okProvider), loose.id)).toBeNull() // no parent epic
})

test('resumeIfBlocked retries the merge when the block came from a conflict', async () => {
  const { db, projectId, epicId, children } = setup(1)
  const log: string[] = []
  const git = fakeGit(log)
  await runBatch(deps(db, okProvider, git), epicId)
  git.mergeTaskBranch = () => ({ ok: false, conflict: true })
  await execApprove(deps(db, okProvider, git), children[0].id)
  expect(db.getTicket(children[0].id).blocked).toBe(1)

  git.mergeTaskBranch = (_r, _e, id) => { log.push(`merge:${id}`); return { ok: true } }
  const run = await resumeIfBlocked(deps(db, okProvider, git), children[0].id)
  expect(run).toBeNull() // an approve retry, not an agent run
  expect(db.getTicket(children[0].id).columnId).toBe(db.getColumnByRole(projectId, 'done').id)
})
