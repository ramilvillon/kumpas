import { useEffect, useRef, useState } from 'react'
import type { Agent, Attachment, Column, Comment, Run, Ticket } from '../../core/types'
import { api } from './api'
import { hue, initials } from './lib/visuals'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'

type Tab = 'description' | 'comments' | 'attachments' | 'activity'

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 2) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function AvatarSm({ name, brass = false }: { name: string; brass?: boolean }) {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-[9.5px] font-semibold"
      style={brass ? { color: 'var(--primary)' } : { color: `hsl(${hue(name)}, 60%, 65%)` }}
    >
      {initials(name)}
    </span>
  )
}

export function TicketDrawer({
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
  const [tab, setTab] = useState<Tab>('description')
  const [comments, setComments] = useState<Comment[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [posting, setPosting] = useState(false)
  const descRef = useRef<HTMLTextAreaElement>(null)

  const ticketId = ticket?.id

  // ponytail: intentional single effect keyed on ticketId — resets all local state and reloads
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setAgentId(null)
    setTab('description')
    setCommentBody('')
    setTagInput('')
    if (!ticketId || !ticket) {
      setComments([])
      setAttachments([])
      setRuns([])
      setDescDraft('')
      return
    }
    setDescDraft(ticket.description)
    void Promise.all([
      api.listComments(ticketId),
      api.listAttachments(ticketId),
      api.listRuns(ticketId),
    ]).then(([c, a, r]) => {
      setComments(c)
      setAttachments(a)
      setRuns(r)
    }).catch(console.error)
  }, [ticketId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resync descDraft if the server value changes while the drawer stays open,
  // but only when the textarea isn't focused (don't clobber an in-progress edit).
  useEffect(() => {
    if (ticket && descRef.current !== document.activeElement) {
      setDescDraft(ticket.description)
    }
  }, [ticket?.description]) // eslint-disable-line react-hooks/exhaustive-deps

  async function reloadData() {
    if (!ticketId) return
    const [c, a, r] = await Promise.all([
      api.listComments(ticketId),
      api.listAttachments(ticketId),
      api.listRuns(ticketId),
    ])
    setComments(c)
    setAttachments(a)
    setRuns(r)
  }

  async function patchTicket(patch: Record<string, unknown>) {
    if (!ticket) return
    await api.updateTicket(ticket.id, patch)
    onChanged()
  }

  async function addTag(tag: string) {
    const t = tag.trim()
    if (!ticket || !t || ticket.tags.includes(t)) return
    await patchTicket({ tags: [...ticket.tags, t] })
  }

  async function removeTag(tag: string) {
    if (!ticket) return
    await patchTicket({ tags: ticket.tags.filter((t) => t !== tag) })
  }

  async function postComment() {
    if (!ticketId || !commentBody.trim()) return
    setPosting(true)
    try {
      await api.addComment(ticketId, commentBody.trim())
      setCommentBody('')
      await reloadData()
      onChanged()
    } finally {
      setPosting(false)
    }
  }

  async function attachFiles() {
    if (!ticketId) return
    const paths = await api.pickFiles()
    if (paths.length === 0) return
    await Promise.all(paths.map((p) => api.addAttachment(ticketId, p)))
    await reloadData()
    onChanged()
  }

  const chosenAgentId = agentId ?? agents[0]?.id ?? null
  const col = columns.find((c) => c.id === ticket?.columnId)
  const assignee = agents.find((a) => a.id === ticket?.assigneeAgentId)

  const TABS: Tab[] = ['description', 'comments', 'attachments', 'activity']
  const tabCount: Record<Tab, number> = {
    description: 0,
    comments: comments.length,
    attachments: attachments.length,
    activity: runs.length,
  }

  return (
    <Sheet
      open={ticket !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-[400px] flex-col gap-0 bg-card p-0 sm:max-w-[400px]"
      >
        {ticket && (
          <div className="flex h-full flex-col overflow-hidden">
            {/* Top bar */}
            <div className="flex items-center gap-3.5 border-b border-border px-[18px] py-[14px] text-muted-foreground">
              <span className="text-sm">↗</span>
              <div className="ml-auto">
                <button
                  onClick={onClose}
                  className="text-sm transition-colors hover:text-foreground focus:outline-none"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-[18px] py-4">
              {/* Title */}
              <h2 className="mb-4 font-serif text-[25px] font-normal leading-[1.2]">
                {ticket.title}
              </h2>

              {/* Fields grid */}
              <div className="grid grid-cols-[88px_1fr] items-center gap-x-3 gap-y-3 text-[13px]">
                {/* Assignee */}
                <span className="text-[12px] text-muted-foreground">Assignee</span>
                <div className="flex items-center gap-2">
                  {assignee && <AvatarSm name={assignee.name} />}
                  <Select
                    value={ticket.assigneeAgentId ? String(ticket.assigneeAgentId) : 'none'}
                    onValueChange={(v) =>
                      void patchTicket({ assigneeAgentId: v === 'none' ? null : Number(v) })
                    }
                  >
                    <SelectTrigger
                      className="h-auto rounded-[7px] border-border bg-secondary px-2.5 text-[12.5px] shadow-none focus-visible:ring-1"
                      style={{ paddingTop: 5, paddingBottom: 5 }}
                    >
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Status — read-only pill */}
                <span className="text-[12px] text-muted-foreground">Status</span>
                <div>
                  <span className="inline-flex items-center gap-[7px] rounded-[7px] border border-border bg-secondary px-2.5 py-[5px] text-[12.5px]">
                    ◑ {col?.name ?? '—'}
                    {runs[0] ? (
                      <span className="text-muted-foreground">· {runs[0].status}</span>
                    ) : null}
                  </span>
                </div>

                {/* Due Date */}
                <span className="text-[12px] text-muted-foreground">Due Date</span>
                <div>
                  <input
                    type="date"
                    value={ticket.dueDate ?? ''}
                    onChange={(e) =>
                      void patchTicket({ dueDate: e.target.value || null })
                    }
                    className="rounded-[7px] border border-border bg-secondary px-2.5 py-[5px] font-mono text-[12.5px] text-foreground outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                {/* Priority */}
                <span className="text-[12px] text-muted-foreground">Priority</span>
                <div>
                  <Select
                    value={ticket.priority ?? 'none'}
                    onValueChange={(v) =>
                      void patchTicket({ priority: v === 'none' ? null : v })
                    }
                  >
                    <SelectTrigger
                      className="h-auto rounded-[7px] border-border bg-secondary px-2.5 text-[12.5px] shadow-none focus-visible:ring-1"
                      style={{ paddingTop: 5, paddingBottom: 5 }}
                    >
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Tags */}
                <span className="text-[12px] text-muted-foreground">Tags</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {ticket.tags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => void removeTag(tag)}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10.5px] font-medium transition-colors hover:border-destructive/50 hover:text-destructive"
                      style={{
                        background: `hsla(${hue(tag)}, 55%, 50%, 0.12)`,
                        color: `hsl(${hue(tag)}, 60%, 65%)`,
                      }}
                      title="Remove tag"
                    >
                      {tag} ×
                    </button>
                  ))}
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value.replace(/,/g, ''))}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                        e.preventDefault()
                        void addTag(tagInput).then(() => setTagInput(''))
                      }
                    }}
                    onBlur={() => {
                      if (tagInput.trim()) void addTag(tagInput).then(() => setTagInput(''))
                    }}
                    placeholder="＋ tag"
                    className="w-16 border-0 bg-transparent text-[11px] text-muted-foreground outline-none placeholder:text-muted-foreground/60"
                  />
                </div>
              </div>

              {/* Tabs */}
              <div className="mb-3 mt-4 flex gap-4 border-b border-border">
                {TABS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`pb-[9px] text-[12.5px] transition-colors ${
                      tab === t ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                    style={tab === t ? { boxShadow: 'inset 0 -2px 0 var(--primary)' } : undefined}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                    {tabCount[t] > 0 && (
                      <span
                        className={`ml-1 font-mono text-[10px] ${
                          tab === t ? 'text-primary' : 'text-muted-foreground/50'
                        }`}
                      >
                        {tabCount[t]}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Description */}
              {tab === 'description' && (
                <textarea
                  ref={descRef}
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onBlur={() => {
                    if (descDraft !== ticket.description) void patchTicket({ description: descDraft })
                  }}
                  placeholder="Describe the task…"
                  className="min-h-[120px] w-full resize-none rounded-[9px] border border-border bg-secondary p-[10px_11px] text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                />
              )}

              {/* Comments */}
              {tab === 'comments' && (
                <div>
                  {/* Composer */}
                  <div className="mb-4 rounded-[9px] border border-border bg-secondary p-[10px_11px]">
                    <textarea
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      placeholder="Add a comment…"
                      rows={2}
                      className="w-full resize-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                    />
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        onClick={() => void postComment()}
                        disabled={posting || !commentBody.trim()}
                      >
                        Comment
                      </Button>
                    </div>
                  </div>
                  {/* Thread */}
                  {comments.map((c) => {
                    const isHuman = c.author === 'human'
                    const agent = isHuman
                      ? null
                      : agents.find(
                          (a) => a.name.toLowerCase() === c.author.toLowerCase(),
                        )
                    const displayName = isHuman ? 'You' : (agent?.name ?? c.author)
                    return (
                      <div key={c.id} className="mb-3.5 flex gap-2.5">
                        {isHuman ? (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-[9.5px] font-semibold text-foreground">
                            Y
                          </span>
                        ) : (
                          <AvatarSm name={displayName} brass />
                        )}
                        <div>
                          <div className="mb-0.5 flex items-baseline gap-2">
                            <span className="text-[12.5px] font-semibold">{displayName}</span>
                            {isHuman ? (
                              <span className="rounded border border-border px-1 text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                                human
                              </span>
                            ) : (
                              <span className="rounded border border-primary/50 px-1 text-[9px] uppercase tracking-[0.08em] text-primary">
                                agent
                              </span>
                            )}
                            <span className="font-mono text-[11px] text-muted-foreground/70">
                              {relTime(c.createdAt)}
                            </span>
                          </div>
                          <div className="text-[13px] leading-[1.45] text-foreground">
                            {c.body}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Attachments */}
              {tab === 'attachments' && (
                <div>
                  {attachments.length === 0 && (
                    <p className="mb-3 text-[13px] text-muted-foreground">No attachments yet.</p>
                  )}
                  {attachments.map((a) => (
                    <div key={a.id} className="mb-2 flex items-center gap-2 text-[13px]">
                      <span>{a.kind === 'text' ? '📄' : '🗂'}</span>
                      <span className="text-foreground">{a.filename}</span>
                    </div>
                  ))}
                  <button
                    onClick={() => void attachFiles().catch(console.error)}
                    className="mt-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    📎 Attach files
                  </button>
                </div>
              )}

              {/* Activity */}
              {tab === 'activity' && (
                <div>
                  {runs.length === 0 && (
                    <p className="text-[13px] text-muted-foreground">No runs yet.</p>
                  )}
                  {runs.map((r) => (
                    <div key={r.id} className="mb-2 font-mono text-[11px] text-muted-foreground">
                      {r.status} · {r.tokensIn + r.tokensOut} tok ·{' '}
                      {(r.durationMs / 1000).toFixed(1)}s · {relTime(r.createdAt)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Post-dispatch result */}
            {result && (
              <div className="border-t border-border bg-card px-[18px] py-2 font-mono text-[11px] text-muted-foreground/70">
                {result}
              </div>
            )}

            {/* Footer: Dispatch */}
            <div className="flex items-center gap-2.5 border-t border-border bg-card px-[18px] py-[14px]">
              <Select
                value={chosenAgentId === null ? undefined : String(chosenAgentId)}
                onValueChange={(v) => setAgentId(Number(v))}
                disabled={busy}
              >
                <SelectTrigger className="flex-1 border-border bg-secondary text-[13px]">
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
              <Button
                onClick={() => {
                  if (chosenAgentId !== null) onDispatch(ticket.id, chosenAgentId)
                }}
                disabled={busy || chosenAgentId === null}
                className="inline-flex items-center gap-[7px]"
              >
                {busy ? 'Running…' : 'Dispatch'}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
