import { useEffect, useRef, useState } from 'react'
import type { Agent, Column, TicketPriority } from '../../core/types'
import { api, baseName } from './api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  columns: Column[]
  agents: Agent[]
  onCreated: () => void
}

export function NewTaskModal({ open, onOpenChange, projectId, columns, agents, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TicketPriority | ''>('')
  const [dueDate, setDueDate] = useState('')
  const [assigneeAgentId, setAssigneeAgentId] = useState<string>('')
  const [columnId, setColumnId] = useState<string>('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [stagedPaths, setStagedPaths] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  // default to todo-role column when columns change
  useEffect(() => {
    if (columns.length === 0) return
    const todo = columns.find((c) => c.role === 'todo') ?? columns[0]
    setColumnId(String(todo.id))
  }, [columns])

  // reset form when modal opens
  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setPriority('')
    setDueDate('')
    setAssigneeAgentId('')
    setTags([])
    setTagInput('')
    setStagedPaths([])
    setSubmitting(false)
    setSubmitError(null)
    const todo = columns.find((c) => c.role === 'todo') ?? columns[0]
    if (todo) setColumnId(String(todo.id))
    setTimeout(() => titleRef.current?.focus(), 50)
  }, [open]) // ponytail: columns intentionally excluded — only reset on open

  async function onCreate() {
    if (!title.trim() || submitting) return
    setSubmitError(null)
    setSubmitting(true)
    try {
      const t = await api.createTicket(projectId, title.trim(), description.trim(), {
        priority: priority || null,
        dueDate: dueDate || null,
        assigneeAgentId: assigneeAgentId ? Number(assigneeAgentId) : null,
        tags,
        columnId: columnId ? Number(columnId) : undefined,
      })
      await Promise.all(stagedPaths.map((p) => api.addAttachment(t.id, p)))
      onCreated()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onCreate()
    }
  }

  async function attachFiles() {
    const paths = await api.pickFiles()
    if (paths.length) setStagedPaths((prev) => [...prev, ...paths])
  }

  function addTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.metaKey || e.ctrlKey) return
    if (e.key !== 'Enter') return
    e.preventDefault()
    const val = tagInput.trim()
    if (val && !tags.includes(val)) setTags((prev) => [...prev, val])
    setTagInput('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 pb-1">
          {/* Title */}
          <input
            ref={titleRef}
            className="w-full bg-transparent border-b border-border text-foreground font-serif text-xl pb-2 pt-1 outline-none placeholder:text-muted-foreground"
            placeholder="What needs doing?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {/* Description */}
          <textarea
            className="w-full bg-muted/40 border border-border rounded-lg text-foreground text-sm px-3 py-2.5 min-h-[70px] resize-none outline-none placeholder:text-muted-foreground"
            placeholder="Describe the task for the agent (or a teammate)…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {/* 2-col grid: Priority, Due, Assignee, Column */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Priority */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Priority</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority | '')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">◆ High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Due date */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Due date</label>
              <input
                type="date"
                className="w-full bg-muted/40 border border-border rounded-md text-foreground text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-ring/50 h-9 font-mono"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            {/* Assignee */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Assignee</label>
              <Select value={assigneeAgentId} onValueChange={setAssigneeAgentId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Unassigned" />
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

            {/* Column */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Column</label>
              <Select value={columnId} onValueChange={setColumnId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Tags</label>
            <div className="flex flex-wrap items-center gap-1.5 bg-muted/40 border border-border rounded-md px-3 py-2 min-h-[36px]">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-xs bg-muted border border-border rounded-full px-2 py-0.5"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                    className="text-muted-foreground hover:text-foreground leading-none"
                  >
                    ✕
                  </button>
                </span>
              ))}
              <input
                className="flex-1 min-w-[80px] bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="＋ add tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={addTag}
              />
            </div>
          </div>

          {/* Attachments */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Attachments</label>
            <div className="flex flex-wrap items-center gap-1.5 bg-muted/40 border border-border rounded-md px-3 py-2 min-h-[36px]">
              {stagedPaths.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1 text-xs bg-muted border border-border rounded-full px-2 py-0.5"
                >
                  📄 {baseName(p)}
                  <button
                    type="button"
                    onClick={() => setStagedPaths((prev) => prev.filter((x) => x !== p))}
                    className="text-muted-foreground hover:text-foreground leading-none"
                  >
                    ✕
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={attachFiles}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                📎 Attach files…
              </button>
            </div>
          </div>
        </div>

        {submitError && (
          <p className="text-destructive text-sm px-5 pb-1">{submitError}</p>
        )}

        <DialogFooter>
          <span className="text-xs text-muted-foreground mr-auto">↩ press ⌘↵ to create</span>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onCreate} disabled={!title.trim() || submitting}>
            {submitting ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
