/**
 * Replay Engine Core
 *
 * Provides time-travel debugging by reconstructing state from event sequences.
 * Builds an in-memory timeline of state snapshots that can be scrubbed to any point.
 *
 * Components:
 * - StateReconstructor: Builds timeline from ParsedLogRecord events
 * - TimeTravelStore: Provides getStateAt(timestamp) API for UI scrubbing
 * - DiffCalculator: Computes state deltas between snapshots for highlighting changes
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2 Time Travel (The Replay Engine)
 * @see docs/design/flow.md §3.2 Event Schema
 */

import type { TranscriptMetrics, TokenUsageMetrics } from '@sidekick/types'
import type { ParsedLogRecord } from './log-parser'

/**
 * Creates default token usage metrics for initial state.
 */
function createDefaultTokenUsage(): TokenUsageMetrics {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheTiers: {
      ephemeral5mInputTokens: 0,
      ephemeral1hInputTokens: 0,
    },
    serviceTierCounts: {},
    byModel: {},
  }
}

/**
 * Creates default transcript metrics for initial state.
 */
export function createDefaultMetrics(): TranscriptMetrics {
  return {
    turnCount: 0,
    toolCount: 0,
    toolsThisTurn: 0,
    messageCount: 0,
    tokenUsage: createDefaultTokenUsage(),
    toolsPerTurn: 0,
    lastProcessedLine: 0,
    lastUpdatedAt: 0,
  }
}

// ============================================================================
// State Types
// ============================================================================

/**
 * Session summary state as stored in session-summary.json.
 * Matches the backend SessionSummary schema.
 */
export interface SessionSummaryState {
  title?: string
  titleConfidence?: number
  intent?: string
  intentConfidence?: number
  topics?: string[]
}

/**
 * Staged reminder from stage/{hookName}/*.json files.
 * @see docs/design/FEATURE-REMINDERS.md §3.3 Reminder File Schema
 */
export interface StagedReminder {
  name: string
  blocking: boolean
  priority: number
  persistent: boolean
  userMessage?: string
  additionalContext?: string
  stagedAt: number
}

/**
 * Complete reconstructed state at a point in time.
 * Contains all state domains the UI tracks.
 */
export interface ReplayState {
  /** Session summary (title, intent, topics) */
  summary: SessionSummaryState
  /** Transcript metrics snapshot */
  metrics: TranscriptMetrics
  /** Currently staged reminders by hook name */
  stagedReminders: Map<string, StagedReminder[]>
  /** Supervisor health status */
  supervisorHealth?: {
    online: boolean
    lastSeen: number
    queueDepth?: number
    activeTasks?: number
  }
}

/**
 * A single entry in the timeline.
 * Associates an event with its timestamp and resulting state change.
 */
export interface TimelineEntry {
  /** Unix timestamp (ms) of this entry */
  timestamp: number
  /** The log record that caused this state change */
  record: ParsedLogRecord
  /** State delta - what changed (keys present only if changed) */
  delta: Partial<ReplayState>
  /** Full state snapshot after applying this event */
  stateAfter: ReplayState
}

// ============================================================================
// Default/Initial State
// ============================================================================

/**
 * Create a fresh initial state.
 * Used as the starting point before any events are processed.
 */
export function createInitialState(): ReplayState {
  return {
    summary: {},
    metrics: createDefaultMetrics(),
    stagedReminders: new Map(),
    supervisorHealth: undefined,
  }
}

/**
 * Deep clone a ReplayState for immutability.
 */
export function cloneState(state: ReplayState): ReplayState {
  return {
    summary: { ...state.summary },
    metrics: {
      ...state.metrics,
      tokenUsage: {
        ...state.metrics.tokenUsage,
        cacheTiers: { ...state.metrics.tokenUsage.cacheTiers },
        serviceTierCounts: { ...state.metrics.tokenUsage.serviceTierCounts },
        byModel: Object.fromEntries(Object.entries(state.metrics.tokenUsage.byModel).map(([k, v]) => [k, { ...v }])),
      },
    },
    stagedReminders: new Map(
      Array.from(state.stagedReminders.entries()).map(([k, v]) => [k, v.map((r) => ({ ...r }))])
    ),
    supervisorHealth: state.supervisorHealth ? { ...state.supervisorHealth } : undefined,
  }
}

// ============================================================================
// State Reconstructor
// ============================================================================

/**
 * Event types that cause state changes.
 * These are the event.type values we watch for.
 */
const STATE_CHANGING_EVENTS = new Set([
  'SummaryUpdated',
  'ReminderStaged',
  'ReminderConsumed',
  'RemindersCleared',
  'TranscriptEventEmitted',
  'TranscriptMetricsUpdated',
  'SessionStart',
  'SessionEnd',
])

/**
 * Determine if a log record represents a state-changing event.
 */
export function isStateChangingEvent(record: ParsedLogRecord): boolean {
  // Check explicit type field
  if (record.type && STATE_CHANGING_EVENTS.has(record.type)) {
    return true
  }

  // Check embedded SidekickEvent
  if (record.event) {
    if (record.event.kind === 'hook') {
      // SessionStart clears reminders, SessionEnd ends session
      return record.event.hook === 'SessionStart' || record.event.hook === 'SessionEnd'
    }
    if (record.event.kind === 'transcript') {
      // All transcript events update metrics
      return true
    }
  }

  return false
}

/**
 * Extract state delta from a log record.
 * Returns partial state with only the fields that changed.
 *
 * @param record - Parsed log record
 * @param currentState - Current state before this event
 * @returns Partial state with changed fields only
 */
export function extractStateDelta(record: ParsedLogRecord, currentState: ReplayState): Partial<ReplayState> {
  const delta: Partial<ReplayState> = {}

  // Handle by event type
  switch (record.type) {
    case 'SummaryUpdated': {
      const payload = record.payload as { state?: SessionSummaryState } | undefined
      if (payload?.state) {
        delta.summary = { ...payload.state }
      }
      break
    }

    case 'ReminderStaged': {
      const payload = record.payload as
        | {
            hookName?: string
            reminder?: StagedReminder
          }
        | undefined
      if (payload?.hookName && payload?.reminder) {
        const hookName = payload.hookName
        const newReminders = new Map(currentState.stagedReminders)
        const existing = newReminders.get(hookName) ?? []
        // Add or update reminder by name
        const idx = existing.findIndex((r) => r.name === payload.reminder?.name)
        if (idx >= 0) {
          existing[idx] = { ...payload.reminder, stagedAt: record.pino.time }
        } else {
          existing.push({ ...payload.reminder, stagedAt: record.pino.time })
        }
        newReminders.set(hookName, existing)
        delta.stagedReminders = newReminders
      }
      break
    }

    case 'ReminderConsumed': {
      const payload = record.payload as
        | {
            hookName?: string
            reminderName?: string
          }
        | undefined
      if (payload?.hookName && payload?.reminderName) {
        const newReminders = new Map(currentState.stagedReminders)
        const existing = newReminders.get(payload.hookName) ?? []
        const filtered = existing.filter((r) => r.name !== payload.reminderName || r.persistent)
        if (filtered.length > 0) {
          newReminders.set(payload.hookName, filtered)
        } else {
          newReminders.delete(payload.hookName)
        }
        delta.stagedReminders = newReminders
      }
      break
    }

    case 'RemindersCleared': {
      const payload = record.payload as { hookName?: string } | undefined
      if (payload?.hookName) {
        const newReminders = new Map(currentState.stagedReminders)
        newReminders.delete(payload.hookName)
        delta.stagedReminders = newReminders
      } else {
        // Clear all if no hookName specified
        delta.stagedReminders = new Map()
      }
      break
    }

    case 'TranscriptEventEmitted':
    case 'TranscriptMetricsUpdated': {
      const metadata = record.metadata as { metrics?: TranscriptMetrics } | undefined
      if (metadata?.metrics) {
        delta.metrics = { ...metadata.metrics }
      }
      break
    }

    case 'SessionStart': {
      // SessionStart with type startup or clear clears reminders
      const payload = record.payload as { startType?: string } | undefined
      if (payload?.startType === 'startup' || payload?.startType === 'clear') {
        delta.stagedReminders = new Map()
        delta.summary = {}
        delta.metrics = createDefaultMetrics()
      }
      break
    }
  }

  // Handle embedded SidekickEvent (for transcript events with metrics)
  if (record.event?.kind === 'transcript') {
    const transcriptEvent = record.event
    if (transcriptEvent.metadata?.metrics) {
      delta.metrics = { ...transcriptEvent.metadata.metrics }
    }
  }

  return delta
}

/**
 * Apply a state delta to produce a new state.
 * Returns a new state object (immutable).
 *
 * @param currentState - State before delta
 * @param delta - Partial state with changes
 * @returns New state with delta applied
 */
export function applyDelta(currentState: ReplayState, delta: Partial<ReplayState>): ReplayState {
  return {
    summary: delta.summary !== undefined ? { ...currentState.summary, ...delta.summary } : currentState.summary,
    metrics: delta.metrics !== undefined ? { ...delta.metrics } : currentState.metrics,
    stagedReminders: delta.stagedReminders !== undefined ? delta.stagedReminders : currentState.stagedReminders,
    supervisorHealth:
      delta.supervisorHealth !== undefined
        ? delta.supervisorHealth
        : currentState.supervisorHealth
          ? { ...currentState.supervisorHealth }
          : undefined,
  }
}

/**
 * Build a timeline from a sequence of log records.
 * Processes events chronologically and builds state snapshots.
 *
 * @param records - Parsed log records (should be sorted by timestamp)
 * @param initialState - Optional starting state
 * @returns Array of timeline entries
 */
export function buildTimeline(
  records: ParsedLogRecord[],
  initialState: ReplayState = createInitialState()
): TimelineEntry[] {
  const timeline: TimelineEntry[] = []
  let currentState = cloneState(initialState)

  for (const record of records) {
    // Only process state-changing events
    if (!isStateChangingEvent(record)) {
      continue
    }

    const delta = extractStateDelta(record, currentState)

    // Skip if no actual changes
    if (Object.keys(delta).length === 0) {
      continue
    }

    // Apply delta and create timeline entry
    const stateAfter = applyDelta(currentState, delta)

    timeline.push({
      timestamp: record.pino.time,
      record,
      delta,
      stateAfter,
    })

    currentState = stateAfter
  }

  return timeline
}

// ============================================================================
// Time Travel Store
// ============================================================================

/**
 * Store for time-travel debugging.
 * Provides efficient state lookup at any timestamp.
 */
export class TimeTravelStore {
  private timeline: TimelineEntry[] = []
  private initialState: ReplayState

  constructor(initialState: ReplayState = createInitialState()) {
    this.initialState = cloneState(initialState)
  }

  /**
   * Load a timeline from log records.
   * Replaces any existing timeline.
   *
   * @param records - Parsed log records (should be sorted by timestamp)
   */
  load(records: ParsedLogRecord[]): void {
    this.timeline = buildTimeline(records, this.initialState)
  }

  /**
   * Append new records to the timeline (for live mode).
   * Records should be newer than existing timeline entries.
   *
   * @param records - New parsed log records
   */
  append(records: ParsedLogRecord[]): void {
    const lastState = this.timeline.length > 0 ? this.timeline[this.timeline.length - 1].stateAfter : this.initialState

    const newEntries = buildTimeline(records, lastState)
    this.timeline.push(...newEntries)
  }

  /**
   * Get the state at a specific timestamp.
   * Returns the state after all events up to and including the timestamp.
   *
   * @param timestamp - Unix timestamp (ms)
   * @returns State at that point in time
   */
  getStateAt(timestamp: number): ReplayState {
    if (this.timeline.length === 0 || timestamp < this.timeline[0].timestamp) {
      return cloneState(this.initialState)
    }

    // Binary search for the entry at or before the timestamp
    let left = 0
    let right = this.timeline.length - 1

    while (left < right) {
      const mid = Math.floor((left + right + 1) / 2)
      if (this.timeline[mid].timestamp <= timestamp) {
        left = mid
      } else {
        right = mid - 1
      }
    }

    return cloneState(this.timeline[left].stateAfter)
  }

  /**
   * Get the entry at a specific index.
   */
  getEntryAt(index: number): TimelineEntry | undefined {
    return this.timeline[index]
  }

  /**
   * Get the index of the entry at or before a timestamp.
   * Returns -1 if timestamp is before all entries.
   */
  getIndexAt(timestamp: number): number {
    if (this.timeline.length === 0 || timestamp < this.timeline[0].timestamp) {
      return -1
    }

    let left = 0
    let right = this.timeline.length - 1

    while (left < right) {
      const mid = Math.floor((left + right + 1) / 2)
      if (this.timeline[mid].timestamp <= timestamp) {
        left = mid
      } else {
        right = mid - 1
      }
    }

    return left
  }

  /**
   * Get the entire timeline.
   */
  getTimeline(): readonly TimelineEntry[] {
    return this.timeline
  }

  /**
   * Get the number of entries in the timeline.
   */
  get length(): number {
    return this.timeline.length
  }

  /**
   * Get the time range of the timeline.
   * Returns null if timeline is empty.
   */
  getTimeRange(): { start: number; end: number } | null {
    if (this.timeline.length === 0) {
      return null
    }
    return {
      start: this.timeline[0].timestamp,
      end: this.timeline[this.timeline.length - 1].timestamp,
    }
  }

  /**
   * Reset the store to initial state.
   */
  reset(): void {
    this.timeline = []
  }
}

// ============================================================================
// Diff Calculator
// ============================================================================

/**
 * Represents a single change in a diff.
 */
export interface DiffChange {
  /** Path to the changed field (dot-notation) */
  path: string
  /** Type of change */
  type: 'added' | 'removed' | 'modified'
  /** Previous value (undefined for 'added') */
  oldValue?: unknown
  /** New value (undefined for 'removed') */
  newValue?: unknown
}

/**
 * Result of comparing two states.
 */
export interface StateDiff {
  /** Whether any changes were detected */
  hasChanges: boolean
  /** List of individual changes */
  changes: DiffChange[]
  /** Summary for UI display */
  summary: string
}

/**
 * Compare two primitive values.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((val, idx) => valuesEqual(val, b[idx]))
  }

  // Handle objects (but not null)
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) => valuesEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  }

  return false
}

/**
 * Recursively compute changes between two objects.
 *
 * @param oldObj - Previous state
 * @param newObj - New state
 * @param basePath - Path prefix for nested properties
 * @returns Array of changes
 */
function computeObjectDiff(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  basePath: string = ''
): DiffChange[] {
  const changes: DiffChange[] = []
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)])

  for (const key of allKeys) {
    const path = basePath ? `${basePath}.${key}` : key
    const oldVal = oldObj[key]
    const newVal = newObj[key]

    if (!(key in oldObj)) {
      changes.push({ path, type: 'added', newValue: newVal })
    } else if (!(key in newObj)) {
      changes.push({ path, type: 'removed', oldValue: oldVal })
    } else if (!valuesEqual(oldVal, newVal)) {
      // Check if we should recurse into nested objects
      if (
        typeof oldVal === 'object' &&
        oldVal !== null &&
        !Array.isArray(oldVal) &&
        typeof newVal === 'object' &&
        newVal !== null &&
        !Array.isArray(newVal)
      ) {
        changes.push(...computeObjectDiff(oldVal as Record<string, unknown>, newVal as Record<string, unknown>, path))
      } else {
        changes.push({ path, type: 'modified', oldValue: oldVal, newValue: newVal })
      }
    }
  }

  return changes
}

/**
 * Convert a ReplayState to a plain object for diffing.
 * Handles Map conversion.
 */
function stateToPlainObject(state: ReplayState): Record<string, unknown> {
  return {
    summary: state.summary,
    metrics: state.metrics,
    stagedReminders: Object.fromEntries(state.stagedReminders),
    supervisorHealth: state.supervisorHealth,
  }
}

/**
 * Compute the difference between two replay states.
 *
 * @param oldState - Previous state
 * @param newState - New state
 * @returns Diff result with changes and summary
 */
export function computeDiff(oldState: ReplayState, newState: ReplayState): StateDiff {
  const oldObj = stateToPlainObject(oldState)
  const newObj = stateToPlainObject(newState)

  const changes = computeObjectDiff(oldObj, newObj)
  const hasChanges = changes.length > 0

  // Generate summary
  let summary = 'No changes'
  if (hasChanges) {
    const parts: string[] = []
    const addedCount = changes.filter((c) => c.type === 'added').length
    const removedCount = changes.filter((c) => c.type === 'removed').length
    const modifiedCount = changes.filter((c) => c.type === 'modified').length

    if (addedCount > 0) parts.push(`+${addedCount}`)
    if (removedCount > 0) parts.push(`-${removedCount}`)
    if (modifiedCount > 0) parts.push(`~${modifiedCount}`)

    summary = parts.join(', ')
  }

  return { hasChanges, changes, summary }
}

/**
 * Compute the diff between two adjacent timeline entries.
 * Convenience function for UI state inspector diff mode.
 *
 * @param timeline - Array of timeline entries
 * @param index - Index of the entry to diff (compares with previous)
 * @returns Diff from previous entry, or empty diff if first entry
 */
export function computeEntryDiff(timeline: readonly TimelineEntry[], index: number): StateDiff {
  if (index < 0 || index >= timeline.length) {
    return { hasChanges: false, changes: [], summary: 'Invalid index' }
  }

  if (index === 0) {
    // First entry - diff from initial state
    const newState = timeline[0].stateAfter
    return computeDiff(createInitialState(), newState)
  }

  const oldState = timeline[index - 1].stateAfter
  const newState = timeline[index].stateAfter

  return computeDiff(oldState, newState)
}
