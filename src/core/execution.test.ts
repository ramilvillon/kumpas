import { expect, test } from 'vitest'
import { Db } from './db.js'
import { runBatch, type ExecGit } from './execution.js'
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
