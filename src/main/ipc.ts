import { app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import type { AgentProvider, ProviderName } from '../core/types.js'
import type { Db } from '../core/db.js'
import { dispatch } from '../core/dispatch.js'
import { isGitRepo } from '../core/git.js'
import { copyIntoStore } from '../core/attachmentStore.js'
import { CHANNELS } from '../shared/api.js'
import {
  validateAgentCreate, validateAgentPatch, validateTeamCreate, validateTeamIds,
  validateTeamPatch, type AgentCreateInput, type AgentPatch,
} from '../core/agentInput.js'

export function registerIpc(
  db: Db,
  providers: Partial<Record<ProviderName, AgentProvider>>,
): void {
  const ATTACH_DIR = join(app.getPath('userData'), 'attachments')
  // Only files the user actually chose via the pickFiles dialog may be attached.
  // A compromised renderer can call addAttachment with any string, so main never
  // trusts a renderer-supplied path — it must be one this dialog returned. Exact
  // match against already-resolved absolute paths, so `..` traversal can't apply.
  const pickedPaths = new Set<string>()

  ipcMain.handle(CHANNELS.listProjects, () => db.listProjects())

  ipcMain.handle(CHANNELS.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  ipcMain.handle(CHANNELS.createProject, (_e, name: string, repoPath: string) => {
    if (!isGitRepo(repoPath)) {
      throw new Error(`Not a git repository: ${repoPath}. Run "git init" there first.`)
    }
    return db.createProject(name, repoPath)
  })

  ipcMain.handle(CHANNELS.listColumns, (_e, projectId: number) => db.listColumns(projectId))
  ipcMain.handle(CHANNELS.listTickets, (_e, projectId: number) => db.listTickets(projectId))
  ipcMain.handle(CHANNELS.createTicket, (_e, projectId, title, description, opts) =>
    db.createTicket(projectId, title, description, opts ?? {}),
  )
  ipcMain.handle(CHANNELS.updateTicket, (_e, ticketId, patch) => db.updateTicketFields(ticketId, patch))
  ipcMain.handle(CHANNELS.moveTicket, (_e, ticketId: number, columnId: number) =>
    db.setTicketColumn(ticketId, columnId),
  )
  ipcMain.handle(CHANNELS.listAgents, () => db.listAgents())
  ipcMain.handle(CHANNELS.createAgent, (_e, input: AgentCreateInput) => {
    validateAgentCreate(input)
    return db.createAgent(
      input.name.trim(), input.provider, input.model.trim(),
      input.systemPrompt, input.permissionLevel,
    )
  })
  ipcMain.handle(CHANNELS.updateAgent, (_e, agentId: number, patch: AgentPatch) => {
    validateAgentPatch(patch)
    const p = { ...patch }
    if (typeof p.name === 'string') p.name = p.name.trim()
    if (typeof p.model === 'string') p.model = p.model.trim()
    return db.updateAgent(agentId, p)
  })
  ipcMain.handle(CHANNELS.listTeams, () => db.listTeams())
  ipcMain.handle(CHANNELS.createTeam, (_e, input: { name: string }) => {
    validateTeamCreate(input)
    return db.createTeam(input.name.trim())
  })
  ipcMain.handle(CHANNELS.updateTeam, (_e, teamId: number, patch: { name?: string; archived?: boolean }) => {
    validateTeamPatch(patch)
    const p = { ...patch }
    if (typeof p.name === 'string') p.name = p.name.trim()
    return db.updateTeam(teamId, p)
  })
  ipcMain.handle(CHANNELS.listMemberships, () => db.listMemberships())
  ipcMain.handle(CHANNELS.setAgentTeams, (_e, agentId: number, teamIds: unknown) => {
    validateTeamIds(teamIds)
    db.setAgentTeams(agentId, teamIds)
  })
  ipcMain.handle(CHANNELS.dispatch, (_e, ticketId: number, agentId: number) =>
    dispatch({ db, providers }, ticketId, agentId),
  )
  const RENDERER_SETTINGS = new Set(['theme', 'sidebar:collapsed'])
  ipcMain.handle(CHANNELS.getSetting, (_e, key: string) => {
    if (!RENDERER_SETTINGS.has(key)) {
      throw new Error(`setting '${key}' is not renderer-accessible`)
    }
    return db.getSetting(key)
  })
  ipcMain.handle(CHANNELS.setSetting, (_e, key: string, value: string) => {
    if (!RENDERER_SETTINGS.has(key)) {
      throw new Error(`setting '${key}' is not renderer-accessible`)
    }
    return db.setSetting(key, value)
  })
  ipcMain.handle(CHANNELS.listComments, (_e, ticketId) => db.listComments(ticketId))
  ipcMain.handle(CHANNELS.addComment, (_e, ticketId, body) => db.addComment(ticketId, 'human', body, 'note'))
  ipcMain.handle(CHANNELS.listAttachments, (_e, ticketId) => db.listAttachments(ticketId))
  ipcMain.handle(CHANNELS.listRuns, (_e, ticketId) => db.listRuns(ticketId))
  ipcMain.handle(CHANNELS.pickFiles, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    if (r.canceled) return []
    for (const p of r.filePaths) pickedPaths.add(p)
    return r.filePaths
  })
  ipcMain.handle(CHANNELS.addAttachment, (_e, ticketId: number, sourcePath: string) => {
    if (!pickedPaths.has(sourcePath)) {
      throw new Error('attachment source not permitted: choose the file via the picker')
    }
    const meta = copyIntoStore(ATTACH_DIR, sourcePath)
    return db.createAttachment({ ticketId, ...meta })
  })
}
