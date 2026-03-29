/**
 * Internal Logging Event Type Definitions
 *
 * Logging events for observability. These events are logged but don't trigger handlers.
 * Includes all per-event payload interfaces used by both logging events and canonical events.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §3.3 Log Record Format
 * @see docs/design/flow.md §7 Logging Events
 */

import type { TranscriptMetrics } from './transcript-events.js'

// ============================================================================
// Internal Logging Events
// ============================================================================

/**
 * Component source for logging events.
 * Each component writes to its own log file.
 *
 * - 'cli' → cli.log
 * - 'daemon' → sidekickd.log
 * - 'transcript' → transcript-events.log
 */
export type LogSource = 'cli' | 'daemon' | 'transcript'

/**
 * Context for logging events.
 * Provides correlation and tracing capabilities for observability.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §3.3 Log Record Format
 */
export interface EventLogContext {
  sessionId: string
  correlationId?: string
  traceId?: string
  hook?: string
  taskId?: string
}

/**
 * Base interface for all logging events.
 * These events are logged for observability but don't trigger handlers.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §3.3 Log Record Format
 * @see docs/design/flow.md §7 Logging Events
 */
export interface LoggingEventBase<P extends object = object> {
  /** Event type discriminator */
  type: string
  /** Unix timestamp (ms) - when the event occurred */
  time: number
  /** Which component emitted this event */
  source: LogSource
  /** Correlation context */
  context: EventLogContext
  /** Event-specific payload (flat structure — overridden in each subtype) */
  payload: P
}

// --- CLI-Logged Events (per docs/design/flow.md §7.1) ---

export interface HookReceivedEvent extends LoggingEventBase<HookReceivedPayload> {
  type: 'hook:received'
  source: 'cli'
  context: LoggingEventBase['context'] & {
    hook: string
  }
}

export interface ReminderConsumedEvent extends LoggingEventBase<ReminderConsumedPayload> {
  type: 'reminder:consumed'
  source: 'cli'
}

export interface HookCompletedEvent extends LoggingEventBase<HookCompletedPayload> {
  type: 'hook:completed'
  source: 'cli'
  context: LoggingEventBase['context'] & {
    hook: string
  }
}

// --- Daemon-Logged Events (per docs/design/flow.md §7.2) ---

export interface EventReceivedEvent extends LoggingEventBase<EventReceivedPayload> {
  type: 'event:received'
  source: 'daemon'
}

/**
 * Internal event: Event processing completed.
 * Emitted when a handler finishes processing an event.
 * (Renamed from HandlerExecuted for consistency with EventReceived)
 */
export interface EventProcessedEvent extends LoggingEventBase<EventProcessedPayload> {
  type: 'event:processed'
  source: 'daemon'
}

export interface ReminderStagedEvent extends LoggingEventBase<ReminderStagedPayload> {
  type: 'reminder:staged'
  source: 'daemon'
}

// --- Persona Events ---

/** Emitted when a persona is selected for a session. */
export interface PersonaSelectedEvent extends LoggingEventBase<PersonaSelectedPayload> {
  type: 'persona:selected'
  source: 'daemon'
}

/** Emitted when persona changes mid-session. */
export interface PersonaChangedEvent extends LoggingEventBase<PersonaChangedPayload> {
  type: 'persona:changed'
  source: 'daemon'
}

// --- Daemon Lifecycle Events ---

/**
 * Daemon process starting.
 * Emitted at the beginning of daemon initialization.
 */
export interface DaemonStartingEvent extends LoggingEventBase<DaemonStartingPayload> {
  type: 'daemon:starting'
  source: 'daemon'
}

/**
 * Daemon process started successfully.
 * Emitted when all daemon components are initialized.
 */
export interface DaemonStartedEvent extends LoggingEventBase<DaemonStartedPayload> {
  type: 'daemon:started'
  source: 'daemon'
}

/**
 * IPC server started and listening.
 * Emitted when Unix socket is ready to accept connections.
 */
export interface IpcServerStartedEvent extends LoggingEventBase<IpcStartedPayload> {
  type: 'ipc:started'
  source: 'daemon'
}

/**
 * Config watcher started.
 * Emitted when file watcher begins monitoring config files.
 */
export interface ConfigWatcherStartedEvent extends LoggingEventBase<ConfigWatcherStartedPayload> {
  type: 'config:watcher-started'
  source: 'daemon'
}

/**
 * Session eviction timer started.
 * Emitted when idle session cleanup timer is activated.
 */
export interface SessionEvictionStartedEvent extends LoggingEventBase<SessionEvictionStartedPayload> {
  type: 'session:eviction-started'
  source: 'daemon'
}

/** Emitted when session summary LLM generation begins. */
export interface SessionSummaryStartEvent extends LoggingEventBase<SessionSummaryStartPayload> {
  type: 'session-summary:start'
  source: 'daemon'
}

/** Emitted when session summary LLM generation completes. */
export interface SessionSummaryFinishEvent extends LoggingEventBase<SessionSummaryFinishPayload> {
  type: 'session-summary:finish'
  source: 'daemon'
}

/** Emitted when snarky message LLM generation begins. */
export interface SnarkyMessageStartEvent extends LoggingEventBase<SnarkyMessageStartPayload> {
  type: 'snarky-message:start'
  source: 'daemon'
}

/** Emitted when snarky message LLM generation completes. */
export interface SnarkyMessageFinishEvent extends LoggingEventBase<SnarkyMessageFinishPayload> {
  type: 'snarky-message:finish'
  source: 'daemon'
}

/** Emitted when session title changes (conditional on diff). */
export interface SessionTitleChangedEvent extends LoggingEventBase<SessionTitleChangedPayload> {
  type: 'session-title:changed'
  source: 'daemon'
}

/** Emitted when latest intent changes (conditional on diff). */
export interface IntentChangedEvent extends LoggingEventBase<IntentChangedPayload> {
  type: 'intent:changed'
  source: 'daemon'
}

/**
 * Internal event: Summary update skipped (countdown active)
 * Emitted when countdown threshold hasn't been reached and analysis is deferred.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.4
 */
export interface SummarySkippedEvent extends LoggingEventBase<SessionSummarySkippedPayload> {
  type: 'session-summary:skipped'
  source: 'daemon'
}

// --- Resume Events (per docs/design/FEATURE-RESUME.md §5.3) ---

/**
 * Internal event: Resume generation triggered.
 * Emitted when pivot is detected with sufficient confidence.
 *
 * @see docs/design/FEATURE-RESUME.md §5.3
 */
export interface ResumeGeneratingEvent extends LoggingEventBase<ResumeMessageStartPayload> {
  type: 'resume-message:start'
  source: 'daemon'
}

/**
 * Internal event: Resume artifact updated.
 * Emitted when resume-message.json is written successfully.
 *
 * @see docs/design/FEATURE-RESUME.md §5.3
 */
export interface ResumeUpdatedEvent extends LoggingEventBase<ResumeMessageFinishPayload> {
  type: 'resume-message:finish'
  source: 'daemon'
}

/**
 * Internal event: Resume generation skipped.
 * Emitted when conditions for resume generation are not met.
 *
 * @see docs/design/FEATURE-RESUME.md §5.3
 */
export interface ResumeSkippedEvent extends LoggingEventBase<ResumeMessageSkippedPayload> {
  type: 'resume-message:skipped'
  source: 'daemon'
}

export interface ReminderUnstagedEvent extends LoggingEventBase<ReminderUnstagedPayload> {
  type: 'reminder:unstaged'
  source: 'daemon'
}

export interface RemindersClearedEvent extends LoggingEventBase<ReminderClearedPayload> {
  type: 'reminder:cleared'
  source: 'daemon'
}

export interface ReminderNotStagedEvent extends LoggingEventBase<ReminderNotStagedPayload> {
  type: 'reminder:not-staged'
  source: 'daemon'
}

/** Emitted when an LLM decision is recorded (calling, skipped, etc.). */
export interface DecisionRecordedEvent extends LoggingEventBase<DecisionRecordedPayload> {
  type: 'decision:recorded'
  source: 'daemon'
}

// --- Statusline Events (per docs/design/FEATURE-STATUSLINE.md §8.5) ---

/**
 * Statusline rendered successfully.
 * Emitted when statusline produces output.
 *
 * @see docs/design/FEATURE-STATUSLINE.md §8.5
 */
export interface StatuslineRenderedEvent extends LoggingEventBase<StatuslineRenderedPayload> {
  type: 'statusline:rendered'
  source: 'cli'
}

/**
 * Statusline render error (graceful fallback used).
 * Emitted when statusline encounters an error but recovers with defaults.
 *
 * @see docs/design/FEATURE-STATUSLINE.md §8.5
 */
export interface StatuslineErrorEvent extends LoggingEventBase<StatuslineErrorPayload> {
  type: 'statusline:error'
  source: 'cli'
}

// --- Transcript Events (logged to transcript-events.log) ---

/**
 * Internal event: Transcript event emitted.
 * Emitted when TranscriptService detects and emits a transcript event.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §4.1
 */
export interface TranscriptEventEmittedEvent extends LoggingEventBase<TranscriptEmittedPayload> {
  type: 'transcript:emitted'
  source: 'transcript'
}

/**
 * Internal event: Pre-compact snapshot captured.
 * Emitted when CLI copies transcript before compaction.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §4.1
 */
export interface PreCompactCapturedEvent extends LoggingEventBase<TranscriptPreCompactPayload> {
  type: 'transcript:pre-compact'
  source: 'transcript'
}

/** Emitted when bulk transcript replay begins. */
export interface BulkProcessingStartEvent extends LoggingEventBase<BulkProcessingStartPayload> {
  type: 'bulk-processing:start'
  source: 'transcript'
}

/** Emitted when bulk transcript replay completes. */
export interface BulkProcessingFinishEvent extends LoggingEventBase<BulkProcessingFinishPayload> {
  type: 'bulk-processing:finish'
  source: 'transcript'
}

/**
 * Error occurred in daemon.
 * @see packages/sidekick-daemon/src/daemon.ts — HookableLogger error hook emits this event.
 */
export interface DaemonErrorOccurredEvent extends LoggingEventBase<ErrorOccurredPayload> {
  type: 'error:occurred'
  source: 'daemon'
}

/**
 * Error occurred in CLI.
 * Available for CLI error hook implementations.
 */
export interface CliErrorOccurredEvent extends LoggingEventBase<ErrorOccurredPayload> {
  type: 'error:occurred'
  source: 'cli'
}

/**
 * Union of daemon and CLI error events.
 * Use DaemonErrorOccurredEvent or CliErrorOccurredEvent for source-specific narrowing.
 */
export type ErrorOccurredEvent = DaemonErrorOccurredEvent | CliErrorOccurredEvent

/**
 * Union of all CLI logging events.
 */
export type CLILoggingEvent =
  | HookReceivedEvent
  | ReminderConsumedEvent
  | HookCompletedEvent
  | StatuslineRenderedEvent
  | StatuslineErrorEvent
  | CliErrorOccurredEvent

/**
 * Union of all Daemon logging events.
 */
export type DaemonLoggingEvent =
  | EventReceivedEvent
  | EventProcessedEvent
  | ReminderStagedEvent
  | ReminderUnstagedEvent
  | DaemonStartingEvent
  | DaemonStartedEvent
  | IpcServerStartedEvent
  | ConfigWatcherStartedEvent
  | SessionEvictionStartedEvent
  | SessionSummaryStartEvent
  | SessionSummaryFinishEvent
  | SnarkyMessageStartEvent
  | SnarkyMessageFinishEvent
  | SessionTitleChangedEvent
  | IntentChangedEvent
  | SummarySkippedEvent
  | ResumeGeneratingEvent
  | ResumeUpdatedEvent
  | ResumeSkippedEvent
  | RemindersClearedEvent
  | ReminderNotStagedEvent
  | DecisionRecordedEvent
  | PersonaSelectedEvent
  | PersonaChangedEvent
  | DaemonErrorOccurredEvent

/**
 * Union of transcript-related logging events.
 * These are written to a separate transcript-events.log file.
 */
export type TranscriptLoggingEvent =
  | TranscriptEventEmittedEvent
  | PreCompactCapturedEvent
  | BulkProcessingStartEvent
  | BulkProcessingFinishEvent

/**
 * Union of all logging events (internal, non-triggering).
 */
export type LoggingEvent = CLILoggingEvent | DaemonLoggingEvent | TranscriptLoggingEvent

// Type guards for logging events

export function isLoggingEvent(obj: unknown): obj is LoggingEvent {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    'time' in obj &&
    'source' in obj &&
    'context' in obj &&
    'payload' in obj
  )
}

export function isCLILoggingEvent(event: LoggingEvent): event is CLILoggingEvent {
  return event.source === 'cli'
}

export function isDaemonLoggingEvent(event: LoggingEvent): event is DaemonLoggingEvent {
  return event.source === 'daemon'
}

export function isTranscriptLoggingEvent(event: LoggingEvent): event is TranscriptLoggingEvent {
  return event.source === 'transcript'
}

// ============================================================================
// Per-Event Payload Interfaces (enriched payloads with optional nested state snapshots)
// ============================================================================

/** Payload for `reminder:staged` — a reminder was staged for a hook. */
export interface ReminderStagedPayload {
  reminderName: string
  hookName: string
  blocking: boolean
  priority: number
  persistent: boolean
  /** Why this reminder was staged */
  reason?: string
  /** What action triggered the staging */
  triggeredBy?: string
  /** For threshold-gated reminders: state at time of staging */
  thresholdState?: {
    current: number
    threshold: number
  }
  /** The rendered reminder text at time of staging (userMessage + additionalContext). */
  reminderText?: string
}

/** Payload for `reminder:unstaged` — a reminder was removed from staging. */
export interface ReminderUnstagedPayload {
  reminderName: string
  hookName: string
  reason: string
  /** What caused this unstaging */
  triggeredBy?: string
  /** For VC tool unstaging: the tool's state machine snapshot */
  toolState?: {
    status: 'staged' | 'verified' | 'cooldown'
    editsSinceVerified: number
  }
}

/** Payload for `reminder:consumed` — a reminder was consumed by a hook. */
export interface ReminderConsumedPayload {
  reminderName: string
  reminderReturned: boolean
  blocking?: boolean
  priority?: number
  persistent?: boolean
  /** The rendered reminder text that was injected into the conversation */
  renderedText?: string
  /** For verify-completion: the LLM classification result */
  classificationResult?: {
    category: string
    confidence: number
    shouldBlock: boolean
  }
}

/** Payload for `reminder:cleared` — reminders were bulk-cleared. */
export interface ReminderClearedPayload {
  clearedCount: number
  hookNames?: string[]
  reason: string
}

/** Payload for `reminder:not-staged` — a reminder was evaluated but not staged. */
export interface ReminderNotStagedPayload {
  /** Which reminder was evaluated. e.g., 'vc-build', 'pause-and-reflect' */
  reminderName: string
  /** Which hook triggered the evaluation */
  hookName: string
  /** Why staging was skipped */
  reason: string
  /** For threshold-gated decisions: the threshold value */
  threshold?: number
  /** For threshold-gated decisions: the current counter value */
  currentValue?: number
  /** What action triggered the evaluation */
  triggeredBy?: string
}

/** Payload for `decision:recorded` — a runtime decision was captured. */
export interface DecisionRecordedPayload {
  decision: string
  reason: string
  subsystem: string
  title: string
}

/**
 * Factory functions for creating decision:recorded logging events.
 * Centralized here so any feature package can emit decisions.
 */
export const DecisionEvents = {
  /** Emitted when a runtime decision is recorded. */
  decisionRecorded(context: EventLogContext, payload: DecisionRecordedPayload): DecisionRecordedEvent {
    return {
      type: 'decision:recorded',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload,
    }
  },
}

/** Payload for `session-summary:start` — LLM summary generation began. */
export interface SessionSummaryStartPayload {
  reason: string
  countdown: number
}

/** Payload for `session-summary:finish` — LLM summary generation completed. */
export interface SessionSummaryFinishPayload {
  session_title: string
  session_title_confidence: number
  latest_intent: string
  latest_intent_confidence: number
  processing_time_ms: number
  pivot_detected: boolean
}

/** Payload for `session-title:changed` — session title was updated. */
export interface SessionTitleChangedPayload {
  previousValue: string
  newValue: string
  confidence: number
}

/** Payload for `intent:changed` — latest intent was updated. */
export interface IntentChangedPayload {
  previousValue: string
  newValue: string
  confidence: number
}

/** Payload for `snarky-message:start` — snarky message generation began. */
export interface SnarkyMessageStartPayload {
  sessionId: string
}

/** Payload for `snarky-message:finish` — snarky message generation completed. */
export interface SnarkyMessageFinishPayload {
  generatedMessage: string
}

/** Payload for `resume-message:start` — resume message generation began. */
export interface ResumeMessageStartPayload {
  title_confidence: number
  intent_confidence: number
}

/** Payload for `resume-message:finish` — resume message generation completed. */
export interface ResumeMessageFinishPayload {
  snarky_comment: string
  timestamp: string
}

/** Payload for `persona:selected` — a persona was selected for a session. */
export interface PersonaSelectedPayload {
  personaId: string
  selectionMethod: 'pinned' | 'handoff' | 'random'
  poolSize: number
}

/** Payload for `persona:changed` — persona changed mid-session. */
export interface PersonaChangedPayload {
  personaFrom: string
  personaTo: string
  reason: string
}

/** Payload for `statusline:rendered` — statusline was rendered. */
export interface StatuslineRenderedPayload {
  displayMode: string
  staleData: boolean
  model?: string
  tokens?: number
  durationMs: number
  /** The rendered statusline text (ANSI codes stripped). */
  renderedText?: string
  /** Summary of hook input data from Claude Code. */
  hookInput?: Record<string, unknown>
}

/** Payload for `hook:received` — a hook event was received by the CLI. */
export interface HookReceivedPayload {
  hook: string
  cwd?: string
  mode?: string
  /** Hook-specific input fields (system fields stripped, values truncated). */
  input?: Record<string, unknown>
}

/** Payload for `hook:completed` — a hook event was processed by the CLI. */
export interface HookCompletedPayload {
  hook: string
  durationMs: number
  reminderReturned?: boolean
  responseType?: string
  /** Response returned to Claude Code (omitted if empty). Values truncated. */
  returnValue?: Record<string, unknown>
}

/** Payload for `event:received` — daemon received an event for processing. */
export interface EventReceivedPayload {
  eventKind: string
  eventType?: string
  hook?: string
}

/** Payload for `event:processed` — daemon finished processing an event. */
export interface EventProcessedPayload {
  handlerId: string
  success: boolean
  durationMs: number
  error?: string
}

/** Payload for `daemon:starting` — daemon process is starting. */
export interface DaemonStartingPayload {
  projectDir: string
  pid: number
}

/** Payload for `daemon:started` — daemon process started successfully. */
export interface DaemonStartedPayload {
  startupDurationMs: number
}

/** Payload for `ipc:started` — IPC server started listening. */
export interface IpcStartedPayload {
  socketPath: string
}

/** Payload for `config:watcher-started` — config watcher started. */
export interface ConfigWatcherStartedPayload {
  projectDir: string
  watchedFiles: string[]
}

/** Payload for `session:eviction-started` — session eviction timer started. */
export interface SessionEvictionStartedPayload {
  intervalMs: number
}

/** Payload for `session-summary:skipped` — summary update was skipped. */
export interface SessionSummarySkippedPayload {
  countdown: number
  countdown_threshold: number
  reason: string
}

/** Payload for `resume-message:skipped` — resume generation was skipped. */
export interface ResumeMessageSkippedPayload {
  title_confidence: number
  intent_confidence: number
  min_confidence: number
  reason: string
}

/** Payload for `statusline:error` — statusline render error. */
export interface StatuslineErrorPayload {
  reason: string
  file?: string
  fallbackUsed: boolean
  error?: string
}

/** Payload for `transcript:emitted` — transcript event emitted. */
export interface TranscriptEmittedPayload {
  eventType: string
  lineNumber: number
  uuid?: string
  toolName?: string
  transcriptPath?: string
  contentPreview?: string
  metrics?: TranscriptMetrics
}

/** Payload for `transcript:pre-compact` — pre-compact snapshot captured. */
export interface TranscriptPreCompactPayload {
  snapshotPath: string
  lineCount: number
  transcriptPath?: string
  metrics?: TranscriptMetrics
}

/** Payload for `bulk-processing:start` — transcript bulk replay starting. */
export interface BulkProcessingStartPayload {
  fileSize: number
}

/** Payload for `bulk-processing:finish` — transcript bulk replay completed. */
export interface BulkProcessingFinishPayload {
  totalLinesProcessed: number
  durationMs: number
}

/** Payload for `error:occurred` — a general error occurred. */
export interface ErrorOccurredPayload {
  errorMessage: string
  errorStack?: string
}
