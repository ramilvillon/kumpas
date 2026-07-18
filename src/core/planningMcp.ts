import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { Db } from './db.js'

// SECURITY: this is a localhost HTTP server, reachable by any local process
// while it runs. Three fences: a per-run random bearer token, 127.0.0.1-only
// binding, and a tool that can ONLY create child tasks of one epic assigned
// to one team. It lives exactly as long as one planning creation turn.

export interface PlanningScope {
  projectId: number
  epicId: number
  teamId: number
  members: { id: number; name: string }[] // active members of the chosen team
}

export interface PlanningServer {
  url: string
  token: string
  toolName: string
  close(): void
}

const TOOL = {
  name: 'create_task',
  description:
    'Create one child task ticket of the epic being planned. Call once per vertical task in the agreed plan.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'short task title' },
      description: { type: 'string', description: 'what to build and how to verify it' },
      assignee: { type: 'string', description: 'exact name of the team member to assign' },
    },
    required: ['title', 'description', 'assignee'],
  },
}

const rpcResult = (id: unknown, result: unknown) => JSON.stringify({ jsonrpc: '2.0', id, result })
const rpcError = (id: unknown, code: number, message: string) =>
  JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
// Tool errors go back as results with isError so the model reads them and self-corrects.
const toolError = (id: unknown, text: string) =>
  rpcResult(id, { content: [{ type: 'text', text }], isError: true })

export function startPlanningServer(db: Db, scope: PlanningScope): Promise<PlanningServer> {
  const token = randomUUID()

  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    let body = ''
    req.on('data', (c) => { body += c; if (body.length > 1_000_000) req.destroy() })
    req.on('end', () => {
      let msg: any
      try {
        msg = JSON.parse(body)
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
          .end(rpcError(null, -32700, 'parse error'))
        return
      }
      if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
        res.writeHead(400, { 'content-type': 'application/json' })
          .end(rpcError(null, -32600, 'invalid request'))
        return
      }
      if (msg.id === undefined || msg.id === null) {
        res.writeHead(202).end() // notification (e.g. notifications/initialized)
        return
      }
      const reply = (payload: string) =>
        res.writeHead(200, { 'content-type': 'application/json' }).end(payload)

      switch (msg.method) {
        case 'initialize':
          reply(rpcResult(msg.id, {
            protocolVersion: msg.params?.protocolVersion ?? '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'kumpas', version: '1.0.0' },
          }))
          return
        case 'tools/list':
          reply(rpcResult(msg.id, { tools: [TOOL] }))
          return
        case 'tools/call': {
          if (msg.params?.name !== TOOL.name) {
            reply(rpcError(msg.id, -32602, `unknown tool: ${msg.params?.name}`))
            return
          }
          const a = msg.params?.arguments ?? {}
          const title = typeof a.title === 'string' ? a.title.trim() : ''
          const description = typeof a.description === 'string' ? a.description.trim() : ''
          const assignee = typeof a.assignee === 'string' ? a.assignee.trim() : ''
          if (!title || !description) {
            reply(toolError(msg.id, 'title and description must be non-empty'))
            return
          }
          const member = scope.members.find((m) => m.name === assignee)
          if (!member) {
            reply(toolError(
              msg.id,
              `unknown assignee '${assignee}' — valid team members: ${scope.members.map((m) => m.name).join(', ')}`,
            ))
            return
          }
          const t = db.createTicket(scope.projectId, title, description, {
            kind: 'task', parentId: scope.epicId, teamId: scope.teamId, assigneeAgentId: member.id,
          })
          reply(rpcResult(msg.id, { content: [{ type: 'text', text: `created ticket #${t.id}: ${t.title}` }] }))
          return
        }
        default:
          reply(rpcError(msg.id, -32601, `method not found: ${msg.method}`))
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        token,
        toolName: `mcp__kumpas__${TOOL.name}`,
        // closeAllConnections kills idle keep-alive sockets too, so a fetch
        // after close() reliably fails instead of reusing a pooled socket.
        close: () => { server.closeAllConnections(); server.close() },
      })
    })
  })
}
