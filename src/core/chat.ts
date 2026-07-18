import type { AgentProvider, Agent, ChatMessage, ChatOpts, ChatTurnResult, Project, ProviderName } from './types.js'
import type { Db } from './db.js'

export interface ChatDeps {
  db: Db
  providers: Partial<Record<ProviderName, AgentProvider>>
}

export type ChatCtx = {
  agent: Agent
  project: Project
  sessionId: string | null
  providerChat: NonNullable<AgentProvider['chat']>
}

export interface ChatTurn {
  message: ChatMessage
  tokensIn: number
  tokensOut: number
}

// All refusals happen here, BEFORE any message is stored. Exported so
// planning can refuse-early without duplicating the checks.
export function loadCtx(deps: ChatDeps, chatId: number): ChatCtx {
  const chat = deps.db.getChat(chatId)
  if (chat.archived) {
    throw new Error('This chat is archived — restore it to continue')
  }
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

async function runTurn(
  deps: ChatDeps, chatId: number, ctx: ChatCtx, body: string, opts?: ChatOpts,
): Promise<ChatTurn> {
  let result: ChatTurnResult
  try {
    result = await ctx.providerChat(body, ctx.project.repoPath, ctx.agent, ctx.sessionId, opts)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // claude prunes sessions (~30 days). Rather than bricking the chat, retry
    // once on a fresh session and mark the reply so the human knows.
    if (ctx.sessionId === null || !/no conversation found/i.test(msg)) throw err
    result = await ctx.providerChat(body, ctx.project.repoPath, ctx.agent, null, opts)
    result = {
      ...result,
      replyText:
        '_(context reset — the previous session expired; replies may lack earlier context)_\n\n' +
        result.replyText,
    }
  }
  deps.db.updateChat(chatId, { providerSessionId: result.sessionId })
  const message = deps.db.addChatMessage(chatId, ctx.agent.name, result.replyText)
  return { message, tokensIn: result.tokensIn, tokensOut: result.tokensOut }
}

export async function sendChatTurn(
  deps: ChatDeps, chatId: number, body: string, opts?: ChatOpts,
): Promise<ChatTurn> {
  const ctx = loadCtx(deps, chatId)
  // Store the human message FIRST — it survives a provider failure.
  deps.db.addChatMessage(chatId, 'human', body)
  return runTurn(deps, chatId, ctx, body, opts)
}

export async function sendChatMessage(deps: ChatDeps, chatId: number, body: string): Promise<ChatMessage> {
  return (await sendChatTurn(deps, chatId, body)).message
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
  return (await runTurn(deps, chatId, ctx, last.body)).message
}
