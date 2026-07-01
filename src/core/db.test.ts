import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { Db } from './db.js'

function fresh() {
  return new Db(':memory:')
}

test('project round-trips', () => {
  const db = fresh()
  const p = db.createProject('demo', '/repo/demo')
  expect(p.id).toBeGreaterThan(0)
  expect(db.getProject(p.id)).toEqual(p)
})

test('creating a project seeds the 4 default columns in order', () => {
  const db = fresh()
  const p = db.createProject('demo', '/repo/demo')
  const cols = db.listColumns(p.id)
  expect(cols.map((c) => c.name)).toEqual(['Backlog', 'In Progress', 'Review', 'Done'])
  expect(cols.map((c) => c.role)).toEqual(['todo', 'in_progress', 'review', null])
})

test('getColumnByRole finds the tagged column and throws when absent', () => {
  const db = fresh()
  const p = db.createProject('demo', '/repo/demo')
  expect(db.getColumnByRole(p.id, 'review').name).toBe('Review')
  const other = db.createProject('other', '/repo/other')
  // roles are scoped per project — this project's review column is distinct
  expect(db.getColumnByRole(other.id, 'review').projectId).toBe(other.id)
  // nonexistent project has no columns, so any role query throws
  expect(() => db.getColumnByRole(9999, 'todo')).toThrow()
})

test('new ticket lands in the todo column, unblocked; column and blocked update', () => {
  const db = fresh()
  const p = db.createProject('demo', '/repo/demo')
  const todo = db.getColumnByRole(p.id, 'todo')
  const review = db.getColumnByRole(p.id, 'review')
  const t = db.createTicket(p.id, 'fix auth', 'null check missing')
  expect(t.columnId).toBe(todo.id)
  expect(t.blocked).toBe(0)
  db.setTicketColumn(t.id, review.id)
  db.setTicketBlocked(t.id, true)
  const got = db.getTicket(t.id)
  expect(got.columnId).toBe(review.id)
  expect(got.blocked).toBe(1)
})

test('comments list in insertion order', () => {
  const db = fresh()
  const p = db.createProject('demo', '/repo/demo')
  const t = db.createTicket(p.id, 'x', 'y')
  db.addComment(t.id, 'human', 'first', 'note')
  db.addComment(t.id, 'Reviewer', 'BLOCKED: which db?', 'question')
  const list = db.listComments(t.id)
  expect(list.map((c) => c.body)).toEqual(['first', 'BLOCKED: which db?'])
  expect(list[1].kind).toBe('question')
})

test('agent and run round-trip', () => {
  const db = fresh()
  const p = db.createProject('demo', '/repo/demo')
  const t = db.createTicket(p.id, 'x', 'y')
  const a = db.createAgent('Developer', 'claude', 'claude-sonnet-5', 'you write code', 'edit')
  const r = db.createRun({
    ticketId: t.id, agentId: a.id, status: 'success',
    tokensIn: 100, tokensOut: 20, durationMs: 4200, diff: 'diff --git a b',
  })
  expect(r.id).toBeGreaterThan(0)
  expect(db.getAgent(a.id).name).toBe('Developer')
  expect(r.status).toBe('success')
  expect(r.durationMs).toBe(4200)
})

test('schema is versioned: reopening a file keeps data and does not re-migrate', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'kumpas-db-')), 'k.db')
  const db1 = new Db(file)
  const p = db1.createProject('demo', '/repo/demo')

  // Reopen the same file: migrations must not re-run (user_version guards them)
  // and data must survive.
  const db2 = new Db(file)
  expect(db2.getProject(p.id).name).toBe('demo')
  expect(db2.listColumns(p.id)).toHaveLength(4)
})

test('attachments on a ticket and on its comments list together', () => {
  const db = fresh()
  const p = db.createProject('demo', '/repo/demo')
  const t = db.createTicket(p.id, 'x', 'y')
  const c = db.addComment(t.id, 'human', 'see the log', 'note')
  db.createAttachment({ ticketId: t.id, filename: 'spec.md', kind: 'text', path: '/store/1' })
  db.createAttachment({ commentId: c.id, filename: 'err.log', kind: 'text', path: '/store/2' })
  expect(db.listAttachments(t.id).map((a) => a.filename)).toEqual(['spec.md', 'err.log'])
})
