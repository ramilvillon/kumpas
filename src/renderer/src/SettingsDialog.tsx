import { useEffect, useState } from 'react'
import { api } from './api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [autoMerge, setAutoMerge] = useState(true)
  const [parallelism, setParallelism] = useState('3')

  useEffect(() => {
    if (!open) return
    void Promise.all([
      api.getSetting('exec:autoMerge'),
      api.getSetting('exec:parallelism'),
    ]).then(([am, par]) => {
      setAutoMerge(am !== '0')
      setParallelism(par ?? '3')
    }).catch(console.error)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <label className="flex items-start gap-2.5 text-[13px]">
          <input
            type="checkbox"
            checked={autoMerge}
            onChange={(e) => {
              setAutoMerge(e.target.checked)
              api.setSetting('exec:autoMerge', e.target.checked ? '1' : '0').catch(console.error)
            }}
            className="mt-0.5 accent-[var(--primary)]"
          />
          <span>
            Merge on approve
            <span className="block text-[11.5px] text-muted-foreground">
              Approving a task merges its branch into the epic branch. Off: you merge by hand.
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2.5 text-[13px]">
          <span className="flex-1">
            Parallel tasks per batch
            <span className="block text-[11.5px] text-muted-foreground">
              How many child tasks run at once (1–10).
            </span>
          </span>
          <input
            type="number"
            min={1}
            max={10}
            value={parallelism}
            onChange={(e) => setParallelism(e.target.value)}
            onBlur={() => {
              const n = Math.min(10, Math.max(1, Math.round(Number(parallelism) || 3)))
              setParallelism(String(n))
              api.setSetting('exec:parallelism', String(n)).catch(console.error)
            }}
            className="w-16 rounded-[7px] border border-border bg-secondary px-2.5 py-[5px] font-mono text-[12.5px] text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      </DialogContent>
    </Dialog>
  )
}
