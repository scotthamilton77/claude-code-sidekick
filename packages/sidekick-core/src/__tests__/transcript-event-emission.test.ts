/**
 * Transcript Event Emission Tests
 *
 * Verifies that transcript:emitted events are logged via logEvent()
 * when HandlerRegistryImpl.emitTranscriptEvent() processes transcript entries.
 *
 * The handler-registry is the single emission point for transcript:emitted events.
 * logEvent() calls logger.info() with { type, source, ...payload },
 * so we verify by checking logger.info mock calls for the expected type.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HandlerRegistryImpl } from '../handler-registry'
import { createFakeLogger, type MockedLogger } from '@sidekick/testing-fixtures'
import type { TranscriptMetrics } from '@sidekick/types'

// ============================================================================
// Test Helpers
// ============================================================================

function createEmptyMetrics(): TranscriptMetrics {
  return {
    turnCount: 0,
    toolCount: 0,
    toolsThisTurn: 0,
    messageCount: 0,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheTiers: { ephemeral5mInputTokens: 0, ephemeral1hInputTokens: 0 },
      serviceTierCounts: {},
      byModel: {},
    },
    currentContextTokens: null,
    isPostCompactIndeterminate: false,
    toolsPerTurn: 0,
    lastProcessedLine: 0,
    lastUpdatedAt: 0,
  }
}

/**
 * Extract logEvent calls from logger.info mock by filtering for metadata
 * with a specific `type` field. logEvent() calls logger.info(msg, { type, source, ...payload }).
 */
function findLogEventCalls(
  logger: MockedLogger,
  eventType: string
): Array<{ msg: string; meta: Record<string, unknown> }> {
  return logger.info.mock.calls
    .filter((call: unknown[]) => {
      const meta = call[1] as Record<string, unknown> | undefined
      return meta?.type === eventType
    })
    .map((call: unknown[]) => ({
      msg: call[0] as string,
      meta: call[1] as Record<string, unknown>,
    }))
}

// ============================================================================
// Tests
// ============================================================================

describe('transcript:emitted event emission via HandlerRegistryImpl', () => {
  let logger: MockedLogger
  let registry: HandlerRegistryImpl

  beforeEach(() => {
    logger = createFakeLogger()
    registry = new HandlerRegistryImpl({
      logger,
      sessionId: 'test-session',
      transcriptPath: '/tmp/test-transcript.jsonl',
    })
    // Wire up a metrics provider so the `if (metrics)` guard passes
    registry.setMetricsProvider(() => createEmptyMetrics())
  })

  it('should emit transcript:emitted event for UserPrompt', async () => {
    const entry = {
      type: 'user',
      message: { role: 'user', content: 'Hello world' },
    }

    await registry.emitTranscriptEvent('UserPrompt', entry, 1, false)

    const emittedCalls = findLogEventCalls(logger, 'transcript:emitted')
    expect(emittedCalls).toHaveLength(1)

    const call = emittedCalls[0]
    expect(call.meta.source).toBe('transcript')
    expect(call.meta.eventType).toBe('UserPrompt')
    expect(call.meta.lineNumber).toBe(1)
  })

  it('should emit transcript:emitted event for ToolCall with toolName', async () => {
    const entry = {
      type: 'tool_use',
      tool_name: 'Read',
      uuid: 'abc-123',
    }

    await registry.emitTranscriptEvent('ToolCall', entry, 5, false)

    const emittedCalls = findLogEventCalls(logger, 'transcript:emitted')
    expect(emittedCalls).toHaveLength(1)

    const call = emittedCalls[0]
    expect(call.meta.eventType).toBe('ToolCall')
    expect(call.meta.toolName).toBe('Read')
    expect(call.meta.uuid).toBe('abc-123')
  })

  it('should include transcriptPath in the logged metadata', async () => {
    const entry = {
      type: 'user',
      message: { role: 'user', content: 'test' },
    }

    await registry.emitTranscriptEvent('UserPrompt', entry, 1, false)

    const emittedCalls = findLogEventCalls(logger, 'transcript:emitted')
    expect(emittedCalls).toHaveLength(1)
    expect(emittedCalls[0].meta.transcriptPath).toBe('/tmp/test-transcript.jsonl')
  })

  it('should not emit transcript:emitted when no metrics provider is set', async () => {
    // Create a registry without a metrics provider
    const noMetricsRegistry = new HandlerRegistryImpl({
      logger,
      sessionId: 'test-session',
      transcriptPath: '/tmp/test.jsonl',
    })

    const entry = { type: 'user', message: { role: 'user', content: 'test' } }
    await noMetricsRegistry.emitTranscriptEvent('UserPrompt', entry, 1, false)

    const emittedCalls = findLogEventCalls(logger, 'transcript:emitted')
    expect(emittedCalls).toHaveLength(0)
  })
})
