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

// Re-export type guards for runtime discrimination
export {
  isHookEvent,
  isTranscriptEvent,
  isSessionStartEvent,
  isSessionEndEvent,
  isUserPromptSubmitEvent,
  isPreToolUseEvent,
  isPostToolUseEvent,
  isStopEvent,
  isPreCompactEvent,
} from '@sidekick/types'

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
}

// Legacy alias - remove after component migration
/** @deprecated Use UIEvent instead */
export type Event = UIEvent
