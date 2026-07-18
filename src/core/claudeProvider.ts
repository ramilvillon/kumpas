import { execFile } from 'node:child_process'
import type { Agent, AgentProvider, ChatOpts, ChatTurnResult, RunResult } from './types.js'
import { parseClaudeResult } from './claudeParse.js'

export type SpawnFn = (
  cmd: string, args: string[], cwd: string, input: string,
) => Promise<{ stdout: string; stderr: string; code: number }>

const defaultSpawn: SpawnFn = (cmd, args, cwd, input) =>
  new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout,
        stderr: stderr || (err && typeof err.code !== 'number' ? err.message : ''),
        code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
      })
    })
    child.stdin?.end(input)
  })

// Maps a role's permissionLevel to Claude's --permission-mode. Without this,
// headless `claude -p` denies the Write/Edit tools (no interactive approval)
// and the agent blocks instead of implementing.
//   read → default      reads only (reviewer: reads the diff and comments)
//   edit → acceptEdits   + file writes and common filesystem commands
//   auto → auto          does everything, but a model safety-classifier
//                        approves/denies each tool call (autonomous, supervised)
//   plan → plan          read-only exploration, no edits
// A permissionLevel NOT listed here (e.g. 'inherit') passes NO --permission-mode
// flag, so Claude falls back to the user's ~/.claude/settings.json defaultMode.
// Deliberately NO 'bypassPermissions' mapping: it disables EVERY safety check
// (auto-runs bash/network unattended) and must not be reachable from plain role
// config. If it's ever genuinely needed, gate it behind an explicit env opt-in
// AND a sandbox check — not a static map entry. ('auto' is safe to expose here
// precisely because it keeps the classifier checks that bypass removes.)
const PERMISSION_MODE: Record<string, string> = {
  read: 'default',
  edit: 'acceptEdits',
  auto: 'auto',
  plan: 'plan',
}

export class ClaudeProvider implements AgentProvider {
  private binary: string
  private spawn: SpawnFn

  constructor(opts: { binary?: string; spawn?: SpawnFn } = {}) {
    this.binary = opts.binary ?? 'claude'
    this.spawn = opts.spawn ?? defaultSpawn
  }

  async run(prompt: string, repoPath: string, role: Agent): Promise<RunResult> {
    // Prompt is passed on stdin (via `-p -`) to avoid arg-length limits.
    const args = [
      '-p', '-',
      '--output-format', 'json',
      '--model', role.model,
      '--append-system-prompt', role.systemPrompt,
    ]
    const mode = PERMISSION_MODE[role.permissionLevel]
    if (mode) args.push('--permission-mode', mode)
    const { stdout, stderr, code } = await this.spawn(this.binary, args, repoPath, prompt)
    if (code !== 0) {
      throw new Error(`claude exited with code ${code}: ${stderr || stdout}`)
    }
    return parseClaudeResult(stdout)
  }

  async chat(
    message: string, repoPath: string, role: Agent, sessionId: string | null, opts?: ChatOpts,
  ): Promise<ChatTurnResult> {
    const args = [
      '-p', '-',
      '--output-format', 'json',
      '--model', role.model,
      '--append-system-prompt', role.systemPrompt,
    ]
    if (sessionId) args.push('--resume', sessionId)
    if (opts?.mcp) {
      // Server name 'kumpas' must match the mcp__kumpas__ prefix in toolName.
      args.push(
        '--mcp-config',
        JSON.stringify({
          mcpServers: {
            kumpas: {
              type: 'http',
              url: opts.mcp.url,
              headers: { Authorization: `Bearer ${opts.mcp.token}` },
            },
          },
        }),
        // Pre-approve ONLY this one tool so the headless run never blocks on a
        // permission prompt. The permission-mode mapping stays unchanged.
        '--allowedTools', opts.mcp.toolName,
      )
    }
    const mode = PERMISSION_MODE[role.permissionLevel]
    if (mode) args.push('--permission-mode', mode)
    const { stdout, stderr, code } = await this.spawn(this.binary, args, repoPath, message)
    if (code !== 0) {
      throw new Error(`claude exited with code ${code}: ${stderr || stdout}`)
    }
    const r = parseClaudeResult(stdout)
    if (!r.sessionId) {
      throw new Error('claude output has no session_id — cannot continue this chat')
    }
    return { replyText: r.resultText, sessionId: r.sessionId, tokensIn: r.tokensIn, tokensOut: r.tokensOut }
  }
}
