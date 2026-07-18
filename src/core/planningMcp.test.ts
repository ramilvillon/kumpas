import { afterEach, beforeEach, expect, test } from 'vitest'
import { Db } from './db.js'
import { startPlanningServer, type PlanningServer } from './planningMcp.js'

let db: Db
let server: PlanningServer
let projectId: number
let epicId: number
let teamId: number
let memberId: number

beforeEach(async () => {
  db = new Db(':memory:')
  const p = db.createProject('demo', '/repo/demo')
  projectId = p.id
  epicId = db.createTicket(p.id, 'Login epic', 'the spec', { kind: 'epic' }).id
  teamId = db.createTeam('Backend').id
  memberId = db.createAgent('Implementer', 'claude', 'claude-sonnet-5', 'you code', 'edit').id
  db.setAgentTeams(memberId, [teamId])
  server = await startPlanningServer(db, {
    projectId, epicId, teamId, members: [{ id: memberId, name: 'Implementer' }],
  })
})
afterEach(() => server.close())

function post(body: unknown, token = server.token) {
  return fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}
const call = (args: Record<string, unknown>) =>
  post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_task', arguments: args } })

test('rejects requests without the per-run token', async () => {
  const res = await fetch(server.url, { method: 'POST', body: '{}' })
  expect(res.status).toBe(401)
  const wrong = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'not-the-token')
  expect(wrong.status).toBe(401)
})

test('rejects non-POST', async () => {
  const res = await fetch(server.url, { headers: { authorization: `Bearer ${server.token}` } })
  expect(res.status).toBe(405)
})

test('initialize handshake and tools/list expose exactly create_task', async () => {
  const init = await post({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude', version: '1' } },
  })
  const initBody = await init.json()
  expect(initBody.result.protocolVersion).toBe('2025-03-26')
  expect(initBody.result.capabilities.tools).toBeDefined()

  const notif = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  expect(notif.status).toBe(202)

  const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const listBody = await list.json()
  expect(listBody.result.tools.map((t: { name: string }) => t.name)).toEqual(['create_task'])
  expect(listBody.result.tools[0].inputSchema.required).toEqual(['title', 'description', 'assignee'])
})

test('create_task creates a scoped child ticket in To Do', async () => {
  const res = await call({ title: 'Build API', description: 'POST /login endpoint', assignee: 'Implementer' })
  const body = await res.json()
  expect(body.result.isError).toBeUndefined()
  expect(body.result.content[0].text).toMatch(/^created ticket #\d+: Build API$/)
  const tickets = db.listTickets(projectId)
  const child = tickets.find((t) => t.title === 'Build API')!
  expect(child).toMatchObject({
    kind: 'task', parentId: epicId, teamId, assigneeAgentId: memberId,
    columnId: db.getColumnByRole(projectId, 'todo').id,
  })
})

test('unknown assignee returns a tool error naming valid members, creates nothing', async () => {
  const res = await call({ title: 'x', description: 'y', assignee: 'Nobody' })
  const body = await res.json()
  expect(body.result.isError).toBe(true)
  expect(body.result.content[0].text).toContain('Implementer')
  expect(db.countChildren(epicId)).toBe(0)
})

test('empty title or description returns a tool error, creates nothing', async () => {
  const res = await call({ title: '  ', description: 'y', assignee: 'Implementer' })
  const body = await res.json()
  expect(body.result.isError).toBe(true)
  expect(db.countChildren(epicId)).toBe(0)
})

test('unknown method returns JSON-RPC method-not-found', async () => {
  const res = await post({ jsonrpc: '2.0', id: 9, method: 'resources/list' })
  const body = await res.json()
  expect(body.error.code).toBe(-32601)
})

test('non-object JSON body returns 400 instead of crashing', async () => {
  for (const raw of ['null', '42', '"x"', '[]']) {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
      body: raw,
    })
    expect(res.status).toBe(400)
  }
})

test('close() shuts the server down', async () => {
  server.close()
  await expect(post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).rejects.toThrow()
})
