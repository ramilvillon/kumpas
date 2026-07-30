import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
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
  mergeTaskBranch,
  removeTaskWorktree,
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
  expect(mergeTaskBranch(repo, 7, 43)).toEqual({ ok: false, conflict: true })
  // aborted: no MERGE_HEAD left behind, working tree clean, 42's content intact
  expect(existsSync(join(repo, '.git', 'worktrees', 'epic-7', 'MERGE_HEAD'))).toBe(false)
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: epicWt }).toString().trim()).toBe('')
  expect(readFileSync(join(epicWt, 'a.txt'), 'utf8')).toBe('from 42\n')
})
