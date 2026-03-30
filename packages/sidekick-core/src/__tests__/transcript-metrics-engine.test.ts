/**
 * Tests for transcript-metrics-engine module.
 *
 * Validates entry processing, token usage extraction, message classification,
 * and compact boundary handling.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  processEntry,
  extractTokenUsage,
  processNestedToolUses,
  processNestedToolResults,
  handleCompactBoundary,
  isToolResultOnlyMessage,
  isLocalCommandStdoutMessage,
  isExcludedBuiltinCommandInvocation,
  updateToolsPerTurn,
} from '../transcript-metrics-engine'
import { createDefaultMetrics } from '../transcript-helpers'
import type { TranscriptEntry, TranscriptMetrics, TranscriptEventType } from '@sidekick/types'

// ============================================================================
// Test Helpers
// ============================================================================

function createEmitSpy(): {
  emitEvent: (eventType: TranscriptEventType, entry: TranscriptEntry, lineNumber: number) => Promise<void>
  emitted: Array<{ eventType: TranscriptEventType; entry: TranscriptEntry; lineNumber: number }>
} {
  const emitted: Array<{ eventType: TranscriptEventType; entry: TranscriptEntry; lineNumber: number }> = []
  const emitEvent = vi.fn((eventType: TranscriptEventType, entry: TranscriptEntry, lineNumber: number) => {
    emitted.push({ eventType, entry, lineNumber })
    return Promise.resolve()
  }) as any
  return { emitEvent, emitted }
}

// ============================================================================
// processEntry
// ============================================================================

describe('processEntry', () => {
  it('processes user prompt and increments turn count', async () => {
    const metrics = createDefaultMetrics()
    const { emitEvent, emitted } = createEmitSpy()
    const toolMap = new Map<string, string>()

    const entry: TranscriptEntry = {
      type: 'user',
      message: { role: 'user', content: 'Hello' },
    }

    await processEntry(entry, 1, metrics, toolMap, emitEvent)

    expect(metrics.turnCount).toBe(1)
    expect(metrics.messageCount).toBe(1)
    expect(metrics.toolsThisTurn).toBe(0)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].eventType).toBe('UserPrompt')
  })

  it('does not increment turn count for tool-result-only messages', async () => {
    const metrics = createDefaultMetrics()
    const { emitEvent, emitted } = createEmitSpy()
    const toolMap = new Map<string, string>()

    const entry: TranscriptEntry = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'id-1', content: 'output' }],
      },
    }

    await processEntry(entry, 1, metrics, toolMap, emitEvent)

    expect(metrics.turnCount).toBe(0)
    expect(metrics.messageCount).toBe(1)
    // Should emit ToolResult event for the nested tool_result block
    expect(emitted.some((e) => e.eventType === 'ToolResult')).toBe(true)
  })

  it('does not increment turn count for isMeta messages', async () => {
    const metrics = createDefaultMetrics()
    const { emitEvent } = createEmitSpy()
    const toolMap = new Map<string, string>()

    const entry: TranscriptEntry = {
      type: 'user',
      isMeta: true,
      message: { role: 'user', content: 'disclaimer' },
    }

    await processEntry(entry, 1, metrics, toolMap, emitEvent)

    expect(metrics.turnCount).toBe(0)
    expect(metrics.messageCount).toBe(1)
  })

  it('emits UserPrompt for local-command-stdout but does not increment turn', async () => {
    const metrics = createDefaultMetrics()
    const { emitEvent, emitted } = createEmitSpy()
    const toolMap = new Map<string, string>()

    const entry: TranscriptEntry = {
      type: 'user',
      message: { role: 'user', content: '<local-command-stdout>output</local-command-stdout>' },
    }

    await processEntry(entry, 1, metrics, toolMap, emitEvent)

    expect(metrics.turnCount).toBe(0)
    expect(emitted.some((e) => e.eventType === 'UserPrompt')).toBe(true)
  })

  it('does not emit UserPrompt for excluded builtin commands', async () => {
    const metrics = createDefaultMetrics()
    const { emitEvent, emitted } = createEmitSpy()
    const toolMap = new Map<string, string>()

    const entry: TranscriptEntry = {
      type: 'user',
      message: { role: 'user', content: '<command-name>/clear</command-name>' },
    }

    await processEntry(entry, 1, metrics, toolMap, emitEvent)

    expect(metrics.turnCount).toBe(0)
    expect(emitted).toHaveLength(0) // no events at all
  })

  it('processes assistant message and extracts token usage', async () => {
    const metrics = createDefaultMetrics()
    const { emitEvent, emitted } = createEmitSpy()
    const toolMap = new Map<string, string>()

    const entry: TranscriptEntry = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: 'Response text',
        model: 'claude-3',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    }

    await processEntry(entry, 1, metrics, toolMap, emitEvent)

    expect(metrics.messageCount).toBe(1)
    expect(metrics.tokenUsage.inputTokens).toBe(100)
    expect(metrics.tokenUsage.outputTokens).toBe(50)
    expect(emitted[0].eventType).toBe('AssistantMessage')
  })

  it('processes assistant message with nested tool_use blocks', async () => {
    const metrics = createDefaultMetrics()
    const { emitEvent, emitted } = createEmitSpy()
    const toolMap = new Map<string, string>()

    const entry: TranscriptEntry = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'tool-1', name: 'Read' },
        ],
      },
    }

    await processEntry(entry, 1, metrics, toolMap, emitEvent)

    expect(metrics.toolCount).toBe(1)
    expect(metrics.toolsThisTurn).toBe(1)
    expect(toolMap.get('tool-1')).toBe('Read')
    expect(emitted.some((e) => e.eventType === 'ToolCall')).toBe(true)
  })

  it('processes compact_boundary system entry', async () => {
    const metrics = createDefaultMetrics()
    metrics.currentContextTokens = 50000
    const { emitEvent, emitted } = createEmitSpy()
    const toolMap = new Map<string, string>()

    const entry: TranscriptEntry = {
      type: 'system',
      subtype: 'compact_boundary',
    }

    await processEntry(entry, 1, metrics, toolMap, emitEvent)

    expect(metrics.currentContextTokens).toBeNull()
    expect(metrics.isPostCompactIndeterminate).toBe(true)
    expect(emitted[0].eventType).toBe('Compact')
  })
})

// ============================================================================
// extractTokenUsage
// ============================================================================

describe('extractTokenUsage', () => {
  it('extracts basic token counts', () => {
    const metrics = createDefaultMetrics()
    const entry: TranscriptEntry = {
      type: 'assistant',
      message: {
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    }

    extractTokenUsage(entry, metrics)

    expect(metrics.tokenUsage.inputTokens).toBe(100)
    expect(metrics.tokenUsage.outputTokens).toBe(50)
    expect(metrics.tokenUsage.totalTokens).toBe(150)
    expect(metrics.currentContextTokens).toBe(100)
  })

  it('accumulates cache tokens into context window', () => {
    const metrics = createDefaultMetrics()
    const entry: TranscriptEntry = {
      type: 'assistant',
      message: {
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 300,
        },
      },
    }

    extractTokenUsage(entry, metrics)

    // currentContextTokens = input + cache_creation + cache_read
    expect(metrics.currentContextTokens).toBe(600)
    expect(metrics.tokenUsage.cacheCreationInputTokens).toBe(200)
    expect(metrics.tokenUsage.cacheReadInputTokens).toBe(300)
  })

  it('tracks per-model breakdown', () => {
    const metrics = createDefaultMetrics()
    const entry: TranscriptEntry = {
      type: 'assistant',
      message: {
        model: 'claude-opus-4',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    }

    extractTokenUsage(entry, metrics)

    const modelStats = metrics.tokenUsage.byModel['claude-opus-4']
    expect(modelStats).toBeDefined()
    expect(modelStats.inputTokens).toBe(100)
    expect(modelStats.outputTokens).toBe(50)
    expect(modelStats.requestCount).toBe(1)
  })

  it('tracks service tier counts', () => {
    const metrics = createDefaultMetrics()
    const entry: TranscriptEntry = {
      type: 'assistant',
      message: {
        usage: { input_tokens: 10, output_tokens: 5, service_tier: 'standard' },
      },
    }

    extractTokenUsage(entry, metrics)

    expect(metrics.tokenUsage.serviceTierCounts['standard']).toBe(1)
  })

  it('clears isPostCompactIndeterminate on usage extraction', () => {
    const metrics = createDefaultMetrics()
    metrics.isPostCompactIndeterminate = true
    const entry: TranscriptEntry = {
      type: 'assistant',
      message: {
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    }

    extractTokenUsage(entry, metrics)

    expect(metrics.isPostCompactIndeterminate).toBe(false)
  })

  it('does nothing when no usage field', () => {
    const metrics = createDefaultMetrics()
    const entry: TranscriptEntry = {
      type: 'assistant',
      message: { content: 'no usage' },
    }

    extractTokenUsage(entry, metrics)

    expect(metrics.tokenUsage.totalTokens).toBe(0)
  })

  it('tracks cache tiers', () => {
    const metrics = createDefaultMetrics()
    const entry: TranscriptEntry = {
      type: 'assistant',
      message: {
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation: {
            ephemeral_5m_input_tokens: 100,
            ephemeral_1h_input_tokens: 200,
          },
        },
      },
    }

    extractTokenUsage(entry, metrics)

    expect(metrics.tokenUsage.cacheTiers.ephemeral5mInputTokens).toBe(100)
    expect(metrics.tokenUsage.cacheTiers.ephemeral1hInputTokens).toBe(200)
  })
})

// ============================================================================
// Message Classification
// ============================================================================

describe('isToolResultOnlyMessage', () => {
  it('returns true for message with only tool_result blocks', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      message: {
        content: [{ type: 'tool_result' }, { type: 'tool_result' }],
      },
    }
    expect(isToolResultOnlyMessage(entry)).toBe(true)
  })

  it('returns false for string content', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      message: { content: 'hello' },
    }
    expect(isToolResultOnlyMessage(entry)).toBe(false)
  })

  it('returns false for mixed content blocks', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      message: {
        content: [{ type: 'text', text: 'hello' }, { type: 'tool_result' }],
      },
    }
    expect(isToolResultOnlyMessage(entry)).toBe(false)
  })

  it('returns false for empty array content', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      message: { content: [] },
    }
    expect(isToolResultOnlyMessage(entry)).toBe(false)
  })

  it('returns false when no message', () => {
    const entry: TranscriptEntry = { type: 'user' }
    expect(isToolResultOnlyMessage(entry)).toBe(false)
  })
})

describe('isLocalCommandStdoutMessage', () => {
  it('returns true for local-command-stdout content', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      message: { content: '<local-command-stdout>output</local-command-stdout>' },
    }
    expect(isLocalCommandStdoutMessage(entry)).toBe(true)
  })

  it('returns false for regular string content', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      message: { content: 'hello' },
    }
    expect(isLocalCommandStdoutMessage(entry)).toBe(false)
  })

  it('returns false for non-string content', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      message: { content: [{ type: 'text', text: 'hello' }] },
    }
    expect(isLocalCommandStdoutMessage(entry)).toBe(false)
  })
})

describe('isExcludedBuiltinCommandInvocation', () => {
  it('returns true for excluded commands', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      message: { content: '<command-name>/clear</command-name>' },
    }
    expect(isExcludedBuiltinCommandInvocation(entry)).toBe(true)
  })

  it('returns false for non-excluded commands', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      message: { content: '<command-name>/rename</command-name>' },
    }
    expect(isExcludedBuiltinCommandInvocation(entry)).toBe(false)
  })

  it('returns false for regular content', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      message: { content: 'just a message' },
    }
    expect(isExcludedBuiltinCommandInvocation(entry)).toBe(false)
  })
})

// ============================================================================
// updateToolsPerTurn
// ============================================================================

describe('updateToolsPerTurn', () => {
  it('computes ratio when turns > 0', () => {
    const metrics = createDefaultMetrics()
    metrics.turnCount = 5
    metrics.toolCount = 15

    updateToolsPerTurn(metrics)

    expect(metrics.toolsPerTurn).toBe(3)
  })

  it('returns 0 when turnCount is 0', () => {
    const metrics = createDefaultMetrics()
    metrics.toolCount = 10

    updateToolsPerTurn(metrics)

    expect(metrics.toolsPerTurn).toBe(0)
  })
})

// ============================================================================
// handleCompactBoundary
// ============================================================================

describe('handleCompactBoundary', () => {
  it('sets indeterminate state and emits Compact event', async () => {
    const metrics = createDefaultMetrics()
    metrics.currentContextTokens = 50000
    const { emitEvent, emitted } = createEmitSpy()

    const entry: TranscriptEntry = {
      type: 'system',
      subtype: 'compact_boundary',
    }

    await handleCompactBoundary(entry, 10, metrics, emitEvent)

    expect(metrics.currentContextTokens).toBeNull()
    expect(metrics.isPostCompactIndeterminate).toBe(true)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].eventType).toBe('Compact')
  })
})

// ============================================================================
// processNestedToolUses
// ============================================================================

describe('processNestedToolUses', () => {
  it('processes tool_use blocks and tracks tool names', async () => {
    const metrics = createDefaultMetrics()
    const toolMap = new Map<string, string>()
    const { emitEvent, emitted } = createEmitSpy()

    const entry: TranscriptEntry = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'tool-1', name: 'Read' },
          { type: 'tool_use', id: 'tool-2', name: 'Write' },
        ],
      },
    }

    await processNestedToolUses(entry, 1, metrics, toolMap, emitEvent)

    expect(metrics.toolCount).toBe(2)
    expect(metrics.toolsThisTurn).toBe(2)
    expect(toolMap.get('tool-1')).toBe('Read')
    expect(toolMap.get('tool-2')).toBe('Write')
    expect(emitted).toHaveLength(2)
    expect(emitted[0].eventType).toBe('ToolCall')
    expect(emitted[1].eventType).toBe('ToolCall')
  })

  it('does nothing for non-array content', async () => {
    const metrics = createDefaultMetrics()
    const toolMap = new Map<string, string>()
    const { emitEvent } = createEmitSpy()

    const entry: TranscriptEntry = {
      type: 'assistant',
      message: { content: 'plain text' },
    }

    await processNestedToolUses(entry, 1, metrics, toolMap, emitEvent)

    expect(metrics.toolCount).toBe(0)
  })
})

// ============================================================================
// processNestedToolResults
// ============================================================================

describe('processNestedToolResults', () => {
  it('processes tool_result blocks and resolves tool names', async () => {
    const toolMap = new Map<string, string>([['tool-1', 'Read']])
    const { emitEvent, emitted } = createEmitSpy()

    const entry: TranscriptEntry = {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' }],
      },
    }

    await processNestedToolResults(entry, 1, toolMap, emitEvent)

    expect(emitted).toHaveLength(1)
    expect(emitted[0].eventType).toBe('ToolResult')
    expect((emitted[0].entry as any).tool_name).toBe('Read')
  })

  it('emits ToolResult without tool_name when tool_use_id is unknown', async () => {
    const toolMap = new Map<string, string>()
    const { emitEvent, emitted } = createEmitSpy()

    const entry: TranscriptEntry = {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'unknown-id' }],
      },
    }

    await processNestedToolResults(entry, 1, toolMap, emitEvent)

    expect(emitted).toHaveLength(1)
    expect((emitted[0].entry as any).tool_name).toBeUndefined()
  })
})
