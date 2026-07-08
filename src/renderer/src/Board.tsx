import { useCallback, useEffect, useState } from 'react'
import type { Agent, Column, Run, Ticket } from '../../core/types'
import { api } from './api'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NewTaskModal } from './NewTaskModal'
import { hue, initials } from './lib/visuals'

/** Format ISO YYYY-MM-DD → "Jul 20" (UTC, no dep needed) */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function Board({ projectId }: { projectId: number }) {
  const [columns, setColumns] = useState<Column[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [busyTicketId, setBusyTicketId] = useState<number | null>(null)
  const [results, setResults] = useState<Record<number, string>>({})
  const [openTicketId, setOpenTicketId] = useState<number | null>(null)
  const [newTaskOpen, setNewTaskOpen] = useState(false)

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
      setResults((r) => ({
        ...r,
        [ticketId]: `${run.status} · ${run.tokensIn + run.tokensOut} tok · ${secs}s`,
      }))
    } catch (e) {
      setResults((r) => ({
        ...r,
        [ticketId]: `error: ${e instanceof Error ? e.message : String(e)}`,
      }))
    } finally {
      setBusyTicketId(null)
      refresh()
    }
  }

  const openTicket = tickets.find((t) => t.id === openTicketId) ?? null

  return (
    <div className="flex h-full flex-col px-[22px] py-5">
      {/* Tabs-lite row */}
      <div className="mb-[18px] flex items-baseline justify-between border-b border-border">
        <span
          className="pb-[9px] text-[13px] text-foreground"
          style={{ boxShadow: 'inset 0 -2px 0 var(--primary)' }}
        >
          Tasks
        </span>
        <Button
          onClick={() => setNewTaskOpen(true)}
          className="mb-[9px] inline-flex items-center gap-[7px]"
        >
          <span className="text-[15px] leading-none">＋</span> New task
        </Button>
      </div>

      {/* Columns */}
      <div className="flex flex-1 items-start gap-3.5 overflow-x-auto">
        {columns.map((col) => {
          const colTickets = tickets.filter((t) => t.columnId === col.id)
          return (
            <div key={col.id} className="min-w-52 flex-1">
              {/* Column header */}
              <div className="flex items-center gap-2 px-1 pb-2.5 pt-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                  {col.name}
                </span>
                <span className="rounded-full bg-card px-[7px] py-px font-mono text-[11px] text-muted-foreground">
                  {colTickets.length}
                </span>
              </div>
              {/* Cards */}
              {colTickets.map((t) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  agents={agents}
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
      <NewTaskModal
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        projectId={projectId}
        columns={columns}
        agents={agents}
        onCreated={() => {
          setNewTaskOpen(false)
          refresh()
        }}
      />
    </div>
  )
}

function TicketCard({
  ticket,
  agents,
  busy,
  result,
  onOpen,
}: {
  ticket: Ticket
  agents: Agent[]
  busy: boolean
  result: string | null
  onOpen: () => void
}) {
  const assignee = agents.find((a) => a.id === ticket.assigneeAgentId)
  const hasChips = ticket.tags.length > 0 || ticket.priority != null

  return (
    <div
      onClick={onOpen}
      className={`mb-2.5 cursor-pointer rounded-[10px] border border-border bg-card p-3 transition-colors hover:border-ring/40 ${busy ? 'card-running' : ''}`}
    >
      {/* Tag + priority chips */}
      {hasChips && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {ticket.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full px-2 py-0.5 text-[10.5px] font-medium tracking-[0.02em]"
              style={{
                background: `hsla(${hue(tag)}, 55%, 50%, 0.18)`,
                color: `hsl(${hue(tag)}, 60%, 65%)`,
              }}
            >
              {tag}
            </span>
          ))}
          {ticket.priority === 'high' && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
              style={{ background: 'rgba(214,84,60,.14)', color: '#e5836f' }}
            >
              ◆ High
            </span>
          )}
          {ticket.priority === 'medium' && (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
              Medium
            </span>
          )}
          {ticket.priority === 'low' && (
            <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground/70">
              Low
            </span>
          )}
        </div>
      )}

      {/* Title */}
      <h3 className="mb-2.5 text-[13.5px] font-medium leading-[1.35]">{ticket.title}</h3>

      {/* Card footer */}
      <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
        {/* Assignee avatar */}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-[9.5px] font-semibold">
          {assignee ? initials(assignee.name) : '·'}
        </span>
        {/* Due date */}
        {ticket.dueDate && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px]">
            📅 {fmtDate(ticket.dueDate)}
          </span>
        )}
        {/* Spacer */}
        <span className="ml-auto" />
        {/* Attachment count */}
        {(ticket.attachmentCount ?? 0) > 0 && (
          <span className="inline-flex items-center gap-[3px] font-mono">
            📎 {ticket.attachmentCount}
          </span>
        )}
        {/* Comment count */}
        {(ticket.commentCount ?? 0) > 0 && (
          <span className="inline-flex items-center gap-[3px] font-mono">
            💬 {ticket.commentCount}
          </span>
        )}
      </div>

      {/* Run result (post-dispatch) */}
      {result && (
        <div className="mt-1.5 truncate text-xs text-muted-foreground">{result}</div>
      )}
    </div>
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
  const ticketId = ticket?.id
  useEffect(() => {
    setAgentId(null)
  }, [ticketId])
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
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {ticket.description}
                </p>
              )}
              {result && <div className="rounded-md bg-muted p-2 text-xs">{result}</div>}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
