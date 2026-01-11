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
  persistMetrics: (immediate: boolean) => void
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
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
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
  let service: TranscriptServiceImpl

  beforeEach(() => {
    testDir = createTestDir()
    stateDir = join(testDir, '.sidekick')
    transcriptPath = join(testDir, 'transcript.jsonl')
    logger = createMockLogger()
    handlers = createMockHandlerRegistry()

    const options: TranscriptServiceOptions = {
      watchDebounceMs: 50,
      metricsPersistIntervalMs: 60000, // Long interval to avoid interference
      handlers,
      logger,
      stateDir,
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
      await service.initialize('test-session', transcriptPath)

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(0)
      expect(metrics.messageCount).toBe(0)
    })

    it('initializes with non-existent transcript', async () => {
      await service.initialize('test-session', transcriptPath)

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(0)
    })
  })

  // --------------------------------------------------------------------------
  // Metrics Computation Tests
  // --------------------------------------------------------------------------

  describe('metrics computation', () => {
    it('increments turnCount and messageCount on user message', async () => {
      const transcript = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } })].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

      expect(handlers.emittedEvents).toContainEqual(
        expect.objectContaining({
          eventType: 'ToolResult',
          lineNumber: 1,
        })
      )
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

      await service.initialize('test-session', transcriptPath)

      const metrics = service.getMetrics()
      expect(metrics.lastProcessedLine).toBe(3)
    })

    it('skips malformed lines', async () => {
      const transcript = [
        'not valid json',
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Valid' } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)
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

      await service.initialize('test-session', transcriptPath)

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
      await service.initialize('test-session', transcriptPath)

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
      await service.initialize('test-session', transcriptPath)

      const callback = vi.fn()
      const unsubscribe = service.onMetricsChange(callback)
      unsubscribe()

      writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }))
      await getTestHelpers(service).processTranscriptFile()

      expect(callback).not.toHaveBeenCalled()
    })

    it('fires threshold callback when crossed', async () => {
      writeFileSync(transcriptPath, '')
      await service.initialize('test-session', transcriptPath)

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
      await service.initialize('test-session', transcriptPath)

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
  })

  // --------------------------------------------------------------------------
  // Metrics Persistence Tests
  // --------------------------------------------------------------------------

  describe('metrics persistence', () => {
    it('persists metrics to state file', async () => {
      const transcript = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } })].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.initialize('test-session', transcriptPath)

      // Force immediate persistence
      getTestHelpers(service).persistMetrics(true)

      const statePath = join(stateDir, 'sessions', 'test-session', 'state', 'transcript-metrics.json')
      expect(existsSync(statePath)).toBe(true)

      const saved = JSON.parse(readFileSync(statePath, 'utf-8'))
      expect(saved.sessionId).toBe('test-session')
      expect(saved.metrics.turnCount).toBe(1)
    })

    it('recovers metrics on restart', async () => {
      // Set up initial state
      const statePath = join(stateDir, 'sessions', 'test-session', 'state', 'transcript-metrics.json')
      mkdirSync(join(stateDir, 'sessions', 'test-session', 'state'), { recursive: true })

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
      writeFileSync(statePath, JSON.stringify(savedState))

      writeFileSync(transcriptPath, '')
      await service.initialize('test-session', transcriptPath)

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(5)
      expect(metrics.toolCount).toBe(10)
      expect(logger.info).toHaveBeenCalledWith('Recovered transcript state', expect.any(Object))
    })
  })

  // --------------------------------------------------------------------------
  // Compaction History Tests
  // --------------------------------------------------------------------------

  describe('compaction history', () => {
    it('captures pre-compact state', async () => {
      const transcript = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } })].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.initialize('test-session', transcriptPath)

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

      await service.initialize('test-session', transcriptPath)

      const snapshotPath = join(testDir, 'snapshots', 'pre-compact-123.jsonl')
      await service.capturePreCompactState(snapshotPath)

      const historyPath = join(stateDir, 'sessions', 'test-session', 'state', 'compaction-history.json')
      expect(existsSync(historyPath)).toBe(true)

      const saved = JSON.parse(readFileSync(historyPath, 'utf-8'))
      expect(saved.length).toBe(1)
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

      await service.initialize('test-session', transcriptPath)

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
        await service.initialize('test-session', transcriptPath)

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
        await service.initialize('test-session', transcriptPath)

        // bookmarkLine === totalLines, condition is bookmarkLine < totalLines
        const excerpt = service.getExcerpt({ bookmarkLine: 5, maxLines: 3 })

        expect(excerpt.bookmarkApplied).toBe(false)
        expect(excerpt.lineCount).toBe(3)
      })

      it('ignores bookmark when bookmarkLine is 0', async () => {
        const lines = createTranscriptLines(5)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.initialize('test-session', transcriptPath)

        const excerpt = service.getExcerpt({ bookmarkLine: 0, maxLines: 3 })

        expect(excerpt.bookmarkApplied).toBe(false)
        expect(excerpt.lineCount).toBe(3)
      })

      it('applies bookmark correctly for valid bookmarkLine', async () => {
        const lines = createTranscriptLines(10)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.initialize('test-session', transcriptPath)

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
        await service.initialize('test-session', transcriptPath)

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
        await service.initialize('test-session', transcriptPath)

        const excerpt = service.getExcerpt({ maxLines: 100 })

        expect(excerpt.lineCount).toBe(5)
        expect(excerpt.startLine).toBe(1)
        expect(excerpt.endLine).toBe(5)
      })

      it('returns exactly maxLines when maxLines < totalLines', async () => {
        const lines = createTranscriptLines(10)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.initialize('test-session', transcriptPath)

        const excerpt = service.getExcerpt({ maxLines: 3 })

        expect(excerpt.lineCount).toBe(3)
        expect(excerpt.startLine).toBe(8) // Last 3 of 10
        expect(excerpt.endLine).toBe(10)
      })

      it('returns all lines when maxLines equals totalLines', async () => {
        const lines = createTranscriptLines(5)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.initialize('test-session', transcriptPath)

        const excerpt = service.getExcerpt({ maxLines: 5 })

        expect(excerpt.lineCount).toBe(5)
        expect(excerpt.startLine).toBe(1)
        expect(excerpt.endLine).toBe(5)
      })

      it('defaults to 80 maxLines when not specified', async () => {
        const lines = createTranscriptLines(100)
        writeFileSync(transcriptPath, lines.join('\n'))
        await service.initialize('test-session', transcriptPath)

        const excerpt = service.getExcerpt({})

        expect(excerpt.lineCount).toBe(80)
        expect(excerpt.startLine).toBe(21) // Lines 21-100
        expect(excerpt.endLine).toBe(100)
      })

      it('handles empty transcript', async () => {
        writeFileSync(transcriptPath, '')
        await service.initialize('test-session', transcriptPath)

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
        await service.initialize('test-session', transcriptPath)

        const excerpt = service.getExcerpt({})

        expect(excerpt.content).toContain('[USER]:')
        expect(excerpt.content).toContain('Hello world')
      })

      it('formats assistant messages correctly', async () => {
        const transcript = [JSON.stringify({ type: 'assistant', message: { content: 'I can help' } })].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.initialize('test-session', transcriptPath)

        const excerpt = service.getExcerpt({})

        expect(excerpt.content).toContain('[ASSISTANT]:')
        expect(excerpt.content).toContain('I can help')
      })

      it('formats tool_use entries correctly', async () => {
        const transcript = [JSON.stringify({ type: 'tool_use', name: 'Read' })].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.initialize('test-session', transcriptPath)

        const excerpt = service.getExcerpt({})

        expect(excerpt.content).toContain('[TOOL]:')
        expect(excerpt.content).toContain('Read')
      })

      it('excludes tool_result entirely when includeToolOutputs is false (no placeholder)', async () => {
        // New behavior: excluded content returns null, not a placeholder line
        const transcript = [JSON.stringify({ type: 'tool_result', content: 'sensitive file contents here' })].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.initialize('test-session', transcriptPath)

        const excerpt = service.getExcerpt({ includeToolOutputs: false })

        // Entire entry is excluded - no [RESULT]: line at all
        expect(excerpt.content).toBe('')
        expect(excerpt.lineCount).toBe(0)
        expect(excerpt.content).not.toContain('sensitive file contents')
      })

      it('includes tool_result output when includeToolOutputs is true', async () => {
        const transcript = [JSON.stringify({ type: 'tool_result', content: 'file contents here' })].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.initialize('test-session', transcriptPath)

        const excerpt = service.getExcerpt({ includeToolOutputs: true })

        expect(excerpt.content).toContain('[RESULT]:')
        expect(excerpt.content).toContain('file contents here')
        expect(excerpt.content).not.toContain('(output omitted)')
      })

      it('excludes unknown entry types to reduce noise', async () => {
        // Unknown types are excluded to keep excerpts focused on user/assistant conversation
        const transcript = [JSON.stringify({ type: 'custom_unknown_type', data: { foo: 'bar' } })].join('\n')
        writeFileSync(transcriptPath, transcript)
        await service.initialize('test-session', transcriptPath)

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
        await service.initialize('test-session', transcriptPath)

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
        await service.initialize('test-session', transcriptPath)

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
        await service.initialize('test-session', transcriptPath)

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
        await service.initialize('test-session', transcriptPath)

        const excerpt = service.getExcerpt({})

        // Text content is extracted, tool_use is stripped
        expect(excerpt.content).toContain('[ASSISTANT]:')
        expect(excerpt.content).toContain('Let me edit that file.')
        expect(excerpt.content).not.toContain('Edit') // tool name stripped
      })
    })

    describe('error handling', () => {
      it('returns empty excerpt when file read fails', async () => {
        writeFileSync(transcriptPath, 'test')
        await service.initialize('test-session', transcriptPath)

        // Delete the file after initialization
        rmSync(transcriptPath)

        const excerpt = service.getExcerpt({})

        expect(excerpt.content).toBe('')
        expect(excerpt.lineCount).toBe(0)
        expect(excerpt.bookmarkApplied).toBe(false)
        expect(logger.error).toHaveBeenCalledWith('Failed to extract transcript excerpt', expect.any(Object))
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
        await service.initialize('test-session', transcriptPath)

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
        await service.initialize('test-session', transcriptPath)

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
        await service.initialize('test-session', transcriptPath)

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
        await service.initialize('test-session', transcriptPath)

        const excerpt = service.getExcerpt({})

        // Summary without leafUuid should be skipped (can't verify it's internal)
        expect(excerpt.content).not.toContain('Summary without leafUuid')
        expect(excerpt.content).toContain('[USER]:')
      })
    })
  })
})
