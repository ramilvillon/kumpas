import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdtempSync as mkdtemp2,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  addTaskWorktree,
  captureDiff,
  commitAll,
  ensureEpicBranch,
  hasTaskWorktree,
  isGitRepo,
  isTaskWorktreeDirty,
  mergeTaskBranch,
  removeTaskWorktree,
  WORKTREES_DIR,
} from './git.js'

function newRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kumpas-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t.co'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return dir
}

test('captures a modification', () => {
  const dir = newRepo()
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
  const diff = captureDiff(dir)
  expect(diff).toContain('a.txt')
  expect(diff).toContain('+two')
})

test('captures a newly created untracked file', () => {
  const dir = newRepo()
  writeFileSync(join(dir, 'b.txt'), 'new file\n')
  const diff = captureDiff(dir)
  expect(diff).toContain('b.txt')
})

test('returns empty string when nothing changed', () => {
  const dir = newRepo()
  expect(captureDiff(dir).trim()).toBe('')
})

test('isGitRepo is true inside a repo, false outside', () => {
  const repo = newRepo()
  expect(isGitRepo(repo)).toBe(true)
  const plain = mkdtemp2(join(tmpdir(), 'kumpas-plain-'))
  expect(isGitRepo(plain)).toBe(false)
})

test('ensureEpicBranch creates epic/{id} in its own worktree, idempotently', () => {
  const repo = newRepo()
  const wt = ensureEpicBranch(repo, 7)
  expect(wt).toBe(join(repo, '.kumpas-worktrees', 'epic-7'))
  expect(existsSync(join(wt, 'a.txt'))).toBe(true)
  expect(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: wt }).toString().trim())
    .toBe('epic/7')
  expect(ensureEpicBranch(repo, 7)).toBe(wt) // second call is a no-op
})

test('ensureEpicBranch keeps the worktrees dir out of the repo status', () => {
  const repo = newRepo()
  ensureEpicBranch(repo, 7)
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString()
  expect(status).not.toContain('.kumpas-worktrees')
  // recorded locally, not in the user's tracked .gitignore
  expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('.kumpas-worktrees/')
  expect(existsSync(join(repo, '.gitignore'))).toBe(false)
})

function branchOf(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).toString().trim()
}

test('ensureEpicBranch refuses a gutted worktree instead of falling through to the parent repo', () => {
  const repo = newRepo()
  const epicWt = ensureEpicBranch(repo, 9)
  const taskWt = addTaskWorktree(repo, 9, 5)
  writeFileSync(join(taskWt, 'agent.txt'), 'agent work\n')
  commitAll(taskWt, 'task 5')
  const userBranch = branchOf(repo)

  // The directory survives but its .git link is gone: git run with this cwd
  // resolves to the parent repo, i.e. the user's own checkout.
  rmSync(join(epicWt, '.git'))

  expect(() => ensureEpicBranch(repo, 9)).toThrow(/kumpas-worktrees/)
  expect(() => mergeTaskBranch(repo, 9, 5)).toThrow()
  // What matters: the user's checkout is untouched — nothing merged into it.
  expect(branchOf(repo)).toBe(userBranch)
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString().trim()).toBe('')
  expect(existsSync(join(repo, 'agent.txt'))).toBe(false)
})

test('ensureEpicBranch prunes a stale registration and recreates the worktree', () => {
  const repo = newRepo()
  const epicWt = ensureEpicBranch(repo, 9)
  rmSync(join(repo, WORKTREES_DIR), { recursive: true, force: true }) // e.g. git clean -xdf

  expect(ensureEpicBranch(repo, 9)).toBe(epicWt)
  expect(branchOf(epicWt)).toBe('epic/9')
})

test('addTaskWorktree refuses a gutted task worktree, live registration or not', () => {
  const repo = newRepo()
  ensureEpicBranch(repo, 9)
  const taskWt = addTaskWorktree(repo, 9, 5)
  const userBranch = branchOf(repo)
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim()
  writeFileSync(join(repo, 'user-work.txt'), 'the user is mid-edit\n')

  // The registration is still live; only the .git link is gone. Trusting it
  // would make commitAll here commit the user's own work onto their branch.
  rmSync(join(taskWt, '.git'))
  expect(hasTaskWorktree(repo, 5)).toBe(true) // git says live — and git is wrong

  expect(() => addTaskWorktree(repo, 9, 5)).toThrow(/kumpas-worktrees/)
  expect(branchOf(repo)).toBe(userBranch)
  expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim()).toBe(head)
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString())
    .toBe('?? user-work.txt\n') // still uncommitted, still the user's
})

test('addTaskWorktree prunes a stale registration and recreates the worktree', () => {
  const repo = newRepo()
  ensureEpicBranch(repo, 9)
  const wt = addTaskWorktree(repo, 9, 5)
  writeFileSync(join(wt, 'task.txt'), 'work\n')
  commitAll(wt, 'task 5')
  rmSync(wt, { recursive: true, force: true }) // e.g. git clean -xdf

  expect(addTaskWorktree(repo, 9, 5)).toBe(wt)
  expect(branchOf(wt)).toBe('task/5')
  expect(existsSync(join(wt, 'task.txt'))).toBe(true) // the branch's commit, back
})

test('addTaskWorktree branches task/{id} off the epic tip and is idempotent', () => {
  const repo = newRepo()
  const epicWt = ensureEpicBranch(repo, 7)
  writeFileSync(join(epicWt, 'from-epic.txt'), 'epic work\n')
  commitAll(epicWt, 'epic commit')

  const wt = addTaskWorktree(repo, 7, 42)
  expect(wt).toBe(join(repo, '.kumpas-worktrees', 'task-42'))
  expect(existsSync(join(wt, 'from-epic.txt'))).toBe(true) // branched from the epic tip
  expect(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: wt }).toString().trim())
    .toBe('task/42')
  expect(hasTaskWorktree(repo, 42)).toBe(true)
  expect(addTaskWorktree(repo, 7, 42)).toBe(wt) // reused, not recreated
})

test('removeTaskWorktree drops the checkout but keeps the branch', () => {
  const repo = newRepo()
  ensureEpicBranch(repo, 7)
  const wt = addTaskWorktree(repo, 7, 42)
  writeFileSync(join(wt, 'b.txt'), 'work\n')
  commitAll(wt, 'task commit')

  removeTaskWorktree(repo, 42)
  expect(hasTaskWorktree(repo, 42)).toBe(false)
  expect(existsSync(wt)).toBe(false)
  expect(execFileSync('git', ['rev-parse', '--verify', 'task/42'], { cwd: repo }).toString().trim())
    .toHaveLength(40)
  removeTaskWorktree(repo, 42) // idempotent
})

test('commitAll commits every change and reports an empty commit as false', () => {
  const repo = newRepo()
  ensureEpicBranch(repo, 7)
  const wt = addTaskWorktree(repo, 7, 42)
  writeFileSync(join(wt, 'new.txt'), 'hello\n')
  expect(commitAll(wt, 'kumpas: task 42')).toBe(true)
  expect(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: wt }).toString().trim())
    .toBe('kumpas: task 42')
  expect(commitAll(wt, 'kumpas: task 42 again')).toBe(false) // nothing left to commit
})

test('mergeTaskBranch merges a clean task branch into the epic branch', () => {
  const repo = newRepo()
  const epicWt = ensureEpicBranch(repo, 7)
  const wt = addTaskWorktree(repo, 7, 42)
  writeFileSync(join(wt, 'feature.txt'), 'shipped\n')
  commitAll(wt, 'task 42')

  expect(mergeTaskBranch(repo, 7, 42)).toEqual({ ok: true })
  expect(readFileSync(join(epicWt, 'feature.txt'), 'utf8')).toBe('shipped\n')
})

test('mergeTaskBranch reports a conflict and leaves the epic branch clean', () => {
  const repo = newRepo()
  const epicWt = ensureEpicBranch(repo, 7)

  // Both branch off the same epic tip and rewrite the same line — the second
  // merge is guaranteed to conflict.
  const first = addTaskWorktree(repo, 7, 42)
  const second = addTaskWorktree(repo, 7, 43)
  writeFileSync(join(first, 'a.txt'), 'from 42\n')
  commitAll(first, 'task 42')
  writeFileSync(join(second, 'a.txt'), 'from 43\n')
  commitAll(second, 'task 43')

  expect(mergeTaskBranch(repo, 7, 42)).toEqual({ ok: true })
  const res = mergeTaskBranch(repo, 7, 43)
  expect(res.ok).toBe(false)
  expect(res).toMatchObject({ conflict: true })
  // git's own words travel with the failure, so the comment can be specific
  expect(res.ok === false && res.detail).toContain('a.txt')
  // aborted: no MERGE_HEAD left behind, working tree clean, 42's content intact
  expect(existsSync(join(repo, '.git', 'worktrees', 'epic-7', 'MERGE_HEAD'))).toBe(false)
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: epicWt }).toString().trim()).toBe('')
  expect(readFileSync(join(epicWt, 'a.txt'), 'utf8')).toBe('from 42\n')
})

test('isTaskWorktreeDirty sees uncommitted work and nothing else', () => {
  const repo = newRepo()
  ensureEpicBranch(repo, 7)
  expect(isTaskWorktreeDirty(repo, 42)).toBe(false) // no worktree = nothing to lose

  const wt = addTaskWorktree(repo, 7, 42)
  expect(isTaskWorktreeDirty(repo, 42)).toBe(false)
  writeFileSync(join(wt, 'work.txt'), 'in progress\n')
  expect(isTaskWorktreeDirty(repo, 42)).toBe(true)
  commitAll(wt, 'task 42')
  expect(isTaskWorktreeDirty(repo, 42)).toBe(false)
})
