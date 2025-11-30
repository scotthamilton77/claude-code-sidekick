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

    it('logs initialization', async () => {
      writeFileSync(transcriptPath, '')
      await service.initialize('test-session', transcriptPath)

      expect(logger.info).toHaveBeenCalledWith('TranscriptService initialized', expect.any(Object))
    })

    it('logs shutdown', async () => {
      writeFileSync(transcriptPath, '')
      await service.initialize('test-session', transcriptPath)
      await service.shutdown()

      expect(logger.info).toHaveBeenCalledWith('TranscriptService shutdown', expect.any(Object))
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

    it('increments toolCount on tool_result in user message content', async () => {
      const transcript = [
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

    it('resets toolsThisTurn on new user message', async () => {
      const transcript = [
        // First turn: user message with tool results
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
        // Second turn: plain user message (no tool results)
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Second' } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.initialize('test-session', transcriptPath)

      const metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(2)
      expect(metrics.toolCount).toBe(2)
      expect(metrics.toolsThisTurn).toBe(0) // Reset after second user message
    })

    it('calculates toolsPerTurn', async () => {
      const transcript = [
        // First turn: 2 tool results
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
        // Second turn: 2 more tool results
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
      expect(metrics.turnCount).toBe(2)
      expect(metrics.toolsPerTurn).toBe(2) // 4 tools / 2 turns
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
    it('detects compaction when file is shorter than watermark', async () => {
      // Initial transcript with 5 lines
      const initial = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'One' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Two' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Three' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Four' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Five' } }),
      ].join('\n')
      writeFileSync(transcriptPath, initial)

      await service.initialize('test-session', transcriptPath)

      let metrics = service.getMetrics()
      expect(metrics.turnCount).toBe(5)
      expect(metrics.lastProcessedLine).toBe(5)

      // Simulate compaction: file becomes shorter
      const compacted = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Compacted' } })].join('\n')
      writeFileSync(transcriptPath, compacted)

      // Manually trigger processing (normally done by file watcher)
      // Access private method for testing
      await (service as unknown as { processTranscriptFile: () => Promise<void> }).processTranscriptFile()

      metrics = service.getMetrics()
      // Per design: metrics are additive (don't reset to zero)
      // Previous 5 turns + 1 new turn after compaction
      expect(metrics.turnCount).toBe(6)
      expect(metrics.lastProcessedLine).toBe(1)
    })

    it('emits Compact event on compaction detection', async () => {
      const initial = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'One' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Two' } }),
      ].join('\n')
      writeFileSync(transcriptPath, initial)

      await service.initialize('test-session', transcriptPath)

      handlers.emittedEvents.length = 0 // Clear events

      const compacted = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Compacted' } })].join('\n')
      writeFileSync(transcriptPath, compacted)

      await (service as unknown as { processTranscriptFile: () => Promise<void> }).processTranscriptFile()

      expect(handlers.emittedEvents).toContainEqual(
        expect.objectContaining({
          eventType: 'Compact',
        })
      )
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
      await (service as unknown as { processTranscriptFile: () => Promise<void> }).processTranscriptFile()

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
      await (service as unknown as { processTranscriptFile: () => Promise<void> }).processTranscriptFile()

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
      await (service as unknown as { processTranscriptFile: () => Promise<void> }).processTranscriptFile()

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('only fires threshold callback once', async () => {
      writeFileSync(transcriptPath, '')
      await service.initialize('test-session', transcriptPath)

      const callback = vi.fn()
      service.onThreshold('turnCount', 1, callback)

      writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'One' } }))
      await (service as unknown as { processTranscriptFile: () => Promise<void> }).processTranscriptFile()

      writeFileSync(
        transcriptPath,
        [
          JSON.stringify({ type: 'user', message: { role: 'user', content: 'One' } }),
          JSON.stringify({ type: 'user', message: { role: 'user', content: 'Two' } }),
        ].join('\n')
      )
      await (service as unknown as { processTranscriptFile: () => Promise<void> }).processTranscriptFile()

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
      ;(service as unknown as { persistMetrics: (immediate: boolean) => void }).persistMetrics(true)

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

      expect(service.getMetric('turnCount')).toBe(1)
      expect(service.getMetric('toolCount')).toBe(1)
      expect(service.getMetric('messageCount')).toBe(1)
    })
  })
})
