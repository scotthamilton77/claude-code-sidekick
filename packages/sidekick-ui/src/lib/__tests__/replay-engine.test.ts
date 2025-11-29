/**
 * Replay Engine Tests
 *
 * Tests for state reconstruction, time travel, and diff calculation.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2 Time Travel
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createInitialState,
  cloneState,
  isStateChangingEvent,
  extractStateDelta,
  applyDelta,
  buildTimeline,
  TimeTravelStore,
  computeDiff,
  computeEntryDiff,
  type ReplayState,
  type StagedReminder,
} from '../replay-engine'
import type { ParsedLogRecord, PinoFields } from '../log-parser'

// ============================================================================
// Test Fixtures
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

/** SummaryUpdated event */
const summaryUpdatedRecord = createRecord(1000, 'SummaryUpdated', {
  state: { title: 'Test Session', titleConfidence: 0.9 },
  reason: 'cadence_met',
})

/** ReminderStaged event */
const reminderStagedRecord = createRecord(2000, 'ReminderStaged', {
  hookName: 'UserPromptSubmit',
  reminder: {
    name: 'DefaultReminder',
    blocking: false,
    priority: 10,
    persistent: true,
  },
})

/** ReminderConsumed event */
const reminderConsumedRecord = createRecord(3000, 'ReminderConsumed', {
  hookName: 'UserPromptSubmit',
  reminderName: 'DefaultReminder',
})

/** RemindersCleared event */
const remindersClearedRecord = createRecord(4000, 'RemindersCleared', {
  hookName: 'UserPromptSubmit',
})

/** TranscriptMetricsUpdated event */
const metricsUpdatedRecord = createRecord(
  5000,
  'TranscriptMetricsUpdated',
  {},
  {
    metrics: {
      turnCount: 5,
      toolCount: 12,
      toolsThisTurn: 3,
      totalTokens: 5000,
    },
  }
)

/** SessionStart event (clears state) */
const sessionStartRecord = createRecord(6000, 'SessionStart', {
  startType: 'startup',
})

/** Non-state-changing event (should be skipped) */
const hookReceivedRecord = createRecord(500, 'HookReceived', {
  hook: 'UserPromptSubmit',
})

// ============================================================================
// createInitialState Tests
// ============================================================================

describe('createInitialState', () => {
  it('creates empty initial state', () => {
    const state = createInitialState()

    expect(state.summary).toEqual({})
    expect(state.metrics).toEqual({
      turnCount: 0,
      toolCount: 0,
      toolsThisTurn: 0,
      totalTokens: 0,
    })
    expect(state.stagedReminders.size).toBe(0)
    expect(state.supervisorHealth).toBeUndefined()
  })

  it('creates independent state objects', () => {
    const state1 = createInitialState()
    const state2 = createInitialState()

    state1.summary.title = 'Modified'
    state1.stagedReminders.set('test', [])

    expect(state2.summary.title).toBeUndefined()
    expect(state2.stagedReminders.size).toBe(0)
  })
})

// ============================================================================
// cloneState Tests
// ============================================================================

describe('cloneState', () => {
  it('creates deep copy of state', () => {
    const original: ReplayState = {
      summary: { title: 'Original' },
      metrics: { turnCount: 5, toolCount: 10, toolsThisTurn: 2, totalTokens: 1000 },
      stagedReminders: new Map([
        ['hook1', [{ name: 'r1', blocking: false, priority: 10, persistent: true, stagedAt: 1000 }]],
      ]),
      supervisorHealth: { online: true, lastSeen: 1000 },
    }

    const cloned = cloneState(original)

    // Verify equality
    expect(cloned.summary.title).toBe('Original')
    expect(cloned.metrics.turnCount).toBe(5)
    expect(cloned.stagedReminders.get('hook1')).toHaveLength(1)
    expect(cloned.supervisorHealth?.online).toBe(true)

    // Verify independence
    cloned.summary.title = 'Modified'
    cloned.metrics.turnCount = 99
    cloned.stagedReminders.get('hook1')![0].name = 'modified'

    expect(original.summary.title).toBe('Original')
    expect(original.metrics.turnCount).toBe(5)
    expect(original.stagedReminders.get('hook1')![0].name).toBe('r1')
  })

  it('handles undefined supervisorHealth', () => {
    const original = createInitialState()
    const cloned = cloneState(original)

    expect(cloned.supervisorHealth).toBeUndefined()
  })
})

// ============================================================================
// isStateChangingEvent Tests
// ============================================================================

describe('isStateChangingEvent', () => {
  it('identifies SummaryUpdated as state-changing', () => {
    expect(isStateChangingEvent(summaryUpdatedRecord)).toBe(true)
  })

  it('identifies ReminderStaged as state-changing', () => {
    expect(isStateChangingEvent(reminderStagedRecord)).toBe(true)
  })

  it('identifies ReminderConsumed as state-changing', () => {
    expect(isStateChangingEvent(reminderConsumedRecord)).toBe(true)
  })

  it('identifies RemindersCleared as state-changing', () => {
    expect(isStateChangingEvent(remindersClearedRecord)).toBe(true)
  })

  it('identifies TranscriptMetricsUpdated as state-changing', () => {
    expect(isStateChangingEvent(metricsUpdatedRecord)).toBe(true)
  })

  it('identifies SessionStart as state-changing', () => {
    expect(isStateChangingEvent(sessionStartRecord)).toBe(true)
  })

  it('rejects HookReceived as non-state-changing', () => {
    expect(isStateChangingEvent(hookReceivedRecord)).toBe(false)
  })

  it('identifies embedded transcript events as state-changing', () => {
    const record: ParsedLogRecord = {
      pino: createPinoFields(1000),
      source: 'supervisor',
      raw: {},
      event: {
        kind: 'transcript',
        eventType: 'ToolCall',
        context: { sessionId: 'test', timestamp: 1000 },
        payload: { lineNumber: 1, entry: {} },
        metadata: {
          transcriptPath: '/path',
          metrics: { turnCount: 1, toolCount: 1, toolsThisTurn: 1, totalTokens: 100 },
        },
      },
    }

    expect(isStateChangingEvent(record)).toBe(true)
  })
})

// ============================================================================
// extractStateDelta Tests
// ============================================================================

describe('extractStateDelta', () => {
  it('extracts summary changes from SummaryUpdated', () => {
    const currentState = createInitialState()
    const delta = extractStateDelta(summaryUpdatedRecord, currentState)

    expect(delta.summary).toEqual({ title: 'Test Session', titleConfidence: 0.9 })
    expect(delta.metrics).toBeUndefined()
    expect(delta.stagedReminders).toBeUndefined()
  })

  it('extracts reminder from ReminderStaged', () => {
    const currentState = createInitialState()
    const delta = extractStateDelta(reminderStagedRecord, currentState)

    expect(delta.stagedReminders).toBeDefined()
    const reminders = delta.stagedReminders!.get('UserPromptSubmit')
    expect(reminders).toHaveLength(1)
    expect(reminders![0].name).toBe('DefaultReminder')
    expect(reminders![0].stagedAt).toBe(2000) // timestamp from record
  })

  it('removes non-persistent reminder on ReminderConsumed', () => {
    const currentState: ReplayState = {
      ...createInitialState(),
      stagedReminders: new Map([
        [
          'UserPromptSubmit',
          [{ name: 'DefaultReminder', blocking: false, priority: 10, persistent: false, stagedAt: 1000 }],
        ],
      ]),
    }

    const delta = extractStateDelta(reminderConsumedRecord, currentState)

    expect(delta.stagedReminders).toBeDefined()
    expect(delta.stagedReminders!.has('UserPromptSubmit')).toBe(false) // Removed entirely
  })

  it('keeps persistent reminder on ReminderConsumed', () => {
    const currentState: ReplayState = {
      ...createInitialState(),
      stagedReminders: new Map([
        [
          'UserPromptSubmit',
          [{ name: 'DefaultReminder', blocking: false, priority: 10, persistent: true, stagedAt: 1000 }],
        ],
      ]),
    }

    const delta = extractStateDelta(reminderConsumedRecord, currentState)

    expect(delta.stagedReminders).toBeDefined()
    const reminders = delta.stagedReminders!.get('UserPromptSubmit')
    expect(reminders).toHaveLength(1)
    expect(reminders![0].persistent).toBe(true)
  })

  it('clears specific hook reminders on RemindersCleared', () => {
    const currentState: ReplayState = {
      ...createInitialState(),
      stagedReminders: new Map([
        ['UserPromptSubmit', [{ name: 'r1', blocking: false, priority: 10, persistent: false, stagedAt: 1000 }]],
        ['PreToolUse', [{ name: 'r2', blocking: false, priority: 10, persistent: false, stagedAt: 1000 }]],
      ]),
    }

    const delta = extractStateDelta(remindersClearedRecord, currentState)

    expect(delta.stagedReminders!.has('UserPromptSubmit')).toBe(false)
    expect(delta.stagedReminders!.has('PreToolUse')).toBe(true) // Kept
  })

  it('extracts metrics from TranscriptMetricsUpdated', () => {
    const currentState = createInitialState()
    const delta = extractStateDelta(metricsUpdatedRecord, currentState)

    expect(delta.metrics).toEqual({
      turnCount: 5,
      toolCount: 12,
      toolsThisTurn: 3,
      totalTokens: 5000,
    })
  })

  it('resets state on SessionStart with startup type', () => {
    const currentState: ReplayState = {
      summary: { title: 'Old Session' },
      metrics: { turnCount: 10, toolCount: 50, toolsThisTurn: 5, totalTokens: 10000 },
      stagedReminders: new Map([['hook1', []]]),
      supervisorHealth: undefined,
    }

    const delta = extractStateDelta(sessionStartRecord, currentState)

    expect(delta.summary).toEqual({})
    expect(delta.metrics).toEqual({
      turnCount: 0,
      toolCount: 0,
      toolsThisTurn: 0,
      totalTokens: 0,
    })
    expect(delta.stagedReminders?.size).toBe(0)
  })

  it('extracts metrics from embedded transcript event', () => {
    const record: ParsedLogRecord = {
      pino: createPinoFields(1000),
      source: 'supervisor',
      raw: {},
      event: {
        kind: 'transcript',
        eventType: 'ToolCall',
        context: { sessionId: 'test', timestamp: 1000 },
        payload: { lineNumber: 1, entry: {} },
        metadata: {
          transcriptPath: '/path',
          metrics: { turnCount: 3, toolCount: 7, toolsThisTurn: 2, totalTokens: 2500 },
        },
      },
    }

    const delta = extractStateDelta(record, createInitialState())

    expect(delta.metrics).toEqual({
      turnCount: 3,
      toolCount: 7,
      toolsThisTurn: 2,
      totalTokens: 2500,
    })
  })
})

// ============================================================================
// applyDelta Tests
// ============================================================================

describe('applyDelta', () => {
  it('applies summary delta', () => {
    const current = createInitialState()
    const delta = { summary: { title: 'New Title' } }

    const result = applyDelta(current, delta)

    expect(result.summary.title).toBe('New Title')
    expect(result.metrics).toEqual(current.metrics)
  })

  it('merges summary fields', () => {
    const current: ReplayState = {
      ...createInitialState(),
      summary: { title: 'Original', intent: 'original intent' },
    }
    const delta = { summary: { title: 'Updated' } }

    const result = applyDelta(current, delta)

    expect(result.summary.title).toBe('Updated')
    expect(result.summary.intent).toBe('original intent')
  })

  it('replaces metrics entirely', () => {
    const current = createInitialState()
    const delta = {
      metrics: { turnCount: 5, toolCount: 10, toolsThisTurn: 2, totalTokens: 1000 },
    }

    const result = applyDelta(current, delta)

    expect(result.metrics).toEqual(delta.metrics)
  })

  it('replaces stagedReminders map', () => {
    const current = createInitialState()
    const newReminders = new Map([['hook1', []]] as [string, StagedReminder[]][])
    const delta = { stagedReminders: newReminders }

    const result = applyDelta(current, delta)

    expect(result.stagedReminders).toBe(newReminders)
  })

  it('preserves original state (immutable)', () => {
    const current = createInitialState()
    const delta = { summary: { title: 'New' } }

    applyDelta(current, delta)

    expect(current.summary.title).toBeUndefined()
  })
})

// ============================================================================
// buildTimeline Tests
// ============================================================================

describe('buildTimeline', () => {
  it('builds timeline from event sequence', () => {
    const records = [summaryUpdatedRecord, reminderStagedRecord, metricsUpdatedRecord]

    const timeline = buildTimeline(records)

    expect(timeline).toHaveLength(3)
    expect(timeline[0].timestamp).toBe(1000)
    expect(timeline[1].timestamp).toBe(2000)
    expect(timeline[2].timestamp).toBe(5000)
  })

  it('skips non-state-changing events', () => {
    const records = [hookReceivedRecord, summaryUpdatedRecord]

    const timeline = buildTimeline(records)

    expect(timeline).toHaveLength(1)
    expect(timeline[0].record.type).toBe('SummaryUpdated')
  })

  it('accumulates state across entries', () => {
    const records = [summaryUpdatedRecord, metricsUpdatedRecord]

    const timeline = buildTimeline(records)

    // First entry has summary
    expect(timeline[0].stateAfter.summary.title).toBe('Test Session')
    expect(timeline[0].stateAfter.metrics.turnCount).toBe(0)

    // Second entry has both summary and metrics
    expect(timeline[1].stateAfter.summary.title).toBe('Test Session')
    expect(timeline[1].stateAfter.metrics.turnCount).toBe(5)
  })

  it('records delta for each entry', () => {
    const records = [summaryUpdatedRecord, metricsUpdatedRecord]

    const timeline = buildTimeline(records)

    expect(timeline[0].delta.summary).toBeDefined()
    expect(timeline[0].delta.metrics).toBeUndefined()

    expect(timeline[1].delta.metrics).toBeDefined()
    expect(timeline[1].delta.summary).toBeUndefined()
  })

  it('respects custom initial state', () => {
    const initialState: ReplayState = {
      summary: { title: 'Initial' },
      metrics: { turnCount: 10, toolCount: 50, toolsThisTurn: 0, totalTokens: 5000 },
      stagedReminders: new Map(),
      supervisorHealth: undefined,
    }

    const timeline = buildTimeline([metricsUpdatedRecord], initialState)

    // Should still have original title
    expect(timeline[0].stateAfter.summary.title).toBe('Initial')
    // But updated metrics
    expect(timeline[0].stateAfter.metrics.turnCount).toBe(5)
  })

  it('handles empty record array', () => {
    const timeline = buildTimeline([])

    expect(timeline).toHaveLength(0)
  })
})

// ============================================================================
// TimeTravelStore Tests
// ============================================================================

describe('TimeTravelStore', () => {
  let store: TimeTravelStore

  beforeEach(() => {
    store = new TimeTravelStore()
  })

  describe('load', () => {
    it('loads records into timeline', () => {
      store.load([summaryUpdatedRecord, metricsUpdatedRecord])

      expect(store.length).toBe(2)
    })

    it('replaces existing timeline', () => {
      store.load([summaryUpdatedRecord])
      store.load([metricsUpdatedRecord])

      expect(store.length).toBe(1)
      expect(store.getTimeline()[0].record.type).toBe('TranscriptMetricsUpdated')
    })
  })

  describe('append', () => {
    it('appends new records to timeline', () => {
      store.load([summaryUpdatedRecord])
      store.append([metricsUpdatedRecord])

      expect(store.length).toBe(2)
    })

    it('maintains accumulated state when appending', () => {
      store.load([summaryUpdatedRecord])
      store.append([metricsUpdatedRecord])

      const finalState = store.getStateAt(Number.MAX_SAFE_INTEGER)

      expect(finalState.summary.title).toBe('Test Session')
      expect(finalState.metrics.turnCount).toBe(5)
    })
  })

  describe('getStateAt', () => {
    beforeEach(() => {
      store.load([summaryUpdatedRecord, reminderStagedRecord, metricsUpdatedRecord])
    })

    it('returns initial state before first event', () => {
      const state = store.getStateAt(500)

      expect(state.summary).toEqual({})
      expect(state.metrics.turnCount).toBe(0)
    })

    it('returns state after exact timestamp match', () => {
      const state = store.getStateAt(1000)

      expect(state.summary.title).toBe('Test Session')
      expect(state.stagedReminders.size).toBe(0) // Not yet staged
    })

    it('returns state at timestamp between events', () => {
      const state = store.getStateAt(1500)

      expect(state.summary.title).toBe('Test Session')
      expect(state.stagedReminders.size).toBe(0) // Staged at 2000
    })

    it('returns state after timestamp with all events applied', () => {
      const state = store.getStateAt(2500)

      expect(state.summary.title).toBe('Test Session')
      expect(state.stagedReminders.has('UserPromptSubmit')).toBe(true)
      expect(state.metrics.turnCount).toBe(0) // Updated at 5000
    })

    it('returns final state for timestamp after all events', () => {
      const state = store.getStateAt(Number.MAX_SAFE_INTEGER)

      expect(state.summary.title).toBe('Test Session')
      expect(state.stagedReminders.has('UserPromptSubmit')).toBe(true)
      expect(state.metrics.turnCount).toBe(5)
    })

    it('returns cloned state (immutable)', () => {
      const state1 = store.getStateAt(5000)
      state1.summary.title = 'Modified'

      const state2 = store.getStateAt(5000)

      expect(state2.summary.title).toBe('Test Session')
    })
  })

  describe('getIndexAt', () => {
    beforeEach(() => {
      store.load([summaryUpdatedRecord, metricsUpdatedRecord]) // timestamps 1000, 5000
    })

    it('returns -1 before first event', () => {
      expect(store.getIndexAt(500)).toBe(-1)
    })

    it('returns index of exact match', () => {
      expect(store.getIndexAt(1000)).toBe(0)
      expect(store.getIndexAt(5000)).toBe(1)
    })

    it('returns index of previous event for timestamp between', () => {
      expect(store.getIndexAt(3000)).toBe(0)
    })

    it('returns last index for timestamp after all events', () => {
      expect(store.getIndexAt(10000)).toBe(1)
    })
  })

  describe('getEntryAt', () => {
    beforeEach(() => {
      store.load([summaryUpdatedRecord])
    })

    it('returns entry at valid index', () => {
      const entry = store.getEntryAt(0)

      expect(entry).toBeDefined()
      expect(entry!.record.type).toBe('SummaryUpdated')
    })

    it('returns undefined for invalid index', () => {
      expect(store.getEntryAt(-1)).toBeUndefined()
      expect(store.getEntryAt(100)).toBeUndefined()
    })
  })

  describe('getTimeRange', () => {
    it('returns null for empty timeline', () => {
      expect(store.getTimeRange()).toBeNull()
    })

    it('returns time range for populated timeline', () => {
      store.load([summaryUpdatedRecord, metricsUpdatedRecord])

      const range = store.getTimeRange()

      expect(range).toEqual({ start: 1000, end: 5000 })
    })
  })

  describe('reset', () => {
    it('clears timeline', () => {
      store.load([summaryUpdatedRecord])
      store.reset()

      expect(store.length).toBe(0)
      expect(store.getTimeRange()).toBeNull()
    })
  })
})

// ============================================================================
// computeDiff Tests
// ============================================================================

describe('computeDiff', () => {
  it('detects no changes between identical states', () => {
    const state1 = createInitialState()
    const state2 = createInitialState()

    const diff = computeDiff(state1, state2)

    expect(diff.hasChanges).toBe(false)
    expect(diff.changes).toHaveLength(0)
    expect(diff.summary).toBe('No changes')
  })

  it('detects added fields', () => {
    const state1 = createInitialState()
    const state2 = {
      ...createInitialState(),
      summary: { title: 'New Title' },
    }

    const diff = computeDiff(state1, state2)

    expect(diff.hasChanges).toBe(true)
    const titleChange = diff.changes.find((c) => c.path === 'summary.title')
    expect(titleChange).toBeDefined()
    expect(titleChange!.type).toBe('added')
    expect(titleChange!.newValue).toBe('New Title')
  })

  it('detects removed fields', () => {
    const state1 = {
      ...createInitialState(),
      summary: { title: 'Old Title' },
    }
    const state2 = {
      ...createInitialState(),
      summary: {},
    }

    const diff = computeDiff(state1, state2)

    expect(diff.hasChanges).toBe(true)
    const titleChange = diff.changes.find((c) => c.path === 'summary.title')
    expect(titleChange).toBeDefined()
    expect(titleChange!.type).toBe('removed')
    expect(titleChange!.oldValue).toBe('Old Title')
  })

  it('detects modified fields', () => {
    const state1 = {
      ...createInitialState(),
      summary: { title: 'Old' },
    }
    const state2 = {
      ...createInitialState(),
      summary: { title: 'New' },
    }

    const diff = computeDiff(state1, state2)

    expect(diff.hasChanges).toBe(true)
    const titleChange = diff.changes.find((c) => c.path === 'summary.title')
    expect(titleChange).toBeDefined()
    expect(titleChange!.type).toBe('modified')
    expect(titleChange!.oldValue).toBe('Old')
    expect(titleChange!.newValue).toBe('New')
  })

  it('detects metrics changes', () => {
    const state1 = createInitialState()
    const state2 = {
      ...createInitialState(),
      metrics: { turnCount: 5, toolCount: 10, toolsThisTurn: 2, totalTokens: 1000 },
    }

    const diff = computeDiff(state1, state2)

    expect(diff.hasChanges).toBe(true)
    expect(diff.changes.some((c) => c.path === 'metrics.turnCount')).toBe(true)
    expect(diff.changes.some((c) => c.path === 'metrics.toolCount')).toBe(true)
  })

  it('generates summary with change counts', () => {
    const state1 = {
      ...createInitialState(),
      summary: { title: 'Old', intent: 'to remove' },
    }
    const state2 = {
      ...createInitialState(),
      summary: { title: 'New', topics: ['topic1'] },
    }

    const diff = computeDiff(state1, state2)

    // ~1 (title modified), -1 (intent removed), +1 (topics added)
    expect(diff.summary).toContain('+1')
    expect(diff.summary).toContain('-1')
    expect(diff.summary).toContain('~1')
  })

  it('handles Map-to-object conversion for stagedReminders', () => {
    const state1 = createInitialState()
    const state2 = {
      ...createInitialState(),
      stagedReminders: new Map([
        ['hook1', [{ name: 'r1', blocking: false, priority: 10, persistent: true, stagedAt: 1000 }]],
      ]),
    }

    const diff = computeDiff(state1, state2)

    expect(diff.hasChanges).toBe(true)
    expect(diff.changes.some((c) => c.path.startsWith('stagedReminders'))).toBe(true)
  })
})

// ============================================================================
// computeEntryDiff Tests
// ============================================================================

describe('computeEntryDiff', () => {
  it('compares first entry to initial state', () => {
    const timeline = buildTimeline([summaryUpdatedRecord])

    const diff = computeEntryDiff(timeline, 0)

    expect(diff.hasChanges).toBe(true)
    expect(diff.changes.some((c) => c.path === 'summary.title')).toBe(true)
  })

  it('compares subsequent entries to previous', () => {
    const timeline = buildTimeline([summaryUpdatedRecord, metricsUpdatedRecord])

    const diff = computeEntryDiff(timeline, 1)

    expect(diff.hasChanges).toBe(true)
    expect(diff.changes.some((c) => c.path === 'metrics.turnCount')).toBe(true)
    // Summary shouldn't appear as changed
    expect(diff.changes.some((c) => c.path === 'summary.title')).toBe(false)
  })

  it('handles invalid index', () => {
    const timeline = buildTimeline([summaryUpdatedRecord])

    const diff = computeEntryDiff(timeline, 5)

    expect(diff.hasChanges).toBe(false)
    expect(diff.summary).toBe('Invalid index')
  })

  it('handles negative index', () => {
    const timeline = buildTimeline([summaryUpdatedRecord])

    const diff = computeEntryDiff(timeline, -1)

    expect(diff.hasChanges).toBe(false)
    expect(diff.summary).toBe('Invalid index')
  })
})
