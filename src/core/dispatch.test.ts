import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { Db } from './db.js'
import { dispatch } from './dispatch.js'
import type { AgentProvider } from './types.js'

function setup() {
  const db = new Db(':memory:')
  const p = db.createProject('demo', '/repo/demo')
  const t = db.createTicket(p.id, 'fix', 'do it')
  const a = db.createAgent('Developer', 'claude', 'claude-sonnet-5', 'sp', 'edit')
  return { db, projectId: p.id, ticketId: t.id, agentId: a.id }
}

const fakeDiff = () => 'diff --git a/x b/x'

test('success: records run, comments, moves ticket to the review column', async () => {
  const { db, projectId, ticketId, agentId } = setup()
  const provider: AgentProvider = {
    run: async () => ({ resultText: 'implemented', tokensIn: 10, tokensOut: 3 }),
  }
  const run = await dispatch({ db, providers: { claude: provider }, captureDiff: fakeDiff }, ticketId, agentId)
  expect(run.status).toBe('success')
  expect(run.tokensIn).toBe(10)
  expect(run.durationMs).toBeGreaterThanOrEqual(0)
  expect(run.diff).toContain('diff --git')
  expect(db.getTicket(ticketId).columnId).toBe(db.getColumnByRole(projectId, 'review').id)
  const comments = db.listComments(ticketId)
  expect(comments[0].author).toBe('Developer')
  expect(comments[0].kind).toBe('note')
})

test('blocked: records blocked run, question comment, flags ticket into todo', async () => {
  const { db, projectId, ticketId, agentId } = setup()
  const provider: AgentProvider = {
    run: async () => ({ resultText: 'BLOCKED: which database?', tokensIn: 4, tokensOut: 2 }),
  }
  const run = await dispatch({ db, providers: { claude: provider }, captureDiff: fakeDiff }, ticketId, agentId)
  expect(run.status).toBe('blocked')
  expect(run.diff).toBe('')
  expect(db.getTicket(ticketId).blocked).toBe(1)
  expect(db.getTicket(ticketId).columnId).toBe(db.getColumnByRole(projectId, 'todo').id)
  expect(db.listComments(ticketId)[0].kind).toBe('question')
})

test('failure: records failed run, error comment, resets ticket to todo', async () => {
  const { db, projectId, ticketId, agentId } = setup()
  db.setTicketColumn(ticketId, db.getColumnByRole(projectId, 'in_progress').id)
  const provider: AgentProvider = {
    run: async () => { throw new Error('claude exited with code 1: boom') },
  }
  const run = await dispatch({ db, providers: { claude: provider }, captureDiff: fakeDiff }, ticketId, agentId)
  expect(run.status).toBe('failed')
  expect(db.getTicket(ticketId).columnId).toBe(db.getColumnByRole(projectId, 'todo').id)
  expect(db.listComments(ticketId)[0].body).toContain('boom')
})

test('text attachment content reaches the agent prompt', async () => {
  const { db, ticketId, agentId } = setup()
  const file = join(mkdtempSync(join(tmpdir(), 'kumpas-d-')), 'note.txt')
  writeFileSync(file, 'secret context 123')
  db.createAttachment({ ticketId, filename: 'note.txt', kind: 'text', path: file })

  let seenPrompt = ''
  const provider: AgentProvider = {
    run: async (prompt) => {
      seenPrompt = prompt
      return { resultText: 'ok', tokensIn: 1, tokensOut: 1 }
    },
  }
  await dispatch({ db, providers: { claude: provider }, captureDiff: fakeDiff }, ticketId, agentId)
  expect(seenPrompt).toContain('secret context 123')
})

test('missing attachment file yields a failed run instead of a rejection', async () => {
  const { db, projectId, ticketId, agentId } = setup()
  db.createAttachment({
    ticketId, filename: 'gone.txt', kind: 'text', path: `/no/such/file-${Date.now()}.txt`,
  })
  const provider: AgentProvider = {
    run: async () => ({ resultText: 'implemented', tokensIn: 10, tokensOut: 3 }),
  }
  const run = await dispatch({ db, providers: { claude: provider }, captureDiff: fakeDiff }, ticketId, agentId)
  expect(run.status).toBe('failed')
  expect(db.getTicket(ticketId).columnId).toBe(db.getColumnByRole(projectId, 'todo').id)
})

test('an provider this build lacks (e.g. agy in v1) yields a failed run with a clear message', async () => {
  const { db, projectId, ticketId } = setup()
  const agy = db.createAgent('Coder', 'agy', 'gemini-x', 'sp', 'edit')
  const provider: AgentProvider = {
    run: async () => ({ resultText: 'unused', tokensIn: 0, tokensOut: 0 }),
  }
  const run = await dispatch(
    { db, providers: { claude: provider }, captureDiff: fakeDiff }, ticketId, agy.id,
  )
  expect(run.status).toBe('failed')
  expect(db.listComments(ticketId)[0].body).toContain('agy')
  expect(db.getTicket(ticketId).columnId).toBe(db.getColumnByRole(projectId, 'todo').id)
})

test('dispatch refuses an archived agent', async () => {
  const { db, ticketId, agentId } = setup()
  db.updateAgent(agentId, { archived: true })
  const provider: AgentProvider = {
    run: async () => ({ resultText: 'implemented', tokensIn: 10, tokensOut: 3 }),
  }
  await expect(
    dispatch({ db, providers: { claude: provider }, captureDiff: fakeDiff }, ticketId, agentId),
  ).rejects.toThrow(/archived/)
  expect(db.listRuns(ticketId)).toHaveLength(0)
})
