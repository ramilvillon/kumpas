import { expect, test } from 'vitest'
import { Db } from './db.js'
import { retryChat, sendChatMessage } from './chat.js'
import type { AgentProvider, ChatTurnResult } from './types.js'

function setup(chatImpl?: AgentProvider['chat']) {
  const db = new Db(':memory:')
  const project = db.createProject('demo', '/repo/demo')
  const agent = db.createAgent('Conductor', 'claude', 'claude-sonnet-5', 'brainstorm', 'read')
  const chat = db.createChat(project.id, agent.id, 'Login feature')
  const calls: { message: string; repoPath: string; sessionId: string | null }[] = []
  const provider: AgentProvider = {
    run: async () => { throw new Error('run must not be called by chat') },
    chat: chatImpl ?? (async (message, repoPath, _role, sessionId) => {
      calls.push({ message, repoPath, sessionId })
      return { replyText: `re: ${message}`, sessionId: 'sess-1', tokensIn: 5, tokensOut: 7 }
    }),
  }
  return { db, project, agent, chat, calls, deps: { db, providers: { claude: provider } } }
}

test('first turn: stores human then agent message, null session in, persists session out', async () => {
  const { db, chat, calls, deps } = setup()
  const reply = await sendChatMessage(deps, chat.id, 'hello there')
  expect(calls).toEqual([{ message: 'hello there', repoPath: '/repo/demo', sessionId: null }])
  expect(reply.author).toBe('Conductor')
  expect(reply.body).toBe('re: hello there')
  expect(db.getChat(chat.id).providerSessionId).toBe('sess-1')
  expect(db.listChatMessages(chat.id).map((m) => m.author)).toEqual(['human', 'Conductor'])
})

test('second turn passes the stored session id', async () => {
  const { db, chat, calls, deps } = setup()
  await sendChatMessage(deps, chat.id, 'one')
  await sendChatMessage(deps, chat.id, 'two')
  expect(calls[1].sessionId).toBe('sess-1')
  expect(db.listChatMessages(chat.id)).toHaveLength(4)
})

test('provider failure keeps the human message and adds no agent reply', async () => {
  const { db, chat, deps } = setup(async () => {
    throw new Error('CLI blew up')
  })
  await expect(sendChatMessage(deps, chat.id, 'save me')).rejects.toThrow(/CLI blew up/)
  const msgs = db.listChatMessages(chat.id)
  expect(msgs.map((m) => [m.author, m.body])).toEqual([['human', 'save me']])
  expect(db.getChat(chat.id).providerSessionId).toBeNull()
})

test('archived agent is refused before anything is stored', async () => {
  const { db, agent, chat, deps } = setup()
  db.updateAgent(agent.id, { archived: true })
  await expect(sendChatMessage(deps, chat.id, 'hi')).rejects.toThrow(/archived/)
  expect(db.listChatMessages(chat.id)).toEqual([])
})

test('provider without chat capability is refused', async () => {
  const { db, chat } = setup()
  const runOnly: AgentProvider = { run: async () => ({ resultText: '', tokensIn: 0, tokensOut: 0 }) }
  const deps = { db, providers: { claude: runOnly } }
  await expect(sendChatMessage(deps, chat.id, 'hi')).rejects.toThrow(/does not support chat/)
  expect(db.listChatMessages(chat.id)).toEqual([])
})

test('retry re-sends the last human message; refuses after an agent reply', async () => {
  let fail = true
  const { db, chat, calls, deps } = setup(async (message, repoPath, _role, sessionId) => {
    calls.push({ message, repoPath, sessionId })
    if (fail) throw new Error('flaky')
    return { replyText: 'recovered', sessionId: 'sess-9', tokensIn: 1, tokensOut: 1 }
  })
  await expect(sendChatMessage(deps, chat.id, 'try this')).rejects.toThrow(/flaky/)
  fail = false
  const reply = await retryChat(deps, chat.id)
  expect(reply.body).toBe('recovered')
  expect(calls.map((c) => c.message)).toEqual(['try this', 'try this']) // same body re-sent
  // no duplicate human message
  expect(db.listChatMessages(chat.id).map((m) => m.author)).toEqual(['human', 'Conductor'])
  // last message is now the agent's → nothing to retry
  await expect(retryChat(deps, chat.id)).rejects.toThrow(/nothing to retry/)
})
