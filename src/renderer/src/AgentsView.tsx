import { useCallback, useEffect, useState } from 'react'
import type { Agent } from '../../core/types'
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

function AgentDrawer({
  agent,
  open,
  onClose,
  onSaved,
}: {
  agent: Agent | null // null = create
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [permissionLevel, setPermissionLevel] = useState('read')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(agent?.name ?? '')
    setModel(agent?.model ?? '')
    setSystemPrompt(agent?.systemPrompt ?? '')
    setPermissionLevel(agent?.permissionLevel ?? 'read')
    setConfirming(false)
    setBusy(false)
    setError(null)
  }, [open, agent])

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
    run(() =>
      agent
        ? api.updateAgent(agent.id, { name, model, systemPrompt, permissionLevel })
        : api.createAgent({ name, provider: 'claude', model, systemPrompt, permissionLevel }),
    )

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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)

  const load = useCallback(() => {
    api.listAgents().then(setAgents).catch(console.error)
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

  const active = agents.filter((a) => !a.archived)
  const archived = agents.filter((a) => a.archived)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center pb-3.5">
        <span className="font-display text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
          Roster
        </span>
        <Button onClick={openCreate} className="ml-auto inline-flex items-center gap-[7px]">
          <span className="text-[15px] leading-none">＋</span> New agent
        </Button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {active.map((a) => (
          <AgentCard key={a.id} agent={a} onEdit={openEdit} />
        ))}
        {active.length === 0 && (
          <p className="text-sm text-muted-foreground">No active agents. Create one to dispatch work.</p>
        )}
      </div>

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
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={changed}
      />
    </div>
  )
}
