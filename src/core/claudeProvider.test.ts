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

const chatJson = JSON.stringify({
  result: 'sounds good — what auth method?',
  session_id: 'sess-42',
  usage: { input_tokens: 11, output_tokens: 9 },
})

test('chat first turn: no --resume, message on stdin, returns reply + session id', async () => {
  let seen: any
  const provider = new ClaudeProvider({
    spawn: async (cmd, args, cwd, input) => {
      seen = { cmd, args, cwd, input }
      return { stdout: chatJson, stderr: '', code: 0 }
    },
  })
  const r = await provider.chat('let us build login', '/repo/demo', role, null)
  expect(r).toEqual({
    replyText: 'sounds good — what auth method?', sessionId: 'sess-42', tokensIn: 11, tokensOut: 9,
  })
  expect(seen.cwd).toBe('/repo/demo')
  expect(seen.input).toBe('let us build login')
  expect(seen.args).not.toContain('--resume')
  // same permission mapping as run(): role has 'edit' → acceptEdits
  expect(seen.args).toContain('--permission-mode')
  expect(seen.args).toContain('acceptEdits')
})

test('chat later turn passes --resume with the stored session id', async () => {
  let seen: string[] = []
  const provider = new ClaudeProvider({
    spawn: async (_cmd, args) => {
      seen = args
      return { stdout: chatJson, stderr: '', code: 0 }
    },
  })
  await provider.chat('next question', '/repo', role, 'sess-41')
  const i = seen.indexOf('--resume')
  expect(i).toBeGreaterThan(-1)
  expect(seen[i + 1]).toBe('sess-41')
})

test('chat throws when the output has no session_id (cannot continue the thread)', async () => {
  const provider = new ClaudeProvider({
    spawn: async () => ({ stdout: okJson, stderr: '', code: 0 }), // okJson has no session_id
  })
  await expect(provider.chat('x', '/repo', role, null)).rejects.toThrow(/session_id/)
})

test('chat throws when the CLI exits non-zero', async () => {
  const provider = new ClaudeProvider({
    spawn: async () => ({ stdout: '', stderr: 'chat boom', code: 1 }),
  })
  await expect(provider.chat('x', '/repo', role, null)).rejects.toThrow(/chat boom/)
})

test('chat passes --mcp-config and --allowedTools when mcp opts are given', async () => {
  let seen: string[] = []
  const provider = new ClaudeProvider({
    spawn: async (_cmd, args) => {
      seen = args
      return { stdout: chatJson, stderr: '', code: 0 }
    },
  })
  await provider.chat('create them', '/repo', role, 'sess-41', {
    mcp: { url: 'http://127.0.0.1:5555/', token: 'tok-1', toolName: 'mcp__kumpas__create_task' },
  })
  const i = seen.indexOf('--mcp-config')
  expect(i).toBeGreaterThan(-1)
  const cfg = JSON.parse(seen[i + 1])
  expect(cfg.mcpServers.kumpas.type).toBe('http')
  expect(cfg.mcpServers.kumpas.url).toBe('http://127.0.0.1:5555/')
  expect(cfg.mcpServers.kumpas.headers.Authorization).toBe('Bearer tok-1')
  const j = seen.indexOf('--allowedTools')
  expect(seen[j + 1]).toBe('mcp__kumpas__create_task')
  expect(seen).toContain('--resume') // still resumes the session
})

test('chat without mcp opts passes no MCP flags', async () => {
  let seen: string[] = []
  const provider = new ClaudeProvider({
    spawn: async (_cmd, args) => {
      seen = args
      return { stdout: chatJson, stderr: '', code: 0 }
    },
  })
  await provider.chat('plain turn', '/repo', role, null)
  expect(seen).not.toContain('--mcp-config')
  expect(seen).not.toContain('--allowedTools')
})
