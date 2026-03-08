/**
 * ClaudeCliEmulator Tests
 *
 * Tests for the Claude CLI emulator that spawns bash scripts.
 * Uses real process spawning to test the actual behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Logger, LLMRequest } from '@sidekick/types'
import { createFakeLogger } from '@sidekick/testing-fixtures'
import { ClaudeCliEmulator } from '../../../providers/emulators/claude-cli-emulator'

// Standard test request
const testRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'Hello, world!' }],
  system: 'You are a helpful assistant.',
}

describe('ClaudeCliEmulator', () => {
  let testDir: string
  let logger: Logger

  beforeEach(async () => {
    testDir = join('/tmp/claude/claude-cli-emulator-test', randomUUID())
    await mkdir(testDir, { recursive: true })
    logger = createFakeLogger()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('constructor', () => {
    it('uses default state path when not provided', () => {
      const emulator = new ClaudeCliEmulator({}, logger)

      expect(emulator.id).toBe('claude-cli-emulator')
    })

    it('uses provided state path', () => {
      const statePath = join(testDir, 'custom-state.json')
      const emulator = new ClaudeCliEmulator({ statePath }, logger)

      expect(emulator.id).toBe('claude-cli-emulator')
    })
  })

  describe('complete', () => {
    it('returns response with correct content format', async () => {
      const statePath = join(testDir, 'state.json')
      const emulator = new ClaudeCliEmulator({ statePath }, logger)

      const response = await emulator.complete(testRequest)

      expect(response.content).toMatch(/\[Claude CLI Emulator\] Call #\d+ - Model:/)
    })

    it('uses request model when provided', async () => {
      const statePath = join(testDir, 'state.json')
      const emulator = new ClaudeCliEmulator({ statePath }, logger)

      const response = await emulator.complete({
        ...testRequest,
        model: 'claude-opus-4',
      })

      expect(response.model).toBe('claude-opus-4')
      expect(response.content).toContain('claude-opus-4')
    })

    it('uses config model when request model not provided', async () => {
      const statePath = join(testDir, 'state.json')
      const emulator = new ClaudeCliEmulator({ statePath, model: 'claude-haiku-3' }, logger)

      const response = await emulator.complete(testRequest)

      expect(response.model).toBe('claude-haiku-3')
    })

    it('uses default model when neither request nor config model provided', async () => {
      const statePath = join(testDir, 'state.json')
      const emulator = new ClaudeCliEmulator({ statePath }, logger)

      const response = await emulator.complete(testRequest)

      expect(response.model).toBe('claude-sonnet-4')
    })

    it('increments call count on each call', async () => {
      const statePath = join(testDir, 'state.json')
      const emulator = new ClaudeCliEmulator({ statePath }, logger)

      const response1 = await emulator.complete(testRequest)
      const response2 = await emulator.complete(testRequest)

      expect(response1.content).toContain('Call #1')
      expect(response2.content).toContain('Call #2')
    })

    it('returns token usage estimates', async () => {
      const statePath = join(testDir, 'state.json')
      const emulator = new ClaudeCliEmulator({ statePath }, logger)

      const response = await emulator.complete(testRequest)

      expect(response.usage).toBeDefined()
      expect(response.usage?.inputTokens).toBeGreaterThan(0)
      expect(response.usage?.outputTokens).toBeGreaterThan(0)
    })

    it('estimates input tokens from system and messages', async () => {
      const statePath = join(testDir, 'state.json')
      const emulator = new ClaudeCliEmulator({ statePath }, logger)

      const response = await emulator.complete({
        messages: [{ role: 'user', content: 'A'.repeat(100) }],
        system: 'B'.repeat(80),
      })

      // (100 + 80) / 4 = 45 tokens expected
      expect(response.usage?.inputTokens).toBe(45)
    })

    it('estimates input tokens without system message', async () => {
      const statePath = join(testDir, 'state.json')
      const emulator = new ClaudeCliEmulator({ statePath }, logger)

      const response = await emulator.complete({
        messages: [{ role: 'user', content: 'A'.repeat(40) }],
      })

      expect(response.usage?.inputTokens).toBe(10)
    })

    it('returns raw response with exit code 0', async () => {
      const statePath = join(testDir, 'state.json')
      const emulator = new ClaudeCliEmulator({ statePath }, logger)

      const response = await emulator.complete(testRequest)

      expect(response.rawResponse.status).toBe(0)
      expect(response.rawResponse.body).toBeDefined()
    })

    it('logs request and response', async () => {
      const statePath = join(testDir, 'state.json')
      const emulator = new ClaudeCliEmulator({ statePath }, logger)

      await emulator.complete(testRequest)

      expect(logger.debug).toHaveBeenCalledWith(
        'LLM request initiated',
        expect.objectContaining({
          provider: 'claude-cli-emulator',
          messageCount: 1,
          hasSystem: true,
        })
      )
      expect(logger.info).toHaveBeenCalledWith(
        'LLM request completed',
        expect.objectContaining({
          provider: 'claude-cli-emulator',
          status: 0,
        })
      )
    })
  })

  describe('id', () => {
    it('returns claude-cli-emulator', () => {
      const emulator = new ClaudeCliEmulator({}, logger)
      expect(emulator.id).toBe('claude-cli-emulator')
    })
  })

  describe('error handling', () => {
    it('logs error when script fails', async () => {
      // Use a non-existent script path to trigger an error
      const emulator = new ClaudeCliEmulator({ scriptPath: '/nonexistent/script.sh' }, logger)

      await expect(emulator.complete(testRequest)).rejects.toThrow()
      expect(logger.error).toHaveBeenCalledWith(
        'LLM request failed',
        expect.objectContaining({
          provider: 'claude-cli-emulator',
        })
      )
    })
  })
})
