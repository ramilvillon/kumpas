import { useCallback, useEffect, useRef, useState } from 'react'
import type { Agent, Chat, ChatMessage } from '../../core/types'
import { api } from './api'
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

// v1: only the claude provider implements AgentProvider.chat. The renderer
// can't probe main for capabilities, so mirror the list here.
const CHAT_PROVIDERS = ['claude']

const fieldLabel = 'font-display text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70'
const inputCls =
  'w-full rounded-lg border border-border bg-background px-2.5 py-[7px] text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-primary'

function NewChatDialog({
  open,
  onOpenChange,
  agents,
  onCreate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  agents: Agent[] // active, chat-capable only — filtered by caller
  onCreate: (agentId: number, title: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [agentId, setAgentId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setAgentId(agents.length > 0 ? String(agents[0].id) : '')
    setBusy(false)
    setError(null)
  }, [open]) // ponytail: agents intentionally excluded — only reset on open

  async function create() {
    if (!title.trim() || !agentId || busy) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(Number(agentId), title.trim())
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-5 pb-1">
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputCls}
              placeholder="Login feature"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Agent</span>
            <Select value={agentId} onValueChange={setAgentId}>
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
            {agents.length === 0 && (
              <span className="text-[10px] text-muted-foreground">
                No chat-capable agents. Create a claude agent in the Agents tab first.
              </span>
            )}
          </label>
        </div>
        {error && <p className="px-5 pb-1 text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || !title.trim() || !agentId}>
            {busy ? 'Creating…' : 'Create chat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PromoteDialog({
  open,
  onOpenChange,
  chat,
  draft,
  onPromoted,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  chat: Chat | null
  draft: string // last agent message body, editable spec text
  onPromoted: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle(chat?.title ?? '')
    setDescription(draft)
    setBusy(false)
    setError(null)
  }, [open]) // ponytail: prefill only on open

  async function promote() {
    if (!chat || !title.trim() || !description.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.promoteChat(chat.id, { title: title.trim(), description: description.trim() })
      onPromoted()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create spec ticket</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-5 pb-1">
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Spec</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={12}
              className={`${inputCls} resize-y font-mono text-[12px] leading-relaxed`}
              placeholder="Ask the agent to draft the spec, then edit it here."
            />
          </label>
          <span className="text-[10px] text-muted-foreground">
            Creates an epic ticket in To Do and links this chat to it.
          </span>
        </div>
        {error && <p className="px-5 pb-1 text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={promote} disabled={busy || !title.trim() || !description.trim()}>
            {busy ? 'Creating…' : 'Create epic'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Bubble({ msg, isHuman }: { msg: ChatMessage; isHuman: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${isHuman ? 'items-end' : 'items-start'}`}>
      <span className="font-display px-1 text-[8px] uppercase tracking-[0.13em] text-muted-foreground/70">
        {msg.author}
      </span>
      <div
        className={`max-w-[78%] whitespace-pre-wrap rounded-[10px] border px-3 py-2 text-[13px] leading-relaxed ${
          isHuman ? 'border-primary/25 bg-primary/10' : 'border-border bg-card'
        }`}
      >
        {msg.body}
      </div>
    </div>
  )
}

export function ChatsPane({ projectId, onChanged }: { projectId: number; onChanged?: () => void }) {
  const [chats, setChats] = useState<Chat[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  // ponytail: one in-flight send at a time, app-wide; per-chat parallel sends when someone actually chats in two threads at once
  const [sendingChatId, setSendingChatId] = useState<number | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [promoteOpen, setPromoteOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const selectedIdRef = useRef<number | null>(null)

  const load = useCallback(() => {
    Promise.all([api.listChats(projectId), api.listAgents()])
      .then(([cs, as]) => {
        setChats(cs)
        setAgents(as)
        setSelectedId((cur) => cur ?? cs.find((c) => !c.archived)?.id ?? null)
      })
      .catch(console.error)
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  const selected = chats.find((c) => c.id === selectedId) ?? null
  const sending = sendingChatId !== null
  const thinkingHere = selected !== null && sendingChatId === selected.id
  // Display uses the FULL agent list (an archived agent's chat still shows its
  // name); only the new-chat picker filters.
  const selectedAgent = selected ? (agents.find((a) => a.id === selected.agentId) ?? null) : null
  const chatCapableAgents = agents.filter(
    (a) => !a.archived && CHAT_PROVIDERS.includes(a.provider),
  )
  const activeChats = chats.filter((c) => !c.archived)
  const archivedChats = chats.filter((c) => c.archived)
  const lastAgentDraft =
    [...messages].reverse().find((m) => m.author !== 'human')?.body ?? ''

  const loadMessages = useCallback((chatId: number) => {
    api.listChatMessages(chatId).then(setMessages).catch(console.error)
  }, [])

  useEffect(() => {
    selectedIdRef.current = selectedId
    setMessages([])
    setSendError(null)
    if (selectedId !== null) loadMessages(selectedId)
  }, [selectedId, loadMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, sending])

  async function send() {
    if (!selected || !draft.trim() || sendingChatId !== null) return
    const chatId = selected.id
    const body = draft.trim()
    setDraft('')
    setSendingChatId(chatId)
    setSendError(null)
    // optimistic human bubble; real rows replace it on reload
    setMessages((m) => [
      ...m,
      { id: -1, chatId, author: 'human', body, createdAt: '' },
    ])
    try {
      await api.sendChatMessage(chatId, body)
    } catch (e) {
      if (selectedIdRef.current === chatId) setSendError(e instanceof Error ? e.message : String(e))
    } finally {
      setSendingChatId(null)
      if (selectedIdRef.current === chatId) loadMessages(chatId)
      load() // providerSessionId changed
    }
  }

  async function retry() {
    if (!selected || sendingChatId !== null) return
    const chatId = selected.id
    setSendingChatId(chatId)
    setSendError(null)
    try {
      await api.retryChat(chatId)
    } catch (e) {
      if (selectedIdRef.current === chatId) setSendError(e instanceof Error ? e.message : String(e))
    } finally {
      setSendingChatId(null)
      if (selectedIdRef.current === chatId) loadMessages(chatId)
      load()
    }
  }

  async function createChat(agentId: number, title: string) {
    const c = await api.createChat({ projectId, agentId, title })
    load()
    setSelectedId(c.id)
  }

  function archiveChat() {
    if (!selected) return
    api.updateChat(selected.id, { archived: true })
      .then(() => {
        setSelectedId(null)
        load()
      })
      .catch(console.error)
  }

  function restoreChat(c: Chat) {
    api.updateChat(c.id, { archived: false }).then(load).catch(console.error)
  }

  function onComposerKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      send()
    }
  }

  const chatListItem = (c: Chat) => (
    <button
      key={c.id}
      onClick={() => setSelectedId(c.id)}
      className={`flex w-full flex-col items-start gap-0.5 rounded-[7px] px-2.5 py-2 text-left transition-colors ${
        c.id === selectedId ? 'bg-card text-foreground' : 'text-muted-foreground hover:bg-card/60'
      } ${c.archived ? 'opacity-55' : ''}`}
    >
      <span className="font-display w-full truncate text-[12px] tracking-[0.06em]">{c.title}</span>
      <span className="flex w-full items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
        {agents.find((a) => a.id === c.agentId)?.name ?? '?'}
        {c.ticketId !== null && (
          <span className="font-display rounded-[5px] bg-primary/10 px-[5px] py-px text-[7px] uppercase tracking-[0.06em] text-primary">
            EPIC
          </span>
        )}
        {c.archived && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              restoreChat(c)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                restoreChat(c)
              }
            }}
            className="ml-auto text-[9px] uppercase text-primary hover:underline"
          >
            Restore
          </span>
        )}
      </span>
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* Chat list */}
      <div className="flex w-[230px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-border pr-3">
        <Button onClick={() => setNewOpen(true)} className="mb-2 inline-flex items-center gap-[7px]">
          <span className="text-[15px] leading-none">＋</span> New feature
        </Button>
        {activeChats.map(chatListItem)}
        {activeChats.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">
            No chats yet. Brainstorm a user story with an agent, then promote the spec to an epic.
          </p>
        )}
        {archivedChats.length > 0 && (
          <>
            <div className="font-display mt-3 px-1 pb-1 text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
              Archived
            </div>
            {archivedChats.map(chatListItem)}
          </>
        )}
      </div>

      {/* Thread */}
      {selected === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select or create a chat.
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-border pb-2.5">
            <span className="font-display min-w-0 truncate text-[13px] tracking-[0.08em]">
              {selected.title}
            </span>
            {selectedAgent && (
              <span className="rounded-full bg-secondary px-[7px] py-px font-mono text-[10px] text-muted-foreground">
                {selectedAgent.name}
                {selectedAgent.archived ? ' (archived)' : ''}
              </span>
            )}
            <span className="ml-auto" />
            {!selected.archived && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={archiveChat}
              >
                Archive
              </Button>
            )}
            {selected.ticketId === null ? (
              <Button
                variant="outline"
                size="sm"
                disabled={messages.length === 0 || selected.archived}
                onClick={() => setPromoteOpen(true)}
              >
                Create spec ticket
              </Button>
            ) : (
              <span className="font-display rounded-[5px] bg-primary/10 px-[7px] py-[3px] text-[8px] uppercase tracking-[0.06em] text-primary">
                EPIC #{selected.ticketId}
              </span>
            )}
          </div>

          {/* Messages */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-3.5">
            {messages.map((m) => (
              <Bubble key={m.id} msg={m} isHuman={m.author === 'human'} />
            ))}
            {thinkingHere && (
              <div className="card-running max-w-[78%] rounded-[10px] border border-border bg-card px-3 py-2 text-[13px] text-muted-foreground">
                Thinking…
              </div>
            )}
            {sendError && (
              <div className="flex max-w-[78%] items-center gap-2.5 rounded-[10px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                <span className="min-w-0 flex-1">{sendError}</span>
                <Button variant="outline" size="sm" onClick={retry} disabled={sending}>
                  Retry
                </Button>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="flex items-end gap-2.5 border-t border-border pt-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKeyDown}
              rows={3}
              disabled={sending || selected.archived || (selectedAgent?.archived ?? false)}
              className={`${inputCls} resize-none leading-relaxed disabled:opacity-50`}
              placeholder={
                selected.archived
                  ? 'This chat is archived — restore it to continue.'
                  : selectedAgent?.archived
                    ? 'This agent is archived — the chat is read-only.'
                    : 'Describe the user story… (⌘↵ to send)'
              }
            />
            <Button
              onClick={send}
              disabled={
                sending || !draft.trim() || selected.archived || (selectedAgent?.archived ?? false)
              }
            >
              {sending ? '…' : 'Send'}
            </Button>
          </div>
        </div>
      )}

      <NewChatDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        agents={chatCapableAgents}
        onCreate={createChat}
      />
      <PromoteDialog
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
        chat={selected}
        draft={lastAgentDraft}
        onPromoted={() => {
          load()
          onChanged?.()
        }}
      />
    </div>
  )
}
