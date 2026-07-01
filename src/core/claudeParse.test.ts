import { expect, test } from 'vitest'
import { parseClaudeResult } from './claudeParse.js'

const sample = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Added a null check on line 40.',
  session_id: 'abc123',
  total_cost_usd: 0.0123,
  usage: { input_tokens: 1520, output_tokens: 340, cache_read_input_tokens: 0 },
})

test('maps claude json to RunResult', () => {
  const r = parseClaudeResult(sample)
  expect(r.resultText).toBe('Added a null check on line 40.')
  expect(r.tokensIn).toBe(1520)
  expect(r.tokensOut).toBe(340)
  expect(r.costUsd).toBeCloseTo(0.0123)
  expect(r.sessionId).toBe('abc123')
})

test('throws a clear error on non-json', () => {
  expect(() => parseClaudeResult('not json')).toThrow(/parse/i)
})

test('defaults missing token fields to 0', () => {
  const r = parseClaudeResult(JSON.stringify({ result: 'ok' }))
  expect(r.tokensIn).toBe(0)
  expect(r.tokensOut).toBe(0)
  expect(r.resultText).toBe('ok')
})
