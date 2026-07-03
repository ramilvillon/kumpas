import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { Db } from '../core/db.js'
import { ClaudeProvider } from '../core/claudeProvider.js'
import { registerIpc } from './ipc.js'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // preload builds as CommonJS (out/preload/index.cjs) so it can run
      // sandboxed under Electron's secure default.
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const db = new Db(join(app.getPath('userData'), 'kumpas.db'))
  if (db.listAgents().length === 0) {
    db.createAgent('Developer', 'claude', 'claude-sonnet-5', 'You are a careful software developer. Implement the ticket.', 'auto')
    db.createAgent('Reviewer', 'claude', 'claude-sonnet-5', 'You are a code reviewer. Review the diff and leave comments.', 'read')
  }
  registerIpc(db, { claude: new ClaudeProvider() })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
  .catch((e) => {
    dialog.showErrorBox('Kumpas failed to start', e instanceof Error ? e.message : String(e))
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
