/**
 * TranscriptService Integration Tests
 *
 * Tests with real Claude Code transcript files to verify parsing handles
 * actual data structures, not naive test fixtures.
 *
 * Key differences from unit tests:
 * - tool_use is nested in assistant.message.content[] (not top-level)
 * - tool_result is nested in user.message.content[] (not top-level)
 * - Entries have additional fields: uuid, sessionId, timestamp, cwd, etc.
 * - summary and file-history-snapshot are additional entry types
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import { existsSync, mkdirSync, rmSync, copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TranscriptServiceImpl, type TranscriptServiceOptions } from '../transcript-service'
import type { HandlerRegistry, Logger, TranscriptEventType, TranscriptEntry } from '@sidekick/types'

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
  const testDir = join(tmpdir(), `transcript-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
  return testDir
}

function cleanupTestDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Path to test transcript data (relative to workspace root via process.cwd())
// When running tests, cwd is the workspace root
const TEST_DATA_DIR = join(process.cwd(), '../../test-data/transcripts')

// Test fixture paths - defined once to avoid repetition in skipIf conditions
const FIXTURES = {
  SHORT_002: join(TEST_DATA_DIR, 'short-002.jsonl'),
  SHORT_003: join(TEST_DATA_DIR, 'short-003.jsonl'),
  SHORT_175: join(TEST_DATA_DIR, 'short-175.jsonl'),
  MEDIUM_003: join(TEST_DATA_DIR, 'medium-003.jsonl'),
  LONG_001: join(TEST_DATA_DIR, 'long-001.jsonl'),
} as const

// ============================================================================
// Integration Tests with Real Transcripts
// ============================================================================

describe('TranscriptService Integration Tests', () => {
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
      metricsPersistIntervalMs: 60000,
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
  // Real Transcript Processing
  // --------------------------------------------------------------------------

  describe('real transcript: short-003.jsonl', () => {
    it.skipIf(!existsSync(FIXTURES.SHORT_003))('processes basic user/assistant transcript correctly', async () => {
      // short-003.jsonl has: 1 user, 1 assistant (simple conversation)
      copyFileSync(FIXTURES.SHORT_003, transcriptPath)
      await service.initialize('test-session', transcriptPath)

      const metrics = service.getMetrics()

      // Should have 1 turn (user message starts a turn)
      expect(metrics.turnCount).toBeGreaterThanOrEqual(1)
      // Should have at least 2 messages (user + assistant)
      expect(metrics.messageCount).toBeGreaterThanOrEqual(2)
      // Should have processed all lines
      expect(metrics.lastProcessedLine).toBeGreaterThan(0)
    })

    it.skipIf(!existsSync(FIXTURES.SHORT_003))('extracts token usage from real assistant message', async () => {
      copyFileSync(FIXTURES.SHORT_003, transcriptPath)
      await service.initialize('test-session', transcriptPath)

      const metrics = service.getMetrics()

      // Real transcripts have usage data
      expect(metrics.tokenUsage.inputTokens).toBeGreaterThan(0)
      expect(metrics.tokenUsage.outputTokens).toBeGreaterThan(0)
      expect(metrics.tokenUsage.totalTokens).toBeGreaterThan(0)
    })

    it.skipIf(!existsSync(FIXTURES.SHORT_003))('tracks model usage from real transcript', async () => {
      copyFileSync(FIXTURES.SHORT_003, transcriptPath)
      await service.initialize('test-session', transcriptPath)

      const metrics = service.getMetrics()

      // Should have at least one model tracked
      const modelKeys = Object.keys(metrics.tokenUsage.byModel)
      expect(modelKeys.length).toBeGreaterThanOrEqual(1)

      // Each model should have usage
      for (const model of modelKeys) {
        expect(metrics.tokenUsage.byModel[model].requestCount).toBeGreaterThan(0)
      }
    })
  })

  describe('real transcript with tool usage: short-175.jsonl', () => {
    it.skipIf(!existsSync(FIXTURES.SHORT_175))('counts tool_use blocks nested in assistant messages', async () => {
      // short-175.jsonl has tool_use blocks inside assistant message content
      copyFileSync(FIXTURES.SHORT_175, transcriptPath)
      await service.initialize('test-session', transcriptPath)

      const metrics = service.getMetrics()

      // Verify we counted tools (nested in assistant.message.content[])
      // short-175 has 1 tool_use block per our earlier analysis
      expect(metrics.toolCount).toBeGreaterThanOrEqual(1)
    })

    it.skipIf(!existsSync(FIXTURES.SHORT_175))('emits ToolCall events for nested tool_use blocks', async () => {
      copyFileSync(FIXTURES.SHORT_175, transcriptPath)
      await service.initialize('test-session', transcriptPath)

      // Should have emitted ToolCall events
      const toolCallEvents = handlers.emittedEvents.filter((e) => e.eventType === 'ToolCall')
      expect(toolCallEvents.length).toBeGreaterThanOrEqual(1)
    })

    it.skipIf(!existsSync(FIXTURES.SHORT_175))('counts tool_result blocks nested in user messages', async () => {
      copyFileSync(FIXTURES.SHORT_175, transcriptPath)
      await service.initialize('test-session', transcriptPath)

      // Should have emitted ToolResult events
      const toolResultEvents = handlers.emittedEvents.filter((e) => e.eventType === 'ToolResult')

      // tool_result is nested in user.message.content[], should be counted
      expect(toolResultEvents.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('real transcript with summary: long-001.jsonl', () => {
    it.skipIf(!existsSync(FIXTURES.LONG_001))('skips summary entries without error', async () => {
      // long-001 has summary entries
      copyFileSync(FIXTURES.LONG_001, transcriptPath)
      await service.initialize('test-session', transcriptPath)

      // Should not have any errors for unknown types
      expect(logger.error).not.toHaveBeenCalled()

      const metrics = service.getMetrics()
      expect(metrics.lastProcessedLine).toBeGreaterThan(0)
    })
  })

  describe('real transcript with file-history-snapshot', () => {
    it.skipIf(!existsSync(FIXTURES.SHORT_002))('skips file-history-snapshot entries without error', async () => {
      // short-002 is just file-history-snapshot entries
      copyFileSync(FIXTURES.SHORT_002, transcriptPath)
      await service.initialize('test-session', transcriptPath)

      // Should not emit any standard events for non-message entries
      const messageEvents = handlers.emittedEvents.filter(
        (e) => e.eventType === 'UserPrompt' || e.eventType === 'AssistantMessage'
      )
      expect(messageEvents.length).toBe(0)

      // Should not error on unknown types
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases in Real Data
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it.skipIf(!existsSync(FIXTURES.SHORT_003))('handles real transcript with cache metrics', async () => {
      copyFileSync(FIXTURES.SHORT_003, transcriptPath)
      await service.initialize('test-session', transcriptPath)

      const metrics = service.getMetrics()

      // Real transcripts have cache metrics
      // At least one of these should be > 0 for a real conversation
      const hasCacheMetrics =
        metrics.tokenUsage.cacheCreationInputTokens > 0 || metrics.tokenUsage.cacheReadInputTokens > 0
      expect(hasCacheMetrics).toBe(true)
    })

    it.skipIf(!existsSync(FIXTURES.SHORT_003))('tracks service tier from real transcript', async () => {
      copyFileSync(FIXTURES.SHORT_003, transcriptPath)
      await service.initialize('test-session', transcriptPath)

      const metrics = service.getMetrics()

      // Real transcripts have service_tier field
      const tierCounts = Object.keys(metrics.tokenUsage.serviceTierCounts)
      expect(tierCounts.length).toBeGreaterThanOrEqual(1)
    })
  })
})

// ============================================================================
// Diagnostic Test (for development - shows actual structure)
// ============================================================================

describe('Transcript Structure Diagnostics', () => {
  it.skip('logs structure of real transcript entries (dev only)', () => {
    // This test is for manual debugging - skip in CI
    // Uncomment console.log statements when investigating transcript structure
    const sourceFile = join(TEST_DATA_DIR, 'short-003.jsonl')
    if (!existsSync(sourceFile)) {
      return
    }

    const content = readFileSync(sourceFile, 'utf-8')
    const lines = content.split('\n').filter((l) => l.trim())

    const entries: Array<{ type: string; keys: string[]; contentTypes?: string[] }> = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        const info: { type: string; keys: string[]; contentTypes?: string[] } = {
          type: entry.type,
          keys: Object.keys(entry),
        }

        if (entry.type === 'assistant' && entry.message?.content) {
          info.contentTypes = entry.message.content.map((c: { type?: string }) => c.type)
        }

        if (entry.type === 'user' && entry.message?.content && Array.isArray(entry.message.content)) {
          info.contentTypes = entry.message.content.map((c: { type?: string }) => c.type)
        }

        entries.push(info)
      } catch {
        // Skip malformed lines
      }
    }

    // Verify we parsed something (the test's actual assertion)
    expect(entries.length).toBeGreaterThan(0)
  })
})
