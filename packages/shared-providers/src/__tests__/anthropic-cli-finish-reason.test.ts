/**
 * Anthropic CLI Provider - finishReason mapping tests
 *
 * Tests the stop_reason -> finishReason normalization map defined in the spec (R3):
 *   end_turn        -> stop
 *   max_tokens      -> length
 *   stop_sequence   -> stop
 *   tool_use        -> tool_calls
 *   <anything else> -> pass-through
 *   absent / raw-output fallback -> undefined
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createLogManager } from '@sidekick/core'
import { AnthropicCliProvider } from '../providers/anthropic-cli'

// Mock node:child_process so we never actually spawn a process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// Mock the spawnClaudeCli utility — it sits between the provider and the real spawn
vi.mock('../claude-cli-spawn', () => ({
  spawnClaudeCli: vi.fn(),
}))

const logger = createLogManager({
  destinations: { console: { enabled: false } },
}).getLogger()

const makeProvider = () => new AnthropicCliProvider({ model: 'claude-3-5-sonnet-20241022' }, logger)

const baseRequest = { messages: [{ role: 'user' as const, content: 'hello' }] }

describe('AnthropicCliProvider - finishReason mapping', () => {
  let mockSpawnClaudeCli: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const spawn = await import('../claude-cli-spawn')
    mockSpawnClaudeCli = spawn.spawnClaudeCli as ReturnType<typeof vi.fn>
    mockSpawnClaudeCli.mockClear()
  })

  const makeCliOutput = (stop_reason: string) => ({
    stdout: JSON.stringify({
      result: 'assistant response',
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason,
    }),
    exitCode: 0,
  })

  it('maps stop_reason "end_turn" to finishReason "stop"', async () => {
    mockSpawnClaudeCli.mockResolvedValue(makeCliOutput('end_turn'))

    const response = await makeProvider().complete(baseRequest)

    expect(response.finishReason).toBe('stop')
  })

  it('maps stop_reason "max_tokens" to finishReason "length"', async () => {
    mockSpawnClaudeCli.mockResolvedValue(makeCliOutput('max_tokens'))

    const response = await makeProvider().complete(baseRequest)

    expect(response.finishReason).toBe('length')
  })

  it('maps stop_reason "stop_sequence" to finishReason "stop"', async () => {
    mockSpawnClaudeCli.mockResolvedValue(makeCliOutput('stop_sequence'))

    const response = await makeProvider().complete(baseRequest)

    expect(response.finishReason).toBe('stop')
  })

  it('maps stop_reason "tool_use" to finishReason "tool_calls"', async () => {
    mockSpawnClaudeCli.mockResolvedValue(makeCliOutput('tool_use'))

    const response = await makeProvider().complete(baseRequest)

    expect(response.finishReason).toBe('tool_calls')
  })

  it('passes unknown stop_reason values through as-is', async () => {
    mockSpawnClaudeCli.mockResolvedValue(makeCliOutput('something_else'))

    const response = await makeProvider().complete(baseRequest)

    expect(response.finishReason).toBe('something_else')
  })

  it('produces finishReason === undefined on raw-output fallback path (non-JSON CLI output)', async () => {
    // Non-JSON output triggers the fallback path in parseCliResponse
    mockSpawnClaudeCli.mockResolvedValue({
      stdout: 'This is plain text output, not JSON',
      exitCode: 0,
    })

    const response = await makeProvider().complete(baseRequest)

    expect(response.finishReason).toBeUndefined()
  })
})
