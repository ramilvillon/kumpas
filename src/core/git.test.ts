import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdtempSync as mkdtemp2 } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { captureDiff, isGitRepo } from './git.js'

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
