import { useCallback, useEffect, useState } from 'react'
import type { Agent, Column, Run, Ticket } from '../../core/types'
import { api } from './api'

export function Board({ projectId }: { projectId: number }) {
  const [columns, setColumns] = useState<Column[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [agents, setAgents] = useState<Agent[]>([])

  const refresh = useCallback(async () => {
    const [cols, tks, ags] = await Promise.all([
      api.listColumns(projectId),
      api.listTickets(projectId),
      api.listAgents(),
    ])
    setColumns(cols)
    setTickets(tks)
    setAgents(ags)
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="board">
      <NewTicketForm projectId={projectId} onCreated={refresh} />
      <div className="columns">
        {columns.map((col) => (
          <div className="column" key={col.id}>
            <h3>{col.name}</h3>
            {tickets
              .filter((t) => t.columnId === col.id)
              .map((t) => (
                <TicketCard key={t.id} ticket={t} columns={columns} agents={agents} onChanged={refresh} />
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function NewTicketForm({ projectId, onCreated }: { projectId: number; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    await api.createTicket(projectId, title.trim(), description.trim())
    setTitle('')
    setDescription('')
    onCreated()
  }

  return (
    <form className="new-ticket" onSubmit={submit}>
      <input placeholder="New ticket title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <button type="submit">Add</button>
    </form>
  )
}

function TicketCard({
  ticket,
  columns,
  agents,
  onChanged,
}: {
  ticket: Ticket
  columns: Column[]
  agents: Agent[]
  onChanged: () => void
}) {
  const [agentId, setAgentId] = useState<number | ''>(agents[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function move(columnId: number) {
    await api.moveTicket(ticket.id, columnId)
    onChanged()
  }

  async function dispatch() {
    if (agentId === '') return
    setBusy(true)
    setResult(null)
    try {
      const run = await api.dispatch(ticket.id, Number(agentId))
      const secs = (run.durationMs / 1000).toFixed(1)
      setResult(`${run.status} · ${run.tokensIn + run.tokensOut} tok · ${secs}s`)
    } catch (e) {
      setResult(`error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  return (
    <div className={`card${busy ? ' busy' : ''}`}>
      <div className="card-title">
        {ticket.title}
        {ticket.blocked ? <span className="badge">blocked</span> : null}
      </div>
      <div className="card-controls">
        <label>
          Move
          <select value={ticket.columnId} onChange={(e) => move(Number(e.target.value))} disabled={busy}>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agent
          <select value={agentId} onChange={(e) => setAgentId(Number(e.target.value))} disabled={busy}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={dispatch} disabled={busy || agentId === ''}>
          {busy ? 'Running…' : 'Dispatch'}
        </button>
      </div>
      {result && <div className="card-result">{result}</div>}
    </div>
  )
}
