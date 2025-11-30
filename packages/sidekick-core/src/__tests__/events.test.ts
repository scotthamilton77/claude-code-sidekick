/**
 * Event Model Type Guards Tests
 *
 * Tests for the type guard functions that discriminate between event types.
 * @see docs/design/flow.md §3.2 Event Schema
 */

import { describe, it, expect } from 'vitest'
import {
  isHookEvent,
  isTranscriptEvent,
  isSessionStartEvent,
  isSessionEndEvent,
  isUserPromptSubmitEvent,
  isPreToolUseEvent,
  isPostToolUseEvent,
  isStopEvent,
  isPreCompactEvent,
} from '../index'
import type {
  SidekickEvent,
  HookEvent,
  SessionStartHookEvent,
  TranscriptEvent,
  EventContext,
  TranscriptMetrics,
} from '../index'

/** Create test metrics with defaults */
function createTestMetrics(): TranscriptMetrics {
  return {
    turnCount: 1,
    toolCount: 0,
    toolsThisTurn: 0,
    messageCount: 0,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 100,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheTiers: { ephemeral5mInputTokens: 0, ephemeral1hInputTokens: 0 },
      serviceTierCounts: {},
      byModel: {},
    },
    toolsPerTurn: 0,
    lastProcessedLine: 0,
    lastUpdatedAt: 0,
  }
}

// Test fixtures
const baseContext: EventContext = {
  sessionId: 'test-session-123',
  timestamp: Date.now(),
  scope: 'project',
}

const sessionStartEvent: SessionStartHookEvent = {
  kind: 'hook',
  hook: 'SessionStart',
  context: baseContext,
  payload: {
    startType: 'startup',
    transcriptPath: '/path/to/transcript.jsonl',
  },
}

const transcriptEvent: TranscriptEvent = {
  kind: 'transcript',
  eventType: 'UserPrompt',
  context: baseContext,
  payload: {
    lineNumber: 42,
    entry: { type: 'human', message: 'Hello' },
    content: 'Hello',
  },
  metadata: {
    transcriptPath: '/path/to/transcript.jsonl',
    metrics: createTestMetrics(),
  },
}

describe('Event Type Guards', () => {
  describe('isHookEvent', () => {
    it('returns true for hook events', () => {
      expect(isHookEvent(sessionStartEvent)).toBe(true)
    })

    it('returns false for transcript events', () => {
      expect(isHookEvent(transcriptEvent)).toBe(false)
    })

    it('narrows type correctly', () => {
      const event: SidekickEvent = sessionStartEvent
      if (isHookEvent(event)) {
        // TypeScript should narrow to HookEvent
        expect(event.hook).toBe('SessionStart')
      }
    })
  })

  describe('isTranscriptEvent', () => {
    it('returns true for transcript events', () => {
      expect(isTranscriptEvent(transcriptEvent)).toBe(true)
    })

    it('returns false for hook events', () => {
      expect(isTranscriptEvent(sessionStartEvent)).toBe(false)
    })

    it('narrows type correctly', () => {
      const event: SidekickEvent = transcriptEvent
      if (isTranscriptEvent(event)) {
        // TypeScript should narrow to TranscriptEvent
        expect(event.eventType).toBe('UserPrompt')
        expect(event.metadata.metrics.turnCount).toBe(1)
      }
    })
  })

  describe('Hook-specific type guards', () => {
    const allHookEvents: HookEvent[] = [
      sessionStartEvent,
      {
        kind: 'hook',
        hook: 'SessionEnd',
        context: baseContext,
        payload: { endReason: 'logout' },
      },
      {
        kind: 'hook',
        hook: 'UserPromptSubmit',
        context: baseContext,
        payload: {
          prompt: 'test',
          transcriptPath: '/path',
          cwd: '/cwd',
          permissionMode: 'default',
        },
      },
      {
        kind: 'hook',
        hook: 'PreToolUse',
        context: baseContext,
        payload: { toolName: 'Read', toolInput: { path: '/test' } },
      },
      {
        kind: 'hook',
        hook: 'PostToolUse',
        context: baseContext,
        payload: { toolName: 'Read', toolInput: { path: '/test' }, toolResult: 'content' },
      },
      {
        kind: 'hook',
        hook: 'Stop',
        context: baseContext,
        payload: { transcriptPath: '/path', permissionMode: 'default', stopHookActive: true },
      },
      {
        kind: 'hook',
        hook: 'PreCompact',
        context: baseContext,
        payload: { transcriptPath: '/path', transcriptSnapshotPath: '/snapshot' },
      },
    ]

    it('isSessionStartEvent identifies SessionStart correctly', () => {
      expect(isSessionStartEvent(allHookEvents[0])).toBe(true)
      expect(isSessionStartEvent(allHookEvents[1])).toBe(false)
    })

    it('isSessionEndEvent identifies SessionEnd correctly', () => {
      expect(isSessionEndEvent(allHookEvents[1])).toBe(true)
      expect(isSessionEndEvent(allHookEvents[0])).toBe(false)
    })

    it('isUserPromptSubmitEvent identifies UserPromptSubmit correctly', () => {
      expect(isUserPromptSubmitEvent(allHookEvents[2])).toBe(true)
      expect(isUserPromptSubmitEvent(allHookEvents[0])).toBe(false)
    })

    it('isPreToolUseEvent identifies PreToolUse correctly', () => {
      expect(isPreToolUseEvent(allHookEvents[3])).toBe(true)
      expect(isPreToolUseEvent(allHookEvents[0])).toBe(false)
    })

    it('isPostToolUseEvent identifies PostToolUse correctly', () => {
      expect(isPostToolUseEvent(allHookEvents[4])).toBe(true)
      expect(isPostToolUseEvent(allHookEvents[0])).toBe(false)
    })

    it('isStopEvent identifies Stop correctly', () => {
      expect(isStopEvent(allHookEvents[5])).toBe(true)
      expect(isStopEvent(allHookEvents[0])).toBe(false)
    })

    it('isPreCompactEvent identifies PreCompact correctly', () => {
      expect(isPreCompactEvent(allHookEvents[6])).toBe(true)
      expect(isPreCompactEvent(allHookEvents[0])).toBe(false)
    })

    it('each event matches exactly one hook-specific guard', () => {
      const guards = [
        isSessionStartEvent,
        isSessionEndEvent,
        isUserPromptSubmitEvent,
        isPreToolUseEvent,
        isPostToolUseEvent,
        isStopEvent,
        isPreCompactEvent,
      ]

      for (const event of allHookEvents) {
        const matchCount = guards.filter((guard) => guard(event)).length
        expect(matchCount).toBe(1)
      }
    })
  })
})
