import { expect, test } from 'vitest'
import { assemblePrompt } from './prompt.js'
import type { Comment, Ticket } from './types.js'

const ticket: Ticket = {
  id: 1, projectId: 1, title: 'Fix auth', description: 'Null check missing on line 40',
  columnId: 1, blocked: 0, kind: 'task', priority: null, dueDate: null, assigneeAgentId: null, teamId: null, tags: [],
}

test('includes title and description', () => {
  const out = assemblePrompt(ticket, [])
  expect(out).toContain('Fix auth')
  expect(out).toContain('Null check missing on line 40')
})

test('includes the comment thread in order with authors', () => {
  const comments: Comment[] = [
    { id: 1, ticketId: 1, author: 'human', body: 'please add a test too', kind: 'note', createdAt: 't1' },
    { id: 2, ticketId: 1, author: 'Reviewer', body: 'missing guard', kind: 'note', createdAt: 't2' },
  ]
  const out = assemblePrompt(ticket, comments)
  expect(out.indexOf('please add a test too')).toBeLessThan(out.indexOf('missing guard'))
  expect(out).toContain('human')
  expect(out).toContain('Reviewer')
})

test('notes when there are no comments', () => {
  expect(assemblePrompt(ticket, [])).toContain('(no comments yet)')
})

test('inlines text attachments and lists binary ones by path', () => {
  const out = assemblePrompt(ticket, [], [
    { filename: 'err.log', kind: 'text', path: '/s/1', textContent: 'stack trace here' },
    { filename: 'shot.png', kind: 'binary', path: '/s/2' },
  ])
  expect(out).toContain('## Attachments')
  expect(out).toContain('stack trace here')
  expect(out).toContain('shot.png')
  expect(out).toContain('/s/2')
})
