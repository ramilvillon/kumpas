import { useCallback, useEffect, useState } from 'react'
import type { Agent, Column, Run, Ticket } from '../../core/types'
import { api } from './api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

export function Board({ projectId }: { projectId: number }) {
  const [columns, setColumns] = useState<Column[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [busyTicketId, setBusyTicketId] = useState<number | null>(null)
  const [results, setResults] = useState<Record<number, string>>({})
  const [openTicketId, setOpenTicketId] = useState<number | null>(null)

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

  const openTicket = tickets.find((t) => t.id === openTicketId) ?? null

  return (
    <div className="flex h-full flex-col gap-4">
      <NewTicketForm projectId={projectId} onCreated={refresh} />
      <div className="flex flex-1 items-start gap-4 overflow-x-auto">
        {columns.map((col) => {
          const colTickets = tickets.filter((t) => t.columnId === col.id)
          return (
            <div key={col.id} className="flex min-w-56 flex-1 flex-col gap-2 rounded-xl bg-muted/50 p-3">
              <div className="flex items-center gap-2 px-1 pb-1">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {col.name}
                </h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {colTickets.length}
                </span>
              </div>
              {colTickets.map((t) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  busy={busyTicketId === t.id}
                  result={results[t.id] ?? null}
                  onOpen={() => setOpenTicketId(t.id)}
                />
              ))}
            </div>
          )
        })}
      </div>
      <TicketDrawer
        ticket={openTicket}
        columns={columns}
        agents={agents}
        busy={openTicket !== null && busyTicketId === openTicket.id}
        result={openTicket ? (results[openTicket.id] ?? null) : null}
        onDispatch={dispatchTicket}
        onChanged={refresh}
        onClose={() => setOpenTicketId(null)}
      />
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
    <form className="flex gap-2" onSubmit={submit}>
      <Input
        placeholder="New ticket title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="max-w-xs"
      />
      <Input
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="flex-1"
      />
      <Button type="submit">Add</Button>
    </form>
  )
}

function TicketCard({
  ticket,
  busy,
  result,
  onOpen,
}: {
  ticket: Ticket
  busy: boolean
  result: string | null
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      className={`w-full rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-ring/60 ${
        busy ? 'opacity-60' : ''
      }`}
    >
      {ticket.blocked ? (
        <Badge variant="destructive" className="mb-1">
          blocked
        </Badge>
      ) : null}
      <div className="text-sm font-medium leading-snug">{ticket.title}</div>
      {(busy || result) && (
        <div className="mt-1.5 truncate text-xs text-muted-foreground">{busy ? 'Running…' : result}</div>
      )}
    </button>
  )
}

function TicketDrawer({
  ticket,
  columns,
  agents,
  busy,
  result,
  onDispatch,
  onChanged,
  onClose,
}: {
  ticket: Ticket | null
  columns: Column[]
  agents: Agent[]
  busy: boolean
  result: string | null
  onDispatch: (ticketId: number, agentId: number) => void
  onChanged: () => void
  onClose: () => void
}) {
  const [agentId, setAgentId] = useState<number | null>(null)
  const chosenAgentId = agentId ?? agents[0]?.id ?? null

  async function move(columnId: number) {
    if (!ticket) return
    await api.moveTicket(ticket.id, columnId)
    onChanged()
  }

  return (
    <Sheet
      open={ticket !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-md">
        {ticket && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 pr-6">
                {ticket.title}
                {ticket.blocked ? <Badge variant="destructive">blocked</Badge> : null}
              </SheetTitle>
            </SheetHeader>
            <div className="grid gap-4 px-4">
              <div className="grid grid-cols-[80px_1fr] items-center gap-x-2 gap-y-3 text-sm">
                <span className="text-muted-foreground">Status</span>
                <Select
                  value={String(ticket.columnId)}
                  onValueChange={(v) => move(Number(v))}
                  disabled={busy}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">Agent</span>
                <Select
                  value={chosenAgentId === null ? undefined : String(chosenAgentId)}
                  onValueChange={(v) => setAgentId(Number(v))}
                  disabled={busy}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => {
                  if (chosenAgentId !== null) onDispatch(ticket.id, chosenAgentId)
                }}
                disabled={busy || chosenAgentId === null}
              >
                {busy ? 'Running…' : 'Dispatch'}
              </Button>
              {ticket.description && (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{ticket.description}</p>
              )}
              {result && <div className="rounded-md bg-muted p-2 text-xs">{result}</div>}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
