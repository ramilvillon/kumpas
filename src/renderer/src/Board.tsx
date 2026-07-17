import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Agent, Column, Run, Team, Ticket } from '../../core/types'
import { api } from './api'
import { Button } from '@/components/ui/button'
import { NewTaskModal } from './NewTaskModal'
import { TicketDrawer } from './TicketDrawer'
import { hue, initials } from './lib/visuals'
import { AgentsPane } from './AgentsView'
import { ChatsPane } from './ChatsView'

export type MainTab = 'tasks' | 'agents' | 'chats'

/** Format ISO YYYY-MM-DD → "Jul 20" (UTC, no dep needed) */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function Board({
  projectId,
  sidebarToggle,
  mainTab,
  agentsOpen,
  onSelectTab,
  onCloseAgents,
}: {
  projectId: number
  sidebarToggle?: ReactNode
  mainTab: MainTab
  agentsOpen: boolean
  onSelectTab: (t: MainTab) => void
  onCloseAgents: () => void
}) {
  const [columns, setColumns] = useState<Column[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [busyTicketId, setBusyTicketId] = useState<number | null>(null)
  const [results, setResults] = useState<Record<number, string>>({})
  const [openTicketId, setOpenTicketId] = useState<number | null>(null)
  const [newTaskOpen, setNewTaskOpen] = useState(false)

  const refresh = useCallback(async () => {
    const [cols, tks, ags, tms] = await Promise.all([
      api.listColumns(projectId),
      api.listTickets(projectId),
      api.listAgents(),
      api.listTeams(),
    ])
    setColumns(cols)
    setTickets(tks)
    setAgents(ags)
    setTeams(tms)
  }, [projectId])

  // Archived agents are filtered out of picker/dispatch OPTIONS only; display
  // (assignee avatar/select value) always uses the full `agents` list so an
  // archived assignee still shows up on tickets it's already assigned to.
  const activeAgents = agents.filter((a) => !a.archived)
  const activeTeams = teams.filter((t) => !t.archived)

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
      <div className="mb-[18px] flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-[9px]">
          {sidebarToggle}
          <button
            onClick={() => onSelectTab('tasks')}
            className={`font-display self-end pb-[9px] text-[12px] tracking-[0.08em] ${
              mainTab === 'tasks' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            style={mainTab === 'tasks' ? { boxShadow: 'inset 0 -2px 0 var(--primary)' } : undefined}
          >
            Tasks
          </button>
          <button
            onClick={() => onSelectTab('chats')}
            className={`font-display self-end pb-[9px] text-[12px] tracking-[0.08em] ${
              mainTab === 'chats' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            style={mainTab === 'chats' ? { boxShadow: 'inset 0 -2px 0 var(--primary)' } : undefined}
          >
            Chats
          </button>
          {agentsOpen && (
            <span
              className={`font-display flex items-center gap-1 self-end pb-[9px] text-[12px] tracking-[0.08em] ${
                mainTab === 'agents' ? 'text-foreground' : 'text-muted-foreground'
              }`}
              style={mainTab === 'agents' ? { boxShadow: 'inset 0 -2px 0 var(--primary)' } : undefined}
            >
              <button onClick={() => onSelectTab('agents')} className="hover:text-foreground">
                Agents
              </button>
              <button
                onClick={onCloseAgents}
                aria-label="Close agents tab"
                className="rounded px-1 text-[11px] text-muted-foreground hover:bg-card hover:text-foreground"
              >
                ✕
              </button>
            </span>
          )}
        </div>
        {mainTab === 'tasks' && (
          <Button
            onClick={() => setNewTaskOpen(true)}
            className="mb-[9px] inline-flex items-center gap-[7px]"
          >
            <span className="text-[15px] leading-none">＋</span> New task
          </Button>
        )}
      </div>

      {mainTab === 'agents' ? (
        <AgentsPane onChanged={refresh} />
      ) : mainTab === 'chats' ? (
        <ChatsPane projectId={projectId} onChanged={refresh} />
      ) : (
        <div className="flex flex-1 items-start gap-3.5 overflow-x-auto">
          {columns.map((col) => {
            const colTickets = tickets.filter((t) => t.columnId === col.id)
            return (
              <div key={col.id} className="min-w-52 flex-1">
                {/* Column header */}
                <div className="flex items-center gap-2 px-1 pb-2.5 pt-0.5">
                  <span className="font-display text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
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
                    teams={teams}
                    busy={busyTicketId === t.id}
                    result={results[t.id] ?? null}
                    onOpen={() => setOpenTicketId(t.id)}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}

      <TicketDrawer
        ticket={openTicket}
        columns={columns}
        agents={agents}
        teams={teams}
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
        agents={activeAgents}
        teams={activeTeams}
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
  teams,
  busy,
  result,
  onOpen,
}: {
  ticket: Ticket
  agents: Agent[]
  teams: Team[]
  busy: boolean
  result: string | null
  onOpen: () => void
}) {
  const assignee = agents.find((a) => a.id === ticket.assigneeAgentId)
  const team = teams.find((t) => t.id === ticket.teamId)
  const hasChips = ticket.tags.length > 0 || ticket.priority != null

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      className={`mb-2.5 cursor-pointer rounded-[10px] border border-border bg-card p-3 transition-colors hover:border-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${busy ? 'card-running' : ''}`}
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
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10.5px] font-medium text-destructive">
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
        {ticket.kind === 'epic' && (
          <span className="font-display rounded-[5px] bg-primary/10 px-[7px] py-[3px] text-[8px] uppercase tracking-[0.06em] text-primary">
            EPIC
          </span>
        )}
        {team && (
          <span className="font-display rounded-[5px] bg-primary/10 px-[7px] py-[3px] text-[8px] uppercase tracking-[0.06em] text-primary">
            {team.name}
          </span>
        )}
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

      {/* In-flight feedback + post-dispatch result */}
      {busy && (
        <div className="mt-1.5 truncate text-xs text-muted-foreground">Running…</div>
      )}
      {result && (
        <div className="mt-1.5 truncate text-xs text-muted-foreground">{result}</div>
      )}
    </div>
  )
}

