import { useEffect, useState } from 'react'
import { Moon, Plus, Sun } from 'lucide-react'
import type { Project } from '../../core/types'
import { api, baseName } from './api'
import { Board } from './Board'
import { Button } from '@/components/ui/button'

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
        api.setSetting('theme', next ? 'dark' : 'light')
        return next
      }),
  }
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
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

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-56 flex-col border-r bg-card p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Projects</span>
          <Button variant="ghost" size="icon" onClick={addProject} aria-label="Add project">
            <Plus />
          </Button>
        </div>
        {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
        <ul className="mt-2 flex-1 space-y-1 overflow-y-auto">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                  p.id === selected ? 'bg-accent font-medium' : 'text-muted-foreground'
                }`}
                onClick={() => setSelected(p.id)}
                title={p.repoPath}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
          {dark ? <Sun /> : <Moon />}
        </Button>
      </aside>
      <main className="flex-1 overflow-auto p-4">
        {selected === null ? (
          <p className="text-sm text-muted-foreground">Add a git project to begin.</p>
        ) : (
          <Board key={selected} projectId={selected} />
        )}
      </main>
    </div>
  )
}
