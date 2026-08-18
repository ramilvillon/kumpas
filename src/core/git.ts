import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

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

export const WORKTREES_DIR = '.kumpas-worktrees'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }).toString()
}

function gitOk(cwd: string, args: string[]): boolean {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function epicBranch(epicId: number): string {
  return `epic/${epicId}`
}

export function taskBranch(taskId: number): string {
  return `task/${taskId}`
}

export function taskWorktreePath(repoPath: string, taskId: number): string {
  return join(repoPath, WORKTREES_DIR, `task-${taskId}`)
}

function epicWorktreePath(repoPath: string, epicId: number): string {
  return join(repoPath, WORKTREES_DIR, `epic-${epicId}`)
}

function branchExists(repoPath: string, name: string): boolean {
  return gitOk(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])
}

// The worktrees sit inside the managed repo, so `git status` and any `git add -A`
// the agent runs would see them. .git/info/exclude is the local-only equivalent
// of .gitignore — Kumpas never edits a file the user has committed.
function excludeWorktreesDir(repoPath: string): void {
  const gitDir = git(repoPath, ['rev-parse', '--git-common-dir']).trim()
  const file = resolve(repoPath, gitDir, 'info', 'exclude')
  const line = `${WORKTREES_DIR}/`
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (current.split('\n').includes(line)) return
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${current === '' || current.endsWith('\n') ? '' : '\n'}${line}\n`)
}

// Whether git itself considers this worktree live. Never ask the filesystem: a
// directory whose .git link is missing makes every git call using it as cwd
// resolve to the parent repo — i.e. the user's own checkout.
function isRegisteredWorktree(repoPath: string, leaf: string): boolean {
  // ponytail: git realpath's worktree paths in its output (e.g. macOS /var ->
  // /private/var); realpath repoPath too so the comparison lines up.
  const target = join(realpathSync(repoPath), WORKTREES_DIR, leaf)
  return git(repoPath, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .some((l) => resolve(l.slice('worktree '.length)) === target)
}

// The only way to a worktree path: returns it when git owns a live worktree
// there, null when there is nothing, and throws when the directory exists but
// git does not own it — a gutted worktree must never be handed to a caller,
// because git run with that cwd resolves to the user's own checkout.
// A live registration alone is not enough: `.git` can be deleted underneath one.
// ponytail: prune on every call — one extra git call per task, cheaper than
// any way of knowing it isn't needed.
function liveWorktree(repoPath: string, leaf: string): string | null {
  // Registrations left over from a moved project, a `git clean -xdf` or a
  // deleted .git link would otherwise fail every `worktree add` forever — or,
  // worse, be trusted; prune self-heals them.
  git(repoPath, ['worktree', 'prune'])
  const path = join(repoPath, WORKTREES_DIR, leaf)
  if (isRegisteredWorktree(repoPath, leaf)) return path
  if (existsSync(path)) {
    throw new Error(
      `${path} exists but is not a registered git worktree. Kumpas will not use it — ` +
        `delete that directory and retry.`,
    )
  }
  return null
}

// The epic branch gets its own worktree: merging into a branch needs it checked
// out somewhere, and the user's working tree must never be touched.
export function ensureEpicBranch(repoPath: string, epicId: number): string {
  excludeWorktreesDir(repoPath)
  const branch = epicBranch(epicId)
  if (!branchExists(repoPath, branch)) {
    // ponytail: 'main' when it exists, else the current HEAD — covers master
    // and freshly-renamed default branches without a config knob.
    git(repoPath, ['branch', branch, branchExists(repoPath, 'main') ? 'main' : 'HEAD'])
  }
  const live = liveWorktree(repoPath, `epic-${epicId}`)
  if (live) return live
  const path = epicWorktreePath(repoPath, epicId)
  git(repoPath, ['worktree', 'add', path, branch])
  return path
}

export function hasTaskWorktree(repoPath: string, taskId: number): boolean {
  return isRegisteredWorktree(repoPath, `task-${taskId}`)
}

export function addTaskWorktree(repoPath: string, epicId: number, taskId: number): string {
  const live = liveWorktree(repoPath, `task-${taskId}`)
  if (live) return live
  const path = taskWorktreePath(repoPath, taskId)
  const branch = taskBranch(taskId)
  if (branchExists(repoPath, branch)) {
    git(repoPath, ['worktree', 'add', path, branch]) // re-run / resume: reuse the branch
  } else {
    git(repoPath, ['worktree', 'add', '-b', branch, path, epicBranch(epicId)])
  }
  return path
}

export function removeTaskWorktree(repoPath: string, taskId: number): void {
  if (hasTaskWorktree(repoPath, taskId)) {
    git(repoPath, ['worktree', 'remove', '--force', taskWorktreePath(repoPath, taskId)])
  }
  git(repoPath, ['worktree', 'prune'])
}

// Agents don't reliably commit; without this the task branch would carry no
// commits and the merge into the epic would be a no-op.
export function commitAll(worktreePath: string, message: string): boolean {
  git(worktreePath, ['add', '-A'])
  return gitOk(worktreePath, ['commit', '-q', '-m', message])
}

export type MergeResult = { ok: true } | { ok: false; conflict: true; detail: string }

// ponytail: no exit-code triage — git's own output goes in `detail` and reaches
// the human, so a locked index doesn't have to masquerade as a conflict.
export function mergeTaskBranch(repoPath: string, epicId: number, taskId: number): MergeResult {
  const cwd = ensureEpicBranch(repoPath, epicId)
  const args = ['merge', '--no-ff', '-m', `merge ${taskBranch(taskId)}`, taskBranch(taskId)]
  try {
    git(cwd, args)
    return { ok: true }
  } catch (err) {
    // git reports conflicts on stdout and hard failures on stderr; take both.
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string }
    const detail =
      `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`.trim() || String(e.message)
    gitOk(cwd, ['merge', '--abort']) // leave the integration branch clean
    return { ok: false, conflict: true, detail }
  }
}

// Approve force-removes the worktree, so anything uncommitted there is gone for
// good; callers check this first. Ignored files (node_modules, build output) do
// not show up in --porcelain, so ordinary agent debris doesn't block an approve.
export function isTaskWorktreeDirty(repoPath: string, taskId: number): boolean {
  if (!hasTaskWorktree(repoPath, taskId)) return false // nothing to lose
  return git(taskWorktreePath(repoPath, taskId), ['status', '--porcelain']).trim() !== ''
}
