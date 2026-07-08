import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { detectKind } from './attachments.js'
import type { AttachmentKind } from './types.js'

let counter = 0

// Copies sourcePath into storeDir under a collision-safe name.
// ponytail: monotonic counter + original name — no hashing; the store is
// single-process and single-user. Switch to a content hash if dedup matters.
export function copyIntoStore(
  storeDir: string, sourcePath: string,
): { filename: string; kind: AttachmentKind; path: string } {
  mkdirSync(storeDir, { recursive: true })
  const filename = basename(sourcePath)
  const stored = join(storeDir, `${Date.now()}-${counter++}-${filename}`)
  copyFileSync(sourcePath, stored)
  return { filename, kind: detectKind(sourcePath), path: stored }
}
