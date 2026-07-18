import type { Agent, AgentProvider, ChatMessage, ProviderName, Ticket } from './types.js'
import type { Db } from './db.js'
import { loadCtx, sendChatMessage, sendChatTurn, type ChatDeps } from './chat.js'
import { startPlanningServer } from './planningMcp.js'

export interface PlanningDeps extends ChatDeps {
  db: Db
  providers: Partial<Record<ProviderName, AgentProvider>>
}

function loadEpic(db: Db, chatId: number): { epic: Ticket } {
  const chat = db.getChat(chatId)
  if (chat.ticketId === null) {
    throw new Error('this chat has no spec ticket — promote the spec first')
  }
  return { epic: db.getTicket(chat.ticketId) }
}

function activeMembers(db: Db, teamId: number): Agent[] {
  const ids = new Set(
    db.listMemberships().filter((m) => m.teamId === teamId).map((m) => m.agentId),
  )
  return db.listAgents().filter((a) => ids.has(a.id) && !a.archived)
}

// The epic title/description ride along even though the session usually
// remembers them: if the session expired, the fallback fresh-session turn
// still has the full spec to plan from.
function planningPrompt(epic: Ticket, teamName: string, members: Agent[]): string {
  const roster = members
    .map((m) => `- ${m.name} (model: ${m.model}) — ${m.systemPrompt.split('\n')[0]}`)
    .join('\n')
  return [
    `You are now the team lead for this feature. Our spec was promoted to epic ticket #${epic.id}: "${epic.title}".`,
    '',
    'Epic spec (for reference in case earlier context is unavailable):',
    epic.description,
    '',
    `Slice this spec into vertical tasks for team "${teamName}" — each independently implementable and testable.`,
    'Team members:',
    roster,
    '',
    'Reply with the proposed task list: for each task give a short title, a one-line scope, and a suggested assignee (one of the team members above).',
    'Do NOT create any tickets yet. We will review the list together first.',
  ].join('\n')
}

// Live roster rides along: the team may have changed since the proposal, and
// the model must not stall asking for names the tool would accept anyway. The
// tool-scope note stops it narrating plain (tool-less) turns as "outages".
function createMessage(members: Agent[]): string {
  return [
    'The plan is approved. Create the tickets now: one create_task tool call per task, exactly as agreed above (incorporate any revisions from our conversation). Skip tasks whose tickets were already created. Then reply with a one-line summary of what you created.',
    `Valid assignees right now: ${members.map((m) => m.name).join(', ')}.`,
    'Note: the create_task tool is attached to this message only — it is intentionally unavailable in ordinary chat replies. That is not an outage; never ask the human to reconnect it.',
  ].join('\n')
}

export async function startPlanning(
  deps: PlanningDeps, chatId: number, teamId: number,
): Promise<ChatMessage> {
  const { db } = deps
  loadCtx(deps, chatId) // refuse archived chat/agent/chat-less provider before any write
  const { epic } = loadEpic(db, chatId)
  const team = db.listTeams().find((t) => t.id === teamId)
  if (!team || team.archived) throw new Error('team not found or archived')
  const members = activeMembers(db, teamId)
  if (members.length === 0) throw new Error(`team '${team.name}' has no active members`)
  if (db.countChildren(epic.id) > 0) throw new Error('this epic already has tasks — one plan per epic')

  db.updateTicketFields(epic.id, { teamId })
  return sendChatMessage(deps, chatId, planningPrompt(epic, team.name, members))
}

// ponytail: single global in-flight guard — one window, one creation run at a
// time; per-chat guards when parallel planning actually happens.
let creationInFlight = false

export async function createPlannedTickets(deps: PlanningDeps, chatId: number): Promise<ChatMessage> {
  const { db } = deps
  loadCtx(deps, chatId)
  const { epic } = loadEpic(db, chatId)
  if (epic.teamId === null) throw new Error('no team chosen — run "Plan with team…" first')
  // Deliberately NO children check: a partial plan (rejected assignees, failed
  // turn) must stay recoverable — the session knows what exists and creates
  // only the rest. One-plan-per-epic applies to startPlanning, not creation.
  if (creationInFlight) throw new Error('a ticket-creation run is already in progress')
  const members = activeMembers(db, epic.teamId)
  if (members.length === 0) throw new Error('the chosen team has no active members')

  creationInFlight = true
  const startedAt = Date.now()
  const chat = db.getChat(chatId)
  const server = await startPlanningServer(db, {
    projectId: epic.projectId,
    epicId: epic.id,
    teamId: epic.teamId,
    members: members.map((m) => ({ id: m.id, name: m.name })),
  })
  try {
    const turn = await sendChatTurn(deps, chatId, createMessage(members), {
      mcp: { url: server.url, token: server.token, toolName: server.toolName },
    })
    db.createRun({
      ticketId: epic.id, agentId: chat.agentId, status: 'success',
      tokensIn: turn.tokensIn, tokensOut: turn.tokensOut,
      durationMs: Date.now() - startedAt, diff: '',
    })
    return turn.message
  } catch (err) {
    db.createRun({
      ticketId: epic.id, agentId: chat.agentId, status: 'failed',
      tokensIn: 0, tokensOut: 0, durationMs: Date.now() - startedAt, diff: '',
    })
    throw err
  } finally {
    creationInFlight = false
    server.close()
  }
}
