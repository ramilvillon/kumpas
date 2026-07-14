import { useCallback, useEffect, useState } from 'react'
import type { Agent, Membership, Team } from '../../core/types'
import { api } from './api'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const KNOWN_MODELS = ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001']

const PERMISSION_OPTIONS = [
  { value: 'read', label: 'read — plan only, no file changes' },
  { value: 'edit', label: 'edit — may edit files, asks before commands' },
  { value: 'auto', label: 'auto — edits and runs commands unattended' },
]

const fieldLabel = 'font-display text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70'
const inputCls =
  'w-full rounded-lg border border-border bg-background px-2.5 py-[7px] text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-primary'

function permChip(level: string): string {
  if (level === 'auto') return 'bg-destructive/15 text-destructive'
  if (level === 'edit') return 'bg-primary/10 text-primary'
  return 'bg-secondary text-muted-foreground'
}

function AgentCard({
  agent,
  onEdit,
  onRestore,
}: {
  agent: Agent
  onEdit: (a: Agent) => void
  onRestore?: (a: Agent) => void
}) {
  return (
    <button
      onClick={() => onEdit(agent)}
      className={`flex w-full flex-col items-start gap-2 rounded-[10px] border border-border bg-card p-4 text-left transition-colors hover:border-primary/45 ${
        agent.archived ? 'opacity-55 hover:opacity-80' : ''
      }`}
    >
      <span className="font-display text-[13px] tracking-[0.08em]">{agent.name}</span>
      <span className="w-full truncate font-mono text-[11px] text-muted-foreground">
        {agent.provider} / {agent.model}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className={`font-display rounded-[5px] px-[7px] py-[3px] text-[8px] uppercase tracking-[0.06em] ${permChip(agent.permissionLevel)}`}
        >
          {agent.permissionLevel}
        </span>
        {agent.archived && (
          <span className="font-display rounded-[5px] bg-secondary px-[7px] py-[3px] text-[8px] uppercase tracking-[0.06em] text-muted-foreground">
            archived
          </span>
        )}
      </span>
      {agent.archived && onRestore && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onRestore(agent)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onRestore(agent)
            }
          }}
          className="font-display rounded-md border border-border px-2 py-1 text-[9px] uppercase tracking-[0.08em] text-primary hover:border-primary"
        >
          Restore
        </span>
      )}
    </button>
  )
}

function TeamCard({
  team,
  memberCount,
  onEdit,
  onRestore,
}: {
  team: Team
  memberCount: number
  onEdit: (t: Team) => void
  onRestore?: (t: Team) => void
}) {
  return (
    <button
      onClick={() => onEdit(team)}
      className={`flex w-full items-center gap-2.5 rounded-[10px] border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/45 ${
        team.archived ? 'opacity-55 hover:opacity-80' : ''
      }`}
    >
      <span className="font-display text-[13px] tracking-[0.08em]">{team.name}</span>
      <span className="rounded-full bg-secondary px-[7px] py-px font-mono text-[10px] text-muted-foreground">
        {memberCount}
      </span>
      {team.archived && (
        <span className="font-display rounded-[5px] bg-secondary px-[7px] py-[3px] text-[8px] uppercase tracking-[0.06em] text-muted-foreground">
          archived
        </span>
      )}
      {team.archived && onRestore && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onRestore(team)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onRestore(team)
            }
          }}
          className="font-display ml-auto rounded-md border border-border px-2 py-1 text-[9px] uppercase tracking-[0.08em] text-primary hover:border-primary"
        >
          Restore
        </span>
      )}
    </button>
  )
}

function TeamDrawer({
  team,
  open,
  onClose,
  onSaved,
}: {
  team: Team | null // null = create
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(team?.name ?? '')
    setConfirming(false)
    setBusy(false)
    setError(null)
  }, [open, team])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(() => (team ? api.updateTeam(team.id, { name }) : api.createTeam({ name })))
  const archive = () => run(() => api.updateTeam(team!.id, { archived: true }))

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-[400px] flex-col gap-0 bg-card p-0 sm:max-w-[400px]"
      >
        <div className="flex h-full flex-col overflow-hidden">
          <div className="flex items-center border-b border-border px-[18px] py-[14px]">
            <span className="font-display text-[12px] tracking-[0.08em]">
              {team ? 'Edit team' : 'New team'}
            </span>
            <button
              onClick={onClose}
              className="ml-auto text-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-[18px] py-4">
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
                placeholder="Backend"
              />
            </label>
            <span className="text-[10px] text-muted-foreground">
              Assign agents to this team from each agent's drawer. Tickets pointed at a team will
              feed auto-dispatch in a future batch.
            </span>
          </div>

          <div className="border-t border-border px-[18px] py-3.5">
            {error && <div className="mb-2 text-xs text-destructive">{error}</div>}
            {confirming ? (
              <div className="flex items-center gap-2.5">
                <span className="flex-1 text-[11.5px] leading-snug text-destructive">
                  Archive this team? Its tickets and members keep their references; it disappears
                  from pickers.
                </span>
                <Button variant="outline" size="sm" disabled={busy} onClick={archive}>
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                {team && !team.archived && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirming(true)}
                  >
                    Archive
                  </Button>
                )}
                <Button className="ml-auto" disabled={busy || !name.trim()} onClick={save}>
                  {busy ? 'Saving…' : 'Save'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function AgentDrawer({
  agent,
  teams,
  initialTeamIds,
  open,
  onClose,
  onSaved,
}: {
  agent: Agent | null // null = create
  teams: Team[]
  initialTeamIds: number[]
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [permissionLevel, setPermissionLevel] = useState('read')
  const [teamIds, setTeamIds] = useState<number[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(agent?.name ?? '')
    setModel(agent?.model ?? '')
    setSystemPrompt(agent?.systemPrompt ?? '')
    setPermissionLevel(agent?.permissionLevel ?? 'read')
    setTeamIds(initialTeamIds)
    setConfirming(false)
    setBusy(false)
    setError(null)
  }, [open, agent])

  // Active teams are selectable; archived teams the agent already belongs to
  // render checked+disabled (same display-truth seam as archived assignees).
  const selectableTeams = teams.filter((t) => !t.archived || initialTeamIds.includes(t.id))

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      const saved = agent
        ? await api.updateAgent(agent.id, { name, model, systemPrompt, permissionLevel })
        : await api.createAgent({ name, provider: 'claude', model, systemPrompt, permissionLevel })
      await api.setAgentTeams(saved.id, teamIds)
    })

  const archive = () => run(() => api.updateAgent(agent!.id, { archived: true }))

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-[400px] flex-col gap-0 bg-card p-0 sm:max-w-[400px]"
      >
        <div className="flex h-full flex-col overflow-hidden">
          {/* Top bar */}
          <div className="flex items-center border-b border-border px-[18px] py-[14px]">
            <span className="font-display text-[12px] tracking-[0.08em]">
              {agent ? 'Edit agent' : 'New agent'}
            </span>
            <button
              onClick={onClose}
              className="ml-auto text-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Form */}
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-[18px] py-4">
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
                placeholder="Developer"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Provider</span>
              <Select value="claude" onValueChange={() => {}}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">claude</SelectItem>
                  <SelectItem value="agy" disabled>
                    agy — coming soon
                  </SelectItem>
                  <SelectItem value="codex" disabled>
                    codex — coming soon
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Model</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                list="kumpas-known-models"
                className={inputCls}
                placeholder="claude-sonnet-5"
              />
              <datalist id="kumpas-known-models">
                {KNOWN_MODELS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <span className="text-[10px] text-muted-foreground">
                Free text — new models don't need an app update.
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>System prompt</span>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={5}
                className={`${inputCls} resize-y leading-relaxed`}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Permission level</span>
              <Select value={permissionLevel} onValueChange={setPermissionLevel}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERMISSION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[10px] text-muted-foreground">
                Bypass is never offered; the main process rejects anything else.
              </span>
            </label>

            <div className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Teams</span>
              {selectableTeams.length === 0 && (
                <span className="text-[10px] text-muted-foreground">
                  No teams yet — create one with + New team.
                </span>
              )}
              {selectableTeams.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    disabled={t.archived}
                    checked={teamIds.includes(t.id)}
                    onChange={(e) =>
                      setTeamIds((prev) =>
                        e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id),
                      )
                    }
                    className="accent-[var(--primary)]"
                  />
                  {t.name}
                  {t.archived ? ' (archived)' : ''}
                </label>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-border px-[18px] py-3.5">
            {error && <div className="mb-2 text-xs text-destructive">{error}</div>}
            {confirming ? (
              <div className="flex items-center gap-2.5">
                <span className="flex-1 text-[11.5px] leading-snug text-destructive">
                  Archive this agent? It disappears from pickers; history stays.
                </span>
                <Button variant="outline" size="sm" disabled={busy} onClick={archive}>
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                {agent && !agent.archived && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirming(true)}
                  >
                    Archive
                  </Button>
                )}
                <Button className="ml-auto" disabled={busy || !name.trim() || !model.trim()} onClick={save}>
                  {busy ? 'Saving…' : 'Save'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function AgentsPane({ onChanged }: { onChanged?: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [teamDrawerOpen, setTeamDrawerOpen] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)

  const load = useCallback(() => {
    Promise.all([api.listAgents(), api.listTeams(), api.listMemberships()])
      .then(([a, t, m]) => {
        setAgents(a)
        setTeams(t)
        setMemberships(m)
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function changed() {
    load()
    onChanged?.()
  }

  function openEdit(a: Agent) {
    setEditing(a)
    setDrawerOpen(true)
  }

  function openCreate() {
    setEditing(null)
    setDrawerOpen(true)
  }

  function restore(a: Agent) {
    api.updateAgent(a.id, { archived: false }).then(changed).catch(console.error)
  }

  function restoreTeam(t: Team) {
    api.updateTeam(t.id, { archived: false }).then(changed).catch(console.error)
  }

  const active = agents.filter((a) => !a.archived)
  const archived = agents.filter((a) => a.archived)
  const activeTeams = teams.filter((t) => !t.archived)
  const archivedTeams = teams.filter((t) => t.archived)

  const teamMembers = (teamId: number) =>
    active.filter((a) => memberships.some((m) => m.teamId === teamId && m.agentId === a.id))
  const unassigned = active.filter((a) => !memberships.some((m) => m.agentId === a.id))
  const editingTeamIds = editing
    ? memberships.filter((m) => m.agentId === editing.id).map((m) => m.teamId)
    : []

  return (
    <div className="flex-1 overflow-y-auto">
      {/* TEAMS strip */}
      <div className="flex items-center pb-3.5">
        <span className="font-display text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
          Teams
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setEditingTeam(null)
              setTeamDrawerOpen(true)
            }}
            className="inline-flex items-center gap-[7px]"
          >
            <span className="text-[15px] leading-none">＋</span> New team
          </Button>
          <Button onClick={openCreate} className="inline-flex items-center gap-[7px]">
            <span className="text-[15px] leading-none">＋</span> New agent
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 pb-5">
        {activeTeams.map((t) => (
          <TeamCard
            key={t.id}
            team={t}
            memberCount={teamMembers(t.id).length}
            onEdit={(team) => {
              setEditingTeam(team)
              setTeamDrawerOpen(true)
            }}
          />
        ))}
        {archivedTeams.map((t) => (
          <TeamCard
            key={t.id}
            team={t}
            memberCount={teamMembers(t.id).length}
            onEdit={(team) => {
              setEditingTeam(team)
              setTeamDrawerOpen(true)
            }}
            onRestore={restoreTeam}
          />
        ))}
        {teams.length === 0 && (
          <p className="text-sm text-muted-foreground">No teams yet. Create one to group agents.</p>
        )}
      </div>

      {/* Roster grouped by team */}
      <span className="font-display text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
        Roster
      </span>
      {activeTeams.map((t) => {
        const members = teamMembers(t.id)
        if (members.length === 0) return null
        return (
          <div key={t.id}>
            <div className="font-display mb-2.5 mt-4 text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
              {t.name}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
              {members.map((a) => (
                <AgentCard key={a.id} agent={a} onEdit={openEdit} />
              ))}
            </div>
          </div>
        )
      })}
      {unassigned.length > 0 && (
        <div>
          <div className="font-display mb-2.5 mt-4 text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
            No team
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {unassigned.map((a) => (
              <AgentCard key={a.id} agent={a} onEdit={openEdit} />
            ))}
          </div>
        </div>
      )}
      {active.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No active agents. Create one to dispatch work.</p>
      )}

      {archived.length > 0 && (
        <>
          <div className="font-display mb-2.5 mt-6 text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
            Archived
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {archived.map((a) => (
              <AgentCard key={a.id} agent={a} onEdit={openEdit} onRestore={restore} />
            ))}
          </div>
        </>
      )}

      <AgentDrawer
        agent={editing}
        teams={teams}
        initialTeamIds={editingTeamIds}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={changed}
      />
      <TeamDrawer
        team={editingTeam}
        open={teamDrawerOpen}
        onClose={() => setTeamDrawerOpen(false)}
        onSaved={changed}
      />
    </div>
  )
}
