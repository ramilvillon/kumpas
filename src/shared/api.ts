import type { Agent, Column, Project, Run, Ticket } from '../core/types.js'

export interface KumpasApi {
  listProjects(): Promise<Project[]>
  pickFolder(): Promise<string | null>
  createProject(name: string, repoPath: string): Promise<Project>
  listColumns(projectId: number): Promise<Column[]>
  listTickets(projectId: number): Promise<Ticket[]>
  createTicket(projectId: number, title: string, description: string): Promise<Ticket>
  moveTicket(ticketId: number, columnId: number): Promise<void>
  listAgents(): Promise<Agent[]>
  dispatch(ticketId: number, agentId: number): Promise<Run>
}

// One channel string per method; keys must match KumpasApi method names.
export const CHANNELS: Record<keyof KumpasApi, string> = {
  listProjects: 'projects:list',
  pickFolder: 'projects:pickFolder',
  createProject: 'projects:create',
  listColumns: 'columns:list',
  listTickets: 'tickets:list',
  createTicket: 'tickets:create',
  moveTicket: 'tickets:move',
  listAgents: 'agents:list',
  dispatch: 'dispatch:run',
}
