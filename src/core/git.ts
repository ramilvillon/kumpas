import { execFileSync } from 'node:child_process'

export function captureDiff(repoPath: string): string {
  // -N (intent-to-add) makes untracked files show up in `git diff`.
  execFileSync('git', ['add', '-A', '-N'], { cwd: repoPath })
  return execFileSync('git', ['diff'], { cwd: repoPath, maxBuffer: 64 * 1024 * 1024 }).toString()
}

export function isGitRepo(path: string): boolean {
  try {
    const out = execFileSync('git', ['-C', path, 'rev-parse', '--is-inside-work-tree'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    return out === 'true'
  } catch {
    return false
  }
}
