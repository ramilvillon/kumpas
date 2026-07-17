import type { AgentProvider, Agent, ChatMessage, Project, ProviderName } from './types.js'
import type { Db } from './db.js'

export interface ChatDeps {
  db: Db
  providers: Partial<Record<ProviderName, AgentProvider>>
}

type ChatCtx = {
  agent: Agent
  project: Project
  sessionId: string | null
  providerChat: NonNullable<AgentProvider['chat']>
}

// All refusals happen here, BEFORE any message is stored.
function loadCtx(deps: ChatDeps, chatId: number): ChatCtx {
  const chat = deps.db.getChat(chatId)
  const agent = deps.db.getAgent(chat.agentId)
  if (agent.archived) {
    throw new Error(`Agent '${agent.name}' is archived — this chat is read-only`)
  }
  const provider = deps.providers[agent.provider]
  if (!provider || !provider.chat) {
    throw new Error(`Provider '${agent.provider}' does not support chat in this build`)
  }
  const project = deps.db.getProject(chat.projectId)
  return {
    agent, project, sessionId: chat.providerSessionId,
    providerChat: provider.chat.bind(provider),
  }
}

async function runTurn(deps: ChatDeps, chatId: number, ctx: ChatCtx, body: string): Promise<ChatMessage> {
  const result = await ctx.providerChat(body, ctx.project.repoPath, ctx.agent, ctx.sessionId)
  deps.db.updateChat(chatId, { providerSessionId: result.sessionId })
  return deps.db.addChatMessage(chatId, ctx.agent.name, result.replyText)
}

export async function sendChatMessage(deps: ChatDeps, chatId: number, body: string): Promise<ChatMessage> {
  const ctx = loadCtx(deps, chatId)
  // Store the human message FIRST — it survives a provider failure.
  deps.db.addChatMessage(chatId, 'human', body)
  return runTurn(deps, chatId, ctx, body)
}

// After a failed turn the thread ends with a human message; Retry re-runs the
// agent turn for it without storing a duplicate.
export async function retryChat(deps: ChatDeps, chatId: number): Promise<ChatMessage> {
  const ctx = loadCtx(deps, chatId)
  const messages = deps.db.listChatMessages(chatId)
  const last = messages[messages.length - 1]
  if (!last || last.author !== 'human') {
    throw new Error('nothing to retry — the last message is not from the human')
  }
  return runTurn(deps, chatId, ctx, last.body)
}
