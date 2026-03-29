/**
 * Event Model Type Definitions — Barrel Re-export
 *
 * Re-exports all event types from domain-specific modules.
 * Consumers continue importing from './events.js' with zero breaking changes.
 *
 * Domain modules:
 * - hook-events.ts: Hook events from Claude Code, EventContext, type guards
 * - transcript-events.ts: Transcript events, token metrics, TranscriptMetrics
 * - logging-events.ts: Internal logging events, all payload interfaces, DecisionEvents
 * - canonical-events.ts: UI event types, visibility, CanonicalEvent
 *
 * @see docs/design/flow.md §3.2 Event Schema (source of truth)
 * @see docs/design/CORE-RUNTIME.md §3.5 Handler Registration
 */

// Hook events: EventContext, HOOK_NAMES, HookName, all *HookEvent interfaces,
// HookEvent union, hook-specific type guards
export * from './hook-events.js'

// Transcript events: TranscriptEventType, TranscriptEntry, TokenUsageMetrics,
// TranscriptMetrics, TranscriptEvent
export * from './transcript-events.js'

// Logging events: LogSource, EventLogContext, LoggingEventBase, all logging event
// interfaces, all payload interfaces, union types, logging type guards, DecisionEvents
export * from './logging-events.js'

// Canonical events: EventVisibility, UI_EVENT_TYPES, UIEventType, UIEventPayloadMap,
// PayloadFor, CanonicalEvent, UI_EVENT_VISIBILITY
export * from './canonical-events.js'

// ============================================================================
// Unified Event Type & Cross-Domain Type Guards
// ============================================================================
//
// SidekickEvent and its type guards live here (not in domain files) because
// they span hook-events and transcript-events, which would create a circular dep.

import type { HookEvent } from './hook-events.js'
import type { TranscriptEvent } from './transcript-events.js'

/**
 * Discriminated union of all Sidekick events.
 * Use `isHookEvent()` and `isTranscriptEvent()` for type narrowing.
 */
export type SidekickEvent = HookEvent | TranscriptEvent

/**
 * Type guard for hook events (from Claude Code).
 */
export function isHookEvent(event: SidekickEvent): event is HookEvent {
  return event.kind === 'hook'
}

/**
 * Type guard for transcript events (from file watching).
 */
export function isTranscriptEvent(event: SidekickEvent): event is TranscriptEvent {
  return event.kind === 'transcript'
}
