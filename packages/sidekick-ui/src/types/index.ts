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
}
