import type { RunResult } from './types.js'

export function parseClaudeResult(stdout: string): RunResult {
  let raw: any
  try {
    raw = JSON.parse(stdout)
  } catch {
    throw new Error(`Failed to parse claude output as JSON: ${stdout.slice(0, 200)}`)
  }
  const usage = raw.usage ?? {}
  return {
    resultText: String(raw.result ?? ''),
    tokensIn: Number(usage.input_tokens ?? 0),
    tokensOut: Number(usage.output_tokens ?? 0),
    costUsd: raw.total_cost_usd != null ? Number(raw.total_cost_usd) : undefined,
    sessionId: raw.session_id != null ? String(raw.session_id) : undefined,
  }
}
