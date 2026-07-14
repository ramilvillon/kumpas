import { expect, test } from 'vitest'
import { ClaudeProvider } from './claudeProvider.js'
import type { Agent } from './types.js'

const role: Agent = {
  id: 1, name: 'Developer', provider: 'claude', model: 'claude-sonnet-5',
  systemPrompt: 'you write code', permissionLevel: 'edit', archived: false,
}

const okJson = JSON.stringify({
  result: 'done', usage: { input_tokens: 10, output_tokens: 5 },
})

test('passes prompt, cwd, and model to the CLI and returns parsed result', async () => {
  let seen: any
  const provider = new ClaudeProvider({
    spawn: async (cmd, args, cwd, input) => {
      seen = { cmd, args, cwd, input }
      return { stdout: okJson, stderr: '', code: 0 }
    },
  })
  const r = await provider.run('do the thing', '/repo/demo', role)
  expect(r.resultText).toBe('done')
  expect(r.tokensIn).toBe(10)
  expect(seen.cwd).toBe('/repo/demo')
  expect(seen.args).toContain('--output-format')
  expect(seen.args).toContain('json')
  expect(seen.args).toContain('claude-sonnet-5')
  expect(seen.input).toContain('do the thing')
})

test('maps permissionLevel to --permission-mode; unknown levels inherit (no flag)', async () => {
  const modeFor = async (level: string) => {
    let seen: string[] = []
    const provider = new ClaudeProvider({
      spawn: async (_cmd, args) => {
        seen = args
        return { stdout: okJson, stderr: '', code: 0 }
      },
    })
    await provider.run('x', '/repo', { ...role, permissionLevel: level })
    const i = seen.indexOf('--permission-mode')
    return i === -1 ? null : seen[i + 1]
  }

  expect(await modeFor('edit')).toBe('acceptEdits')
  expect(await modeFor('auto')).toBe('auto')
  expect(await modeFor('read')).toBe('default')
  expect(await modeFor('plan')).toBe('plan')
  // unlisted level → no flag → Claude uses its own settings defaultMode
  expect(await modeFor('inherit')).toBeNull()
  // bypassPermissions is intentionally NOT reachable from role config
  expect(await modeFor('bypassPermissions')).toBeNull()
})

test('throws when the CLI exits non-zero', async () => {
  const provider = new ClaudeProvider({
    spawn: async () => ({ stdout: '', stderr: 'boom', code: 1 }),
  })
  await expect(provider.run('x', '/repo', role)).rejects.toThrow(/boom/)
})

test('a missing CLI binary surfaces a diagnostic error', async () => {
  const provider = new ClaudeProvider({ binary: 'kumpas-no-such-binary-xyz' })
  await expect(provider.run('x', process.cwd(), role)).rejects.toThrow(/ENOENT|no-such-binary/i)
})
