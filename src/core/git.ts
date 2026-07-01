import { execFileSync } from 'node:child_process'

export function captureDiff(repoPath: string): string {
  // -N (intent-to-add) makes untracked files show up in `git diff`.
  execFileSync('git', ['add', '-A', '-N'], { cwd: repoPath })
  return execFileSync('git', ['diff'], { cwd: repoPath, maxBuffer: 64 * 1024 * 1024 }).toString()
}
