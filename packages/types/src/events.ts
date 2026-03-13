/**
 * Event Model Type Definitions
 *
 * Discriminated union types for the Sidekick event system.
 * Defines hook events (from Claude Code) and transcript events (from file watching).
 *
 * @see docs/design/flow.md §3.2 Event Schema (source of truth)
 * @see docs/design/CORE-RUNTIME.md §3.5 Handler Registration
 */

// ============================================================================
// Event Context
// ============================================================================

/**
 * Base context shared by all events.
 * Provides correlation and tracing capabilities.
 */
export interface EventContext {
  /** Required: correlates all events in a session */
  sessionId: string
  /** Unix timestamp (ms) */
  timestamp: number
  /** Unique ID for the CLI command execution */
  correlationId?: string
  /** Links causally-related events (e.g., hook → handler → staged reminder) */
  traceId?: string
}

// ============================================================================
// Hook Events - from Claude Code
// ============================================================================

/**
 * All supported hook names as a const tuple.
 * Single source of truth for both the HookName type and Zod validation.
 */
export const HOOK_NAMES = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'PreCompact',
] as const

/**
 * All supported hook names.
 * Derived from Claude Code's hook system.
 */
export type HookName = (typeof HOOK_NAMES)[number]

export interface SessionStartHookEvent {
  kind: 'hook'
  hook: 'SessionStart'
  context: EventContext
  payload: {
    startType: 'startup' | 'resume' | 'clear' | 'compact'
    transcriptPath: string
  }
}

export interface SessionEndHookEvent {
  kind: 'hook'
  hook: 'SessionEnd'
  context: EventContext
  payload: {
    endReason: 'clear' | 'logout' | 'prompt_input_exit' | 'other'
  }
}

export interface UserPromptSubmitHookEvent {
  kind: 'hook'
  hook: 'UserPromptSubmit'
  context: EventContext
  payload: {
    /** User's prompt text */
    prompt: string
    /** Path to transcript file */
    transcriptPath: string
    /** Current working directory */
    cwd: string
    /** Permission mode (e.g., "default") */
    permissionMode: string
  }
}

export interface PreToolUseHookEvent {
  kind: 'hook'
  hook: 'PreToolUse'
  context: EventContext
  payload: {
    toolName: string
    toolInput: Record<string, unknown>
  }
}

export interface PostToolUseHookEvent {
  kind: 'hook'
  hook: 'PostToolUse'
  context: EventContext
  payload: {
    toolName: string
    toolInput: Record<string, unknown>
    toolResult: unknown
  }
}

export interface StopHookEvent {
  kind: 'hook'
  hook: 'Stop'
  context: EventContext
  payload: {
    /** Path to transcript file */
    transcriptPath: string
    /** Permission mode (e.g., "default") */
    permissionMode: string
    /** Whether stop hook is active */
    stopHookActive: boolean
  }
}

export interface PreCompactHookEvent {
  kind: 'hook'
  hook: 'PreCompact'
  context: EventContext
  payload: {
    /** Path to current transcript */
    transcriptPath: string
    /** Path where CLI copied snapshot */
    transcriptSnapshotPath: string
  }
}

/**
 * Union of all hook event types.
 * Discriminated by the `hook` field.
 */
export type HookEvent =
  | SessionStartHookEvent
  | SessionEndHookEvent
  | UserPromptSubmitHookEvent
  | PreToolUseHookEvent
  | PostToolUseHookEvent
  | StopHookEvent
  | PreCompactHookEvent

// ============================================================================
// Transcript Events - from file watching
// ============================================================================

/**
 * Transcript event types emitted by TranscriptService.
 */
export type TranscriptEventType =
  | 'UserPrompt'
  | 'AssistantMessage'
  | 'ToolCall'
  | 'ToolResult'
  | 'Compact'
  | 'BulkProcessingComplete'

/**
 * Raw transcript entry from JSONL file.
 * Structure varies by entry type.
 */
export type TranscriptEntry = Record<string, unknown>

/**
 * Token usage metrics extracted from native transcript metadata.
 * Cumulative totals across session.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md §3.1, §3.4
 */
export interface TokenUsageMetrics {
  /** Sum of usage.input_tokens across all assistant responses */
  inputTokens: number
  /** Sum of usage.output_tokens across all assistant responses */
  outputTokens: number
  /** inputTokens + outputTokens */
  totalTokens: number

  // Cache metrics (critical for cost analysis)
  /** Sum of cache_creation_input_tokens */
  cacheCreationInputTokens: number
  /** Sum of cache_read_input_tokens (cache hits) */
  cacheReadInputTokens: number

  /** Cache tier breakdown */
  cacheTiers: {
    /** cache_creation.ephemeral_5m_input_tokens */
    ephemeral5mInputTokens: number
    /** cache_creation.ephemeral_1h_input_tokens */
    ephemeral1hInputTokens: number
  }

  /** Service tier tracking (for cost/performance analysis) */
  serviceTierCounts: Record<string, number>

  /** Per-model breakdown (sessions may span model switches) */
  byModel: Record<
    string,
    {
      inputTokens: number
      outputTokens: number
      requestCount: number
    }
  >
}

/**
 * Full transcript metrics schema.
 * Single source of truth for transcript-derived metrics.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md §3.1
 */
export interface TranscriptMetrics {
  // Turn-level metrics
  /** Total user prompts in session */
  turnCount: number
  /** Tools since last UserPrompt (reset on UserPrompt) */
  toolsThisTurn: number

  // Session-level metrics
  /** Total tool invocations across session */
  toolCount: number
  /** Total messages (user + assistant + system) */
  messageCount: number

  // Token metrics (extracted from native transcript metadata)
  /** Token usage metrics from API responses (cumulative, never resets) */
  tokenUsage: TokenUsageMetrics

  /**
   * Current context window tokens (resets on compact).
   * Calculated from API usage: input_tokens + cache_creation_input_tokens + cache_read_input_tokens.
   * Unlike tokenUsage which tracks cumulative totals for cost analysis,
   * this tracks the actual tokens in the current context window.
   *
   * - null: New session (no usage blocks yet) or post-compact indeterminate state
   * - number: Actual context window size from last API response
   */
  currentContextTokens: number | null

  /**
   * True after compact_boundary detected until first usage block arrives.
   * When true, statusline should show placeholder (e.g., "⟳ compacted").
   */
  isPostCompactIndeterminate: boolean

  // Derived ratios
  /** Average tools per turn (toolCount / turnCount) */
  toolsPerTurn: number

  // Watermarks
  /** Line number of last processed transcript entry */
  lastProcessedLine: number
  /** Timestamp of last metrics update (Unix ms) */
  lastUpdatedAt: number
}

/**
 * Transcript events emitted by TranscriptService when file changes detected.
 * TranscriptService updates internal state BEFORE emitting, so embedded
 * metrics reflect current state including this event.
 */
export interface TranscriptEvent {
  kind: 'transcript'
  eventType: TranscriptEventType
  context: EventContext
  payload: {
    /** Line in transcript file */
    lineNumber: number
    /** Raw JSONL entry */
    entry: TranscriptEntry
    /** Parsed content (if applicable) */
    content?: string
    /** For ToolCall/ToolResult events */
    toolName?: string
  }
  metadata: {
    /** Absolute path to transcript file */
    transcriptPath: string
    /** Snapshot of current metrics (after this event) */
    metrics: TranscriptMetrics
    /** True when replaying historical transcript data (first-time processing) */
    isBulkProcessing?: boolean
  }
}

// ============================================================================
// Unified Event Type
// ============================================================================

/**
 * Discriminated union of all Sidekick events.
 * Use `isHookEvent()` and `isTranscriptEvent()` for type narrowing.
 */
export type SidekickEvent = HookEvent | TranscriptEvent

// ============================================================================
// Type Guards
// ============================================================================

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

// Hook-specific type guards (for use after isHookEvent check)

export function isSessionStartEvent(event: HookEvent): event is SessionStartHookEvent {
  return event.hook === 'SessionStart'
}

export function isSessionEndEvent(event: HookEvent): event is SessionEndHookEvent {
  return event.hook === 'SessionEnd'
}

export function isUserPromptSubmitEvent(event: HookEvent): event is UserPromptSubmitHookEvent {
  return event.hook === 'UserPromptSubmit'
}

export function isPreToolUseEvent(event: HookEvent): event is PreToolUseHookEvent {
  return event.hook === 'PreToolUse'
}

export function isPostToolUseEvent(event: HookEvent): event is PostToolUseHookEvent {
  return event.hook === 'PostToolUse'
}

export function isStopEvent(event: HookEvent): event is StopHookEvent {
  return event.hook === 'Stop'
}

export function isPreCompactEvent(event: HookEvent): event is PreCompactHookEvent {
  return event.hook === 'PreCompact'
}

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

/**
 * Error occurred in daemon.
 * Emitted automatically by HookableLogger on error/fatal log calls.
 */
export interface DaemonErrorOccurredEvent extends LoggingEventBase<ErrorOccurredPayload> {
  type: 'error:occurred'
  source: 'daemon'
}

/**
 * Error occurred in CLI.
 * Emitted automatically by HookableLogger on error/fatal log calls.
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
  | DecisionRecordedEvent
  | PersonaSelectedEvent
  | PersonaChangedEvent
  | DaemonErrorOccurredEvent

/**
 * Union of transcript-related logging events.
 * These are written to a separate transcript-events.log file.
 */
export type TranscriptLoggingEvent = TranscriptEventEmittedEvent | PreCompactCapturedEvent

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
// Canonical UI Event Types
// ============================================================================
//
// Unified event vocabulary for the Sidekick monitoring UI.
// Uses `category:action` naming convention. Payloads are FLAT (no state/metadata nesting).
//
// @see packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md §2.2–2.4

/**
 * Event visibility determines where the event is rendered in the UI.
 * - `timeline`: Main timeline panel (user-visible state changes)
 * - `log`: Log viewer panel only (internal machinery)
 * - `both`: Both timeline and log viewer
 */
export type EventVisibility = 'timeline' | 'log' | 'both'

/**
 * All 31 canonical UI event type names as a const tuple.
 * Single source of truth for both the UIEventType union and runtime validation.
 */
export const UI_EVENT_TYPES = [
  // Reminder events
  'reminder:staged',
  'reminder:unstaged',
  'reminder:consumed',
  'reminder:cleared',
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
  // General error
  'error:occurred',
] as const

/**
 * Union of all canonical UI event type names.
 * Derived from the UI_EVENT_TYPES const tuple.
 */
export type UIEventType = (typeof UI_EVENT_TYPES)[number]

// ============================================================================
// Per-Event Payload Interfaces (flat structure)
// ============================================================================

/** Payload for `reminder:staged` — a reminder was staged for a hook. */
export interface ReminderStagedPayload {
  reminderName: string
  hookName: string
  blocking: boolean
  priority: number
  persistent: boolean
}

/** Payload for `reminder:unstaged` — a reminder was removed from staging. */
export interface ReminderUnstagedPayload {
  reminderName: string
  hookName: string
  reason: string
}

/** Payload for `reminder:consumed` — a reminder was consumed by a hook. */
export interface ReminderConsumedPayload {
  reminderName: string
  reminderReturned: boolean
  blocking?: boolean
  priority?: number
  persistent?: boolean
}

/** Payload for `reminder:cleared` — reminders were bulk-cleared. */
export interface ReminderClearedPayload {
  clearedCount: number
  hookNames?: string[]
  reason: string
}

/** Payload for `decision:recorded` — an LLM decision was captured. */
export interface DecisionRecordedPayload {
  decision: string
  reason: string
  detail: string
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
}

/** Payload for `hook:received` — a hook event was received by the CLI. */
export interface HookReceivedPayload {
  hook: string
  cwd?: string
  mode?: string
}

/** Payload for `hook:completed` — a hook event was processed by the CLI. */
export interface HookCompletedPayload {
  hook: string
  durationMs: number
  reminderReturned?: boolean
  responseType?: string
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

/** Payload for `error:occurred` — a general error occurred. */
export interface ErrorOccurredPayload {
  errorMessage: string
  errorStack?: string
}

// ============================================================================
// Payload Mapping (UIEventType → Payload Interface)
// ============================================================================

/**
 * Maps each UIEventType to its corresponding payload interface.
 */
export interface UIEventPayloadMap {
  'reminder:staged': ReminderStagedPayload
  'reminder:unstaged': ReminderUnstagedPayload
  'reminder:consumed': ReminderConsumedPayload
  'reminder:cleared': ReminderClearedPayload
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
} as const satisfies Record<UIEventType, EventVisibility>
