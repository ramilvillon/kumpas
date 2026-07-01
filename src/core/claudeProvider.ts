import { execFile } from 'node:child_process'
import type { Agent, AgentProvider, RunResult } from './types.js'
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
    const { stdout, stderr, code } = await this.spawn(this.binary, args, repoPath, prompt)
    if (code !== 0) {
      throw new Error(`claude exited with code ${code}: ${stderr || stdout}`)
    }
    return parseClaudeResult(stdout)
  }
}
