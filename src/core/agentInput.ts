import type { ProviderName } from './types.js'

// Trust boundary: the main process must reject bad values no matter what a
// (possibly compromised) renderer sends. In particular, no permission level
// outside this whitelist may ever reach the agents table.
export const PROVIDERS: readonly ProviderName[] = ['claude', 'agy', 'codex']
export const PERMISSION_LEVELS = ['read', 'edit', 'auto'] as const

export interface AgentCreateInput {
  name: string
  provider: ProviderName
  model: string
  systemPrompt: string
  permissionLevel: string
}
export type AgentPatch = Partial<AgentCreateInput & { archived: boolean }>

export function validateAgentPatch(patch: AgentPatch): void {
  if (patch === null || typeof patch !== 'object') throw new Error('invalid agent input')
  if ('name' in patch && (typeof patch.name !== 'string' || !patch.name.trim()))
    throw new Error('agent name must not be empty')
  if ('provider' in patch && !PROVIDERS.includes(patch.provider as ProviderName))
    throw new Error(`provider must be one of: ${PROVIDERS.join(', ')}`)
  if ('model' in patch && (typeof patch.model !== 'string' || !patch.model.trim()))
    throw new Error('model must not be empty')
  if ('systemPrompt' in patch && typeof patch.systemPrompt !== 'string')
    throw new Error('system prompt must be a string')
  if ('permissionLevel' in patch && !(PERMISSION_LEVELS as readonly string[]).includes(patch.permissionLevel as string))
    throw new Error(`permission level must be one of: ${PERMISSION_LEVELS.join(', ')}`)
  if ('archived' in patch && typeof patch.archived !== 'boolean')
    throw new Error('archived must be a boolean')
}

export function validateAgentCreate(input: AgentCreateInput): void {
  if (input === null || input === undefined || typeof input !== 'object')
    throw new Error('invalid agent input')
  for (const k of ['name', 'provider', 'model', 'systemPrompt', 'permissionLevel'] as const) {
    if (!(k in input)) throw new Error(`missing field: ${k}`)
  }
  validateAgentPatch(input)
}

export function validateTeamPatch(patch: { name?: string; archived?: boolean }): void {
  if (patch === null || typeof patch !== 'object') throw new Error('invalid team input')
  if ('name' in patch && (typeof patch.name !== 'string' || !patch.name.trim()))
    throw new Error('team name must not be empty')
  if ('archived' in patch && typeof patch.archived !== 'boolean')
    throw new Error('archived must be a boolean')
}

export function validateTeamCreate(input: { name: string }): void {
  if (input === null || input === undefined || typeof input !== 'object')
    throw new Error('invalid team input')
  if (!('name' in input)) throw new Error('missing field: name')
  validateTeamPatch(input)
}

export function validateTeamIds(teamIds: unknown): asserts teamIds is number[] {
  if (!Array.isArray(teamIds) || teamIds.some((t) => !Number.isInteger(t)))
    throw new Error('teamIds must be an array of integers')
}
