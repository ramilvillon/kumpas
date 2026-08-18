import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type KumpasApi } from '../shared/api.js'

const api: KumpasApi = {
  listProjects: () => ipcRenderer.invoke(CHANNELS.listProjects),
  pickFolder: () => ipcRenderer.invoke(CHANNELS.pickFolder),
  createProject: (name, repoPath) => ipcRenderer.invoke(CHANNELS.createProject, name, repoPath),
  listColumns: (projectId) => ipcRenderer.invoke(CHANNELS.listColumns, projectId),
  listTickets: (projectId) => ipcRenderer.invoke(CHANNELS.listTickets, projectId),
  createTicket: (projectId, title, description, opts) =>
    ipcRenderer.invoke(CHANNELS.createTicket, projectId, title, description, opts),
  updateTicket: (ticketId, patch) => ipcRenderer.invoke(CHANNELS.updateTicket, ticketId, patch),
  moveTicket: (ticketId, columnId) => ipcRenderer.invoke(CHANNELS.moveTicket, ticketId, columnId),
  listAgents: () => ipcRenderer.invoke(CHANNELS.listAgents),
  createAgent: (input) => ipcRenderer.invoke(CHANNELS.createAgent, input),
  updateAgent: (agentId, patch) => ipcRenderer.invoke(CHANNELS.updateAgent, agentId, patch),
  listTeams: () => ipcRenderer.invoke(CHANNELS.listTeams),
  createTeam: (input) => ipcRenderer.invoke(CHANNELS.createTeam, input),
  updateTeam: (teamId, patch) => ipcRenderer.invoke(CHANNELS.updateTeam, teamId, patch),
  listMemberships: () => ipcRenderer.invoke(CHANNELS.listMemberships),
  setAgentTeams: (agentId, teamIds) => ipcRenderer.invoke(CHANNELS.setAgentTeams, agentId, teamIds),
  listChats: (projectId) => ipcRenderer.invoke(CHANNELS.listChats, projectId),
  createChat: (input) => ipcRenderer.invoke(CHANNELS.createChat, input),
  listChatMessages: (chatId) => ipcRenderer.invoke(CHANNELS.listChatMessages, chatId),
  sendChatMessage: (chatId, body) => ipcRenderer.invoke(CHANNELS.sendChatMessage, chatId, body),
  retryChat: (chatId) => ipcRenderer.invoke(CHANNELS.retryChat, chatId),
  updateChat: (chatId, patch) => ipcRenderer.invoke(CHANNELS.updateChat, chatId, patch),
  promoteChat: (chatId, input) => ipcRenderer.invoke(CHANNELS.promoteChat, chatId, input),
  planChat: (chatId, teamId) => ipcRenderer.invoke(CHANNELS.planChat, chatId, teamId),
  createPlannedTickets: (chatId) => ipcRenderer.invoke(CHANNELS.createPlannedTickets, chatId),
  dispatch: (ticketId, agentId) => ipcRenderer.invoke(CHANNELS.dispatch, ticketId, agentId),
  runBatch: (epicId) => ipcRenderer.invoke(CHANNELS.runBatch, epicId),
  approveTicket: (ticketId) => ipcRenderer.invoke(CHANNELS.approveTicket, ticketId),
  getSetting: (key) => ipcRenderer.invoke(CHANNELS.getSetting, key),
  setSetting: (key, value) => ipcRenderer.invoke(CHANNELS.setSetting, key, value),
  listComments: (ticketId) => ipcRenderer.invoke(CHANNELS.listComments, ticketId),
  addComment: (ticketId, body) => ipcRenderer.invoke(CHANNELS.addComment, ticketId, body),
  listAttachments: (ticketId) => ipcRenderer.invoke(CHANNELS.listAttachments, ticketId),
  listRuns: (ticketId) => ipcRenderer.invoke(CHANNELS.listRuns, ticketId),
  pickFiles: () => ipcRenderer.invoke(CHANNELS.pickFiles),
  addAttachment: (ticketId, sourcePath) =>
    ipcRenderer.invoke(CHANNELS.addAttachment, ticketId, sourcePath),
}

contextBridge.exposeInMainWorld('kumpas', api)
