import { readFileSync } from 'node:fs'
import type { Attachment, AttachmentKind, PromptAttachment } from './types.js'

// Text vs binary by sniffing for a NUL byte in the first 8 KB — good enough,
// no libmagic. ponytail: upgrade to a real content-type sniff if it misfires.
export function detectKind(filePath: string): AttachmentKind {
  return readFileSync(filePath).subarray(0, 8192).includes(0) ? 'binary' : 'text'
}

export function readAttachmentForPrompt(
  att: Attachment, maxBytes = 100_000,
): PromptAttachment {
  if (att.kind !== 'text') {
    return { filename: att.filename, kind: att.kind, path: att.path }
  }
  const buf = readFileSync(att.path)
  const textContent =
    buf.subarray(0, maxBytes).toString('utf8') +
    (buf.byteLength > maxBytes ? '\n… [truncated]' : '')
  return { filename: att.filename, kind: 'text', path: att.path, textContent }
}
