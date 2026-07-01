import { useCallback, useEffect, useState } from 'react'
import type { Agent, Column, Run, Ticket } from '../../core/types'
import { api } from './api'

export function Board({ projectId }: { projectId: number }) {
  const [columns, setColumns] = useState<Column[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [busyTicketId, setBusyTicketId] = useState<number | null>(null)
  const [results, setResults] = useState<Record<number, string>>({})

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

  async function dispatchTicket(ticketId: number, agentId: number) {
    setBusyTicketId(ticketId)
    setResults((r) => {
      const n = { ...r }
      delete n[ticketId]
      return n
    })
    try {
      const run: Run = await api.dispatch(ticketId, agentId)
      const secs = (run.durationMs / 1000).toFixed(1)
      setResults((r) => ({ ...r, [ticketId]: `${run.status} · ${run.tokensIn + run.tokensOut} tok · ${secs}s` }))
    } catch (e) {
      setResults((r) => ({ ...r, [ticketId]: `error: ${e instanceof Error ? e.message : String(e)}` }))
    } finally {
      setBusyTicketId(null)
      refresh()
    }
  }

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
                <TicketCard
                  key={t.id}
                  ticket={t}
                  columns={columns}
                  agents={agents}
                  busy={busyTicketId === t.id}
                  result={results[t.id] ?? null}
                  onDispatch={dispatchTicket}
                  onChanged={refresh}
                />
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
  busy,
  result,
  onDispatch,
  onChanged,
}: {
  ticket: Ticket
  columns: Column[]
  agents: Agent[]
  busy: boolean
  result: string | null
  onDispatch: (ticketId: number, agentId: number) => void
  onChanged: () => void
}) {
  const [agentId, setAgentId] = useState<number | ''>(agents[0]?.id ?? '')

  async function move(columnId: number) {
    await api.moveTicket(ticket.id, columnId)
    onChanged()
  }

  return (
    <div className={`card${busy ? ' busy' : ''}`}>
      <div className="card-title">
        {ticket.title}
        {ticket.blocked ? <span className="badge">blocked</span> : null}
      </div>
      {ticket.description && <div className="card-desc">{ticket.description}</div>}
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
        <button
          onClick={() => {
            if (agentId !== '') onDispatch(ticket.id, Number(agentId))
          }}
          disabled={busy || agentId === ''}
        >
          {busy ? 'Running…' : 'Dispatch'}
        </button>
      </div>
      {result && <div className="card-result">{result}</div>}
    </div>
  )
}
