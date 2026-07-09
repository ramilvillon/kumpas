import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { expect, test } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyIntoStore } from './attachmentStore.js'

test('copies a text file into the store with detected kind', () => {
  const work = mkdtempSync(join(tmpdir(), 'kum-'))
  const src = join(work, 'notes.txt')
  writeFileSync(src, 'hello')
  const store = join(work, 'store')
  const out = copyIntoStore(store, src)
  expect(out.filename).toBe('notes.txt')
  expect(out.kind).toBe('text')
  expect(existsSync(out.path)).toBe(true)
  expect(readFileSync(out.path, 'utf8')).toBe('hello')
})

test('two files of the same name do not collide', () => {
  const work = mkdtempSync(join(tmpdir(), 'kum-'))
  const store = join(work, 'store')
  writeFileSync(join(work, 'a.txt'), '1')
  const one = copyIntoStore(store, join(work, 'a.txt'))
  writeFileSync(join(work, 'a.txt'), '2')
  const two = copyIntoStore(store, join(work, 'a.txt'))
  expect(one.path).not.toBe(two.path)
  expect(readFileSync(one.path, 'utf8')).toBe('1')
  expect(readFileSync(two.path, 'utf8')).toBe('2')
})
