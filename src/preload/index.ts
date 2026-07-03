import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type KumpasApi } from '../shared/api.js'

const api: KumpasApi = {
  listProjects: () => ipcRenderer.invoke(CHANNELS.listProjects),
  pickFolder: () => ipcRenderer.invoke(CHANNELS.pickFolder),
  createProject: (name, repoPath) => ipcRenderer.invoke(CHANNELS.createProject, name, repoPath),
  listColumns: (projectId) => ipcRenderer.invoke(CHANNELS.listColumns, projectId),
  listTickets: (projectId) => ipcRenderer.invoke(CHANNELS.listTickets, projectId),
  createTicket: (projectId, title, description) =>
    ipcRenderer.invoke(CHANNELS.createTicket, projectId, title, description),
  moveTicket: (ticketId, columnId) => ipcRenderer.invoke(CHANNELS.moveTicket, ticketId, columnId),
  listAgents: () => ipcRenderer.invoke(CHANNELS.listAgents),
  dispatch: (ticketId, agentId) => ipcRenderer.invoke(CHANNELS.dispatch, ticketId, agentId),
  getSetting: (key) => ipcRenderer.invoke(CHANNELS.getSetting, key),
  setSetting: (key, value) => ipcRenderer.invoke(CHANNELS.setSetting, key, value),
}

contextBridge.exposeInMainWorld('kumpas', api)
