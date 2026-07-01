import { useCallback, useEffect, useState } from 'react'
import type { Column, Ticket } from '../../core/types'
import { api } from './api'

export function Board({ projectId }: { projectId: number }) {
  const [columns, setColumns] = useState<Column[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])

  const refresh = useCallback(async () => {
    const [cols, tks] = await Promise.all([api.listColumns(projectId), api.listTickets(projectId)])
    setColumns(cols)
    setTickets(tks)
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
                <TicketCard key={t.id} ticket={t} columns={columns} onChanged={refresh} />
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
  onChanged,
}: {
  ticket: Ticket
  columns: Column[]
  onChanged: () => void
}) {
  async function move(columnId: number) {
    await api.moveTicket(ticket.id, columnId)
    onChanged()
  }
  return (
    <div className="card">
      <div className="card-title">
        {ticket.title}
        {ticket.blocked ? <span className="badge">blocked</span> : null}
      </div>
      <div className="card-controls">
        <label>
          Move
          <select value={ticket.columnId} onChange={(e) => move(Number(e.target.value))}>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {/* Dispatch control added in Task 6 */}
      </div>
    </div>
  )
}
