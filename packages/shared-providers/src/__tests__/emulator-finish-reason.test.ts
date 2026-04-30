/**
 * Emulator round-trip tests for finishReason.
 *
 * Verifies that each emulator propagates finishReason === 'stop' through to the
 * returned LLMResponse, and that ClaudeCliEmulator maps stop_reason 'end_turn'
 * correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LLMRequest } from '@sidekick/types'
import { createLogManager } from '@sidekick/core'
import { OpenAIEmulator } from '../providers/emulators/openai-emulator'
import { OpenRouterEmulator } from '../providers/emulators/openrouter-emulator'
import { ClaudeCliEmulator } from '../providers/emulators/claude-cli-emulator'
import type { EmulatorStateManager } from '../providers/emulators/emulator-state'

const logger = createLogManager({
  destinations: { console: { enabled: false } },
}).getLogger()

// Minimal fake state manager — no file I/O
function createFakeStateManager(): EmulatorStateManager {
  const counts = new Map<string, number>()

  return {
    load: vi.fn().mockResolvedValue({ version: 1, providers: {} }),
    incrementCallCount: vi.fn().mockImplementation((providerId: string) => {
      const count = (counts.get(providerId) ?? 0) + 1
      counts.set(providerId, count)
      return Promise.resolve(count)
    }),
    getCallCount: vi.fn().mockImplementation((providerId: string) => {
      return Promise.resolve(counts.get(providerId) ?? 0)
    }),
    reset: vi.fn().mockResolvedValue(undefined),
  } as unknown as EmulatorStateManager
}

const testRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'hello' }],
}

describe('Emulator round-trip - finishReason', () => {
  it('OpenAIEmulator complete() returns finishReason === "stop"', async () => {
    const emulator = new OpenAIEmulator(createFakeStateManager(), { model: 'gpt-4' }, logger)

    const response = await emulator.complete(testRequest)

    expect(response.finishReason).toBe('stop')
  })

  it('OpenRouterEmulator complete() returns finishReason === "stop"', async () => {
    const emulator = new OpenRouterEmulator(createFakeStateManager(), { model: 'openai/gpt-4' }, logger)

    const response = await emulator.complete(testRequest)

    expect(response.finishReason).toBe('stop')
  })

  describe('ClaudeCliEmulator', () => {
    let testDir: string

    beforeEach(async () => {
      testDir = join('/tmp/claude/emulator-finish-reason-test', randomUUID())
      await mkdir(testDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true })
    })

    it('returns finishReason === "stop" by mapping stop_reason "end_turn" from the inline script', async () => {
      // The inline EMULATOR_SCRIPT hardcodes stop_reason: "end_turn" — after R3/R6
      // the provider must map that to finishReason: 'stop'
      const statePath = join(testDir, 'state.json')
      const emulator = new ClaudeCliEmulator({ statePath }, logger)

      const response = await emulator.complete(testRequest)

      expect(response.finishReason).toBe('stop')
    })
  })
})
