import { useEffect, useRef, useState } from 'react'
import { Moon, PanelLeft, Plus, Sun } from 'lucide-react'
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

interface SidebarViewProps {
  collapsed: boolean
  projects: Project[]
  selected: number | null
  error: string | null
  search: string
  onSearch: (s: string) => void
  onAddProject: () => void
  onPickProject: (id: number) => void
  dark: boolean
  onToggleTheme: () => void
}

function SidebarView(p: SidebarViewProps) {
  const filtered = p.projects.filter((proj) =>
    proj.name.toLowerCase().includes(p.search.toLowerCase()),
  )

  if (p.collapsed) {
    // VS Code activity-bar style: tiles only; clicking a tile expands (App handles it)
    return (
      <div className="flex h-full flex-col items-center py-4">
        <span className="relative h-5 w-5 shrink-0">
          <span className="absolute left-[9px] top-px h-[18px] w-0.5 origin-bottom rotate-[24deg] rounded-sm bg-primary" />
          <span className="absolute bottom-0 left-[7px] h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
        <div className="mt-4 flex w-full flex-col items-center gap-1">
          {p.projects.map((proj) => (
            <button
              key={proj.id}
              onClick={() => p.onPickProject(proj.id)}
              title={proj.name}
              className={`font-display flex h-9 w-9 items-center justify-center rounded-[7px] text-[13px] ${
                proj.id === p.selected
                  ? 'bg-card text-primary ring-1 ring-primary'
                  : 'text-muted-foreground hover:bg-card/60'
              }`}
            >
              {proj.name.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="mt-auto h-7 w-7 shrink-0"
          onClick={p.onToggleTheme}
          aria-label="Toggle theme"
        >
          {p.dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col px-[14px] py-4">
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
          value={p.search}
          onChange={(e) => p.onSearch(e.target.value)}
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
            onClick={p.onAddProject}
            className="text-muted-foreground/60 hover:text-muted-foreground"
            aria-label="Add project"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {p.error && <div className="mb-1 px-1 text-xs text-destructive">{p.error}</div>}
        {filtered.map((proj) => (
          <button
            key={proj.id}
            onClick={() => p.onPickProject(proj.id)}
            title={proj.repoPath}
            className={`flex w-full items-center gap-[9px] rounded-[7px] px-2 py-[7px] text-[13px] transition-colors ${
              proj.id === p.selected
                ? 'bg-card text-foreground'
                : 'text-muted-foreground hover:bg-card/60'
            }`}
          >
            <span
              className="h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ background: `hsl(${hue(proj.name)}, 60%, 55%)` }}
            />
            <span className="min-w-0 truncate">{proj.name}</span>
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
          onClick={p.onToggleTheme}
          aria-label="Toggle theme"
        >
          {p.dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  )
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [flyout, setFlyout] = useState(false)
  const flyoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { dark, toggle } = useTheme()

  useEffect(() => {
    api.getSetting('sidebar:collapsed').then((v) => setCollapsed(v === '1'))
  }, [])

  function setCollapsedPersist(next: boolean) {
    setCollapsed(next)
    setFlyout(false)
    api.setSetting('sidebar:collapsed', next ? '1' : '0').catch(console.error)
  }

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

  function pickProject(id: number) {
    setSelected(id)
    // VS Code activity-bar behavior: picking a project from the rail/flyout expands
    if (collapsed) setCollapsedPersist(false)
  }

  const sidebarProps = {
    projects,
    selected,
    error,
    search,
    onSearch: setSearch,
    onAddProject: addProject,
    onPickProject: pickProject,
    dark,
    onToggleTheme: toggle,
  }

  const sidebarToggle = (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      onClick={() => setCollapsedPersist(!collapsed)}
      aria-label="Toggle sidebar"
    >
      <PanelLeft className="h-3.5 w-3.5" />
    </Button>
  )

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`relative shrink-0 border-r border-border bg-background transition-[width] duration-150 ${
          collapsed ? 'w-[56px]' : 'w-[224px]'
        }`}
        onMouseEnter={() => {
          if (!collapsed) return
          flyoutTimer.current = setTimeout(() => setFlyout(true), 200)
        }}
        onMouseLeave={() => {
          if (flyoutTimer.current) clearTimeout(flyoutTimer.current)
          setFlyout(false)
        }}
        onFocusCapture={() => {
          if (collapsed) setFlyout(true)
        }}
      >
        <SidebarView collapsed={collapsed} {...sidebarProps} />
        {collapsed && flyout && (
          <div className="absolute inset-y-0 left-0 z-10 w-[224px] border-r border-border bg-background shadow-xl">
            <SidebarView collapsed={false} {...sidebarProps} />
          </div>
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {selected === null ? (
          <div className="flex items-center gap-2 p-4">
            {sidebarToggle}
            <p className="text-sm text-muted-foreground">Add a git project to begin.</p>
          </div>
        ) : (
          <Board key={selected} projectId={selected} sidebarToggle={sidebarToggle} />
        )}
      </main>
    </div>
  )
}
