/**
 * State Inspector Tests
 *
 * Tests for state inspector functionality covering:
 * - State reconstruction correctness from event streams
 * - Snapshot selection by scrub position/timestamp
 * - Diff calculation for various state change scenarios
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2 State Inspector
 * @see packages/sidekick-ui/src/lib/replay-engine.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TimeTravelStore,
  buildTimeline,
  computeDiff,
  createInitialState,
  createDefaultMetrics,
  type ReplayState,
} from '../../lib/replay-engine'
import type { ParsedLogRecord, PinoFields } from '../../lib/log-parser'
import type { TranscriptMetrics } from '@sidekick/types'

// ============================================================================
// Test Fixtures & Helpers
// ============================================================================

function createPinoFields(time: number, overrides: Partial<PinoFields> = {}): PinoFields {
  return {
    level: 30,
    time,
    pid: 12345,
    hostname: 'test-host',
    ...overrides,
  }
}

function createRecord(
  time: number,
  type: string,
  payload: Record<string, unknown> = {},
  metadata?: Record<string, unknown>
): ParsedLogRecord {
  return {
    pino: createPinoFields(time),
    source: 'supervisor',
    type,
    context: { session_id: 'test-session' },
    payload,
    metadata,
    raw: { type, payload },
  }
}

function createTestMetrics(overrides: Partial<TranscriptMetrics> = {}): TranscriptMetrics {
  return {
    ...createDefaultMetrics(),
    ...overrides,
    tokenUsage: {
      ...createDefaultMetrics().tokenUsage,
      ...(overrides.tokenUsage ?? {}),
    },
  }
}

// ============================================================================
// State Reconstruction Tests
// ============================================================================

describe('State Inspector - State Reconstruction', () => {
  describe('from single event stream', () => {
    it('reconstructs state from summary updates only', () => {
      const records = [
        createRecord(1000, 'SummaryUpdated', {
          state: { title: 'Initial Session', titleConfidence: 0.8 },
        }),
        createRecord(2000, 'SummaryUpdated', {
          state: { title: 'Updated Session', titleConfidence: 0.9, intent: 'debug auth' },
        }),
      ]

      const store = new TimeTravelStore()
      store.load(records)

      // Verify reconstruction at first update
      const state1 = store.getStateAt(1000)
      expect(state1.summary.title).toBe('Initial Session')
      expect(state1.summary.titleConfidence).toBe(0.8)

      // Verify reconstruction at second update (accumulated)
      const state2 = store.getStateAt(2000)
      expect(state2.summary.title).toBe('Updated Session')
      expect(state2.summary.titleConfidence).toBe(0.9)
      expect(state2.summary.intent).toBe('debug auth')
    })

    it('reconstructs state from metrics updates only', () => {
      const records = [
        createRecord(1000, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: 1 }) }),
        createRecord(2000, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: 2 }) }),
        createRecord(
          3000,
          'TranscriptMetricsUpdated',
          {},
          { metrics: createTestMetrics({ turnCount: 3, toolCount: 5 }) }
        ),
      ]

      const store = new TimeTravelStore()
      store.load(records)

      const state1 = store.getStateAt(1000)
      expect(state1.metrics.turnCount).toBe(1)
      expect(state1.metrics.toolCount).toBe(0)

      const state3 = store.getStateAt(3000)
      expect(state3.metrics.turnCount).toBe(3)
      expect(state3.metrics.toolCount).toBe(5)
    })

    it('reconstructs state from reminder lifecycle', () => {
      const records = [
        createRecord(1000, 'ReminderStaged', {
          hookName: 'UserPromptSubmit',
          reminder: { name: 'StuckReminder', blocking: false, priority: 10, persistent: false },
        }),
        createRecord(2000, 'ReminderStaged', {
          hookName: 'PreToolUse',
          reminder: { name: 'WarningReminder', blocking: true, priority: 5, persistent: true },
        }),
        createRecord(3000, 'ReminderConsumed', {
          hookName: 'UserPromptSubmit',
          reminderName: 'StuckReminder',
        }),
      ]

      const store = new TimeTravelStore()
      store.load(records)

      // After first reminder staged
      const state1 = store.getStateAt(1000)
      expect(state1.stagedReminders.has('UserPromptSubmit')).toBe(true)
      expect(state1.stagedReminders.get('UserPromptSubmit')).toHaveLength(1)

      // After second reminder staged
      const state2 = store.getStateAt(2000)
      expect(state2.stagedReminders.has('UserPromptSubmit')).toBe(true)
      expect(state2.stagedReminders.has('PreToolUse')).toBe(true)

      // After consuming non-persistent reminder
      const state3 = store.getStateAt(3000)
      expect(state3.stagedReminders.has('UserPromptSubmit')).toBe(false)
      expect(state3.stagedReminders.has('PreToolUse')).toBe(true)
    })
  })

  describe('from mixed event streams', () => {
    it('reconstructs state from interleaved summary and metrics updates', () => {
      const records = [
        createRecord(1000, 'SummaryUpdated', { state: { title: 'Session A' } }),
        createRecord(2000, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: 1 }) }),
        createRecord(3000, 'SummaryUpdated', { state: { intent: 'fix bug' } }),
        createRecord(4000, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: 2 }) }),
      ]

      const store = new TimeTravelStore()
      store.load(records)

      const finalState = store.getStateAt(4000)
      expect(finalState.summary.title).toBe('Session A')
      expect(finalState.summary.intent).toBe('fix bug')
      expect(finalState.metrics.turnCount).toBe(2)
    })

    it('reconstructs state from complex event sequence', () => {
      const records = [
        createRecord(1000, 'SessionStart', { startType: 'startup' }),
        createRecord(2000, 'SummaryUpdated', { state: { title: 'New Session' } }),
        createRecord(3000, 'ReminderStaged', {
          hookName: 'UserPromptSubmit',
          reminder: { name: 'R1', blocking: false, priority: 10, persistent: false },
        }),
        createRecord(4000, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: 5 }) }),
        createRecord(5000, 'ReminderConsumed', { hookName: 'UserPromptSubmit', reminderName: 'R1' }),
      ]

      const store = new TimeTravelStore()
      store.load(records)

      // Before SessionStart - initial state
      const state0 = store.getStateAt(500)
      expect(state0.summary).toEqual({})

      // After SessionStart - cleared state
      const state1 = store.getStateAt(1000)
      expect(state1.summary).toEqual({})
      expect(state1.stagedReminders.size).toBe(0)

      // After summary update
      const state2 = store.getStateAt(2000)
      expect(state2.summary.title).toBe('New Session')

      // After reminder staged
      const state3 = store.getStateAt(3000)
      expect(state3.stagedReminders.has('UserPromptSubmit')).toBe(true)

      // Final state
      const finalState = store.getStateAt(5000)
      expect(finalState.summary.title).toBe('New Session')
      expect(finalState.metrics.turnCount).toBe(5)
      expect(finalState.stagedReminders.has('UserPromptSubmit')).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('reconstructs from empty event stream', () => {
      const store = new TimeTravelStore()
      store.load([])

      const state = store.getStateAt(1000)
      expect(state.summary).toEqual({})
      expect(state.metrics.turnCount).toBe(0)
      expect(state.stagedReminders.size).toBe(0)
    })

    it('reconstructs from single event', () => {
      const records = [createRecord(1000, 'SummaryUpdated', { state: { title: 'Solo' } })]

      const store = new TimeTravelStore()
      store.load(records)

      const state = store.getStateAt(1000)
      expect(state.summary.title).toBe('Solo')
    })

    it('reconstructs from many events (stress test)', () => {
      const records: ParsedLogRecord[] = []

      // Generate 1000 metric updates
      for (let i = 0; i < 1000; i++) {
        records.push(
          createRecord(1000 + i * 10, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: i }) })
        )
      }

      const store = new TimeTravelStore()
      store.load(records)

      // Verify reconstruction at various points
      expect(store.getStateAt(1000).metrics.turnCount).toBe(0)
      expect(store.getStateAt(5000).metrics.turnCount).toBe(400)
      expect(store.getStateAt(10990).metrics.turnCount).toBe(999)
    })

    it('handles state reset via SessionStart', () => {
      const records = [
        createRecord(1000, 'SummaryUpdated', { state: { title: 'Old Session' } }),
        createRecord(2000, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: 10 }) }),
        createRecord(3000, 'ReminderStaged', {
          hookName: 'UserPromptSubmit',
          reminder: { name: 'R1', blocking: false, priority: 10, persistent: false },
        }),
        createRecord(4000, 'SessionStart', { startType: 'startup' }),
        createRecord(5000, 'SummaryUpdated', { state: { title: 'New Session' } }),
      ]

      const store = new TimeTravelStore()
      store.load(records)

      // Before reset
      const stateBefore = store.getStateAt(3000)
      expect(stateBefore.summary.title).toBe('Old Session')
      expect(stateBefore.metrics.turnCount).toBe(10)
      expect(stateBefore.stagedReminders.size).toBe(1)

      // After reset - note: summary fields are merged, so title persists from previous state
      // This is the actual behavior of applyDelta (merge semantics)
      const stateAfterReset = store.getStateAt(4000)
      expect(stateAfterReset.summary.title).toBe('Old Session') // Merged, not cleared
      expect(stateAfterReset.metrics.turnCount).toBe(0)
      expect(stateAfterReset.stagedReminders.size).toBe(0)

      // After new session started
      const stateNew = store.getStateAt(5000)
      expect(stateNew.summary.title).toBe('New Session')
    })
  })
})

// ============================================================================
// Snapshot Selection Tests
// ============================================================================

describe('State Inspector - Snapshot Selection', () => {
  let store: TimeTravelStore
  let records: ParsedLogRecord[]

  beforeEach(() => {
    records = [
      createRecord(1000, 'SummaryUpdated', { state: { title: 'State at 1000' } }),
      createRecord(2000, 'SummaryUpdated', { state: { title: 'State at 2000' } }),
      createRecord(3000, 'SummaryUpdated', { state: { title: 'State at 3000' } }),
      createRecord(4000, 'SummaryUpdated', { state: { title: 'State at 4000' } }),
      createRecord(5000, 'SummaryUpdated', { state: { title: 'State at 5000' } }),
    ]

    store = new TimeTravelStore()
    store.load(records)
  })

  describe('by exact timestamp', () => {
    it('selects snapshot at exact event timestamp', () => {
      const state = store.getStateAt(3000)
      expect(state.summary.title).toBe('State at 3000')
    })

    it('selects first snapshot at its exact timestamp', () => {
      const state = store.getStateAt(1000)
      expect(state.summary.title).toBe('State at 1000')
    })

    it('selects last snapshot at its exact timestamp', () => {
      const state = store.getStateAt(5000)
      expect(state.summary.title).toBe('State at 5000')
    })
  })

  describe('by timestamp between events', () => {
    it('selects most recent snapshot before timestamp', () => {
      const state = store.getStateAt(2500)
      expect(state.summary.title).toBe('State at 2000')
    })

    it('selects snapshot just before target timestamp', () => {
      const state = store.getStateAt(2999)
      expect(state.summary.title).toBe('State at 2000')
    })

    it('selects snapshot just after crossing boundary', () => {
      const state = store.getStateAt(3001)
      expect(state.summary.title).toBe('State at 3000')
    })
  })

  describe('by timestamp outside range', () => {
    it('returns initial state for timestamp before first event', () => {
      const state = store.getStateAt(500)
      expect(state.summary).toEqual({})
    })

    it('returns final state for timestamp after last event', () => {
      const state = store.getStateAt(10000)
      expect(state.summary.title).toBe('State at 5000')
    })

    it('returns initial state for timestamp at zero', () => {
      const state = store.getStateAt(0)
      expect(state.summary).toEqual({})
    })

    it('returns final state for timestamp at max safe integer', () => {
      const state = store.getStateAt(Number.MAX_SAFE_INTEGER)
      expect(state.summary.title).toBe('State at 5000')
    })
  })

  describe('scrub position accuracy', () => {
    it('maintains state continuity when scrubbing forward', () => {
      const positions = [1000, 1500, 2000, 2500, 3000, 3500, 4000]
      const states = positions.map((pos) => store.getStateAt(pos))

      expect(states[0].summary.title).toBe('State at 1000')
      expect(states[1].summary.title).toBe('State at 1000')
      expect(states[2].summary.title).toBe('State at 2000')
      expect(states[3].summary.title).toBe('State at 2000')
      expect(states[4].summary.title).toBe('State at 3000')
      expect(states[5].summary.title).toBe('State at 3000')
      expect(states[6].summary.title).toBe('State at 4000')
    })

    it('maintains state continuity when scrubbing backward', () => {
      const positions = [5000, 4500, 4000, 3500, 3000, 2500, 2000]
      const states = positions.map((pos) => store.getStateAt(pos))

      expect(states[0].summary.title).toBe('State at 5000')
      expect(states[1].summary.title).toBe('State at 4000')
      expect(states[2].summary.title).toBe('State at 4000')
      expect(states[3].summary.title).toBe('State at 3000')
      expect(states[4].summary.title).toBe('State at 3000')
      expect(states[5].summary.title).toBe('State at 2000')
      expect(states[6].summary.title).toBe('State at 2000')
    })

    it('handles random scrub positions correctly', () => {
      const randomPositions = [3721, 1234, 4567, 2890, 500, 10000, 2500]
      const states = randomPositions.map((pos) => store.getStateAt(pos))

      expect(states[0].summary.title).toBe('State at 3000')
      expect(states[1].summary.title).toBe('State at 1000')
      expect(states[2].summary.title).toBe('State at 4000')
      expect(states[3].summary.title).toBe('State at 2000')
      expect(states[4].summary).toEqual({})
      expect(states[5].summary.title).toBe('State at 5000')
      expect(states[6].summary.title).toBe('State at 2000')
    })
  })

  describe('with metrics in snapshots', () => {
    beforeEach(() => {
      const metricsRecords = [
        createRecord(1000, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: 1 }) }),
        createRecord(2000, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: 5 }) }),
        createRecord(3000, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: 10 }) }),
      ]

      store = new TimeTravelStore()
      store.load(metricsRecords)
    })

    it('selects correct metrics snapshot by timestamp', () => {
      expect(store.getStateAt(1500).metrics.turnCount).toBe(1)
      expect(store.getStateAt(2500).metrics.turnCount).toBe(5)
      expect(store.getStateAt(3500).metrics.turnCount).toBe(10)
    })

    it('tracks metrics evolution accurately', () => {
      const evolution = [1000, 2000, 3000].map((t) => store.getStateAt(t).metrics.turnCount)
      expect(evolution).toEqual([1, 5, 10])
    })
  })
})

// ============================================================================
// Diff Calculation Tests
// ============================================================================

describe('State Inspector - Diff Calculation', () => {
  describe('primitive field changes', () => {
    it('detects additions', () => {
      const oldState: ReplayState = {
        ...createInitialState(),
        summary: {},
      }
      const newState: ReplayState = {
        ...createInitialState(),
        summary: { title: 'New Title', titleConfidence: 0.9 },
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.hasChanges).toBe(true)
      expect(diff.changes).toContainEqual({
        path: 'summary.title',
        type: 'added',
        newValue: 'New Title',
      })
      expect(diff.changes).toContainEqual({
        path: 'summary.titleConfidence',
        type: 'added',
        newValue: 0.9,
      })
    })

    it('detects deletions', () => {
      const oldState: ReplayState = {
        ...createInitialState(),
        summary: { title: 'Old Title', intent: 'old intent' },
      }
      const newState: ReplayState = {
        ...createInitialState(),
        summary: { title: 'Old Title' },
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.hasChanges).toBe(true)
      expect(diff.changes).toContainEqual({
        path: 'summary.intent',
        type: 'removed',
        oldValue: 'old intent',
      })
    })

    it('detects modifications', () => {
      const oldState: ReplayState = {
        ...createInitialState(),
        summary: { title: 'Old Title', titleConfidence: 0.5 },
      }
      const newState: ReplayState = {
        ...createInitialState(),
        summary: { title: 'New Title', titleConfidence: 0.9 },
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.hasChanges).toBe(true)
      expect(diff.changes).toContainEqual({
        path: 'summary.title',
        type: 'modified',
        oldValue: 'Old Title',
        newValue: 'New Title',
      })
      expect(diff.changes).toContainEqual({
        path: 'summary.titleConfidence',
        type: 'modified',
        oldValue: 0.5,
        newValue: 0.9,
      })
    })
  })

  describe('nested object changes', () => {
    it('detects changes in nested metrics', () => {
      const oldState: ReplayState = {
        ...createInitialState(),
        metrics: createTestMetrics({ turnCount: 1, toolCount: 5 }),
      }
      const newState: ReplayState = {
        ...createInitialState(),
        metrics: createTestMetrics({ turnCount: 2, toolCount: 10 }),
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.hasChanges).toBe(true)
      expect(diff.changes).toContainEqual({
        path: 'metrics.turnCount',
        type: 'modified',
        oldValue: 1,
        newValue: 2,
      })
      expect(diff.changes).toContainEqual({
        path: 'metrics.toolCount',
        type: 'modified',
        oldValue: 5,
        newValue: 10,
      })
    })

    it('detects changes in deeply nested token usage', () => {
      const oldState: ReplayState = {
        ...createInitialState(),
        metrics: createTestMetrics({
          tokenUsage: {
            ...createDefaultMetrics().tokenUsage,
            inputTokens: 1000,
            outputTokens: 500,
          },
        }),
      }
      const newState: ReplayState = {
        ...createInitialState(),
        metrics: createTestMetrics({
          tokenUsage: {
            ...createDefaultMetrics().tokenUsage,
            inputTokens: 2000,
            outputTokens: 1000,
          },
        }),
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.hasChanges).toBe(true)
      expect(diff.changes.some((c) => c.path === 'metrics.tokenUsage.inputTokens' && c.type === 'modified')).toBe(true)
      expect(diff.changes.some((c) => c.path === 'metrics.tokenUsage.outputTokens' && c.type === 'modified')).toBe(true)
    })

    it('detects addition of nested fields', () => {
      const oldState: ReplayState = {
        ...createInitialState(),
        metrics: createTestMetrics({
          tokenUsage: {
            ...createDefaultMetrics().tokenUsage,
            inputTokens: 1000,
          },
        }),
      }
      const newState: ReplayState = {
        ...createInitialState(),
        metrics: createTestMetrics({
          tokenUsage: {
            ...createDefaultMetrics().tokenUsage,
            inputTokens: 1000,
            cacheCreationInputTokens: 500,
          },
        }),
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.hasChanges).toBe(true)
      expect(
        diff.changes.some((c) => c.path === 'metrics.tokenUsage.cacheCreationInputTokens' && c.type === 'modified')
      ).toBe(true)
    })
  })

  describe('complex state changes', () => {
    it('detects multiple simultaneous changes across domains', () => {
      const oldState: ReplayState = {
        summary: { title: 'Old' },
        metrics: createTestMetrics({ turnCount: 1 }),
        stagedReminders: new Map(),
        supervisorHealth: undefined,
      }
      const newState: ReplayState = {
        summary: { title: 'New', intent: 'debug' },
        metrics: createTestMetrics({ turnCount: 2, toolCount: 5 }),
        stagedReminders: new Map([
          ['hook1', [{ name: 'r1', blocking: false, priority: 10, persistent: false, stagedAt: 1000 }]],
        ]),
        supervisorHealth: { online: true, lastSeen: 5000 },
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.hasChanges).toBe(true)
      expect(diff.changes.some((c) => c.path === 'summary.title')).toBe(true)
      expect(diff.changes.some((c) => c.path === 'summary.intent')).toBe(true)
      expect(diff.changes.some((c) => c.path === 'metrics.turnCount')).toBe(true)
      expect(diff.changes.some((c) => c.path === 'metrics.toolCount')).toBe(true)
      expect(diff.changes.some((c) => c.path.startsWith('stagedReminders'))).toBe(true)
      expect(diff.changes.some((c) => c.path.startsWith('supervisorHealth'))).toBe(true)
    })

    it('handles no changes correctly', () => {
      const state1 = createInitialState()
      const state2 = createInitialState()

      const diff = computeDiff(state1, state2)

      expect(diff.hasChanges).toBe(false)
      expect(diff.changes).toHaveLength(0)
      expect(diff.summary).toBe('No changes')
    })
  })

  describe('diff summary generation', () => {
    it('generates summary with counts for additions', () => {
      const oldState = createInitialState()
      const newState: ReplayState = {
        ...createInitialState(),
        summary: { title: 'New', intent: 'debug', titleConfidence: 0.9 },
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.summary).toContain('+3')
    })

    it('generates summary with counts for deletions', () => {
      const oldState: ReplayState = {
        ...createInitialState(),
        summary: { title: 'Old', intent: 'debug' },
      }
      const newState: ReplayState = {
        ...createInitialState(),
        summary: {},
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.summary).toContain('-2')
    })

    it('generates summary with counts for modifications', () => {
      const oldState: ReplayState = {
        ...createInitialState(),
        summary: { title: 'Old', intent: 'old intent' },
      }
      const newState: ReplayState = {
        ...createInitialState(),
        summary: { title: 'New', intent: 'new intent' },
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.summary).toContain('~2')
    })

    it('generates combined summary for mixed changes', () => {
      const oldState: ReplayState = {
        ...createInitialState(),
        summary: { title: 'Old', intent: 'to remove' },
      }
      const newState: ReplayState = {
        ...createInitialState(),
        summary: { title: 'New', titleConfidence: 0.9 },
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.summary).toMatch(/\+1.*-1.*~1/)
    })
  })

  describe('edge cases in diff calculation', () => {
    it('handles empty to populated state', () => {
      const oldState = createInitialState()
      const newState: ReplayState = {
        summary: { title: 'Session', titleConfidence: 0.9, intent: 'debug' },
        metrics: createTestMetrics({ turnCount: 5, toolCount: 15 }),
        stagedReminders: new Map([
          ['hook1', [{ name: 'r1', blocking: false, priority: 10, persistent: false, stagedAt: 1000 }]],
        ]),
        supervisorHealth: { online: true, lastSeen: 1000 },
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.hasChanges).toBe(true)
      expect(diff.changes.length).toBeGreaterThan(0)
    })

    it('handles populated to empty state', () => {
      const oldState: ReplayState = {
        summary: { title: 'Session' },
        metrics: createTestMetrics({ turnCount: 5 }),
        stagedReminders: new Map([
          ['hook1', [{ name: 'r1', blocking: false, priority: 10, persistent: false, stagedAt: 1000 }]],
        ]),
        supervisorHealth: { online: true, lastSeen: 1000 },
      }
      const newState = createInitialState()

      const diff = computeDiff(oldState, newState)

      expect(diff.hasChanges).toBe(true)
      expect(diff.changes.some((c) => c.type === 'removed')).toBe(true)
    })

    it('handles identical states', () => {
      const state: ReplayState = {
        summary: { title: 'Same', titleConfidence: 0.9 },
        metrics: createTestMetrics({ turnCount: 5 }),
        stagedReminders: new Map(),
        supervisorHealth: undefined,
      }

      const diff = computeDiff(state, state)

      expect(diff.hasChanges).toBe(false)
      expect(diff.changes).toHaveLength(0)
    })

    it('detects changes in array fields', () => {
      const oldState: ReplayState = {
        ...createInitialState(),
        summary: { topics: ['topic1', 'topic2'] },
      }
      const newState: ReplayState = {
        ...createInitialState(),
        summary: { topics: ['topic1', 'topic2', 'topic3'] },
      }

      const diff = computeDiff(oldState, newState)

      expect(diff.hasChanges).toBe(true)
      expect(diff.changes.some((c) => c.path === 'summary.topics')).toBe(true)
    })
  })
})

// ============================================================================
// Integration Tests - State Inspector Workflow
// ============================================================================

describe('State Inspector - Integration Workflow', () => {
  it('correctly displays state evolution through timeline', () => {
    // Simulate a realistic session
    const records = [
      createRecord(1000, 'SessionStart', { startType: 'startup' }),
      createRecord(2000, 'SummaryUpdated', { state: { title: 'Initial Session' } }),
      createRecord(3000, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: 1 }) }),
      createRecord(4000, 'ReminderStaged', {
        hookName: 'UserPromptSubmit',
        reminder: { name: 'DefaultReminder', blocking: false, priority: 10, persistent: true },
      }),
      createRecord(5000, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: 3 }) }),
      createRecord(6000, 'SummaryUpdated', { state: { title: 'Updated Session', intent: 'debugging' } }),
    ]

    const store = new TimeTravelStore()
    store.load(records)

    // Scrub through timeline and verify state at key points
    const checkpoints = [
      { time: 1500, expectedTitle: undefined, expectedTurns: 0, expectedReminders: 0 },
      { time: 2500, expectedTitle: 'Initial Session', expectedTurns: 0, expectedReminders: 0 },
      { time: 3500, expectedTitle: 'Initial Session', expectedTurns: 1, expectedReminders: 0 },
      { time: 4500, expectedTitle: 'Initial Session', expectedTurns: 1, expectedReminders: 1 },
      { time: 5500, expectedTitle: 'Initial Session', expectedTurns: 3, expectedReminders: 1 },
      { time: 6500, expectedTitle: 'Updated Session', expectedTurns: 3, expectedReminders: 1 },
    ]

    checkpoints.forEach(({ time, expectedTitle, expectedTurns, expectedReminders }) => {
      const state = store.getStateAt(time)
      expect(state.summary.title).toBe(expectedTitle)
      expect(state.metrics.turnCount).toBe(expectedTurns)
      expect(state.stagedReminders.size).toBe(expectedReminders)
    })
  })

  it('provides accurate diffs between consecutive states', () => {
    const records = [
      createRecord(1000, 'SummaryUpdated', { state: { title: 'State 1' } }),
      createRecord(2000, 'SummaryUpdated', { state: { title: 'State 2', intent: 'added' } }),
      createRecord(3000, 'TranscriptMetricsUpdated', {}, { metrics: createTestMetrics({ turnCount: 5 }) }),
    ]

    const timeline = buildTimeline(records)

    // Diff between first and second state
    const diff1to2 = computeDiff(timeline[0].stateAfter, timeline[1].stateAfter)
    expect(diff1to2.changes).toContainEqual({
      path: 'summary.title',
      type: 'modified',
      oldValue: 'State 1',
      newValue: 'State 2',
    })
    expect(diff1to2.changes).toContainEqual({
      path: 'summary.intent',
      type: 'added',
      newValue: 'added',
    })

    // Diff between second and third state
    const diff2to3 = computeDiff(timeline[1].stateAfter, timeline[2].stateAfter)
    expect(diff2to3.changes.some((c) => c.path === 'metrics.turnCount' && c.type === 'modified')).toBe(true)
  })

  it('handles rapid state changes correctly', () => {
    // Simulate rapid updates within 100ms
    const records = [
      createRecord(1000, 'SummaryUpdated', { state: { title: 'Rapid 1' } }),
      createRecord(1050, 'SummaryUpdated', { state: { title: 'Rapid 2' } }),
      createRecord(1075, 'SummaryUpdated', { state: { title: 'Rapid 3' } }),
      createRecord(1100, 'SummaryUpdated', { state: { title: 'Final' } }),
    ]

    const store = new TimeTravelStore()
    store.load(records)

    expect(store.getStateAt(1025).summary.title).toBe('Rapid 1')
    expect(store.getStateAt(1060).summary.title).toBe('Rapid 2')
    expect(store.getStateAt(1080).summary.title).toBe('Rapid 3')
    expect(store.getStateAt(1150).summary.title).toBe('Final')
  })
})
