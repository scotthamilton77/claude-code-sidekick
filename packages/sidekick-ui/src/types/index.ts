/**
 * UI Type Definitions
 *
 * Re-exports canonical event types from @sidekick/types and defines
 * UI-specific presentation types.
 *
 * @see docs/design/flow.md §3.2 Event Schema (canonical event model)
 * @see packages/sidekick-ui/docs/MONITORING-UI.md (UI architecture)
 */

// ============================================================================
// Canonical Event Types from @sidekick/types
// ============================================================================

export type {
  // Event types
  SidekickEvent,
  HookEvent,
  TranscriptEvent,
  HookName,
  TranscriptEventType,
  TranscriptEntry,

  // Individual hook event types
  SessionStartHookEvent,
  SessionEndHookEvent,
  UserPromptSubmitHookEvent,
  PreToolUseHookEvent,
  PostToolUseHookEvent,
  StopHookEvent,
  PreCompactHookEvent,

  // Context and metrics
  EventContext,
  TranscriptMetrics,
} from '@sidekick/types'

// Local type guards for runtime discrimination
// (Implemented locally to avoid ESM/CommonJS interop issues with Vite)
import type { SidekickEvent, HookEvent, TranscriptEvent } from '@sidekick/types'

export function isHookEvent(event: SidekickEvent): event is HookEvent {
  return event.kind === 'hook'
}

export function isTranscriptEvent(event: SidekickEvent): event is TranscriptEvent {
  return event.kind === 'transcript'
}

export function isSessionStartEvent(event: HookEvent): event is import('@sidekick/types').SessionStartHookEvent {
  return event.hook === 'SessionStart'
}

export function isSessionEndEvent(event: HookEvent): event is import('@sidekick/types').SessionEndHookEvent {
  return event.hook === 'SessionEnd'
}

export function isUserPromptSubmitEvent(
  event: HookEvent
): event is import('@sidekick/types').UserPromptSubmitHookEvent {
  return event.hook === 'UserPromptSubmit'
}

export function isPreToolUseEvent(event: HookEvent): event is import('@sidekick/types').PreToolUseHookEvent {
  return event.hook === 'PreToolUse'
}

export function isPostToolUseEvent(event: HookEvent): event is import('@sidekick/types').PostToolUseHookEvent {
  return event.hook === 'PostToolUse'
}

export function isStopEvent(event: HookEvent): event is import('@sidekick/types').StopHookEvent {
  return event.hook === 'Stop'
}

export function isPreCompactEvent(event: HookEvent): event is import('@sidekick/types').PreCompactHookEvent {
  return event.hook === 'PreCompact'
}

// ============================================================================
// UI-Specific Types
// ============================================================================

/**
 * Session metadata for the session selector.
 * UI-specific - not directly from event payloads.
 */
export interface Session {
  id: string
  title: string
  date: string
  branch: string
}

/**
 * State snapshot for the State Inspector panel.
 * Displayed from session-summary.json state files.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md for backend state structure
 */
export interface StateSnapshot {
  session_id: string
  session_title: string
  session_title_confidence: number
  latest_intent: string
  latest_intent_confidence: number
  tokens: {
    input: number
    output: number
  }
  cost_usd: number
  duration_sec: number
}

/**
 * UI event types for timeline/transcript display.
 * These map to categories of SidekickEvent for visual rendering.
 */
export type UIEventType =
  | 'session' // SessionStart hook
  | 'user' // UserPromptSubmit hook / UserPrompt transcript
  | 'assistant' // AssistantMessage transcript
  | 'decision' // Internal decision (prune context, etc.)
  | 'state' // SummaryUpdated internal event
  | 'tool' // PreToolUse/PostToolUse hook / ToolCall transcript
  | 'reminder' // ReminderStaged/ReminderConsumed events

/**
 * Simplified event for timeline/transcript UI rendering.
 *
 * This is a UI presentation type that flattens SidekickEvent data for display.
 * Phase 1.5.4 will add adapters to convert SidekickEvent → UIEvent.
 *
 * @see SidekickEvent for the canonical event schema
 */
export interface UIEvent {
  /** Sequential ID for timeline positioning */
  id: number
  /** Display time (HH:MM:SS format) */
  time: string
  /** Event category for styling/filtering */
  type: UIEventType
  /** Short display label */
  label: string
  /** Event content/description */
  content?: string
  /** Git branch (if relevant) */
  branch?: string
  /** Source component (for 1.5.4 badge display) */
  source?: 'cli' | 'supervisor'
  /** Original SidekickEvent (for drill-down in 1.5.4) */
  rawEvent?: import('@sidekick/types').SidekickEvent
  /** Trace ID for correlating related events */
  traceId?: string
  /** Structured reminder data for reminder events */
  reminderData?: ReminderData
  /** Structured summary data for summary events */
  summaryData?: SummaryData
  /** Structured decision data for decision events */
  decisionData?: DecisionData
}

// ============================================================================
// Phase 6.5: Enhanced Event Data Types
// ============================================================================

/**
 * Structured data extracted from reminder events.
 * Used by ReminderCard for rich rendering.
 *
 * @see packages/types/src/events.ts ReminderStagedEvent, ReminderConsumedEvent
 */
export interface ReminderData {
  /** The reminder action type */
  action: 'staged' | 'consumed' | 'cleared'
  /** Name of the reminder (e.g., "AreYouStuckReminder") */
  reminderName?: string
  /** Target hook for the reminder */
  hookName?: string
  /** Whether the reminder blocks the action */
  blocking?: boolean
  /** Priority for consumption ordering (higher = consumed first) */
  priority?: number
  /** Whether the reminder persists after consumption */
  persistent?: boolean
  /** Number of reminders cleared (for cleared action) */
  clearedCount?: number
  /** Whether a reminder was actually returned to Claude */
  reminderReturned?: boolean
}

/**
 * Structured data extracted from summary events.
 * Used by SummaryUpdatedCard for diff rendering.
 *
 * @see packages/types/src/events.ts SummaryUpdatedEvent, SummarySkippedEvent
 */
export interface SummaryData {
  /** Whether summary was updated or skipped */
  action: 'updated' | 'skipped'
  /** Reason for the action */
  reason: 'user_prompt_forced' | 'countdown_reached' | 'compaction_reset' | 'countdown_active'
  /** Current session title */
  sessionTitle?: string
  /** Confidence in session title (0-1) */
  titleConfidence?: number
  /** Current latest intent */
  latestIntent?: string
  /** Confidence in latest intent (0-1) */
  intentConfidence?: number
  /** Previous session title (for diff display) */
  oldTitle?: string
  /** Previous intent (for diff display) */
  oldIntent?: string
  /** Whether a significant pivot was detected */
  pivotDetected?: boolean
  /** Countdown reset value after update */
  countdownResetTo?: number
}

/**
 * Decision event categories for filtering.
 */
export type DecisionCategory = 'summary' | 'reminder' | 'context_prune' | 'handler'

/**
 * Structured data extracted from decision events.
 * Used by DecisionCard for categorized rendering.
 */
export interface DecisionData {
  /** Category of the decision */
  category: DecisionCategory
  /** Handler ID if applicable */
  handlerId?: string
  /** Whether the operation succeeded */
  success?: boolean
  /** Duration in milliseconds */
  durationMs?: number
  /** Error message if failed */
  error?: string
}

/**
 * Filter options for the Decision Log view.
 */
export type DecisionLogFilterCategory = 'all' | DecisionCategory

export interface DecisionLogFilter {
  /** Filter by decision category */
  category: DecisionLogFilterCategory
  /** Filter by session ID */
  sessionId?: string
  /** Filter by trace ID to show related events */
  traceId?: string
}

/**
 * Group of events linked by traceId for flow visualization.
 * Represents a causal chain from hook → handlers → side effects.
 */
export interface TraceGroup {
  /** The trace ID linking these events */
  traceId: string
  /** All events in this trace group, ordered by time */
  events: UIEvent[]
  /** Timestamp of first event */
  startTime: number
  /** Timestamp of last event */
  endTime: number
  /** Hook that initiated this trace (if known) */
  hookName?: string
}
