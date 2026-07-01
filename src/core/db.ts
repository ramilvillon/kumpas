import Database from 'better-sqlite3'
import type {
  ProviderName, Agent, Attachment, AttachmentKind, Column, ColumnRole, Comment,
  CommentKind, Project, Run, RunStatus, Ticket,
} from './types.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  role TEXT
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  column_id INTEGER NOT NULL REFERENCES columns(id),
  blocked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  permission_level TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  agent_id INTEGER NOT NULL REFERENCES agents(id),
  status TEXT NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  diff TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER REFERENCES tickets(id),
  comment_id INTEGER REFERENCES comments(id),
  filename TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((ticket_id IS NULL) <> (comment_id IS NULL))
);
`

// Ordered migrations: index i brings a DB from user_version i to i+1.
// v1 = the initial schema above. Ship future schema changes by APPENDING an
// ALTER string as a new element — never edit an already-released migration.
const MIGRATIONS: string[] = [SCHEMA]

const DEFAULT_COLUMNS: { name: string; role: ColumnRole | null }[] = [
  { name: 'Backlog', role: 'todo' },
  { name: 'In Progress', role: 'in_progress' },
  { name: 'Review', role: 'review' },
  { name: 'Done', role: null },
]

export class Db {
  private db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  // ponytail: PRAGMA user_version is SQLite's native migration marker — no
  // library. Each migration applies once, in a transaction, then bumps the
  // version. Split MIGRATIONS to its own module once there are several.
  private migrate(): void {
    const current = this.db.pragma('user_version', { simple: true }) as number
    for (let v = current; v < MIGRATIONS.length; v++) {
      const sql = MIGRATIONS[v]
      this.db.transaction(() => {
        this.db.exec(sql)
        this.db.pragma(`user_version = ${v + 1}`)
      })()
    }
  }

  createProject(name: string, repoPath: string): Project {
    const id = this.db.transaction(() => {
      const info = this.db
        .prepare('INSERT INTO projects (name, repo_path) VALUES (?, ?)')
        .run(name, repoPath)
      const projectId = Number(info.lastInsertRowid)
      const insertCol = this.db.prepare(
        'INSERT INTO columns (project_id, name, position, role) VALUES (?, ?, ?, ?)',
      )
      DEFAULT_COLUMNS.forEach((c, i) => insertCol.run(projectId, c.name, i, c.role))
      return projectId
    })()
    return this.getProject(id)
  }

  getProject(id: number): Project {
    return this.db
      .prepare('SELECT id, name, repo_path AS repoPath FROM projects WHERE id = ?')
      .get(id) as Project
  }

  listProjects(): Project[] {
    return this.db
      .prepare('SELECT id, name, repo_path AS repoPath FROM projects ORDER BY id ASC')
      .all() as Project[]
  }

  listColumns(projectId: number): Column[] {
    return this.db
      .prepare(
        `SELECT id, project_id AS projectId, name, position, role
         FROM columns WHERE project_id = ? ORDER BY position ASC`,
      )
      .all(projectId) as Column[]
  }

  getColumnByRole(projectId: number, role: ColumnRole): Column {
    const col = this.db
      .prepare(
        `SELECT id, project_id AS projectId, name, position, role
         FROM columns WHERE project_id = ? AND role = ?`,
      )
      .get(projectId, role) as Column | undefined
    if (!col) throw new Error(`No column with role '${role}' in project ${projectId}`)
    return col
  }

  createTicket(projectId: number, title: string, description: string): Ticket {
    const todo = this.getColumnByRole(projectId, 'todo')
    const info = this.db
      .prepare(
        'INSERT INTO tickets (project_id, title, description, column_id) VALUES (?, ?, ?, ?)',
      )
      .run(projectId, title, description, todo.id)
    return this.getTicket(Number(info.lastInsertRowid))
  }

  getTicket(id: number): Ticket {
    return this.db
      .prepare(
        `SELECT id, project_id AS projectId, title, description,
                column_id AS columnId, blocked
         FROM tickets WHERE id = ?`,
      )
      .get(id) as Ticket
  }

  listTickets(projectId: number): Ticket[] {
    return this.db
      .prepare(
        `SELECT id, project_id AS projectId, title, description,
                column_id AS columnId, blocked
         FROM tickets WHERE project_id = ? ORDER BY id ASC`,
      )
      .all(projectId) as Ticket[]
  }

  setTicketColumn(id: number, columnId: number): void {
    this.db.prepare('UPDATE tickets SET column_id = ? WHERE id = ?').run(columnId, id)
  }

  setTicketBlocked(id: number, blocked: boolean): void {
    this.db.prepare('UPDATE tickets SET blocked = ? WHERE id = ?').run(blocked ? 1 : 0, id)
  }

  addComment(ticketId: number, author: string, body: string, kind: CommentKind): Comment {
    const info = this.db
      .prepare('INSERT INTO comments (ticket_id, author, body, kind) VALUES (?, ?, ?, ?)')
      .run(ticketId, author, body, kind)
    return this.db
      .prepare(
        `SELECT id, ticket_id AS ticketId, author, body, kind, created_at AS createdAt
         FROM comments WHERE id = ?`,
      )
      .get(Number(info.lastInsertRowid)) as Comment
  }

  listComments(ticketId: number): Comment[] {
    return this.db
      .prepare(
        `SELECT id, ticket_id AS ticketId, author, body, kind, created_at AS createdAt
         FROM comments WHERE ticket_id = ? ORDER BY id ASC`,
      )
      .all(ticketId) as Comment[]
  }

  createAgent(
    name: string, provider: ProviderName, model: string,
    systemPrompt: string, permissionLevel: string,
  ): Agent {
    const info = this.db
      .prepare(
        `INSERT INTO agents (name, provider, model, system_prompt, permission_level)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(name, provider, model, systemPrompt, permissionLevel)
    return this.getAgent(Number(info.lastInsertRowid))
  }

  getAgent(id: number): Agent {
    return this.db
      .prepare(
        `SELECT id, name, provider, model, system_prompt AS systemPrompt,
                permission_level AS permissionLevel
         FROM agents WHERE id = ?`,
      )
      .get(id) as Agent
  }

  listAgents(): Agent[] {
    return this.db
      .prepare(
        `SELECT id, name, provider, model, system_prompt AS systemPrompt,
                permission_level AS permissionLevel
         FROM agents ORDER BY id ASC`,
      )
      .all() as Agent[]
  }

  createRun(r: {
    ticketId: number; agentId: number; status: RunStatus
    tokensIn: number; tokensOut: number; durationMs: number; diff: string
  }): Run {
    const info = this.db
      .prepare(
        `INSERT INTO runs
           (ticket_id, agent_id, status, tokens_in, tokens_out, duration_ms, diff)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.ticketId, r.agentId, r.status, r.tokensIn, r.tokensOut, r.durationMs, r.diff)
    return this.db
      .prepare(
        `SELECT id, ticket_id AS ticketId, agent_id AS agentId, status,
                tokens_in AS tokensIn, tokens_out AS tokensOut,
                duration_ms AS durationMs, diff, created_at AS createdAt
         FROM runs WHERE id = ?`,
      )
      .get(Number(info.lastInsertRowid)) as Run
  }

  createAttachment(a: {
    ticketId?: number | null; commentId?: number | null
    filename: string; kind: AttachmentKind; path: string
  }): Attachment {
    const info = this.db
      .prepare(
        `INSERT INTO attachments (ticket_id, comment_id, filename, kind, path)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(a.ticketId ?? null, a.commentId ?? null, a.filename, a.kind, a.path)
    return this.db
      .prepare(
        `SELECT id, ticket_id AS ticketId, comment_id AS commentId, filename,
                kind, path, created_at AS createdAt
         FROM attachments WHERE id = ?`,
      )
      .get(Number(info.lastInsertRowid)) as Attachment
  }

  // Everything relevant to a ticket: attachments on the ticket itself plus
  // attachments on any of its comments, in insertion order.
  listAttachments(ticketId: number): Attachment[] {
    return this.db
      .prepare(
        `SELECT id, ticket_id AS ticketId, comment_id AS commentId, filename,
                kind, path, created_at AS createdAt
         FROM attachments
         WHERE ticket_id = ?
            OR comment_id IN (SELECT id FROM comments WHERE ticket_id = ?)
         ORDER BY id ASC`,
      )
      .all(ticketId, ticketId) as Attachment[]
  }
}
