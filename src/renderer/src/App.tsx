import { useEffect, useState } from 'react'
import type { Project } from '../../core/types'
import { api, baseName } from './api'
import { Board } from './Board'

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    const path = await api.pickFolder()
    if (!path) return
    try {
      const p = await api.createProject(baseName(path), path)
      await refresh()
      setSelected(p.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span>Projects</span>
          <button onClick={addProject}>＋</button>
        </div>
        {error && <div className="error">{error}</div>}
        <ul>
          {projects.map((p) => (
            <li
              key={p.id}
              className={p.id === selected ? 'active' : ''}
              onClick={() => setSelected(p.id)}
              title={p.repoPath}
            >
              {p.name}
            </li>
          ))}
        </ul>
      </aside>
      <main className="main">
        {selected === null ? (
          <p className="empty">Add a git project to begin.</p>
        ) : (
          <Board projectId={selected} />
        )}
      </main>
    </div>
  )
}
