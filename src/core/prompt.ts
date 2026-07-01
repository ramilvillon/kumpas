import type { Comment, PromptAttachment, Ticket } from './types.js'

export function assemblePrompt(
  ticket: Ticket, comments: Comment[], attachments: PromptAttachment[] = [],
): string {
  const thread = comments.length
    ? comments.map((c) => `[${c.author}] ${c.body}`).join('\n')
    : '(no comments yet)'

  const parts = [
    `# Ticket: ${ticket.title}`,
    '',
    ticket.description,
    '',
    '## Discussion thread',
    thread,
  ]

  if (attachments.length) {
    parts.push('', '## Attachments')
    for (const a of attachments) {
      if (a.kind === 'text' && a.textContent != null) {
        parts.push(`--- ${a.filename} (text) ---`, a.textContent)
      } else {
        parts.push(`--- ${a.filename} (binary) — read it at: ${a.path}`)
      }
    }
  }

  parts.push(
    '',
    'Implement this ticket in the current repository. If you cannot proceed ' +
      'without more information, reply with a single line beginning "BLOCKED:" ' +
      'followed by your question, and make no code changes.',
  )
  return parts.join('\n')
}
