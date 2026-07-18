export type RunStatus = 'success' | 'failed' | 'blocked'
export type CommentKind = 'note' | 'question'

// Reserved roles the dispatch engine keys off. A column with role === null is
// a plain user column (e.g. "Done") the engine never moves tickets into.
export type ColumnRole = 'todo' | 'in_progress' | 'review'

export interface Project {
  id: number
  name: string
  repoPath: string
}

export interface Column {
  id: number
  projectId: number
  name: string
  position: number
  role: ColumnRole | null
}

export type TicketPriority = 'low' | 'medium' | 'high'

export type TicketKind = 'task' | 'epic'

export interface Ticket {
  id: number
  projectId: number
  title: string
  description: string
  columnId: number
  blocked: number // 0 | 1
  kind: TicketKind
  parentId: number | null // epic this task was planned under; null for top-level
  priority: TicketPriority | null
  dueDate: string | null // ISO YYYY-MM-DD
  assigneeAgentId: number | null
  teamId: number | null
  tags: string[]
  commentCount?: number // populated by listTickets only
  attachmentCount?: number
}

export interface Comment {
  id: number
  ticketId: number
  author: string // 'human' or an agent role name
  body: string
  kind: CommentKind
  createdAt: string
}

// Which coding-agent CLI backs a role. v1 implements only 'claude'; the others
// resolve once their providers are built.
export type ProviderName = 'claude' | 'agy' | 'codex'

export interface Agent {
  id: number
  name: string
  provider: ProviderName
  model: string
  systemPrompt: string
  permissionLevel: string
  archived: boolean
}

// A team is the unit work gets pointed at: tickets are assigned to a team,
// and auto-dispatch (future) picks the acting agent from the ticket's team.
export interface Team {
  id: number
  name: string
  archived: boolean
}

export interface Membership {
  agentId: number
  teamId: number
}

// A brainstorm conversation with one agent, scoped to a project. Context lives
// in the provider's own session (providerSessionId); Kumpas stores messages
// for display only. ticketId links the epic ticket this chat was promoted to.
export interface Chat {
  id: number
  projectId: number
  agentId: number
  title: string
  providerSessionId: string | null
  ticketId: number | null
  archived: boolean
}

export interface ChatMessage {
  id: number
  chatId: number
  author: string // 'human' or the agent name
  body: string
  createdAt: string
}

export interface Run {
  id: number
  ticketId: number
  agentId: number
  status: RunStatus
  tokensIn: number
  tokensOut: number
  durationMs: number // wall-clock time the agent ran
  diff: string
  createdAt: string
}

export type AttachmentKind = 'text' | 'binary'

// A file attached to a ticket or a comment. Exactly one of ticketId/commentId
// is set. `path` points into the Kumpas attachment store on disk.
export interface Attachment {
  id: number
  ticketId: number | null
  commentId: number | null
  filename: string
  kind: AttachmentKind
  path: string
  createdAt: string
}

// Attachment prepared for the prompt: text files carry inlined content,
// binaries carry only their path.
export interface PromptAttachment {
  filename: string
  kind: AttachmentKind
  path: string
  textContent?: string
}

// Returned by every AgentProvider. NOTE: no diff — dispatch captures that.
export interface RunResult {
  resultText: string
  tokensIn: number
  tokensOut: number
  costUsd?: number
  sessionId?: string
}

// One blocking chat turn. sessionId is the provider's own conversation handle
// (claude --resume); Kumpas persists it on the chat and passes it back next turn.
export interface ChatTurnResult {
  replyText: string
  sessionId: string
  tokensIn: number
  tokensOut: number
}

// Extra per-turn provider options. mcp attaches a Kumpas-hosted MCP endpoint
// (the planning create_task tool) to exactly this turn.
export interface ChatOpts {
  mcp?: { url: string; token: string; toolName: string }
}

export interface AgentProvider {
  run(prompt: string, repoPath: string, role: Agent): Promise<RunResult>
  // Optional per-provider capability: multi-turn brainstorm chat via the CLI's
  // native session resume. Providers without it don't offer chat.
  chat?(message: string, repoPath: string, role: Agent, sessionId: string | null, opts?: ChatOpts): Promise<ChatTurnResult>
}
