import Database from 'better-sqlite3'
import type {
  ProviderName, Agent, Attachment, AttachmentKind, Chat, ChatMessage, Column, ColumnRole, Comment,
  CommentKind, Membership, Project, Run, RunStatus, Team, Ticket, TicketKind, TicketPriority,
} from './types.js'

type TicketFields = {
  priority?: TicketPriority | null
  dueDate?: string | null
  assigneeAgentId?: number | null
  teamId?: number | null
  tags?: string[]
}

type AgentFields = {
  name?: string
  provider?: ProviderName
  model?: string
  systemPrompt?: string
  permissionLevel?: string
  archived?: boolean
}

type TeamFields = { name?: string; archived?: boolean }

type ChatFields = {
  title?: string
  archived?: boolean
  providerSessionId?: string | null
  ticketId?: number | null
}

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
export const MIGRATIONS: string[] = [
  SCHEMA,
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  // v2 → v3: ticket task-fields for the Pit UI.
  `ALTER TABLE tickets ADD COLUMN priority TEXT;
   ALTER TABLE tickets ADD COLUMN due_date TEXT;
   ALTER TABLE tickets ADD COLUMN assignee_agent_id INTEGER REFERENCES agents(id);
   ALTER TABLE tickets ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';`,
  // v3 → v4: soft-delete for agents.
  'ALTER TABLE agents ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;',
  // v4 → v5: teams as dispatch units + agent membership + ticket assignment.
  `CREATE TABLE IF NOT EXISTS teams (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE IF NOT EXISTS agent_teams (
     agent_id INTEGER NOT NULL REFERENCES agents(id),
     team_id INTEGER NOT NULL REFERENCES teams(id),
     PRIMARY KEY (agent_id, team_id)
   );
   ALTER TABLE tickets ADD COLUMN team_id INTEGER REFERENCES teams(id);`,
  // v5 → v6: brainstorm chats + spec epics.
  `CREATE TABLE IF NOT EXISTS chats (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id INTEGER NOT NULL REFERENCES projects(id),
     agent_id INTEGER NOT NULL REFERENCES agents(id),
     title TEXT NOT NULL,
     provider_session_id TEXT,
     ticket_id INTEGER REFERENCES tickets(id),
     archived INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE IF NOT EXISTS chat_messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     chat_id INTEGER NOT NULL REFERENCES chats(id),
     author TEXT NOT NULL,
     body TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   );
   ALTER TABLE tickets ADD COLUMN kind TEXT NOT NULL DEFAULT 'task';`,
  // v6 → v7: planning — child tasks link to their epic.
  'ALTER TABLE tickets ADD COLUMN parent_id INTEGER REFERENCES tickets(id);',
]

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

  createTicket(
    projectId: number, title: string, description: string,
    opts: TicketFields & { columnId?: number; kind?: TicketKind; parentId?: number } = {},
  ): Ticket {
    const columnId = opts.columnId ?? this.getColumnByRole(projectId, 'todo').id
    const info = this.db.prepare(
      `INSERT INTO tickets
         (project_id, title, description, column_id, kind, parent_id, priority, due_date, assignee_agent_id, team_id, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId, title, description, columnId, opts.kind ?? 'task', opts.parentId ?? null,
      opts.priority ?? null, opts.dueDate ?? null, opts.assigneeAgentId ?? null,
      opts.teamId ?? null, JSON.stringify(opts.tags ?? []),
    )
    return this.getTicket(Number(info.lastInsertRowid))
  }

  // ponytail: build the SET clause from the patch keys — one method, not five setters.
  updateTicketFields(
    id: number,
    patch: Partial<TicketFields & { title: string; description: string; columnId: number }>,
  ): Ticket {
    const col: Record<string, string> = {
      title: 'title', description: 'description', columnId: 'column_id',
      priority: 'priority', dueDate: 'due_date', assigneeAgentId: 'assignee_agent_id',
      teamId: 'team_id', tags: 'tags',
    }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(patch)) {
      if (!Object.hasOwn(col, k)) continue
      sets.push(`${col[k]} = ?`)
      vals.push(k === 'tags' ? JSON.stringify(v) : (v ?? null))
    }
    if (sets.length) {
      this.db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
    }
    return this.getTicket(id)
  }

  listRuns(ticketId: number): Run[] {
    return this.db.prepare(
      `SELECT id, ticket_id AS ticketId, agent_id AS agentId, status,
              tokens_in AS tokensIn, tokens_out AS tokensOut,
              duration_ms AS durationMs, diff, created_at AS createdAt
       FROM runs WHERE ticket_id = ? ORDER BY id DESC`,
    ).all(ticketId) as Run[]
  }

  private mapTicket(row: any): Ticket {
    return { ...row, tags: JSON.parse(row.tags ?? '[]') }
  }

  getTicket(id: number): Ticket {
    const row = this.db.prepare(
      `SELECT id, project_id AS projectId, title, description, column_id AS columnId,
              blocked, kind, parent_id AS parentId, priority, due_date AS dueDate, assignee_agent_id AS assigneeAgentId, team_id AS teamId, tags
       FROM tickets WHERE id = ?`,
    ).get(id)
    return this.mapTicket(row)
  }

  listTickets(projectId: number): Ticket[] {
    const rows = this.db.prepare(
      `SELECT t.id, t.project_id AS projectId, t.title, t.description, t.column_id AS columnId,
              t.blocked, t.kind, t.parent_id AS parentId, t.priority, t.due_date AS dueDate,
              t.assignee_agent_id AS assigneeAgentId, t.team_id AS teamId, t.tags,
              (SELECT COUNT(*) FROM comments c WHERE c.ticket_id = t.id) AS commentCount,
              (SELECT COUNT(*) FROM attachments a WHERE a.ticket_id = t.id) AS attachmentCount
       FROM tickets t WHERE t.project_id = ? ORDER BY t.id ASC`,
    ).all(projectId)
    return rows.map((r) => this.mapTicket(r))
  }

  countChildren(ticketId: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM tickets WHERE parent_id = ?')
      .get(ticketId) as { n: number }
    return row.n
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

  private mapAgent(row: any): Agent {
    return { ...row, archived: !!row.archived }
  }

  getAgent(id: number): Agent {
    const row = this.db
      .prepare(
        `SELECT id, name, provider, model, system_prompt AS systemPrompt,
                permission_level AS permissionLevel, archived
         FROM agents WHERE id = ?`,
      )
      .get(id)
    return this.mapAgent(row)
  }

  listAgents(): Agent[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, provider, model, system_prompt AS systemPrompt,
                permission_level AS permissionLevel, archived
         FROM agents ORDER BY id ASC`,
      )
      .all()
    return rows.map((r) => this.mapAgent(r))
  }

  updateAgent(id: number, patch: AgentFields): Agent {
    const col: Record<string, string> = {
      name: 'name', provider: 'provider', model: 'model',
      systemPrompt: 'system_prompt', permissionLevel: 'permission_level', archived: 'archived',
    }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(patch)) {
      if (!Object.hasOwn(col, k)) continue
      sets.push(`${col[k]} = ?`)
      vals.push(k === 'archived' ? (v ? 1 : 0) : v)
    }
    if (sets.length) {
      this.db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
    }
    return this.getAgent(id)
  }

  private mapTeam(row: any): Team {
    return { ...row, archived: !!row.archived }
  }

  createTeam(name: string): Team {
    const info = this.db.prepare('INSERT INTO teams (name) VALUES (?)').run(name)
    return this.getTeam(Number(info.lastInsertRowid))
  }

  getTeam(id: number): Team {
    const row = this.db.prepare('SELECT id, name, archived FROM teams WHERE id = ?').get(id)
    return this.mapTeam(row)
  }

  listTeams(): Team[] {
    const rows = this.db.prepare('SELECT id, name, archived FROM teams ORDER BY id ASC').all()
    return rows.map((r) => this.mapTeam(r))
  }

  updateTeam(id: number, patch: TeamFields): Team {
    const col: Record<string, string> = { name: 'name', archived: 'archived' }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(patch)) {
      if (!Object.hasOwn(col, k)) continue
      sets.push(`${col[k]} = ?`)
      vals.push(k === 'archived' ? (v ? 1 : 0) : v)
    }
    if (sets.length) {
      this.db.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
    }
    return this.getTeam(id)
  }

  listMemberships(): Membership[] {
    return this.db
      .prepare('SELECT agent_id AS agentId, team_id AS teamId FROM agent_teams ORDER BY team_id ASC, agent_id ASC')
      .all() as Membership[]
  }

  setAgentTeams(agentId: number, teamIds: number[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM agent_teams WHERE agent_id = ?').run(agentId)
      const ins = this.db.prepare('INSERT INTO agent_teams (agent_id, team_id) VALUES (?, ?)')
      for (const t of teamIds) ins.run(agentId, t)
    })()
  }

  private mapChat(row: any): Chat {
    return { ...row, archived: !!row.archived }
  }

  createChat(projectId: number, agentId: number, title: string): Chat {
    const info = this.db
      .prepare('INSERT INTO chats (project_id, agent_id, title) VALUES (?, ?, ?)')
      .run(projectId, agentId, title)
    return this.getChat(Number(info.lastInsertRowid))
  }

  getChat(id: number): Chat {
    const row = this.db
      .prepare(
        `SELECT id, project_id AS projectId, agent_id AS agentId, title,
                provider_session_id AS providerSessionId, ticket_id AS ticketId, archived
         FROM chats WHERE id = ?`,
      )
      .get(id)
    return this.mapChat(row)
  }

  // Newest first: the active brainstorm is almost always the latest one.
  listChats(projectId: number): Chat[] {
    const rows = this.db
      .prepare(
        `SELECT id, project_id AS projectId, agent_id AS agentId, title,
                provider_session_id AS providerSessionId, ticket_id AS ticketId, archived
         FROM chats WHERE project_id = ? ORDER BY id DESC`,
      )
      .all(projectId)
    return rows.map((r) => this.mapChat(r))
  }

  updateChat(id: number, patch: ChatFields): Chat {
    const col: Record<string, string> = {
      title: 'title', archived: 'archived',
      providerSessionId: 'provider_session_id', ticketId: 'ticket_id',
    }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(patch)) {
      if (!Object.hasOwn(col, k)) continue
      sets.push(`${col[k]} = ?`)
      vals.push(k === 'archived' ? (v ? 1 : 0) : (v ?? null))
    }
    if (sets.length) {
      this.db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
    }
    return this.getChat(id)
  }

  addChatMessage(chatId: number, author: string, body: string): ChatMessage {
    const info = this.db
      .prepare('INSERT INTO chat_messages (chat_id, author, body) VALUES (?, ?, ?)')
      .run(chatId, author, body)
    return this.db
      .prepare(
        `SELECT id, chat_id AS chatId, author, body, created_at AS createdAt
         FROM chat_messages WHERE id = ?`,
      )
      .get(Number(info.lastInsertRowid)) as ChatMessage
  }

  listChatMessages(chatId: number): ChatMessage[] {
    return this.db
      .prepare(
        `SELECT id, chat_id AS chatId, author, body, created_at AS createdAt
         FROM chat_messages WHERE chat_id = ? ORDER BY id ASC`,
      )
      .all(chatId) as ChatMessage[]
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

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value)
  }
}
