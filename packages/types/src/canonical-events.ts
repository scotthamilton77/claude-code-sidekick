/**
 * Canonical UI Event Type Definitions
 *
 * Unified event vocabulary for the Sidekick monitoring UI.
 * Uses `category:action` naming convention. Payloads are FLAT (no state/metadata nesting).
 *
 * @see packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md §2.2-2.4
 */

import type {
  LogSource,
  EventLogContext,
  ReminderStagedPayload,
  ReminderUnstagedPayload,
  ReminderConsumedPayload,
  ReminderClearedPayload,
  ReminderNotStagedPayload,
  DecisionRecordedPayload,
  SessionSummaryStartPayload,
  SessionSummaryFinishPayload,
  SessionTitleChangedPayload,
  IntentChangedPayload,
  SnarkyMessageStartPayload,
  SnarkyMessageFinishPayload,
  ResumeMessageStartPayload,
  ResumeMessageFinishPayload,
  PersonaSelectedPayload,
  PersonaChangedPayload,
  StatuslineRenderedPayload,
  HookReceivedPayload,
  HookCompletedPayload,
  EventReceivedPayload,
  EventProcessedPayload,
  DaemonStartingPayload,
  DaemonStartedPayload,
  IpcStartedPayload,
  ConfigWatcherStartedPayload,
  SessionEvictionStartedPayload,
  SessionSummarySkippedPayload,
  ResumeMessageSkippedPayload,
  StatuslineErrorPayload,
  TranscriptEmittedPayload,
  TranscriptPreCompactPayload,
  BulkProcessingStartPayload,
  BulkProcessingFinishPayload,
  ErrorOccurredPayload,
} from './logging-events.js'

// ============================================================================
// Canonical UI Event Types
// ============================================================================
//
// Unified event vocabulary for the Sidekick monitoring UI.
// Uses `category:action` naming convention. Payloads are FLAT (no state/metadata nesting).
//
// @see packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md §2.2-2.4

/**
 * Event visibility determines where the event is rendered in the UI.
 * - `timeline`: Main timeline panel (user-visible state changes)
 * - `log`: Log viewer panel only (internal machinery)
 * - `both`: Both timeline and log viewer
 */
export type EventVisibility = 'timeline' | 'log' | 'both'

/**
 * Canonical UI event type names as a const tuple.
 * Single source of truth for both the UIEventType union and runtime validation.
 */
export const UI_EVENT_TYPES = [
  // Reminder events
  'reminder:staged',
  'reminder:unstaged',
  'reminder:consumed',
  'reminder:cleared',
  'reminder:not-staged',
  // Decision events
  'decision:recorded',
  // Session summary events
  'session-summary:start',
  'session-summary:finish',
  // Session state change events
  'session-title:changed',
  'intent:changed',
  // Snarky message events
  'snarky-message:start',
  'snarky-message:finish',
  // Resume message events
  'resume-message:start',
  'resume-message:finish',
  // Persona events
  'persona:selected',
  'persona:changed',
  // Statusline events
  'statusline:rendered',
  // Hook lifecycle events
  'hook:received',
  'hook:completed',
  // Daemon event processing
  'event:received',
  'event:processed',
  // Daemon lifecycle events
  'daemon:starting',
  'daemon:started',
  'ipc:started',
  'config:watcher-started',
  'session:eviction-started',
  // Skipped operation events
  'session-summary:skipped',
  'resume-message:skipped',
  // Error events
  'statusline:error',
  // Transcript events
  'transcript:emitted',
  'transcript:pre-compact',
  // Bulk processing lifecycle events
  'bulk-processing:start',
  'bulk-processing:finish',
  // General error
  'error:occurred',
] as const

/**
 * Union of all canonical UI event type names.
 * Derived from the UI_EVENT_TYPES const tuple.
 */
export type UIEventType = (typeof UI_EVENT_TYPES)[number]

// ============================================================================
// Payload Mapping (UIEventType -> Payload Interface)
// ============================================================================

/**
 * Maps each UIEventType to its corresponding payload interface.
 */
export interface UIEventPayloadMap {
  'reminder:staged': ReminderStagedPayload
  'reminder:unstaged': ReminderUnstagedPayload
  'reminder:consumed': ReminderConsumedPayload
  'reminder:cleared': ReminderClearedPayload
  'reminder:not-staged': ReminderNotStagedPayload
  'decision:recorded': DecisionRecordedPayload
  'session-summary:start': SessionSummaryStartPayload
  'session-summary:finish': SessionSummaryFinishPayload
  'session-title:changed': SessionTitleChangedPayload
  'intent:changed': IntentChangedPayload
  'snarky-message:start': SnarkyMessageStartPayload
  'snarky-message:finish': SnarkyMessageFinishPayload
  'resume-message:start': ResumeMessageStartPayload
  'resume-message:finish': ResumeMessageFinishPayload
  'persona:selected': PersonaSelectedPayload
  'persona:changed': PersonaChangedPayload
  'statusline:rendered': StatuslineRenderedPayload
  'hook:received': HookReceivedPayload
  'hook:completed': HookCompletedPayload
  'event:received': EventReceivedPayload
  'event:processed': EventProcessedPayload
  'daemon:starting': DaemonStartingPayload
  'daemon:started': DaemonStartedPayload
  'ipc:started': IpcStartedPayload
  'config:watcher-started': ConfigWatcherStartedPayload
  'session:eviction-started': SessionEvictionStartedPayload
  'session-summary:skipped': SessionSummarySkippedPayload
  'resume-message:skipped': ResumeMessageSkippedPayload
  'statusline:error': StatuslineErrorPayload
  'transcript:emitted': TranscriptEmittedPayload
  'transcript:pre-compact': TranscriptPreCompactPayload
  'bulk-processing:start': BulkProcessingStartPayload
  'bulk-processing:finish': BulkProcessingFinishPayload
  'error:occurred': ErrorOccurredPayload
}

/**
 * Utility type: resolves the payload interface for a given UIEventType.
 */
export type PayloadFor<T extends UIEventType> = UIEventPayloadMap[T]

// ============================================================================
// Canonical Event Interface
// ============================================================================

/**
 * A canonical UI event with type-safe payload discrimination.
 * Use the `type` field as a discriminator to narrow the payload type.
 *
 * @example
 * ```typescript
 * function handleEvent(event: CanonicalEvent) {
 *   if (event.type === 'reminder:staged') {
 *     // event.payload is ReminderStagedPayload
 *     console.log(event.payload.reminderName)
 *   }
 * }
 * ```
 */
export interface CanonicalEvent<T extends UIEventType = UIEventType> {
  type: T
  visibility: (typeof UI_EVENT_VISIBILITY)[T]
  source: LogSource
  /** Unix timestamp (ms) — when the event occurred. Used by the UI to merge/sort events. */
  time: number
  context: EventLogContext
  payload: PayloadFor<T>
}

// ============================================================================
// Event Visibility Map
// ============================================================================

/**
 * Const record mapping each UIEventType to its EventVisibility.
 * Derived from the §2.4 canonical event table.
 *
 * @see packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md §2.4
 */
export const UI_EVENT_VISIBILITY = {
  // Timeline events (user-visible state changes)
  'reminder:staged': 'timeline',
  'reminder:unstaged': 'timeline',
  'reminder:consumed': 'timeline',
  'reminder:cleared': 'timeline',
  'reminder:not-staged': 'log',
  'decision:recorded': 'timeline',
  'session-summary:start': 'timeline',
  'session-summary:finish': 'timeline',
  'session-title:changed': 'timeline',
  'intent:changed': 'timeline',
  'snarky-message:start': 'timeline',
  'snarky-message:finish': 'timeline',
  'resume-message:start': 'timeline',
  'resume-message:finish': 'timeline',
  'persona:selected': 'timeline',
  'persona:changed': 'timeline',
  'statusline:rendered': 'timeline',
  // Both (timeline + log viewer)
  'hook:received': 'both',
  'hook:completed': 'both',
  'statusline:error': 'both',
  'error:occurred': 'both',
  // Log-only (internal machinery)
  'event:received': 'log',
  'event:processed': 'log',
  'daemon:starting': 'log',
  'daemon:started': 'log',
  'ipc:started': 'log',
  'config:watcher-started': 'log',
  'session:eviction-started': 'log',
  'session-summary:skipped': 'log',
  'resume-message:skipped': 'log',
  'transcript:emitted': 'log',
  'transcript:pre-compact': 'log',
  'bulk-processing:start': 'log',
  'bulk-processing:finish': 'log',
} as const satisfies Record<UIEventType, EventVisibility>
