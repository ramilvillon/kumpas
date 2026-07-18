import { expect, test } from 'vitest'
import { Db } from './db.js'
import { createPlannedTickets, startPlanning } from './planning.js'
import type { AgentProvider, ChatOpts } from './types.js'

type ChatCall = { message: string; sessionId: string | null; opts: ChatOpts | undefined }

function setup(chatImpl?: AgentProvider['chat']) {
  const db = new Db(':memory:')
  const project = db.createProject('demo', '/repo/demo')
  const lead = db.createAgent('Conductor', 'claude', 'claude-sonnet-5', 'brainstorm', 'read')
  const member = db.createAgent('Implementer', 'claude', 'claude-sonnet-5', 'you code\nmore', 'edit')
  const team = db.createTeam('Backend')
  db.setAgentTeams(member.id, [team.id])
  const chat = db.createChat(project.id, lead.id, 'Login feature')
  const epic = db.createTicket(project.id, 'Login epic', 'the full spec', { kind: 'epic' })
  db.updateChat(chat.id, { ticketId: epic.id, providerSessionId: 'sess-1' })
  const calls: ChatCall[] = []
  const provider: AgentProvider = {
    run: async () => { throw new Error('run must not be called') },
    chat: chatImpl ?? (async (message, _repo, _role, sessionId, opts) => {
      calls.push({ message, sessionId, opts })
      return { replyText: 'proposed plan', sessionId: 'sess-2', tokensIn: 3, tokensOut: 4 }
    }),
  }
  const deps = { db, providers: { claude: provider } }
  return { db, project, lead, member, team, chat, epic, calls, deps }
}

test('startPlanning refuses an unpromoted chat', async () => {
  const { db, project, lead, team, deps } = setup()
  const bare = db.createChat(project.id, lead.id, 'no epic yet')
  await expect(startPlanning(deps, bare.id, team.id)).rejects.toThrow(/promote/)
})

test('startPlanning refuses archived or missing teams and empty teams', async () => {
  const { db, team, chat, deps } = setup()
  await expect(startPlanning(deps, chat.id, 9999)).rejects.toThrow(/team/)
  db.updateTeam(team.id, { archived: true })
  await expect(startPlanning(deps, chat.id, team.id)).rejects.toThrow(/team/)
  db.updateTeam(team.id, { archived: false })
  const empty = db.createTeam('Ghosts')
  await expect(startPlanning(deps, chat.id, empty.id)).rejects.toThrow(/no active members/)
})

test('startPlanning refuses when the epic already has children', async () => {
  const { db, project, epic, team, chat, deps } = setup()
  db.createTicket(project.id, 'existing child', 'd', { parentId: epic.id })
  await expect(startPlanning(deps, chat.id, team.id)).rejects.toThrow(/already has tasks/)
  expect(db.getTicket(epic.id).teamId).toBeNull() // refused before any write
})

test('startPlanning sets epic.teamId and sends the roster prompt through the chat', async () => {
  const { db, epic, team, chat, calls, deps } = setup()
  const reply = await startPlanning(deps, chat.id, team.id)
  expect(db.getTicket(epic.id).teamId).toBe(team.id)
  expect(reply.body).toBe('proposed plan')
  expect(calls).toHaveLength(1)
  expect(calls[0].sessionId).toBe('sess-1') // resumes the brainstorm session
  expect(calls[0].opts?.mcp).toBeUndefined() // proposal turn has NO tool
  const prompt = calls[0].message
  expect(prompt).toContain('Login epic')
  expect(prompt).toContain('the full spec') // context survives an expired-session fallback
  expect(prompt).toContain('Backend')
  expect(prompt).toContain('- Implementer (model: claude-sonnet-5) — you code')
  expect(prompt).toContain('Do NOT create any tickets yet')
  // stored in the thread like any human turn
  expect(db.listChatMessages(chat.id).map((m) => m.author)).toEqual(['human', 'Conductor'])
})

test('createPlannedTickets refuses without a team', async () => {
  const { chat, deps } = setup()
  await expect(createPlannedTickets(deps, chat.id)).rejects.toThrow(/no team chosen/)
})

// A partial plan (e.g. some assignees rejected) must not lock the human out of
// the tool-armed turn — the session knows what exists and creates the rest.
test('createPlannedTickets can re-run after a partial plan (children exist)', async () => {
  const { db, project, epic, team, chat, deps } = setup()
  db.updateTicketFields(epic.id, { teamId: team.id })
  db.createTicket(project.id, 'partial child', 'd', { parentId: epic.id })
  const reply = await createPlannedTickets(deps, chat.id)
  expect(reply.body).toBe('proposed plan')
  expect(db.listRuns(epic.id)).toHaveLength(1)
})

test('createPlannedTickets runs the tool turn: tickets created via MCP, run recorded, server closed', async () => {
  let mcpUrl = ''
  const { db, epic, member, team, chat, deps } = setup(async (_message, _repo, _role, _session, opts) => {
    mcpUrl = opts!.mcp!.url
    const res = await fetch(opts!.mcp!.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts!.mcp!.token}` },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'create_task', arguments: { title: 'Build API', description: 'endpoint', assignee: 'Implementer' } },
      }),
    })
    const body = await res.json()
    if (body.result.isError) throw new Error('tool failed')
    return { replyText: 'created 1 task', sessionId: 'sess-3', tokensIn: 7, tokensOut: 8 }
  })
  db.updateTicketFields(epic.id, { teamId: team.id })
  const reply = await createPlannedTickets(deps, chat.id)
  expect(reply.body).toBe('created 1 task')
  const child = db.listTickets(epic.projectId).find((t) => t.title === 'Build API')!
  expect(child).toMatchObject({ parentId: epic.id, teamId: team.id, assigneeAgentId: member.id, kind: 'task' })
  const runs = db.listRuns(epic.id)
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({ status: 'success', tokensIn: 7, tokensOut: 8 })
  await expect(fetch(mcpUrl)).rejects.toThrow() // server is down after the turn
})

test('createPlannedTickets records a failed run and closes the server when the provider throws', async () => {
  let mcpUrl = ''
  const { db, epic, team, chat, deps } = setup(async (_m, _r, _ro, _s, opts) => {
    mcpUrl = opts!.mcp!.url
    throw new Error('CLI crashed')
  })
  db.updateTicketFields(epic.id, { teamId: team.id })
  await expect(createPlannedTickets(deps, chat.id)).rejects.toThrow(/CLI crashed/)
  expect(db.listRuns(epic.id)[0].status).toBe('failed')
  await expect(fetch(mcpUrl)).rejects.toThrow()
})

test('only one creation run at a time', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const { db, epic, team, chat, deps } = setup(async () => {
    await gate
    return { replyText: 'ok', sessionId: 's', tokensIn: 0, tokensOut: 0 }
  })
  db.updateTicketFields(epic.id, { teamId: team.id })
  const first = createPlannedTickets(deps, chat.id)
  await new Promise((r) => setTimeout(r, 10)) // let the first run reach the provider
  await expect(createPlannedTickets(deps, chat.id)).rejects.toThrow(/already in progress/)
  release()
  await first
})
