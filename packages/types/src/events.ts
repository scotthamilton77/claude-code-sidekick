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
  /** Which scope this event occurred in */
  scope?: 'project' | 'user'
  /** Unique ID for the CLI command execution */
  correlationId?: string
  /** Links causally-related events (e.g., hook → handler → staged reminder) */
  traceId?: string
}

// ============================================================================
// Hook Events - from Claude Code
// ============================================================================

/**
 * All supported hook names.
 * Derived from Claude Code's hook system.
 */
export type HookName =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'PreCompact'

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
 * - 'supervisor' → supervisor.log
 * - 'transcript' → transcript-events.log
 */
export type LogSource = 'cli' | 'supervisor' | 'transcript'

/**
 * Base interface for all logging events.
 * These events are logged for observability but don't trigger handlers.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §3.3 Log Record Format
 * @see docs/design/flow.md §7 Logging Events
 */
export interface LoggingEventBase {
  /** Event type discriminator */
  type: string
  /** Unix timestamp (ms) - when the event occurred */
  time: number
  /** Which component emitted this event */
  source: LogSource
  /** Correlation context */
  context: {
    sessionId: string
    scope?: 'project' | 'user'
    correlationId?: string
    traceId?: string
    hook?: string
    taskId?: string
  }
  /** Event-specific payload */
  payload: {
    state?: Record<string, unknown>
    metadata?: Record<string, unknown>
    reason?: string
  }
}

// --- CLI-Logged Events (per docs/design/flow.md §7.1) ---

export interface HookReceivedEvent extends LoggingEventBase {
  type: 'HookReceived'
  source: 'cli'
  context: LoggingEventBase['context'] & {
    hook: string
  }
  payload: {
    metadata: {
      cwd?: string
      mode?: 'hook' | 'interactive'
    }
  }
}

export interface ReminderConsumedEvent extends LoggingEventBase {
  type: 'ReminderConsumed'
  source: 'cli'
  payload: {
    state: {
      reminderName: string
      reminderReturned: boolean
      blocking?: boolean
      priority?: number
      persistent?: boolean
    }
    metadata?: {
      stagingPath?: string
    }
  }
}

export interface HookCompletedEvent extends LoggingEventBase {
  type: 'HookCompleted'
  source: 'cli'
  context: LoggingEventBase['context'] & {
    hook: string
  }
  payload: {
    state?: {
      reminderReturned?: boolean
      responseType?: string
    }
    metadata: {
      durationMs: number
    }
  }
}

// --- Supervisor-Logged Events (per docs/design/flow.md §7.2) ---

export interface EventReceivedEvent extends LoggingEventBase {
  type: 'EventReceived'
  source: 'supervisor'
  payload: {
    metadata: {
      eventKind: 'hook' | 'transcript'
      eventType?: string
      hook?: string
    }
  }
}

/**
 * Internal event: Event processing completed.
 * Emitted when a handler finishes processing an event.
 * (Renamed from HandlerExecuted for consistency with EventReceived)
 */
export interface EventProcessedEvent extends LoggingEventBase {
  type: 'EventProcessed'
  source: 'supervisor'
  payload: {
    state: {
      handlerId: string
      success: boolean
      stopped?: boolean
    }
    metadata: {
      durationMs: number
      error?: string
    }
  }
}

export interface ReminderStagedEvent extends LoggingEventBase {
  type: 'ReminderStaged'
  source: 'supervisor'
  payload: {
    state: {
      reminderName: string
      hookName: string
      blocking: boolean
      priority: number
      persistent: boolean
    }
    metadata?: {
      stagingPath?: string
    }
  }
}

/**
 * Internal event: Summary recalculated successfully
 * Emitted when session summary is updated via LLM analysis.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.4
 */
export interface SummaryUpdatedEvent extends LoggingEventBase {
  type: 'SummaryUpdated'
  source: 'supervisor'
  payload: {
    state: {
      session_title: string
      session_title_confidence: number
      latest_intent: string
      latest_intent_confidence: number
    }
    metadata: {
      countdown_reset_to: number
      tokens_used?: number
      processing_time_ms?: number
      pivot_detected: boolean
      old_title?: string
      old_intent?: string
    }
    reason: 'user_prompt_forced' | 'countdown_reached' | 'compaction_reset'
  }
}

/**
 * Internal event: Summary update skipped (countdown active)
 * Emitted when countdown threshold hasn't been reached and analysis is deferred.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.4
 */
export interface SummarySkippedEvent extends LoggingEventBase {
  type: 'SummarySkipped'
  source: 'supervisor'
  payload: {
    metadata: {
      countdown: number
      countdown_threshold: number
    }
    reason: 'countdown_active'
  }
}

// --- Resume Events (per docs/design/FEATURE-RESUME.md §5.3) ---

/**
 * Internal event: Resume generation triggered.
 * Emitted when pivot is detected with sufficient confidence.
 *
 * @see docs/design/FEATURE-RESUME.md §5.3
 */
export interface ResumeGeneratingEvent extends LoggingEventBase {
  type: 'ResumeGenerating'
  source: 'supervisor'
  payload: {
    metadata: {
      title_confidence: number
      intent_confidence: number
    }
    reason: 'pivot_detected'
  }
}

/**
 * Internal event: Resume artifact updated.
 * Emitted when resume-message.json is written successfully.
 *
 * @see docs/design/FEATURE-RESUME.md §5.3
 */
export interface ResumeUpdatedEvent extends LoggingEventBase {
  type: 'ResumeUpdated'
  source: 'supervisor'
  payload: {
    state: {
      resume_last_goal_message: string
      snarky_comment: string
      timestamp: string
    }
    reason: 'generation_complete'
  }
}

/**
 * Internal event: Resume generation skipped.
 * Emitted when conditions for resume generation are not met.
 *
 * @see docs/design/FEATURE-RESUME.md §5.3
 */
export interface ResumeSkippedEvent extends LoggingEventBase {
  type: 'ResumeSkipped'
  source: 'supervisor'
  payload: {
    metadata: {
      title_confidence: number
      intent_confidence: number
      min_confidence: number
    }
    reason: 'confidence_below_threshold' | 'no_pivot_detected'
  }
}

export interface RemindersClearedEvent extends LoggingEventBase {
  type: 'RemindersCleared'
  source: 'supervisor'
  payload: {
    state: {
      clearedCount: number
      hookNames?: string[]
    }
    reason: 'session_start' | 'manual'
  }
}

// --- Statusline Events (per docs/design/FEATURE-STATUSLINE.md §8.5) ---

/**
 * Statusline rendered successfully.
 * Emitted when statusline produces output.
 *
 * @see docs/design/FEATURE-STATUSLINE.md §8.5
 */
export interface StatuslineRenderedEvent extends LoggingEventBase {
  type: 'StatuslineRendered'
  source: 'cli'
  payload: {
    state: {
      displayMode: 'session_summary' | 'resume_message' | 'first_prompt' | 'empty_summary'
      staleData: boolean
    }
    metadata: {
      model?: string
      tokens?: number
      durationMs: number
    }
  }
}

/**
 * Statusline render error (graceful fallback used).
 * Emitted when statusline encounters an error but recovers with defaults.
 *
 * @see docs/design/FEATURE-STATUSLINE.md §8.5
 */
export interface StatuslineErrorEvent extends LoggingEventBase {
  type: 'StatuslineError'
  source: 'cli'
  payload: {
    reason: 'state_file_missing' | 'parse_error' | 'git_timeout' | 'unknown'
    metadata: {
      file?: string
      fallbackUsed: boolean
      error?: string
    }
  }
}

// --- Transcript Events (logged to transcript-events.log) ---

/**
 * Internal event: Transcript event emitted.
 * Emitted when TranscriptService detects and emits a transcript event.
 *
 * @see docs/design/MONITORING-UI.md §4.1
 */
export interface TranscriptEventEmittedEvent extends LoggingEventBase {
  type: 'TranscriptEventEmitted'
  source: 'transcript'
  payload: {
    state: {
      eventType: TranscriptEventType
      lineNumber: number
      /** UUID of the transcript line for quick lookup */
      uuid?: string
      toolName?: string
    }
    metadata: {
      transcriptPath: string
      contentPreview?: string // Truncated for logging
      metrics: TranscriptMetrics
    }
  }
}

/**
 * Internal event: Pre-compact snapshot captured.
 * Emitted when CLI copies transcript before compaction.
 *
 * @see docs/design/MONITORING-UI.md §4.1
 */
export interface PreCompactCapturedEvent extends LoggingEventBase {
  type: 'PreCompactCaptured'
  source: 'transcript'
  payload: {
    state: {
      snapshotPath: string
      lineCount: number
    }
    metadata: {
      transcriptPath: string
      metrics: TranscriptMetrics
    }
    reason: 'pre_compact_hook'
  }
}

/**
 * Union of all CLI logging events.
 */
export type CLILoggingEvent =
  | HookReceivedEvent
  | ReminderConsumedEvent
  | HookCompletedEvent
  | StatuslineRenderedEvent
  | StatuslineErrorEvent

/**
 * Union of all Supervisor logging events.
 */
export type SupervisorLoggingEvent =
  | EventReceivedEvent
  | EventProcessedEvent
  | ReminderStagedEvent
  | SummaryUpdatedEvent
  | SummarySkippedEvent
  | ResumeGeneratingEvent
  | ResumeUpdatedEvent
  | ResumeSkippedEvent
  | RemindersClearedEvent

/**
 * Union of transcript-related logging events.
 * These are written to a separate transcript-events.log file.
 */
export type TranscriptLoggingEvent = TranscriptEventEmittedEvent | PreCompactCapturedEvent

/**
 * Union of all logging events (internal, non-triggering).
 */
export type LoggingEvent = CLILoggingEvent | SupervisorLoggingEvent | TranscriptLoggingEvent

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

export function isSupervisorLoggingEvent(event: LoggingEvent): event is SupervisorLoggingEvent {
  return event.source === 'supervisor'
}

export function isTranscriptLoggingEvent(event: LoggingEvent): event is TranscriptLoggingEvent {
  return event.source === 'transcript'
}
