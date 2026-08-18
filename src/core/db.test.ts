import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import Database from 'better-sqlite3'
import { Db, MIGRATIONS } from './db.js'

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
  expect(cols.map((c) => c.role)).toEqual(['todo', 'in_progress', 'review', 'done'])
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

test('an attachment must belong to exactly one of a ticket or a comment', () => {
  const db = fresh()
  expect(() => db.createAttachment({ filename: 'x', kind: 'text', path: '/p' })).toThrow()
})

test('setting round-trips; missing key returns null', () => {
  const db = fresh()
  expect(db.getSetting('theme')).toBeNull()
  db.setSetting('theme', 'dark')
  expect(db.getSetting('theme')).toBe('dark')
  db.setSetting('theme', 'light')
  expect(db.getSetting('theme')).toBe('light')
})

test('settings table migration is idempotent across two openings of the same file', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'kumpas-db-')), 'k.db')
  const db1 = new Db(file)
  db1.setSetting('theme', 'dark')

  const db2 = new Db(file)
  expect(db2.getSetting('theme')).toBe('dark')
})

test('new ticket has priority/dueDate/assignee null and empty tags', () => {
  const db = new Db(':memory:')
  const p = db.createProject('p', '/tmp/p')
  const t = db.createTicket(p.id, 'title', 'desc')
  const got = db.getTicket(t.id)
  expect(got.priority).toBeNull()
  expect(got.dueDate).toBeNull()
  expect(got.assigneeAgentId).toBeNull()
  expect(got.tags).toEqual([])
})

test('listTickets carries comment and attachment counts', () => {
  const db = new Db(':memory:')
  const p = db.createProject('p', '/tmp/p')
  const t = db.createTicket(p.id, 'title', 'desc')
  db.addComment(t.id, 'human', 'hi', 'note')
  db.addComment(t.id, 'Developer', 'done', 'note')
  db.createAttachment({ ticketId: t.id, filename: 'a.txt', kind: 'text', path: '/tmp/a.txt' })
  const [row] = db.listTickets(p.id)
  expect(row.commentCount).toBe(2)
  expect(row.attachmentCount).toBe(1)
})

test('createTicket accepts optional fields and a target column', () => {
  const db = new Db(':memory:')
  const p = db.createProject('p', '/tmp/p')
  const review = db.getColumnByRole(p.id, 'review')
  const t = db.createTicket(p.id, 'x', 'y', {
    priority: 'high', dueDate: '2026-07-12', tags: ['core', 'ui'], columnId: review.id,
  })
  expect(t.priority).toBe('high')
  expect(t.dueDate).toBe('2026-07-12')
  expect(t.tags).toEqual(['core', 'ui'])
  expect(t.columnId).toBe(review.id)
})

test('updateTicketFields patches only given fields', () => {
  const db = new Db(':memory:')
  const p = db.createProject('p', '/tmp/p')
  const t = db.createTicket(p.id, 'x', 'y')
  const u = db.updateTicketFields(t.id, { priority: 'low', tags: ['a'] })
  expect(u.priority).toBe('low')
  expect(u.tags).toEqual(['a'])
  expect(u.title).toBe('x') // untouched
})

test('listRuns returns a ticket runs newest-first', () => {
  const db = new Db(':memory:')
  const p = db.createProject('p', '/tmp/p')
  const t = db.createTicket(p.id, 'x', 'y')
  const a = db.createAgent('Dev', 'claude', 'sonnet', '', 'auto')
  db.createRun({ ticketId: t.id, agentId: a.id, status: 'success', tokensIn: 1, tokensOut: 2, durationMs: 10, diff: '' })
  db.createRun({ ticketId: t.id, agentId: a.id, status: 'failed', tokensIn: 3, tokensOut: 4, durationMs: 20, diff: '' })
  const runs = db.listRuns(t.id)
  expect(runs).toHaveLength(2)
  expect(runs[0].status).toBe('failed') // newest first
})

test('listProjects / listTickets / listAgents return scoped, ordered rows', () => {
  const db = fresh()
  const p1 = db.createProject('a', '/r/a')
  const p2 = db.createProject('b', '/r/b')
  db.createTicket(p1.id, 't1', 'x')
  db.createTicket(p1.id, 't2', 'x')
  db.createTicket(p2.id, 't3', 'x')
  db.createAgent('Dev', 'claude', 'claude-sonnet-5', 'sp', 'edit')

  expect(db.listProjects().map((p) => p.name)).toEqual(['a', 'b'])
  expect(db.listTickets(p1.id).map((t) => t.title)).toEqual(['t1', 't2'])
  expect(db.listTickets(p2.id).map((t) => t.title)).toEqual(['t3'])
  expect(db.listAgents().map((a) => a.name)).toEqual(['Dev'])
})

test('agents round-trip archived as boolean; updateAgent patches every field', () => {
  const db = new Db(':memory:')
  const a = db.createAgent('Dev', 'claude', 'claude-sonnet-5', 'implement it', 'auto')
  expect(a.archived).toBe(false)

  const edited = db.updateAgent(a.id, {
    name: 'Dev 2', provider: 'claude', model: 'claude-opus-4-8',
    systemPrompt: 'implement it well', permissionLevel: 'edit',
  })
  expect(edited).toMatchObject({
    id: a.id, name: 'Dev 2', model: 'claude-opus-4-8',
    systemPrompt: 'implement it well', permissionLevel: 'edit', archived: false,
  })

  expect(db.updateAgent(a.id, { archived: true }).archived).toBe(true)
  expect(db.listAgents()[0].archived).toBe(true)
  expect(db.updateAgent(a.id, { archived: false }).archived).toBe(false)

  // unknown keys are ignored, not written
  expect(db.updateAgent(a.id, { nope: 'x' } as never).name).toBe('Dev 2')
})

test('migration v4 upgrades an existing v3 db and preserves agent rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kumpas-mig4-'))
  const file = join(dir, 'v3.db')
  // Build a genuine v3 database by replaying the first three released migrations.
  const raw = new Database(file)
  for (const sql of MIGRATIONS.slice(0, 3)) raw.exec(sql)
  raw.pragma('user_version = 3')
  raw.prepare(
    `INSERT INTO agents (name, provider, model, system_prompt, permission_level)
     VALUES ('Old Hand', 'claude', 'claude-sonnet-5', 'p', 'read')`,
  ).run()
  raw.close()

  const db = new Db(file) // opening migrates v3 → v4
  const agents = db.listAgents()
  expect(agents).toHaveLength(1)
  expect(agents[0].name).toBe('Old Hand')
  expect(agents[0].archived).toBe(false)
})

test('update patch loops ignore prototype keys like constructor', () => {
  const db = new Db(':memory:')
  const a = db.createAgent('Dev', 'claude', 'claude-sonnet-5', 'p', 'read')
  expect(db.updateAgent(a.id, { constructor: 'x' } as never).name).toBe('Dev')
  const proj = db.createProject('demo', '/repo/demo')
  const t = db.createTicket(proj.id, 'T', 'd')
  expect(db.updateTicketFields(t.id, { constructor: 'x' } as never).title).toBe('T')
})

test('teams round-trip; updateTeam patches name and archived as boolean', () => {
  const db = new Db(':memory:')
  const t = db.createTeam('Backend')
  expect(t).toMatchObject({ name: 'Backend', archived: false })
  expect(db.updateTeam(t.id, { name: 'Platform' }).name).toBe('Platform')
  expect(db.updateTeam(t.id, { archived: true }).archived).toBe(true)
  expect(db.listTeams()[0].archived).toBe(true)
  expect(db.updateTeam(t.id, { archived: false }).archived).toBe(false)
  expect(db.updateTeam(t.id, { constructor: 'x' } as never).name).toBe('Platform')

  // archive → restore must be lossless for memberships and ticket refs
  const agent = db.createAgent('Dev', 'claude', 'claude-sonnet-5', 'p', 'read')
  const proj = db.createProject('demo', '/repo/demo')
  const ticket = db.createTicket(proj.id, 'T', 'd', { teamId: t.id })
  db.setAgentTeams(agent.id, [t.id])
  db.updateTeam(t.id, { archived: true })
  db.updateTeam(t.id, { archived: false })
  expect(db.listMemberships()).toEqual([{ agentId: agent.id, teamId: t.id }])
  expect(db.getTicket(ticket.id).teamId).toBe(t.id)
})

test('setAgentTeams atomically replaces the membership set', () => {
  const db = new Db(':memory:')
  const a = db.createAgent('Dev', 'claude', 'claude-sonnet-5', 'p', 'read')
  const t1 = db.createTeam('Backend')
  const t2 = db.createTeam('Frontend')
  const t3 = db.createTeam('Docs')
  db.setAgentTeams(a.id, [t1.id, t2.id])
  expect(db.listMemberships()).toEqual([
    { agentId: a.id, teamId: t1.id },
    { agentId: a.id, teamId: t2.id },
  ])
  db.setAgentTeams(a.id, [t3.id])
  expect(db.listMemberships()).toEqual([{ agentId: a.id, teamId: t3.id }])
  db.setAgentTeams(a.id, [])
  expect(db.listMemberships()).toEqual([])
})

test('ticket teamId: create with, patch, null out', () => {
  const db = new Db(':memory:')
  const p = db.createProject('demo', '/repo/demo')
  const team = db.createTeam('Backend')
  const t = db.createTicket(p.id, 'T', 'd', { teamId: team.id })
  expect(t.teamId).toBe(team.id)
  expect(db.listTickets(p.id)[0].teamId).toBe(team.id)
  const other = db.createTeam('Frontend')
  expect(db.updateTicketFields(t.id, { teamId: other.id }).teamId).toBe(other.id)
  expect(db.updateTicketFields(t.id, { teamId: null }).teamId).toBeNull()
  expect(db.createTicket(p.id, 'T2', 'd').teamId).toBeNull()
})

test('migration v5 upgrades an existing v4 db and preserves rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kumpas-mig5-'))
  const file = join(dir, 'v4.db')
  const raw = new Database(file)
  for (const sql of MIGRATIONS.slice(0, 4)) raw.exec(sql)
  raw.pragma('user_version = 4')
  raw.prepare(
    `INSERT INTO agents (name, provider, model, system_prompt, permission_level)
     VALUES ('Old Hand', 'claude', 'claude-sonnet-5', 'p', 'read')`,
  ).run()
  raw.close()

  const db = new Db(file) // opening migrates v4 → v5
  expect(db.listAgents()[0].name).toBe('Old Hand')
  const team = db.createTeam('Backend')
  db.setAgentTeams(db.listAgents()[0].id, [team.id])
  expect(db.listMemberships()).toHaveLength(1)
})

test('migration v6 upgrades an existing v5 db and preserves rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kumpas-mig6-'))
  const file = join(dir, 'v5.db')
  // Build a genuine v5 database by replaying the first five released migrations.
  const raw = new Database(file)
  for (const sql of MIGRATIONS.slice(0, 5)) raw.exec(sql)
  raw.pragma('user_version = 5')
  raw.prepare(`INSERT INTO projects (name, repo_path) VALUES ('demo', '/repo/demo')`).run()
  raw.prepare(
    `INSERT INTO columns (project_id, name, position, role) VALUES (1, 'Backlog', 0, 'todo')`,
  ).run()
  raw.prepare(
    `INSERT INTO tickets (project_id, title, description, column_id) VALUES (1, 'old', 'd', 1)`,
  ).run()
  // agent row so createChat below passes the FK check (Db opens with foreign_keys = ON)
  raw.prepare(
    `INSERT INTO agents (name, provider, model, system_prompt, permission_level)
     VALUES ('Conductor', 'claude', 'claude-sonnet-5', 'p', 'read')`,
  ).run()
  raw.close()

  const db = new Db(file) // opening migrates v5 → v6
  const t = db.getTicket(1)
  expect(t.title).toBe('old')
  expect(t.kind).toBe('task') // pre-existing tickets default to task
  const chat = db.createChat(1, 1, 'first chat') // chats table exists and works
  expect(chat.id).toBeGreaterThan(0)
})

test('chat round-trip: create, list newest-first, patch fields, prototype keys ignored', () => {
  const db = new Db(':memory:')
  const p = db.createProject('demo', '/repo/demo')
  const a = db.createAgent('Conductor', 'claude', 'claude-sonnet-5', 'brainstorm', 'read')
  const c1 = db.createChat(p.id, a.id, 'Login feature')
  expect(c1).toMatchObject({
    projectId: p.id, agentId: a.id, title: 'Login feature',
    providerSessionId: null, ticketId: null, archived: false,
  })
  const c2 = db.createChat(p.id, a.id, 'Signup flow')
  expect(db.listChats(p.id).map((c) => c.id)).toEqual([c2.id, c1.id]) // newest first
  // other project's list is empty
  const p2 = db.createProject('other', '/repo/other')
  expect(db.listChats(p2.id)).toEqual([])

  expect(db.updateChat(c1.id, { title: 'Login v2' }).title).toBe('Login v2')
  expect(db.updateChat(c1.id, { providerSessionId: 'sess-abc' }).providerSessionId).toBe('sess-abc')
  expect(db.updateChat(c1.id, { archived: true }).archived).toBe(true)
  expect(db.updateChat(c1.id, { archived: false }).archived).toBe(false)
  const ticket = db.createTicket(p.id, 'Spec', 'body', { kind: 'epic' })
  expect(db.updateChat(c1.id, { ticketId: ticket.id }).ticketId).toBe(ticket.id)
  expect(db.updateChat(c1.id, { constructor: 'x' } as never).title).toBe('Login v2')
})

test('chat messages list in insertion order with authors', () => {
  const db = new Db(':memory:')
  const p = db.createProject('demo', '/repo/demo')
  const a = db.createAgent('Conductor', 'claude', 'claude-sonnet-5', 'brainstorm', 'read')
  const c = db.createChat(p.id, a.id, 'Login feature')
  const m1 = db.addChatMessage(c.id, 'human', 'hello')
  db.addChatMessage(c.id, 'Conductor', 'hi, what are we building?')
  expect(m1.chatId).toBe(c.id)
  expect(m1.createdAt).toBeTruthy()
  const list = db.listChatMessages(c.id)
  expect(list.map((m) => [m.author, m.body])).toEqual([
    ['human', 'hello'],
    ['Conductor', 'hi, what are we building?'],
  ])
})

test('ticket kind: defaults to task, creates as epic, cannot be patched', () => {
  const db = new Db(':memory:')
  const p = db.createProject('demo', '/repo/demo')
  const plain = db.createTicket(p.id, 'T', 'd')
  expect(plain.kind).toBe('task')
  const epic = db.createTicket(p.id, 'Spec: login', 'the spec', { kind: 'epic' })
  expect(epic.kind).toBe('epic')
  expect(db.listTickets(p.id).find((t) => t.id === epic.id)?.kind).toBe('epic')
  // kind is immutable: updateTicketFields must ignore it
  expect(db.updateTicketFields(epic.id, { kind: 'task' } as never).kind).toBe('epic')
})

test('migration v7 upgrades an existing v6 db and preserves rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kumpas-mig7-'))
  const file = join(dir, 'v6.db')
  // Build a genuine v6 database by replaying the first six released migrations.
  const raw = new Database(file)
  for (const sql of MIGRATIONS.slice(0, 6)) raw.exec(sql)
  raw.pragma('user_version = 6')
  raw.prepare(`INSERT INTO projects (name, repo_path) VALUES ('demo', '/repo/demo')`).run()
  raw.prepare(
    `INSERT INTO columns (project_id, name, position, role) VALUES (1, 'Backlog', 0, 'todo')`,
  ).run()
  raw.prepare(
    `INSERT INTO tickets (project_id, title, description, column_id) VALUES (1, 'old epic', 'd', 1)`,
  ).run()
  raw.close()

  const db = new Db(file) // opening migrates v6 → v7
  expect(db.getTicket(1).parentId).toBeNull() // pre-existing tickets have no parent
  const child = db.createTicket(1, 'child task', 'd', { parentId: 1 })
  expect(child.parentId).toBe(1)
  expect(db.listTickets(1).find((t) => t.id === child.id)?.parentId).toBe(1)
  expect(db.countChildren(1)).toBe(1)
  expect(db.countChildren(child.id)).toBe(0)
})

test('parent_id is immutable through updateTicketFields', () => {
  const db = new Db(':memory:')
  const p = db.createProject('demo', '/repo/demo')
  const epic = db.createTicket(p.id, 'Epic', 'spec', { kind: 'epic' })
  const child = db.createTicket(p.id, 'child', 'd', { parentId: epic.id })
  const after = db.updateTicketFields(child.id, { parentId: null, title: 'renamed' } as never)
  expect(after.title).toBe('renamed')
  expect(after.parentId).toBe(epic.id) // patch key silently ignored, like kind
})

test('new projects seed a Done column carrying the done role', () => {
  const db = fresh()
  const p = db.createProject('demo', '/repo/demo')
  const done = db.getColumnByRole(p.id, 'done')
  expect(done.name).toBe('Done')
  expect(done.position).toBe(3)
})

test('migration v8 upgrades an existing v7 db and gives Done the done role', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kumpas-mig8-'))
  const file = join(dir, 'v7.db')
  // Build a genuine v7 database by replaying the first seven released migrations.
  const raw = new Database(file)
  for (const sql of MIGRATIONS.slice(0, 7)) raw.exec(sql)
  raw.pragma('user_version = 7')
  raw.prepare(`INSERT INTO projects (name, repo_path) VALUES ('demo', '/repo/demo')`).run()
  raw.prepare(
    `INSERT INTO columns (project_id, name, position, role) VALUES (1, 'Backlog', 0, 'todo')`,
  ).run()
  raw.prepare(
    `INSERT INTO columns (project_id, name, position, role) VALUES (1, 'Done', 1, NULL)`,
  ).run()
  raw.prepare(
    `INSERT INTO columns (project_id, name, position, role) VALUES (1, 'Icebox', 2, NULL)`,
  ).run()
  raw.close()

  const db = new Db(file) // opening migrates v7 → v8
  expect(db.getColumnByRole(1, 'done').name).toBe('Done')
  // Other role-less columns keep role NULL — only an exact 'Done' match is claimed.
  expect(db.listColumns(1).find((c) => c.name === 'Icebox')?.role).toBeNull()
})
