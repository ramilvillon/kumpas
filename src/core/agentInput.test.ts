import { expect, test } from 'vitest'
import { validateAgentCreate, validateAgentPatch, validateTeamCreate, validateTeamIds, validateTeamPatch, validateChatCreate, validateChatPatch, validateChatBody, validatePromote, type AgentCreateInput } from './agentInput.js'

const good: AgentCreateInput = {
  name: 'Dev', provider: 'claude', model: 'claude-sonnet-5',
  systemPrompt: 'implement the ticket', permissionLevel: 'auto',
}

test('valid create input passes', () => {
  expect(() => validateAgentCreate(good)).not.toThrow()
  expect(() => validateAgentCreate({ ...good, systemPrompt: '' })).not.toThrow() // empty prompt allowed
})

test('create requires every field', () => {
  const { permissionLevel: _omit, ...missing } = good
  expect(() => validateAgentCreate(missing as AgentCreateInput)).toThrow(/missing field: permissionLevel/)
  expect(() => validateAgentCreate(undefined as unknown as AgentCreateInput)).toThrow()
})

test('permission level whitelist: bypassPermissions and friends are rejected', () => {
  for (const bad of ['bypassPermissions', 'bypass', 'admin', '', 'READ']) {
    expect(() => validateAgentCreate({ ...good, permissionLevel: bad })).toThrow(/permission level/)
    expect(() => validateAgentPatch({ permissionLevel: bad })).toThrow(/permission level/)
  }
  for (const ok of ['read', 'edit', 'auto']) {
    expect(() => validateAgentPatch({ permissionLevel: ok })).not.toThrow()
  }
})

test('provider whitelist', () => {
  expect(() => validateAgentPatch({ provider: 'gpt' as never })).toThrow(/provider/)
  for (const ok of ['claude', 'agy', 'codex'] as const) {
    expect(() => validateAgentPatch({ provider: ok })).not.toThrow()
  }
})

test('name and model must be non-empty after trim', () => {
  expect(() => validateAgentPatch({ name: '   ' })).toThrow(/name/)
  expect(() => validateAgentPatch({ model: '' })).toThrow(/model/)
  expect(() => validateAgentPatch({ name: 'ok', model: 'ok' })).not.toThrow()
})

test('patch: absent keys are not validated; archived must be boolean; junk patch rejected', () => {
  expect(() => validateAgentPatch({})).not.toThrow()
  expect(() => validateAgentPatch({ archived: true })).not.toThrow()
  expect(() => validateAgentPatch({ archived: 1 as never })).toThrow(/archived/)
  expect(() => validateAgentPatch(null as never)).toThrow()
})

test('team name must be non-empty on create and patch', () => {
  expect(() => validateTeamCreate({ name: 'Backend' })).not.toThrow()
  expect(() => validateTeamCreate({ name: '   ' })).toThrow(/team name/)
  expect(() => validateTeamCreate({} as never)).toThrow(/missing field: name/)
  expect(() => validateTeamCreate(undefined as never)).toThrow()
  expect(() => validateTeamPatch({})).not.toThrow()
  expect(() => validateTeamPatch({ name: '' })).toThrow(/team name/)
  expect(() => validateTeamPatch({ archived: true })).not.toThrow()
  expect(() => validateTeamPatch({ archived: 1 as never })).toThrow(/archived/)
  expect(() => validateTeamPatch(null as never)).toThrow()
})

test('teamIds must be an array of integers', () => {
  expect(() => validateTeamIds([])).not.toThrow()
  expect(() => validateTeamIds([1, 2, 3])).not.toThrow()
  expect(() => validateTeamIds([1.5])).toThrow(/integers/)
  expect(() => validateTeamIds(['1'])).toThrow(/integers/)
  expect(() => validateTeamIds('nope')).toThrow(/integers/)
  expect(() => validateTeamIds(null)).toThrow(/integers/)
})

test('validateChatCreate: requires integer ids and non-empty title', () => {
  expect(() => validateChatCreate({ projectId: 1, agentId: 2, title: 'Login' })).not.toThrow()
  expect(() => validateChatCreate(null as never)).toThrow(/invalid chat input/)
  expect(() => validateChatCreate({ projectId: 1.5, agentId: 2, title: 'x' } as never)).toThrow(/projectId/)
  expect(() => validateChatCreate({ projectId: 1, agentId: '2', title: 'x' } as never)).toThrow(/agentId/)
  expect(() => validateChatCreate({ projectId: 1, agentId: 2, title: '  ' })).toThrow(/title/)
})

test('validateChatPatch: title non-empty if present, archived boolean if present', () => {
  expect(() => validateChatPatch({})).not.toThrow()
  expect(() => validateChatPatch({ title: 'Renamed' })).not.toThrow()
  expect(() => validateChatPatch({ archived: true })).not.toThrow()
  expect(() => validateChatPatch({ title: ' ' })).toThrow(/title/)
  expect(() => validateChatPatch({ archived: 1 } as never)).toThrow(/archived/)
  expect(() => validateChatPatch(null as never)).toThrow(/invalid chat input/)
})

test('validateChatBody rejects empty and non-string bodies', () => {
  expect(() => validateChatBody('hello')).not.toThrow()
  expect(() => validateChatBody('   ')).toThrow(/message/)
  expect(() => validateChatBody(42)).toThrow(/message/)
})

test('validatePromote requires non-empty title and description', () => {
  expect(() => validatePromote({ title: 'Spec', description: 'body' })).not.toThrow()
  expect(() => validatePromote({ title: ' ', description: 'body' })).toThrow(/title/)
  expect(() => validatePromote({ title: 'Spec', description: '' })).toThrow(/description/)
  expect(() => validatePromote(null as never)).toThrow(/invalid promote input/)
})
