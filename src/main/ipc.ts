import { dialog, ipcMain } from 'electron'
import type { AgentProvider, ProviderName } from '../core/types.js'
import type { Db } from '../core/db.js'
import { dispatch } from '../core/dispatch.js'
import { isGitRepo } from '../core/git.js'
import { CHANNELS } from '../shared/api.js'

export function registerIpc(
  db: Db,
  providers: Partial<Record<ProviderName, AgentProvider>>,
): void {
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
  ipcMain.handle(CHANNELS.createTicket, (_e, projectId: number, title: string, description: string) =>
    db.createTicket(projectId, title, description),
  )
  ipcMain.handle(CHANNELS.moveTicket, (_e, ticketId: number, columnId: number) =>
    db.setTicketColumn(ticketId, columnId),
  )
  ipcMain.handle(CHANNELS.listAgents, () => db.listAgents())
  ipcMain.handle(CHANNELS.dispatch, (_e, ticketId: number, agentId: number) =>
    dispatch({ db, providers }, ticketId, agentId),
  )
}
