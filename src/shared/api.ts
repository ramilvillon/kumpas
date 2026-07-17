import type { Agent, Attachment, Chat, ChatMessage, Column, Comment, Membership, Project, Run, Team, Ticket } from '../core/types.js'

export interface KumpasApi {
  listProjects(): Promise<Project[]>
  pickFolder(): Promise<string | null>
  createProject(name: string, repoPath: string): Promise<Project>
  listColumns(projectId: number): Promise<Column[]>
  listTickets(projectId: number): Promise<Ticket[]>
  createTicket(
    projectId: number, title: string, description: string,
    opts?: {
      priority?: 'low' | 'medium' | 'high' | null
      dueDate?: string | null
      assigneeAgentId?: number | null
      teamId?: number | null
      tags?: string[]
      columnId?: number
    },
  ): Promise<Ticket>
  updateTicket(ticketId: number, patch: Record<string, unknown>): Promise<Ticket>
  moveTicket(ticketId: number, columnId: number): Promise<void>
  listAgents(): Promise<Agent[]>
  createAgent(input: {
    name: string
    provider: 'claude' | 'agy' | 'codex'
    model: string
    systemPrompt: string
    permissionLevel: string
  }): Promise<Agent>
  updateAgent(agentId: number, patch: Record<string, unknown>): Promise<Agent>
  listTeams(): Promise<Team[]>
  createTeam(input: { name: string }): Promise<Team>
  updateTeam(teamId: number, patch: Record<string, unknown>): Promise<Team>
  listMemberships(): Promise<Membership[]>
  setAgentTeams(agentId: number, teamIds: number[]): Promise<void>
  listChats(projectId: number): Promise<Chat[]>
  createChat(input: { projectId: number; agentId: number; title: string }): Promise<Chat>
  listChatMessages(chatId: number): Promise<ChatMessage[]>
  sendChatMessage(chatId: number, body: string): Promise<ChatMessage>
  retryChat(chatId: number): Promise<ChatMessage>
  updateChat(chatId: number, patch: Record<string, unknown>): Promise<Chat>
  promoteChat(chatId: number, input: { title: string; description: string }): Promise<Ticket>
  dispatch(ticketId: number, agentId: number): Promise<Run>
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  listComments(ticketId: number): Promise<Comment[]>
  addComment(ticketId: number, body: string): Promise<Comment>
  listAttachments(ticketId: number): Promise<Attachment[]>
  listRuns(ticketId: number): Promise<Run[]>
  pickFiles(): Promise<string[]>
  addAttachment(ticketId: number, sourcePath: string): Promise<Attachment>
}

// One channel string per method; keys must match KumpasApi method names.
export const CHANNELS: Record<keyof KumpasApi, string> = {
  listProjects: 'projects:list',
  pickFolder: 'projects:pickFolder',
  createProject: 'projects:create',
  listColumns: 'columns:list',
  listTickets: 'tickets:list',
  createTicket: 'tickets:create',
  updateTicket: 'tickets:update',
  moveTicket: 'tickets:move',
  listAgents: 'agents:list',
  createAgent: 'agents:create',
  updateAgent: 'agents:update',
  listTeams: 'teams:list',
  createTeam: 'teams:create',
  updateTeam: 'teams:update',
  listMemberships: 'teams:memberships',
  setAgentTeams: 'agents:setTeams',
  listChats: 'chats:list',
  createChat: 'chats:create',
  listChatMessages: 'chats:messages',
  sendChatMessage: 'chats:send',
  retryChat: 'chats:retry',
  updateChat: 'chats:update',
  promoteChat: 'chats:promote',
  dispatch: 'dispatch:run',
  getSetting: 'settings:get',
  setSetting: 'settings:set',
  listComments: 'comments:list',
  addComment: 'comments:add',
  listAttachments: 'attachments:list',
  listRuns: 'runs:list',
  pickFiles: 'attachments:pickFiles',
  addAttachment: 'attachments:add',
}
