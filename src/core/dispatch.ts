import type { ProviderName, AgentProvider, Run } from './types.js'
import type { Db } from './db.js'
import { assemblePrompt } from './prompt.js'
import { captureDiff as realCaptureDiff } from './git.js'
import { readAttachmentForPrompt } from './attachments.js'

export interface DispatchDeps {
  db: Db
  providers: Partial<Record<ProviderName, AgentProvider>>
  captureDiff?: (repoPath: string) => string
}

export async function dispatch(
  deps: DispatchDeps, ticketId: number, agentId: number, cwd?: string,
): Promise<Run> {
  const { db, providers } = deps
  const captureDiff = deps.captureDiff ?? realCaptureDiff

  // ponytail: these lookups run before the try, so a stale ticket/agent id or a
  // project missing a role column would reject rather than record a failed run —
  // unreachable in v1 (ids come from the app, the 3 role columns are always
  // seeded, no column-deletion path yet); harden when Plan 2 adds column
  // editing/deletion.
  const ticket = db.getTicket(ticketId)
  const agent = db.getAgent(agentId)
  if (agent.archived) throw new Error(`Agent '${agent.name}' is archived and cannot be dispatched`)
  const project = db.getProject(ticket.projectId)

  // Batch execution passes the task's worktree; manual dispatch runs in the repo.
  const workDir = cwd ?? project.repoPath

  const todoCol = db.getColumnByRole(ticket.projectId, 'todo')
  const inProgressCol = db.getColumnByRole(ticket.projectId, 'in_progress')
  const reviewCol = db.getColumnByRole(ticket.projectId, 'review')

  db.setTicketColumn(ticketId, inProgressCol.id)

  const startedAt = Date.now()
  try {
    const attachments = db.listAttachments(ticketId).map((a) => readAttachmentForPrompt(a))
    const prompt = assemblePrompt(ticket, db.listComments(ticketId), attachments)

    const provider = providers[agent.provider]
    if (!provider) {
      throw new Error(`Provider '${agent.provider}' is not available in this build`)
    }
    const result = await provider.run(prompt, workDir, agent)

    if (result.resultText.trimStart().startsWith('BLOCKED:')) {
      db.addComment(ticketId, agent.name, result.resultText, 'question')
      db.setTicketBlocked(ticketId, true)
      db.setTicketColumn(ticketId, todoCol.id)
      return db.createRun({
        ticketId, agentId, status: 'blocked',
        tokensIn: result.tokensIn, tokensOut: result.tokensOut,
        durationMs: Date.now() - startedAt, diff: '',
      })
    }

    const diff = captureDiff(workDir)
    db.addComment(ticketId, agent.name, result.resultText, 'note')
    db.setTicketBlocked(ticketId, false)
    db.setTicketColumn(ticketId, reviewCol.id)
    return db.createRun({
      ticketId, agentId, status: 'success',
      tokensIn: result.tokensIn, tokensOut: result.tokensOut,
      durationMs: Date.now() - startedAt, diff,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    db.addComment(ticketId, agent.name, `Run failed: ${message}`, 'note')
    db.setTicketColumn(ticketId, todoCol.id)
    return db.createRun({
      ticketId, agentId, status: 'failed', tokensIn: 0, tokensOut: 0,
      durationMs: Date.now() - startedAt, diff: '',
    })
  }
}
