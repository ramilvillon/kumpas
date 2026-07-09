import { useEffect, useState } from 'react'
import { Moon, Plus, Sun } from 'lucide-react'
import type { Project } from '../../core/types'
import { api, baseName } from './api'
import { Board } from './Board'
import { Button } from '@/components/ui/button'
import { hue } from './lib/visuals'

function useTheme() {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    api.getSetting('theme').then((saved) => {
      if (saved === 'dark' || saved === 'light') setDark(saved === 'dark')
    })
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  return {
    dark,
    toggle: () =>
      setDark((d) => {
        const next = !d
        api.setSetting('theme', next ? 'dark' : 'light').catch(console.error)
        return next
      }),
  }
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const { dark, toggle } = useTheme()

  async function refresh() {
    const ps = await api.listProjects()
    setProjects(ps)
    if (selected === null && ps.length > 0) setSelected(ps[0].id)
  }
  useEffect(() => {
    refresh()
  }, [])

  async function addProject() {
    setError(null)
    try {
      const path = await api.pickFolder()
      if (!path) return
      const p = await api.createProject(baseName(path), path)
      await refresh()
      setSelected(p.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex w-[224px] shrink-0 flex-col border-r border-border bg-background px-[14px] py-4">
        {/* Brand */}
        <div className="flex items-center gap-[9px] px-1 pb-1 pt-0.5">
          {/* ponytail: two spans mimic the ::before/::after baton from the mockup */}
          <span className="relative h-5 w-5 shrink-0">
            <span className="absolute left-[9px] top-px h-[18px] w-0.5 origin-bottom rotate-[24deg] rounded-sm bg-primary" />
            <span className="absolute bottom-0 left-[7px] h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <span className="font-display text-[19px] leading-none tracking-[0.08em]">Kumpas</span>
          <span className="ml-auto text-[11px] text-muted-foreground">▾</span>
        </div>

        {/* Search */}
        <div className="mt-3.5 flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-[7px]">
          <span className="text-[13px] text-muted-foreground">⌕</span>
          <input
            type="text"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          <kbd className="rounded border border-border px-1 py-px font-mono text-[10px] text-muted-foreground/60">
            ⌘K
          </kbd>
        </div>

        {/* PROJECTS group */}
        <div className="mt-4">
          <div className="flex items-center px-1 pb-1.5">
            <h4 className="font-display flex-1 text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
              Projects
            </h4>
            <button
              onClick={addProject}
              className="text-muted-foreground/60 hover:text-muted-foreground"
              aria-label="Add project"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {error && <div className="mb-1 px-1 text-xs text-destructive">{error}</div>}
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              title={p.repoPath}
              className={`flex w-full items-center gap-[9px] rounded-[7px] px-2 py-[7px] text-[13px] transition-colors ${
                p.id === selected
                  ? 'bg-card text-foreground'
                  : 'text-muted-foreground hover:bg-card/60'
              }`}
            >
              <span
                className="h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: `hsl(${hue(p.name)}, 60%, 55%)` }}
              />
              <span className="min-w-0 truncate">{p.name}</span>
            </button>
          ))}
        </div>

        {/* Staff divider */}
        <div className="my-3.5 border-t border-border" />

        {/* OTHER group */}
        <div>
          <h4 className="font-display px-1 pb-1.5 text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
            Other
          </h4>
          {/* ponytail: Settings is static — no feature behind it yet */}
          <div className="flex items-center gap-[9px] rounded-[7px] px-2 py-[7px] text-[13px] text-muted-foreground">
            <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-muted-foreground/40" />
            Settings
          </div>
        </div>

        {/* Footer identity card */}
        <div className="mt-auto flex items-center gap-[9px] border-t border-border px-1 pt-2">
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-[11px] font-semibold">
            K
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px]">Kumpas</div>
            <div className="font-mono text-[10px] text-muted-foreground">v0.0.1</div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={toggle}
            aria-label="Toggle theme"
          >
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {selected === null ? (
          <p className="p-4 text-sm text-muted-foreground">Add a git project to begin.</p>
        ) : (
          <Board key={selected} projectId={selected} />
        )}
      </main>
    </div>
  )
}
