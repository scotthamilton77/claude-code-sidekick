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
export type TranscriptEventType = 'UserPrompt' | 'AssistantMessage' | 'ToolCall' | 'ToolResult' | 'Compact'

/**
 * Raw transcript entry from JSONL file.
 * Structure varies by entry type.
 */
export type TranscriptEntry = Record<string, unknown>

/**
 * Metrics snapshot embedded in TranscriptEvent.
 * Subset of full TranscriptMetrics for event payload.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md §3.1 for full schema
 */
export interface TranscriptMetrics {
  /** Total user prompts in session */
  turnCount: number
  /** Total tool invocations in session */
  toolCount: number
  /** Tools since last UserPrompt */
  toolsThisTurn: number
  /** Estimated total tokens in transcript */
  totalTokens: number
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
 */
export type LogSource = 'cli' | 'supervisor'

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

export interface HandlerExecutedEvent extends LoggingEventBase {
  type: 'HandlerExecuted'
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

export interface SummaryUpdatedEvent extends LoggingEventBase {
  type: 'SummaryUpdated'
  source: 'supervisor'
  payload: {
    state?: {
      previousSummary?: string
      newSummary?: string
    }
    reason: string
    metadata?: {
      durationMs?: number
      tokenCount?: number
    }
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

/**
 * Union of all CLI logging events.
 */
export type CLILoggingEvent = HookReceivedEvent | ReminderConsumedEvent | HookCompletedEvent

/**
 * Union of all Supervisor logging events.
 */
export type SupervisorLoggingEvent =
  | EventReceivedEvent
  | HandlerExecutedEvent
  | ReminderStagedEvent
  | SummaryUpdatedEvent
  | RemindersClearedEvent

/**
 * Union of all logging events (internal, non-triggering).
 */
export type LoggingEvent = CLILoggingEvent | SupervisorLoggingEvent

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
