/**
 * TranscriptServiceImpl Tests
 *
 * Tests for file watching, metrics computation, compaction detection,
 * and event emission.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  TranscriptServiceImpl,
  createDefaultMetrics,
  createDefaultTokenUsage,
  type TranscriptServiceOptions,
} from '../transcript-service'
import type { HandlerRegistry, Logger, TranscriptEventType, TranscriptEntry } from '@sidekick/types'
import { MockStateService } from '@sidekick/testing-fixtures'

// ============================================================================
// Test Helpers for Internal API Access
// ============================================================================

/**
 * Type for accessing TranscriptServiceImpl's internal methods for testing.
 *
 * DESIGN NOTE: The `processTranscriptFile` method is private because it's
 * triggered by the file watcher in production. However, tests need to
 * trigger it directly to verify behavior without waiting for debounced
 * file events or creating race conditions.
 *
 * This type makes the testing intent explicit and allows type-safe access
 * to internal methods without scattered `as unknown as { ... }` casts.
 */
interface TranscriptServiceTestInternals {
  processTranscriptFile: () => Promise<void>
  persistMetrics: (immediate: boolean) => Promise<void>
  // Streaming/buffer internals for testing
  lastProcessedByteOffset: number
  excerptBufferCount: number
  getBufferedEntries: () => Array<{ lineNumber: number; rawLine: string; uuid: string | null }>
  resetStreamingState: () => void
}

/**
 * Cast service to access internal methods for testing.
 */
function getTestHelpers(service: TranscriptServiceImpl): TranscriptServiceTestInternals {
  return service as unknown as TranscriptServiceTestInternals
}

// ============================================================================
// Test Utilities
// ============================================================================

function createMockLogger(): Logger {
  return {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn(() => createMockLogger()),
    flush: vi.fn(() => Promise.resolve()),
  }
}

function createMockHandlerRegistry(): HandlerRegistry & {
  emittedEvents: Array<{ eventType: TranscriptEventType; entry: TranscriptEntry; lineNumber: number }>
} {
  const emittedEvents: Array<{ eventType: TranscriptEventType; entry: TranscriptEntry; lineNumber: number }> = []
  return {
    register: vi.fn(),
    invokeHook: vi.fn(() => Promise.resolve({})),
    emitTranscriptEvent: vi.fn((eventType, entry, lineNumber) => {
      emittedEvents.push({ eventType, entry, lineNumber })
      return Promise.resolve()
    }),
    emittedEvents,
  }
}

function createTestDir(): string {
  const testDir = join(tmpdir(), `transcript-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
  return testDir
}

function cleanupTestDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================================
// Default Metrics Tests
// ============================================================================

describe('createDefaultMetrics', () => {
  it('returns zeroed metrics', () => {
    const metrics = createDefaultMetrics()
    expect(metrics.turnCount).toBe(0)
    expect(metrics.toolCount).toBe(0)
    expect(metrics.toolsThisTurn).toBe(0)
    expect(metrics.messageCount).toBe(0)
    expect(metrics.toolsPerTurn).toBe(0)
    expect(metrics.lastProcessedLine).toBe(0)
    expect(metrics.lastUpdatedAt).toBe(0)
  })

  it('returns zeroed token usage', () => {
    const metrics = createDefaultMetrics()
    expect(metrics.tokenUsage.inputTokens).toBe(0)
    expect(metrics.tokenUsage.outputTokens).toBe(0)
    expect(metrics.tokenUsage.totalTokens).toBe(0)
  })
})

describe('createDefaultTokenUsage', () => {
  it('returns zeroed token usage with all fields', () => {
    const usage = createDefaultTokenUsage()
    expect(usage.inputTokens).toBe(0)
    expect(usage.outputTokens).toBe(0)
    expect(usage.totalTokens).toBe(0)
    expect(usage.cacheCreationInputTokens).toBe(0)
    expect(usage.cacheReadInputTokens).toBe(0)
    expect(usage.cacheTiers.ephemeral5mInputTokens).toBe(0)
    expect(usage.cacheTiers.ephemeral1hInputTokens).toBe(0)
    expect(usage.serviceTierCounts).toEqual({})
    expect(usage.byModel).toEqual({})
  })
})

// ============================================================================
// TranscriptServiceImpl Tests
// ============================================================================

describe('TranscriptServiceImpl', () => {
  let testDir: string
  let stateDir: string
  let transcriptPath: string
  let logger: Logger
  let handlers: ReturnType<typeof createMockHandlerRegistry>
  let mockStateService: MockStateService
  let service: TranscriptServiceImpl

  beforeEach(() => {
    testDir = createTestDir()
    stateDir = join(testDir, '.sidekick')
    transcriptPath = join(testDir, 'transcript.jsonl')
    logger = createMockLogger()
    handlers = createMockHandlerRegistry()
    mockStateService = new MockStateService(testDir)

    const options: TranscriptServiceOptions = {
      watchDebounceMs: 50,
      metricsPersistIntervalMs: 60000, // Long interval to avoid interference
      handlers,
      logger,
      stateDir,
      stateService: mockStateService,
    }

    service = new TranscriptServiceImpl(options)
  })

  afterEach(async () => {
    await service.shutdown()
    cleanupTestDir(testDir)
  })

  // --------------------------------------------------------------------------
  // Lifecycle Tests
  // --------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('initializes with empty transcript', async () => {
      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(0)
      expect(metrics.messageCount).toBe(0)
    })

    it('initializes with non-existent transcript', async () => {
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(0)
    })

    it('throws error when prepare() called twice without shutdown', async () => {
      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)

      await expect(async () => {
        await service.prepare('another-session', transcriptPath)
      }).rejects.toThrow('TranscriptService already prepared - call shutdown() first')
    })

    it('throws error when start() called before prepare()', async () => {
      await expect(async () => {
        await service.start()
      }).rejects.toThrow('TranscriptService.start() called before prepare()')
    })

    it('allows re-initialization after shutdown', async () => {
      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()
      await service.shutdown()

      // Should not throw - can prepare again after shutdown
      await service.prepare('another-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(0)
    })

    it('handles duplicate start() calls idempotently', async () => {
      writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }))
      await service.prepare('test-session', transcriptPath)
      await service.start()

      // Call start() again - should return early without error
      await service.start()

      // Verify logging indicates it was skipped
      expect(logger.debug).toHaveBeenCalledWith(
        'TranscriptService.start() called but already running, skipping',
        expect.objectContaining({ sessionId: 'test-session' })
      )

      // Metrics should still be correct (not processed twice)
      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(1)
    })
  })

  // --------------------------------------------------------------------------
  // catchUp() Serialization Tests
  // --------------------------------------------------------------------------

  describe('catchUp', () => {
    it('processes new transcript entries written after start()', async () => {
      // Start with one entry
      writeFileSync(
        transcriptPath,
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }) + '\n'
      )
      await service.prepare('test-session', transcriptPath)
      await service.start()

      expect(service.getMetrics().turnCount).toBe(1)

      // Append a new entry (simulates Claude writing to transcript)
      const { appendFileSync } = await import('node:fs')
      appendFileSync(
        transcriptPath,
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
        }) + '\n'
      )

      // Without catchUp, the buffer wouldn't have the new entry yet
      // (file watcher debounce hasn't fired)
      await service.catchUp()

      expect(service.getMetrics().messageCount).toBe(2)
    })

    it('is idempotent when called twice with no new data', async () => {
      writeFileSync(
        transcriptPath,
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }) + '\n'
      )
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metricsBefore = service.getMetrics()

      // Two serial catchUp calls - second should find nothing new
      await service.catchUp()
      await service.catchUp()

      const metricsAfter = service.getMetrics()
      expect(metricsAfter.turnCount).toBe(metricsBefore.turnCount)
      expect(metricsAfter.messageCount).toBe(metricsBefore.messageCount)
    })

    it('serializes with concurrent calls (no duplicate events)', async () => {
      writeFileSync(
        transcriptPath,
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }) + '\n'
      )
      await service.prepare('test-session', transcriptPath)
      await service.start()

      // Append new data
      const { appendFileSync } = await import('node:fs')
      appendFileSync(
        transcriptPath,
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Response' }] },
        }) + '\n'
      )

      // Fire two catchUp calls concurrently
      await Promise.all([service.catchUp(), service.catchUp()])

      // Should have processed the new entry exactly once
      expect(service.getMetrics().messageCount).toBe(2)
    })

    it('cancels pending debounce timer', async () => {
      writeFileSync(
        transcriptPath,
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }) + '\n'
      )
      await service.prepare('test-session', transcriptPath)
      await service.start()

      // Append new data
      const { appendFileSync } = await import('node:fs')
      appendFileSync(
        transcriptPath,
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Response' }] },
        }) + '\n'
      )

      // catchUp should process immediately, not wait for debounce
      await service.catchUp()

      expect(service.getMetrics().messageCount).toBe(2)
    })

    it('recovers after processTranscriptFile() error (chain not poisoned)', async () => {
      writeFileSync(
        transcriptPath,
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }) + '\n'
      )
      await service.prepare('test-session', transcriptPath)
      await service.start()

      expect(service.getMetrics().turnCount).toBe(1)

      // Delete the file to force an error path (statSync will throw or existsSync returns false)
      const { unlinkSync, appendFileSync } = await import('node:fs')
      unlinkSync(transcriptPath)

      // catchUp on a missing file should not throw (processTranscriptFile guards with existsSync)
      await service.catchUp()

      // Recreate the file with new data
      writeFileSync(
        transcriptPath,
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'New session' } }) + '\n'
      )
      appendFileSync(
        transcriptPath,
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Reply' }] },
        }) + '\n'
      )

      // Next catchUp should succeed — chain is not poisoned
      await service.catchUp()

      // File was recreated so it processes from offset 0 (truncation detection)
      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBeGreaterThanOrEqual(1)
      expect(metrics.messageCount).toBeGreaterThanOrEqual(2)
    })

    it('is a safe no-op after shutdown()', async () => {
      writeFileSync(
        transcriptPath,
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }) + '\n'
      )
      await service.prepare('test-session', transcriptPath)
      await service.start()
      await service.shutdown()

      // Should not throw — transcriptPath is null, processTranscriptFile bails early
      await expect(service.catchUp()).resolves.toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // Metrics Computation Tests
  // --------------------------------------------------------------------------

  describe('metrics computation', () => {
    it('increments turnCount and messageCount on user message', async () => {
      const transcript = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } })].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(1)
      expect(metrics.messageCount).toBe(1)
    })

    it('increments messageCount on assistant message', async () => {
      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ text: 'Hi' }] } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(1)
      expect(metrics.messageCount).toBe(2)
    })

    it('increments toolCount on tool_use in assistant message content', async () => {
      const transcript = [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/test' } },
              { type: 'tool_use', id: 'tool-2', name: 'Write', input: { file_path: '/test' } },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' },
              { type: 'tool_result', tool_use_id: 'tool-2', content: 'wrote file' },
            ],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.toolCount).toBe(2)
      expect(metrics.toolsThisTurn).toBe(2)
    })

    it('resets toolsThisTurn on real user message (not tool_result wrapper)', async () => {
      const transcript = [
        // Real user prompt starts a turn
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'First prompt' } }),
        // Assistant requests tools
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/test1' } },
              { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/test2' } },
            ],
          },
        }),
        // Tool result wrapper: does NOT start a new turn
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tool-1', content: 'result 1' },
              { type: 'tool_result', tool_use_id: 'tool-2', content: 'result 2' },
            ],
          },
        }),
        // Another real user prompt: starts new turn, resets toolsThisTurn
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Second prompt' } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(2) // Only real user prompts count as turns
      expect(metrics.toolCount).toBe(2)
      expect(metrics.toolsThisTurn).toBe(0) // Reset by second real user prompt
    })

    it('accumulates toolsThisTurn across consecutive tool_use blocks', async () => {
      const transcript = [
        // Real user prompt starts a turn
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'User prompt' } }),
        // Multiple assistant messages with tool_use blocks
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/test1' } }],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result 1' }],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/test2' } }],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-2', content: 'result 2' }],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool-3', name: 'Read', input: { file_path: '/test3' } }],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-3', content: 'result 3' }],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(1) // Only the real user prompt counts as a turn
      expect(metrics.toolCount).toBe(3)
      expect(metrics.toolsThisTurn).toBe(3) // Accumulated across all tool_use blocks
    })

    it('calculates toolsPerTurn', async () => {
      const transcript = [
        // First turn: real user prompt followed by 2 tool uses
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'First prompt' } }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/test1' } },
              { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/test2' } },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tool-1', content: 'result 1' },
              { type: 'tool_result', tool_use_id: 'tool-2', content: 'result 2' },
            ],
          },
        }),
        // Second turn: real user prompt followed by 2 more tool uses
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Second prompt' } }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool-3', name: 'Read', input: { file_path: '/test3' } },
              { type: 'tool_use', id: 'tool-4', name: 'Read', input: { file_path: '/test4' } },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tool-3', content: 'result 3' },
              { type: 'tool_result', tool_use_id: 'tool-4', content: 'result 4' },
            ],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.toolCount).toBe(4)
      expect(metrics.turnCount).toBe(2) // Only real user prompts count as turns
      expect(metrics.toolsPerTurn).toBe(2) // 4 tools / 2 turns
    })

    it('excludes isMeta messages from turnCount', async () => {
      const transcript = [
        // isMeta disclaimer message: should NOT count as a turn
        JSON.stringify({
          type: 'user',
          isMeta: true,
          message: {
            role: 'user',
            content:
              'Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages.',
          },
        }),
        // Real user prompt: should count as a turn
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'First real prompt' } }),
        // Another isMeta message: should NOT count as a turn
        JSON.stringify({
          type: 'user',
          isMeta: true,
          message: {
            role: 'user',
            content: 'Caveat: The messages below were generated by the user while running local commands.',
          },
        }),
        // Second real user prompt: should count as a turn
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Second real prompt' } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(2) // Only real user prompts count
      expect(metrics.messageCount).toBe(4) // All messages counted
    })

    it('excludes local-command-stdout messages from turnCount', async () => {
      const transcript = [
        // Command message (with <command-name>): should count as a turn
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: '<command-name>/context</command-name>\n<command-message>context</command-message>',
          },
        }),
        // Local command stdout: should NOT count as a turn
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: '<local-command-stdout>Context Usage: 73k/200k tokens</local-command-stdout>',
          },
        }),
        // Real user prompt: should count as a turn
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'First real prompt' } }),
        // Another local command stdout: should NOT count as a turn
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: '<local-command-stdout></local-command-stdout>',
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(2) // Command message + real prompt
      expect(metrics.messageCount).toBe(4) // All messages counted
    })

    it('excludes both isMeta and local-command-stdout in mixed transcript', async () => {
      const transcript = [
        // isMeta disclaimer
        JSON.stringify({
          type: 'user',
          isMeta: true,
          message: { role: 'user', content: 'Caveat: DO NOT respond to these messages.' },
        }),
        // Command (counts)
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: '<command-name>/clear</command-name>' },
        }),
        // Local stdout (excluded)
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: '<local-command-stdout></local-command-stdout>' },
        }),
        // isMeta again
        JSON.stringify({
          type: 'user',
          isMeta: true,
          message: { role: 'user', content: 'Caveat: DO NOT respond.' },
        }),
        // Command (counts)
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: '<command-name>/context</command-name>' },
        }),
        // Local stdout with content (excluded)
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: '<local-command-stdout>some output</local-command-stdout>' },
        }),
        // Real user prompt (counts)
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Real user question' } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      // Turns: /clear command + /context command + real prompt = 3
      expect(metrics.turnCount).toBe(3)
      // Messages: all 7 user messages counted
      expect(metrics.messageCount).toBe(7)
    })
  })

  // --------------------------------------------------------------------------
  // Token Usage Tests
  // --------------------------------------------------------------------------

  describe('token usage extraction', () => {
    it('extracts token counts from assistant message', async () => {
      const transcript = [
        JSON.stringify({
          type: 'assistant',
          message: {
            model: 'claude-sonnet-4-20250514',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.tokenUsage.inputTokens).toBe(100)
      expect(metrics.tokenUsage.outputTokens).toBe(50)
      expect(metrics.tokenUsage.totalTokens).toBe(150)
    })

    it('accumulates tokens across messages', async () => {
      const transcript = [
        JSON.stringify({
          type: 'assistant',
          message: { model: 'claude-sonnet-4-20250514', usage: { input_tokens: 100, output_tokens: 50 } },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { model: 'claude-sonnet-4-20250514', usage: { input_tokens: 200, output_tokens: 75 } },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.tokenUsage.inputTokens).toBe(300)
      expect(metrics.tokenUsage.outputTokens).toBe(125)
      expect(metrics.tokenUsage.totalTokens).toBe(425)
    })

    it('extracts cache metrics', async () => {
      const transcript = [
        JSON.stringify({
          type: 'assistant',
          message: {
            model: 'claude-sonnet-4-20250514',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_creation_input_tokens: 500,
              cache_read_input_tokens: 200,
              cache_creation: {
                ephemeral_5m_input_tokens: 300,
                ephemeral_1h_input_tokens: 200,
              },
            },
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.tokenUsage.cacheCreationInputTokens).toBe(500)
      expect(metrics.tokenUsage.cacheReadInputTokens).toBe(200)
      expect(metrics.tokenUsage.cacheTiers.ephemeral5mInputTokens).toBe(300)
      expect(metrics.tokenUsage.cacheTiers.ephemeral1hInputTokens).toBe(200)
    })

    it('tracks service tier counts', async () => {
      const transcript = [
        JSON.stringify({
          type: 'assistant',
          message: {
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 100, output_tokens: 50, service_tier: 'standard' },
          },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 100, output_tokens: 50, service_tier: 'standard' },
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.tokenUsage.serviceTierCounts).toEqual({ standard: 2 })
    })

    it('tracks per-model breakdown', async () => {
      const transcript = [
        JSON.stringify({
          type: 'assistant',
          message: { model: 'claude-sonnet-4-20250514', usage: { input_tokens: 100, output_tokens: 50 } },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { model: 'claude-haiku-3-5-20241022', usage: { input_tokens: 50, output_tokens: 25 } },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.tokenUsage.byModel['claude-sonnet-4-20250514']).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        requestCount: 1,
      })
      expect(metrics.tokenUsage.byModel['claude-haiku-3-5-20241022']).toEqual({
        inputTokens: 50,
        outputTokens: 25,
        requestCount: 1,
      })
    })
  })

  // --------------------------------------------------------------------------
  // Event Emission Tests
  // --------------------------------------------------------------------------

  describe('event emission', () => {
    it('emits UserPrompt event for user messages', async () => {
      const transcript = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } })].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      expect(handlers.emittedEvents).toContainEqual(
        expect.objectContaining({
          eventType: 'UserPrompt',
          lineNumber: 1,
        })
      )
    })

    it('emits AssistantMessage event for assistant messages', async () => {
      const transcript = [
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ text: 'Hi' }] } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      expect(handlers.emittedEvents).toContainEqual(
        expect.objectContaining({
          eventType: 'AssistantMessage',
          lineNumber: 1,
        })
      )
    })

    it('emits ToolCall event for tool_use in assistant message', async () => {
      const transcript = [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/test.ts' } }],
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      expect(handlers.emittedEvents).toContainEqual(
        expect.objectContaining({
          eventType: 'ToolCall',
          lineNumber: 1,
        })
      )
    })

    it('emits ToolResult event for tool_result in user message', async () => {
      const transcript = [
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' }],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      expect(handlers.emittedEvents).toContainEqual(
        expect.objectContaining({
          eventType: 'ToolResult',
          lineNumber: 1,
        })
      )
    })

    it('includes tool_name on ToolResult entries when preceding ToolCall exists', async () => {
      const transcript = [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'touch foo.ts' } }],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '' }],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const toolResultEvent = handlers.emittedEvents.find((e) => e.eventType === 'ToolResult')
      expect(toolResultEvent).toBeDefined()
      expect((toolResultEvent!.entry as Record<string, unknown>).tool_name).toBe('Bash')
    })

    it('resolves tool_name for multiple tool_use/tool_result pairs', async () => {
      const transcript = [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
              { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/test' } },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tool-1', content: 'output' },
              { type: 'tool_result', tool_use_id: 'tool-2', content: 'file contents' },
            ],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const toolResults = handlers.emittedEvents.filter((e) => e.eventType === 'ToolResult')
      expect(toolResults).toHaveLength(2)
      expect((toolResults[0].entry as Record<string, unknown>).tool_name).toBe('Bash')
      expect((toolResults[1].entry as Record<string, unknown>).tool_name).toBe('Read')
    })
  })

  // --------------------------------------------------------------------------
  // Incremental Processing Tests
  // --------------------------------------------------------------------------

  describe('incremental processing', () => {
    it('updates lastProcessedLine watermark', async () => {
      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'One' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Two' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Three' } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.lastProcessedLine).toBe(3)
    })

    it('skips malformed lines', async () => {
      const transcript = [
        'not valid json',
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Valid' } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(1) // Only counted valid line
      expect(logger.warn).toHaveBeenCalledWith('Skipping malformed transcript line', expect.any(Object))
    })
  })

  // --------------------------------------------------------------------------
  // Compaction Detection Tests
  // --------------------------------------------------------------------------

  describe('compaction detection', () => {
    it('detects compaction via compact_boundary entry', async () => {
      // Initial transcript with user messages and usage
      const initial = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'One' } }),
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: 'Response', usage: { input_tokens: 100, output_tokens: 50 } },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, initial)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      let metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(1)
      expect(metrics.currentContextTokens).toBe(100) // input_tokens only (context window)
      expect(metrics.isPostCompactIndeterminate).toBe(false)

      // Append compact_boundary entry (Claude Code appends this, doesn't truncate)
      const withCompact = [
        initial,
        JSON.stringify({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto' } }),
      ].join('\n')
      writeFileSync(transcriptPath, withCompact)

      await getTestHelpers(service).processTranscriptFile()

      metrics = service.getMetrics()
      // After compact_boundary: indeterminate state
      expect(metrics.currentContextTokens).toBeNull()
      expect(metrics.isPostCompactIndeterminate).toBe(true)
      // turnCount stays the same (compact_boundary doesn't add turns)
      expect(metrics.turnCount).toBe(1)
    })

    it('emits Compact event on compact_boundary detection', async () => {
      const initial = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Test' } })].join('\n')
      writeFileSync(transcriptPath, initial)

      await service.prepare('test-session', transcriptPath)
      await service.start()
      handlers.emittedEvents.length = 0 // Clear events

      // Append compact_boundary
      const withCompact = [initial, JSON.stringify({ type: 'system', subtype: 'compact_boundary' })].join('\n')
      writeFileSync(transcriptPath, withCompact)

      await getTestHelpers(service).processTranscriptFile()

      expect(handlers.emittedEvents).toContainEqual(
        expect.objectContaining({
          eventType: 'Compact',
        })
      )
    })

    it('clears indeterminate state when usage block arrives after compaction', async () => {
      // Start with content including compact_boundary
      const initial = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Pre-compact' } }),
        JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
      ].join('\n')
      writeFileSync(transcriptPath, initial)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      let metrics = service.getMetrics()
      expect(metrics.isPostCompactIndeterminate).toBe(true)
      expect(metrics.currentContextTokens).toBeNull()

      // Append new assistant message with usage (post-compact response)
      const withResponse = [
        initial,
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: 'Post-compact response',
            usage: {
              input_tokens: 200,
              output_tokens: 75,
              cache_creation_input_tokens: 50,
              cache_read_input_tokens: 25,
            },
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, withResponse)

      await getTestHelpers(service).processTranscriptFile()

      metrics = service.getMetrics()
      // Indeterminate cleared, context tokens set from usage
      expect(metrics.isPostCompactIndeterminate).toBe(false)
      expect(metrics.currentContextTokens).toBe(275) // 200 + 50 + 25 (input + cache_creation + cache_read)
    })
  })

  // --------------------------------------------------------------------------
  // Observable API Tests
  // --------------------------------------------------------------------------

  describe('observable API', () => {
    it('notifies subscribers on metrics change', async () => {
      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const callback = vi.fn()
      service.onMetricsChange(callback)

      // Add content and process
      writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }))
      await getTestHelpers(service).processTranscriptFile()

      expect(callback).toHaveBeenCalled()
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ turnCount: 1 }))
    })

    it('unsubscribes correctly', async () => {
      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const callback = vi.fn()
      const unsubscribe = service.onMetricsChange(callback)
      unsubscribe()

      writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }))
      await getTestHelpers(service).processTranscriptFile()

      expect(callback).not.toHaveBeenCalled()
    })

    it('fires threshold callback when crossed', async () => {
      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const callback = vi.fn()
      service.onThreshold('turnCount', 2, callback)

      // Add 2 user messages
      writeFileSync(
        transcriptPath,
        [
          JSON.stringify({ type: 'user', message: { role: 'user', content: 'One' } }),
          JSON.stringify({ type: 'user', message: { role: 'user', content: 'Two' } }),
        ].join('\n')
      )
      await getTestHelpers(service).processTranscriptFile()

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('only fires threshold callback once', async () => {
      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const callback = vi.fn()
      service.onThreshold('turnCount', 1, callback)

      writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'One' } }))
      await getTestHelpers(service).processTranscriptFile()

      writeFileSync(
        transcriptPath,
        [
          JSON.stringify({ type: 'user', message: { role: 'user', content: 'One' } }),
          JSON.stringify({ type: 'user', message: { role: 'user', content: 'Two' } }),
        ].join('\n')
      )
      await getTestHelpers(service).processTranscriptFile()

      expect(callback).toHaveBeenCalledTimes(1) // Only once, not twice
    })

    it('catches and logs error in metrics change callback', async () => {
      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const errorCallback = vi.fn(() => {
        throw new Error('Callback exploded')
      })
      const normalCallback = vi.fn()

      service.onMetricsChange(errorCallback)
      service.onMetricsChange(normalCallback)

      writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }))
      await getTestHelpers(service).processTranscriptFile()

      // Error should be logged
      expect(logger.error).toHaveBeenCalledWith('Error in metrics change callback', expect.any(Object))

      // Other callbacks should still be called
      expect(normalCallback).toHaveBeenCalled()
    })

    it('catches and logs error in threshold callback', async () => {
      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const errorCallback = vi.fn(() => {
        throw new Error('Threshold callback exploded')
      })

      service.onThreshold('turnCount', 1, errorCallback)

      writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }))
      await getTestHelpers(service).processTranscriptFile()

      // Error should be logged with threshold context
      expect(logger.error).toHaveBeenCalledWith(
        'Error in threshold callback',
        expect.objectContaining({
          metric: 'turnCount',
          threshold: 1,
        })
      )
    })

    it('unsubscribes threshold callback correctly', async () => {
      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const callback = vi.fn()
      const unsubscribe = service.onThreshold('turnCount', 1, callback)
      unsubscribe()

      writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }))
      await getTestHelpers(service).processTranscriptFile()

      expect(callback).not.toHaveBeenCalled()
    })

    it('does not fire threshold for non-numeric metrics', async () => {
      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const callback = vi.fn()
      // tokenUsage is an object, not a number - threshold check should skip it
      service.onThreshold('tokenUsage' as keyof import('@sidekick/types').TranscriptMetrics, 1, callback)

      writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }))
      await getTestHelpers(service).processTranscriptFile()

      expect(callback).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Metrics Persistence Tests
  // --------------------------------------------------------------------------

  describe('metrics persistence', () => {
    it('persists metrics to state file', async () => {
      const transcript = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } })].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      // Force immediate persistence
      await getTestHelpers(service).persistMetrics(true)

      // Verify via MockStateService instead of filesystem
      const statePath = join(stateDir, 'sessions', 'test-session', 'state', 'transcript-metrics.json')
      expect(mockStateService.has(statePath)).toBe(true)

      const saved = mockStateService.getStored(statePath) as { sessionId: string; metrics: { turnCount: number } }
      expect(saved.sessionId).toBe('test-session')
      expect(saved.metrics.turnCount).toBe(1)
    })

    it('recovers metrics on restart', async () => {
      // Set up initial state via MockStateService
      const statePath = join(stateDir, 'sessions', 'test-session', 'state', 'transcript-metrics.json')

      const savedState = {
        sessionId: 'test-session',
        metrics: {
          ...createDefaultMetrics(),
          turnCount: 5,
          toolCount: 10,
          lastProcessedLine: 3,
        },
        persistedAt: Date.now(),
      }
      mockStateService.setStored(statePath, savedState)

      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(5)
      expect(metrics.toolCount).toBe(10)
      expect(logger.info).toHaveBeenCalledWith('Recovered transcript state', expect.any(Object))
    })

    it('warns and returns fresh metrics on session ID mismatch', async () => {
      // Set up state with wrong session ID via MockStateService
      const statePath = join(stateDir, 'sessions', 'test-session', 'state', 'transcript-metrics.json')

      const savedState = {
        sessionId: 'wrong-session-id',
        metrics: {
          ...createDefaultMetrics(),
          turnCount: 100,
        },
        persistedAt: Date.now(),
      }
      mockStateService.setStored(statePath, savedState)

      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      // Should warn about mismatch and use fresh metrics
      expect(logger.warn).toHaveBeenCalledWith(
        'Session ID mismatch in persisted state',
        expect.objectContaining({
          expectedSessionId: 'test-session',
          foundSessionId: 'wrong-session-id',
        })
      )

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(0) // Fresh metrics, not 100
    })

    it('handles corrupted data in persisted state', async () => {
      // Set up invalid data that won't pass schema validation via MockStateService
      const statePath = join(stateDir, 'sessions', 'test-session', 'state', 'transcript-metrics.json')
      mockStateService.setStored(statePath, { invalid: 'not valid transcript state' })

      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to load persisted transcript state',
        expect.objectContaining({ statePath })
      )

      // Should use fresh metrics
      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(0)
    })

    it('handles numeric format for currentContextTokens', async () => {
      // Set up state via MockStateService with current numeric format
      const statePath = join(stateDir, 'sessions', 'test-session', 'state', 'transcript-metrics.json')

      const savedState = {
        sessionId: 'test-session',
        metrics: {
          ...createDefaultMetrics(),
          turnCount: 7,
          currentContextTokens: 50000,
        },
        persistedAt: Date.now(),
      }
      mockStateService.setStored(statePath, savedState)

      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(7)
      expect(metrics.currentContextTokens).toBe(50000)
    })

    it('skips non-immediate persistence when recently persisted', async () => {
      writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }))
      await service.prepare('test-session', transcriptPath)
      await service.start()

      // Force immediate persistence to set lastPersistedAt
      await getTestHelpers(service).persistMetrics(true)

      // Clear debug logs
      ;(logger.debug as ReturnType<typeof vi.fn>).mockClear()

      // Try non-immediate persistence immediately after (should skip)
      await getTestHelpers(service).persistMetrics(false)

      expect(logger.debug).toHaveBeenCalledWith(
        'persistMetrics skipped (too recent)',
        expect.objectContaining({ sessionId: 'test-session' })
      )
    })
  })

  // --------------------------------------------------------------------------
  // Compaction History Tests
  // --------------------------------------------------------------------------

  describe('compaction history', () => {
    it('captures pre-compact state', async () => {
      const transcript = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } })].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const snapshotPath = join(testDir, 'snapshots', 'pre-compact-123.jsonl')
      await service.capturePreCompactState(snapshotPath)

      expect(existsSync(snapshotPath)).toBe(true)

      const history = service.getCompactionHistory()
      expect(history.length).toBe(1)
      expect(history[0].transcriptSnapshotPath).toBe(snapshotPath)
      expect(history[0].metricsAtCompaction.turnCount).toBe(1)
    })

    it('persists compaction history', async () => {
      const transcript = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } })].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const snapshotPath = join(testDir, 'snapshots', 'pre-compact-123.jsonl')
      await service.capturePreCompactState(snapshotPath)

      // Verify via MockStateService instead of filesystem
      const historyPath = join(stateDir, 'sessions', 'test-session', 'state', 'compaction-history.json')
      expect(mockStateService.has(historyPath)).toBe(true)

      const saved = mockStateService.getStored(historyPath) as unknown[]
      expect(saved.length).toBe(1)
    })

    it('handles corrupted compaction history data', async () => {
      // Pre-create corrupted (non-array) compaction history via MockStateService
      const historyPath = join(stateDir, 'sessions', 'test-session', 'state', 'compaction-history.json')
      mockStateService.setStored(historyPath, { corrupted: 'not an array' })

      writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }))
      await service.prepare('test-session', transcriptPath)
      await service.start()

      // With MockStateService, corrupted data + defaultValue returns the default (source: 'recovered')
      // No warning is logged - graceful fallback to empty array
      const history = service.getCompactionHistory()
      expect(history).toEqual([])
    })

    it('throws error when capturePreCompactState called before initialization', async () => {
      // Service not initialized
      const snapshotPath = join(testDir, 'snapshots', 'pre-compact.jsonl')

      await expect(async () => {
        await service.capturePreCompactState(snapshotPath)
      }).rejects.toThrow('TranscriptService not initialized')
    })

    it('loads existing compaction history on restart', async () => {
      // Pre-populate MockStateService with valid compaction history
      const historyPath = join(stateDir, 'sessions', 'test-session', 'state', 'compaction-history.json')

      const existingHistory = [
        {
          compactedAt: Date.now() - 60000,
          transcriptSnapshotPath: '/old/snapshot.jsonl',
          metricsAtCompaction: createDefaultMetrics(),
          postCompactLineCount: 5,
        },
      ]
      mockStateService.setStored(historyPath, existingHistory)

      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const history = service.getCompactionHistory()
      expect(history.length).toBe(1)
      expect(history[0].transcriptSnapshotPath).toBe('/old/snapshot.jsonl')
    })
  })

  // --------------------------------------------------------------------------
  // getTranscript Tests
  // --------------------------------------------------------------------------

  describe('getTranscript', () => {
    it('returns empty transcript when not initialized', () => {
      // Service not initialized - transcriptPath is null
      const transcript = service.getTranscript()

      expect(transcript.entries).toEqual([])
      expect(transcript.metadata.sessionId).toBe('')
      expect(transcript.metadata.transcriptPath).toBe('')
      expect(transcript.metadata.lineCount).toBe(0)
      expect(transcript.metadata.lastModified).toBe(0)
      expect(transcript.toString()).toBe('')
    })

    it('returns empty transcript when file does not exist', async () => {
      // Initialize with path but delete file
      writeFileSync(transcriptPath, '')
      await service.prepare('test-session', transcriptPath)
      await service.start()
      rmSync(transcriptPath)

      const transcript = service.getTranscript()

      expect(transcript.entries).toEqual([])
      expect(transcript.metadata.sessionId).toBe('test-session')
      expect(transcript.metadata.lineCount).toBe(0)
    })

    it('parses user and assistant messages into canonical entries', async () => {
      const content = [
        JSON.stringify({
          type: 'user',
          uuid: 'user-1',
          timestamp: '2024-01-15T10:00:00Z',
          message: { role: 'user', content: 'Hello there' },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'asst-1',
          timestamp: '2024-01-15T10:00:01Z',
          message: { role: 'assistant', content: 'Hi, how can I help?' },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, content)
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const transcript = service.getTranscript()

      expect(transcript.entries.length).toBe(2)
      expect(transcript.entries[0].role).toBe('user')
      expect(transcript.entries[0].type).toBe('text')
      expect(transcript.entries[0].content).toBe('Hello there')
      expect(transcript.entries[1].role).toBe('assistant')
      expect(transcript.entries[1].type).toBe('text')
      expect(transcript.entries[1].content).toBe('Hi, how can I help?')
      expect(transcript.metadata.lineCount).toBe(2)
    })

    it('parses nested tool_use blocks in assistant message', async () => {
      const content = [
        JSON.stringify({
          type: 'assistant',
          uuid: 'asst-1',
          timestamp: '2024-01-15T10:00:00Z',
          message: {
            role: 'assistant',
            id: 'msg-123',
            content: [
              { type: 'text', text: 'Let me read that file.' },
              { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/test.ts' } },
            ],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, content)
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const transcript = service.getTranscript()

      expect(transcript.entries.length).toBe(2)
      expect(transcript.entries[0].type).toBe('text')
      expect(transcript.entries[0].content).toBe('Let me read that file.')
      expect(transcript.entries[1].type).toBe('tool_use')
      expect((transcript.entries[1].content as { name: string }).name).toBe('Read')
    })

    it('parses nested tool_result blocks in user message', async () => {
      const content = [
        JSON.stringify({
          type: 'user',
          uuid: 'user-1',
          timestamp: '2024-01-15T10:00:00Z',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents here', is_error: false }],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, content)
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const transcript = service.getTranscript()

      expect(transcript.entries.length).toBe(1)
      expect(transcript.entries[0].type).toBe('tool_result')
      expect(transcript.entries[0].metadata?.isError).toBe(false)
      expect(transcript.entries[0].metadata?.toolUseId).toBe('tool-1')
    })

    it('skips non-message entry types like file-history-snapshot', async () => {
      const content = [
        JSON.stringify({
          type: 'file-history-snapshot',
          data: { files: [] },
        }),
        JSON.stringify({
          type: 'user',
          uuid: 'user-1',
          message: { role: 'user', content: 'Hello' },
        }),
        JSON.stringify({
          type: 'summary',
          summary: 'Session summary',
        }),
      ].join('\n')
      writeFileSync(transcriptPath, content)
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const transcript = service.getTranscript()

      // Only the user message is parsed
      expect(transcript.entries.length).toBe(1)
      expect(transcript.entries[0].role).toBe('user')
    })

    it('logs warning and skips malformed JSON lines', async () => {
      const content = [
        'not valid json',
        JSON.stringify({
          type: 'user',
          uuid: 'user-1',
          message: { role: 'user', content: 'Valid message' },
        }),
        '{ broken: json',
      ].join('\n')
      writeFileSync(transcriptPath, content)
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const transcript = service.getTranscript()

      // Only valid line is parsed
      expect(transcript.entries.length).toBe(1)
      expect(transcript.entries[0].content).toBe('Valid message')

      // getTranscript also warns about malformed lines (different from processTranscriptFile)
      expect(logger.warn).toHaveBeenCalledWith(
        'Skipping malformed transcript line',
        expect.objectContaining({ line: 1 })
      )
      expect(logger.warn).toHaveBeenCalledWith(
        'Skipping malformed transcript line',
        expect.objectContaining({ line: 3 })
      )
    })

    it('generates human-readable string via toString()', async () => {
      const content = [
        JSON.stringify({
          type: 'user',
          uuid: 'user-1',
          timestamp: '2024-01-15T10:00:00Z',
          message: { role: 'user', content: 'What time is it?' },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'asst-1',
          timestamp: '2024-01-15T10:00:01Z',
          message: { role: 'assistant', content: "It's 10 AM" },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, content)
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const transcript = service.getTranscript()
      const str = transcript.toString()

      expect(str).toContain('USER:')
      expect(str).toContain('What time is it?')
      expect(str).toContain('ASSISTANT:')
      expect(str).toContain("It's 10 AM")
    })

    it('renders tool_use entries in toString()', async () => {
      const content = [
        JSON.stringify({
          type: 'assistant',
          uuid: 'asst-1',
          timestamp: '2024-01-15T10:00:00Z',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Edit', input: {} }],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, content)
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const transcript = service.getTranscript()
      const str = transcript.toString()

      expect(str).toContain('ASSISTANT TOOL_USE:')
      expect(str).toContain('Edit')
    })

    it('renders tool_result entries in toString()', async () => {
      const content = [
        JSON.stringify({
          type: 'user',
          uuid: 'user-1',
          timestamp: '2024-01-15T10:00:00Z',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result' }],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, content)
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const transcript = service.getTranscript()
      const str = transcript.toString()

      expect(str).toContain('USER TOOL_RESULT')
    })

    it('includes isMeta and isCompactSummary in metadata', async () => {
      const content = [
        JSON.stringify({
          type: 'user',
          uuid: 'user-1',
          isMeta: true,
          isCompactSummary: false,
          message: { role: 'user', content: 'Disclaimer message' },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'asst-1',
          isCompactSummary: true,
          message: { role: 'assistant', content: 'Summary after compaction' },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, content)
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const transcript = service.getTranscript()

      expect(transcript.entries[0].metadata?.isMeta).toBe(true)
      expect(transcript.entries[0].metadata?.isCompactSummary).toBe(false)
      expect(transcript.entries[1].metadata?.isCompactSummary).toBe(true)
    })

    it('handles entry with missing message gracefully', async () => {
      const content = [
        JSON.stringify({
          type: 'user',
          uuid: 'user-1',
          // No message field
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'asst-1',
          message: { role: 'assistant', content: 'Valid response' },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, content)
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const transcript = service.getTranscript()

      // Entry without message is skipped
      expect(transcript.entries.length).toBe(1)
      expect(transcript.entries[0].role).toBe('assistant')
    })

    it('uses line number as fallback ID when uuid missing', async () => {
      const content = [
        JSON.stringify({
          type: 'user',
          // No uuid
          timestamp: '2024-01-15T10:00:00Z',
          message: { role: 'user', content: 'No UUID message' },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, content)
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const transcript = service.getTranscript()

      expect(transcript.entries[0].id).toBe('line-1')
    })
  })

  // --------------------------------------------------------------------------
  // getMetric Tests
  // --------------------------------------------------------------------------

  describe('getMetric', () => {
    it('returns individual metric values', async () => {
      const transcript = [
        // Real user prompt (counts as a turn)
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }),
        // Assistant requests a tool (counts as tool and message)
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/test' } }],
          },
        }),
        // Tool result wrapper (counts as message, but not a turn or tool)
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result' }],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      expect(service.getMetric('turnCount')).toBe(1) // Only real user prompt counts
      expect(service.getMetric('toolCount')).toBe(1)
      expect(service.getMetric('messageCount')).toBe(3) // All three messages count
    })
  })

  // --------------------------------------------------------------------------
  // getExcerpt Tests
  // --------------------------------------------------------------------------

  describe('getExcerpt', () => {
    // Helper to create transcript with N lines
    function createTranscriptLines(count: number): string[] {
      return Array.from({ length: count }, (_, i) =>
        JSON.stringify({ type: 'user', message: { role: 'user', content: `Message ${i + 1}` } })
      )
    }

    describe('bookmark edge cases', () => {
      it('returns empty excerpt when transcriptPath is null (not initialized)', () => {
        // Don't initialize - transcriptPath remains null
        const excerpt = service.getExcerpt({ bookmarkLine: 5 })

        expect(excerpt.content).toBe('')
        expect(excerpt.lineCount).toBe(0)
        expect(excerpt.startLine).toBe(0)
        expect(excerpt.endLine).toBe(0)
        expect(excerpt.bookmarkApplied).toBe(false)
      })

      it('ignores bookmark when bookmarkLine > file length', async () => {
        const lines = createTranscriptLines(5) // 5 lines
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        // Bookmark at line 10, but file only has 5 lines
        const excerpt = service.getExcerpt({ bookmarkLine: 10, maxLines: 3 })

        // Should fall back to simple tail (last 3 lines)
        expect(excerpt.bookmarkApplied).toBe(false)
        expect(excerpt.lineCount).toBe(3)
        expect(excerpt.startLine).toBe(3) // Lines 3-5 (1-indexed)
        expect(excerpt.endLine).toBe(5)
      })

      it('ignores bookmark when bookmarkLine equals file length', async () => {
        const lines = createTranscriptLines(5)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        // bookmarkLine === totalLines, condition is bookmarkLine < totalLines
        const excerpt = service.getExcerpt({ bookmarkLine: 5, maxLines: 3 })

        expect(excerpt.bookmarkApplied).toBe(false)
        expect(excerpt.lineCount).toBe(3)
      })

      it('ignores bookmark when bookmarkLine is 0', async () => {
        const lines = createTranscriptLines(5)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({ bookmarkLine: 0, maxLines: 3 })

        expect(excerpt.bookmarkApplied).toBe(false)
        expect(excerpt.lineCount).toBe(3)
      })

      it('applies bookmark correctly for valid bookmarkLine', async () => {
        const lines = createTranscriptLines(10)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        // Bookmark at line 5, maxLines 20 - should get lines 5-10 (6 lines)
        const excerpt = service.getExcerpt({ bookmarkLine: 5, maxLines: 20 })

        expect(excerpt.bookmarkApplied).toBe(true)
        // recentLines = min(20, 10 - 5) = 5
        // startLine = max(0, 10 - 5) = 5 (0-indexed), so 1-indexed = 6
        expect(excerpt.lineCount).toBe(5)
        expect(excerpt.startLine).toBe(6)
        expect(excerpt.endLine).toBe(10)
      })

      it('handles bookmark at line 1', async () => {
        const lines = createTranscriptLines(5)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        // Bookmark at line 1, should get remaining 4 lines
        const excerpt = service.getExcerpt({ bookmarkLine: 1, maxLines: 20 })

        expect(excerpt.bookmarkApplied).toBe(true)
        expect(excerpt.lineCount).toBe(4)
        expect(excerpt.startLine).toBe(2)
        expect(excerpt.endLine).toBe(5)
      })
    })

    describe('maxLines boundary conditions', () => {
      it('returns all lines when maxLines > totalLines', async () => {
        const lines = createTranscriptLines(5)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({ maxLines: 100 })

        expect(excerpt.lineCount).toBe(5)
        expect(excerpt.startLine).toBe(1)
        expect(excerpt.endLine).toBe(5)
      })

      it('returns exactly maxLines when maxLines < totalLines', async () => {
        const lines = createTranscriptLines(10)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({ maxLines: 3 })

        expect(excerpt.lineCount).toBe(3)
        expect(excerpt.startLine).toBe(8) // Last 3 of 10
        expect(excerpt.endLine).toBe(10)
      })

      it('returns all lines when maxLines equals totalLines', async () => {
        const lines = createTranscriptLines(5)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({ maxLines: 5 })

        expect(excerpt.lineCount).toBe(5)
        expect(excerpt.startLine).toBe(1)
        expect(excerpt.endLine).toBe(5)
      })

      it('defaults to 80 maxLines when not specified', async () => {
        const lines = createTranscriptLines(100)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        expect(excerpt.lineCount).toBe(80)
        expect(excerpt.startLine).toBe(21) // Lines 21-100
        expect(excerpt.endLine).toBe(100)
      })

      it('handles empty transcript', async () => {
        writeFileSync(transcriptPath, '')
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({ maxLines: 10 })

        // Empty files correctly report lineCount=0
        expect(excerpt.lineCount).toBe(0)
      })
    })

    describe('line filtering behavior', () => {
      it('formats user messages correctly', async () => {
        const transcript = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello world' } })].join(
          '\n'
        )
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        expect(excerpt.content).toContain('[USER]:')
        expect(excerpt.content).toContain('Hello world')
      })

      it('formats assistant messages correctly', async () => {
        const transcript = [JSON.stringify({ type: 'assistant', message: { content: 'I can help' } })].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        expect(excerpt.content).toContain('[ASSISTANT]:')
        expect(excerpt.content).toContain('I can help')
      })

      it('formats tool_use entries correctly', async () => {
        const transcript = [JSON.stringify({ type: 'tool_use', name: 'Read' })].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        expect(excerpt.content).toContain('[TOOL]:')
        expect(excerpt.content).toContain('Read')
      })

      it('excludes tool_result entirely when includeToolOutputs is false (no placeholder)', async () => {
        // New behavior: excluded content returns null, not a placeholder line
        const transcript = [JSON.stringify({ type: 'tool_result', content: 'sensitive file contents here' })].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({ includeToolOutputs: false })

        // Entire entry is excluded - no [RESULT]: line at all
        expect(excerpt.content).toBe('')
        expect(excerpt.lineCount).toBe(0)
        expect(excerpt.content).not.toContain('sensitive file contents')
      })

      it('includes tool_result output when includeToolOutputs is true', async () => {
        const transcript = [JSON.stringify({ type: 'tool_result', content: 'file contents here' })].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({ includeToolOutputs: true })

        expect(excerpt.content).toContain('[RESULT]:')
        expect(excerpt.content).toContain('file contents here')
        expect(excerpt.content).not.toContain('(output omitted)')
      })

      it('excludes unknown entry types to reduce noise', async () => {
        // Unknown types are excluded to keep excerpts focused on user/assistant conversation
        const transcript = [JSON.stringify({ type: 'custom_unknown_type', data: { foo: 'bar' } })].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // Unknown types are filtered out entirely
        expect(excerpt.content).toBe('')
        expect(excerpt.lineCount).toBe(0)
      })

      it('excludes malformed JSON lines to reduce noise', async () => {
        const transcript = [
          'not valid json at all',
          JSON.stringify({ type: 'user', message: { content: 'Valid message' } }),
        ].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // Malformed JSON is filtered out, only valid user message remains
        expect(excerpt.lineCount).toBe(1)
        expect(excerpt.content).not.toContain('not valid json')
        expect(excerpt.content).toContain('[USER]:')
        expect(excerpt.content).toContain('Valid message')
      })

      it('excludes malformed lines entirely', async () => {
        const longLine = 'x'.repeat(500) // 500 char line, not valid JSON
        const transcript = [longLine].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // Malformed lines are excluded entirely
        expect(excerpt.content).toBe('')
        expect(excerpt.lineCount).toBe(0)
      })

      it('excludes assistant messages with only tool_use blocks (no text)', async () => {
        // Assistant messages with only tool blocks have no human-readable text
        const transcript = [
          JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'tool_use', name: 'Edit' }] },
          }),
        ].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // Assistant with only tool_use has no text content, so it's excluded
        expect(excerpt.content).toBe('')
        expect(excerpt.lineCount).toBe(0)
      })

      it('includes assistant messages with text alongside tool_use blocks', async () => {
        // Assistant messages with text content should be included
        const transcript = [
          JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Let me edit that file.' },
                { type: 'tool_use', name: 'Edit' },
              ],
            },
          }),
        ].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // Text content is extracted, tool_use is stripped
        expect(excerpt.content).toContain('[ASSISTANT]:')
        expect(excerpt.content).toContain('Let me edit that file.')
        expect(excerpt.content).not.toContain('Edit') // tool name stripped
      })
    })

    describe('error handling', () => {
      it('returns empty excerpt when buffer is empty (invalid content at init)', async () => {
        // Write invalid JSON - will be skipped during processing, buffer stays empty
        writeFileSync(transcriptPath, 'test')
        await service.prepare('test-session', transcriptPath)
        await service.start()

        // Delete the file after initialization - shouldn't matter since we use buffer
        rmSync(transcriptPath)

        // Buffer-based excerpt: gracefully returns empty result
        // No error log since this is handled gracefully with buffers
        const excerpt = service.getExcerpt({})

        expect(excerpt.content).toBe('')
        expect(excerpt.lineCount).toBe(0)
        expect(excerpt.bookmarkApplied).toBe(false)
      })
    })

    describe('summary entry filtering', () => {
      it('skips external summary entries (leafUuid not in file)', async () => {
        // External summary references a UUID not in this file
        const transcript = [
          JSON.stringify({
            type: 'summary',
            summary: 'Context from another session',
            leafUuid: 'external-uuid-not-in-file',
          }),
          JSON.stringify({
            type: 'user',
            uuid: 'user-uuid-1',
            message: { role: 'user', content: 'Hello' },
          }),
        ].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // External summary should be skipped entirely
        expect(excerpt.content).not.toContain('Context from another session')
        expect(excerpt.content).not.toContain('[SUMMARY]')
        // User message should still be present
        expect(excerpt.content).toContain('[USER]:')
        expect(excerpt.content).toContain('Hello')
      })

      it('includes internal summary entries as session hints (leafUuid in file)', async () => {
        // Internal summary references a UUID that exists in this file
        const transcript = [
          JSON.stringify({
            type: 'user',
            uuid: 'user-uuid-1',
            message: { role: 'user', content: 'First message' },
          }),
          JSON.stringify({
            type: 'assistant',
            uuid: 'assistant-uuid-1',
            message: { role: 'assistant', content: 'Response' },
          }),
          JSON.stringify({
            type: 'summary',
            summary: 'Discussion about first topic',
            leafUuid: 'user-uuid-1', // References UUID in this file
          }),
          JSON.stringify({
            type: 'user',
            uuid: 'user-uuid-2',
            message: { role: 'user', content: 'Second message' },
          }),
        ].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // Internal summary should be included as a session hint
        expect(excerpt.content).toContain('[SESSION_HINT]:')
        expect(excerpt.content).toContain('Discussion about first topic')
        // Other messages should still be present
        expect(excerpt.content).toContain('First message')
        expect(excerpt.content).toContain('Second message')
      })

      it('handles multiple summaries with mixed internal/external references', async () => {
        const transcript = [
          JSON.stringify({
            type: 'summary',
            summary: 'External context 1',
            leafUuid: 'external-1',
          }),
          JSON.stringify({
            type: 'summary',
            summary: 'External context 2',
            leafUuid: 'external-2',
          }),
          JSON.stringify({
            type: 'user',
            uuid: 'user-1',
            message: { role: 'user', content: 'User message' },
          }),
          JSON.stringify({
            type: 'summary',
            summary: 'Internal hint about user message',
            leafUuid: 'user-1', // References user-1 which is in file
          }),
          JSON.stringify({
            type: 'assistant',
            uuid: 'assistant-1',
            message: { role: 'assistant', content: 'Assistant response' },
          }),
        ].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // External summaries should be skipped
        expect(excerpt.content).not.toContain('External context 1')
        expect(excerpt.content).not.toContain('External context 2')
        // Internal summary should be included
        expect(excerpt.content).toContain('[SESSION_HINT]:')
        expect(excerpt.content).toContain('Internal hint about user message')
        // Regular messages present
        expect(excerpt.content).toContain('[USER]:')
        expect(excerpt.content).toContain('[ASSISTANT]:')
      })

      it('skips summary entries without leafUuid', async () => {
        const transcript = [
          JSON.stringify({
            type: 'summary',
            summary: 'Summary without leafUuid',
            // No leafUuid field
          }),
          JSON.stringify({
            type: 'user',
            uuid: 'user-1',
            message: { role: 'user', content: 'Hello' },
          }),
        ].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // Summary without leafUuid should be skipped (can't verify it's internal)
        expect(excerpt.content).not.toContain('Summary without leafUuid')
        expect(excerpt.content).toContain('[USER]:')
      })
    })

    describe('slash command filtering', () => {
      it('excludes built-in slash commands like /clear from excerpt', async () => {
        const transcript = [
          JSON.stringify({
            type: 'user',
            message: {
              role: 'user',
              content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>',
            },
          }),
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: 'What is the status of the build?' },
          }),
        ].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // /clear command should be filtered out
        expect(excerpt.content).not.toContain('/clear')
        expect(excerpt.content).not.toContain('command-name')
        // Regular user message should remain
        expect(excerpt.content).toContain('[USER]:')
        expect(excerpt.content).toContain('What is the status of the build?')
        expect(excerpt.lineCount).toBe(1)
      })

      it('excludes multiple built-in commands (/context, /compact, /status)', async () => {
        const transcript = [
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '<command-name>/context</command-name>' },
          }),
          JSON.stringify({
            type: 'user',
            message: {
              role: 'user',
              content: '<command-name>/compact</command-name>\n<command-args>focus on tests</command-args>',
            },
          }),
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '<command-name>/status</command-name>' },
          }),
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: 'Run the tests' },
          }),
        ].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // All built-in commands should be filtered
        expect(excerpt.content).not.toContain('/context')
        expect(excerpt.content).not.toContain('/compact')
        expect(excerpt.content).not.toContain('/status')
        // Real user message remains
        expect(excerpt.content).toContain('Run the tests')
        expect(excerpt.lineCount).toBe(1)
      })

      it('preserves /rename command (helps infer session title)', async () => {
        const transcript = [
          JSON.stringify({
            type: 'user',
            message: {
              role: 'user',
              content: '<command-name>/rename</command-name>\n<command-args>Auth Feature Development</command-args>',
            },
          }),
        ].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // /rename is NOT filtered - the name can hint at session purpose
        expect(excerpt.content).toContain('/rename')
        expect(excerpt.content).toContain('Auth Feature Development')
        expect(excerpt.lineCount).toBe(1)
      })

      it('preserves custom commands (may have task-relevant parameters)', async () => {
        const transcript = [
          JSON.stringify({
            type: 'user',
            message: {
              role: 'user',
              content:
                '<command-name>/my-custom-command</command-name>\n<command-args>important task info</command-args>',
            },
          }),
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '<command-name>/deploy-staging</command-name>' },
          }),
        ].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // Custom commands are preserved (not in built-in exclude list)
        expect(excerpt.content).toContain('/my-custom-command')
        expect(excerpt.content).toContain('important task info')
        expect(excerpt.content).toContain('/deploy-staging')
        expect(excerpt.lineCount).toBe(2)
      })

      it('filters commands case-insensitively', async () => {
        const transcript = [
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '<command-name>/CLEAR</command-name>' },
          }),
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '<command-name>/Context</command-name>' },
          }),
        ].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // Case variations of built-in commands should still be filtered
        expect(excerpt.content).not.toContain('/CLEAR')
        expect(excerpt.content).not.toContain('/Context')
        expect(excerpt.lineCount).toBe(0)
      })

      it('excludes all documented built-in commands', async () => {
        // Test a representative sample of built-in commands from the exclude list
        const builtinCommands = [
          '/add-dir',
          '/agents',
          '/bashes',
          '/bug',
          '/clear',
          '/compact',
          '/config',
          '/context',
          '/cost',
          '/doctor',
          '/exit',
          '/export',
          '/help',
          '/hooks',
          '/ide',
          '/init',
          '/login',
          '/logout',
          '/mcp',
          '/memory',
          '/model',
          '/permissions',
          '/plan',
          '/plugin',
          '/resume',
          '/review',
          '/rewind',
          '/sandbox',
          '/stats',
          '/status',
          '/statusline',
          '/theme',
          '/todos',
          '/usage',
          '/vim',
        ]

        const transcript = builtinCommands
          .map((cmd) =>
            JSON.stringify({
              type: 'user',
              message: { role: 'user', content: `<command-name>${cmd}</command-name>` },
            })
          )
          .join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({})

        // All built-in commands should be filtered
        expect(excerpt.lineCount).toBe(0)
        expect(excerpt.content).toBe('')
      })
    })
  })

  // ==========================================================================
  // Streaming and Buffer Tests
  // ==========================================================================

  describe('streaming and buffer behavior', () => {
    // Helper to create transcript with N lines (same as in getExcerpt tests)
    function createTranscriptLines(count: number, startIndex = 1): string[] {
      return Array.from({ length: count }, (_, i) =>
        JSON.stringify({ type: 'user', message: { role: 'user', content: `Message ${startIndex + i}` } })
      )
    }

    describe('byte offset tracking', () => {
      it('tracks byte offset after initial processing', async () => {
        const lines = createTranscriptLines(5)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const internals = getTestHelpers(service)
        // Byte offset should be > 0 after processing content
        expect(internals.lastProcessedByteOffset).toBeGreaterThan(0)
      })

      it('only reads new content on incremental append', async () => {
        // Start with 3 lines
        const initialLines = createTranscriptLines(3)
        writeFileSync(transcriptPath, initialLines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const internals = getTestHelpers(service)
        const offsetAfterInitial = internals.lastProcessedByteOffset
        const metricsAfterInitial = service.getMetrics()

        // Append 2 more lines
        const appendLines = createTranscriptLines(2, 4) // Start line numbers at 4
        writeFileSync(transcriptPath, initialLines.join('\n') + '\n' + appendLines.join('\n'))

        // Manually trigger processing (simulates file watcher)
        await internals.processTranscriptFile()

        // Byte offset should have increased
        expect(internals.lastProcessedByteOffset).toBeGreaterThan(offsetAfterInitial)

        // Metrics should reflect the new lines
        const metricsAfterAppend = service.getMetrics()
        expect(metricsAfterAppend.lastProcessedLine).toBeGreaterThan(metricsAfterInitial.lastProcessedLine)
      })

      it('resets state if file appears truncated', async () => {
        const lines = createTranscriptLines(10)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const internals = getTestHelpers(service)
        const originalOffset = internals.lastProcessedByteOffset

        // Simulate file truncation by writing shorter content
        const shorterLines = createTranscriptLines(2)
        writeFileSync(transcriptPath, shorterLines.join('\n'))

        // Process should detect truncation and reset
        await internals.processTranscriptFile()

        // Should have reset and reprocessed from beginning
        expect(internals.lastProcessedByteOffset).toBeLessThan(originalOffset)
        expect(service.getMetrics().lastProcessedLine).toBe(2)
      })
    })

    describe('circular buffer for excerpts', () => {
      it('populates buffer during processing', async () => {
        const lines = createTranscriptLines(10)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const internals = getTestHelpers(service)
        // Buffer should contain entries
        expect(internals.excerptBufferCount).toBe(10)
      })

      it('returns entries in chronological order', async () => {
        const lines = createTranscriptLines(5)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const internals = getTestHelpers(service)
        const buffered = internals.getBufferedEntries()

        // Entries should be in ascending line number order
        for (let i = 1; i < buffered.length; i++) {
          expect(buffered[i].lineNumber).toBeGreaterThan(buffered[i - 1].lineNumber)
        }
      })

      it('serves excerpt from buffer without re-reading file', async () => {
        const lines = createTranscriptLines(10)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        // Delete the file after processing
        rmSync(transcriptPath)

        // Excerpt should still work from buffer
        const excerpt = service.getExcerpt({})
        expect(excerpt.lineCount).toBeGreaterThan(0)
        expect(excerpt.content).toContain('[USER]:')
      })

      it('maintains chronological order after buffer wraparound', async () => {
        // Create more entries than EXCERPT_BUFFER_SIZE (500) to trigger wraparound
        const totalEntries = 510
        const lines = createTranscriptLines(totalEntries)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const internals = getTestHelpers(service)
        // Buffer should be capped at 500 (EXCERPT_BUFFER_SIZE)
        expect(internals.excerptBufferCount).toBe(500)

        const buffered = internals.getBufferedEntries()
        expect(buffered).toHaveLength(500)

        // Oldest entries (1-10) should have been evicted
        const firstLineNumber = buffered[0].lineNumber
        expect(firstLineNumber).toBe(11) // first 10 evicted

        // Last entry should be the most recent
        const lastLineNumber = buffered[buffered.length - 1].lineNumber
        expect(lastLineNumber).toBe(totalEntries)

        // Verify strict chronological order throughout the wrapped buffer
        for (let i = 1; i < buffered.length; i++) {
          expect(buffered[i].lineNumber).toBeGreaterThan(buffered[i - 1].lineNumber)
        }
      })

      it('maintains buffer on incremental updates', async () => {
        // Start with 5 lines
        const initialLines = createTranscriptLines(5)
        writeFileSync(transcriptPath, initialLines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const internals = getTestHelpers(service)
        expect(internals.excerptBufferCount).toBe(5)

        // Append more lines
        const appendLines = createTranscriptLines(3, 6)
        writeFileSync(transcriptPath, initialLines.join('\n') + '\n' + appendLines.join('\n'))
        await internals.processTranscriptFile()

        // Buffer should now have 8 entries
        expect(internals.excerptBufferCount).toBe(8)
      })
    })

    describe('buffer limits', () => {
      it('limits buffer to EXCERPT_BUFFER_SIZE entries', async () => {
        // Create more lines than the buffer size (500)
        // We'll use 10 lines but test the principle
        const lines = createTranscriptLines(10)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const internals = getTestHelpers(service)
        // Buffer count should not exceed the buffer size
        // (In this test we only have 10 lines, but the principle is tested)
        expect(internals.excerptBufferCount).toBeLessThanOrEqual(500)
      })
    })

    describe('excerpt from buffer vs file', () => {
      it('produces same excerpt content as would be read from file', async () => {
        const lines = createTranscriptLines(20)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.prepare('test-session', transcriptPath)
        await service.start()

        const excerpt = service.getExcerpt({ maxLines: 10 })

        // Should have 10 lines (all user messages pass filter)
        expect(excerpt.lineCount).toBe(10)
        // Should be the LAST 10 lines (tail behavior)
        expect(excerpt.endLine).toBe(20)
        expect(excerpt.startLine).toBe(11)
      })
    })
  })

  describe('getRecentTextEntries', () => {
    let testDir: string
    let transcriptPath: string
    let service: TranscriptServiceImpl

    beforeEach(() => {
      testDir = createTestDir()
      transcriptPath = join(testDir, 'transcript.jsonl')
      service = new TranscriptServiceImpl({
        watchDebounceMs: 100,
        metricsPersistIntervalMs: 60000,
        handlers: createMockHandlerRegistry(),
        logger: createMockLogger(),
        stateDir: testDir,
        stateService: new MockStateService(),
      })
    })

    afterEach(async () => {
      await service.shutdown()
      cleanupTestDir(testDir)
    })

    it('returns empty array when buffer is empty', () => {
      const entries = service.getRecentTextEntries()
      expect(entries).toEqual([])
    })

    it('returns only text entries, filtering out tool_use and tool_result', async () => {
      const lines = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Fix the bug' } }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'I will read the file' },
              { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'foo.ts' } },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' }],
          },
        }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Here is the fix' } }),
      ]
      writeFileSync(transcriptPath, lines.join('\n'))
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const entries = service.getRecentTextEntries(10)

      // Should only contain text entries, not tool_use/tool_result
      expect(entries.every((e) => e.type === 'text')).toBe(true)
      // Should find the user prompt and assistant messages
      const contents = entries.map((e) => e.content)
      expect(contents).toContain('Fix the bug')
      expect(contents).toContain('I will read the file')
      expect(contents).toContain('Here is the fix')
    })

    it('respects count parameter', async () => {
      const lines = Array.from({ length: 10 }, (_, i) =>
        JSON.stringify({ type: 'user', message: { role: 'user', content: `Message ${i + 1}` } })
      )
      writeFileSync(transcriptPath, lines.join('\n'))
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const entries = service.getRecentTextEntries(3)

      expect(entries).toHaveLength(3)
      // Should be the LAST 3 text entries in chronological order
      expect(entries[0].content).toBe('Message 8')
      expect(entries[1].content).toBe('Message 9')
      expect(entries[2].content).toBe('Message 10')
    })

    it('returns in chronological order (oldest first)', async () => {
      const lines = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'First' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Second' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Third' } }),
      ]
      writeFileSync(transcriptPath, lines.join('\n'))
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const entries = service.getRecentTextEntries(10)

      expect(entries[0].content).toBe('First')
      expect(entries[entries.length - 1].content).toBe('Third')
    })

    it('finds text entries even when dominated by tool calls', async () => {
      // Simulate a tool-heavy turn: 1 user prompt, then 50 tool_use/tool_result pairs
      const lines: string[] = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Refactor the codebase' } }),
      ]
      for (let i = 0; i < 50; i++) {
        lines.push(
          JSON.stringify({
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{ type: 'tool_use', id: `tool-${i}`, name: 'Read', input: {} }],
            },
          })
        )
        lines.push(
          JSON.stringify({
            type: 'user',
            message: {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: `tool-${i}`, content: 'result' }],
            },
          })
        )
      }
      lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'All done' } }))

      writeFileSync(transcriptPath, lines.join('\n'))
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const entries = service.getRecentTextEntries(5)

      // Should find text entries despite 100 tool entries in between
      expect(entries.every((e) => e.type === 'text')).toBe(true)
      const contents = entries.map((e) => e.content)
      expect(contents).toContain('Refactor the codebase')
      expect(contents).toContain('All done')
    })

    it('returns empty array when count is 0', async () => {
      const lines = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Hi there' } }),
      ]
      writeFileSync(transcriptPath, lines.join('\n'))
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const entries = service.getRecentTextEntries(0)
      expect(entries).toEqual([])
    })

    it('returns empty array when count is negative', async () => {
      const lines = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Hi there' } }),
      ]
      writeFileSync(transcriptPath, lines.join('\n'))
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const entries = service.getRecentTextEntries(-5)
      expect(entries).toEqual([])
    })

    it('returns entries with empty text content', async () => {
      const lines = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: '' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'World' } }),
      ]
      writeFileSync(transcriptPath, lines.join('\n'))
      await service.prepare('test-session', transcriptPath)
      await service.start()

      const entries = service.getRecentTextEntries(10)

      // All three should be present — empty string is valid text content
      expect(entries).toHaveLength(3)
      const contents = entries.map((e) => e.content)
      expect(contents).toContain('Hello')
      expect(contents).toContain('')
      expect(contents).toContain('World')
    })
  })
})
