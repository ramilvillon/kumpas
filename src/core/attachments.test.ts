// src/core/attachments.test.ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { detectKind, readAttachmentForPrompt } from './attachments.js'
import type { Attachment } from './types.js'

function tmpFile(name: string, content: Buffer | string): string {
  const p = join(mkdtempSync(join(tmpdir(), 'kumpas-att-')), name)
  writeFileSync(p, content)
  return p
}

test('detectKind distinguishes text from binary', () => {
  expect(detectKind(tmpFile('a.txt', 'hello'))).toBe('text')
  expect(detectKind(tmpFile('a.bin', Buffer.from([1, 0, 2, 3])))).toBe('binary')
})

test('readAttachmentForPrompt inlines text and truncates past the cap', () => {
  const path = tmpFile('big.txt', 'x'.repeat(50))
  const att: Attachment = {
    id: 1, ticketId: 1, commentId: null, filename: 'big.txt',
    kind: 'text', path, createdAt: 't',
  }
  const out = readAttachmentForPrompt(att, 10)
  expect(out.textContent).toContain('[truncated]')
  expect(out.textContent!.length).toBeLessThan(50)
})

test('readAttachmentForPrompt returns no content for binaries', () => {
  const att: Attachment = {
    id: 2, ticketId: 1, commentId: null, filename: 's.png',
    kind: 'binary', path: '/does/not/matter', createdAt: 't',
  }
  const out = readAttachmentForPrompt(att)
  expect(out.textContent).toBeUndefined()
  expect(out.path).toBe('/does/not/matter')
})
