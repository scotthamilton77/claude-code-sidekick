/**
 * Structured Logging Event Factories
 *
 * Domain-specific event factory functions for creating properly-typed logging events.
 * Extracted from structured-logging.ts to separate domain event concerns from
 * Pino logging infrastructure.
 *
 * These events are logged for observability but don't trigger handlers.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §3.4-3.5
 * @see docs/design/flow.md §7 Logging Events
 */

import type { Logger } from '@sidekick/types'
import type { SessionLogWriter } from './session-log-writer'

/** Module-level reference to the session log writer. Set by daemon/CLI during init. */
let sessionLogWriter: SessionLogWriter | null = null

/**
 * Set the SessionLogWriter instance for per-session log routing.
 * Call with null to disable.
 */
export function setSessionLogWriter(writer: SessionLogWriter | null): void {
  sessionLogWriter = writer
}

import type {
  HookReceivedEvent,
  HookCompletedEvent,
  EventReceivedEvent,
  EventProcessedEvent,
  ReminderStagedEvent,
  DaemonStartingEvent,
  DaemonStartedEvent,
  IpcServerStartedEvent,
  ConfigWatcherStartedEvent,
  SessionEvictionStartedEvent,
  ResumeGeneratingEvent,
  ResumeUpdatedEvent,
  ResumeSkippedEvent,
  PersonaSelectedEvent,
  PersonaChangedEvent,
  StatuslineRenderedEvent,
  StatuslineErrorEvent,
  TranscriptEventEmittedEvent,
  PreCompactCapturedEvent,
  DaemonErrorOccurredEvent,
  CliErrorOccurredEvent,
  BulkProcessingStartEvent,
  BulkProcessingFinishEvent,
  LoggingEventBase,
  TranscriptEventType,
  TranscriptMetrics,
  EventLogContext,
  PersonaSelectedPayload,
  PersonaChangedPayload,
} from '@sidekick/types'

// Re-export for backward compatibility
export type { EventLogContext } from '@sidekick/types'

/** Pick only the context fields needed for logging events. */
function buildContext(ctx: EventLogContext): EventLogContext {
  return {
    sessionId: ctx.sessionId,
    correlationId: ctx.correlationId,
    traceId: ctx.traceId,
    hook: ctx.hook,
    taskId: ctx.taskId,
  }
}

/** Sentinel context for daemon lifecycle events emitted before any session exists. */
const EMPTY_CONTEXT: EventLogContext = { sessionId: '' }

/**
 * Factory functions for creating properly-typed logging events.
 * These events are logged for observability but don't trigger handlers.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §3.4-3.5
 * @see docs/design/flow.md §7 Logging Events
 */
/* v8 ignore start -- pure data factories with deterministic structure, tested via integration */
export const LogEvents = {
  // --- CLI Events ---

  /**
   * Create a HookReceived event (logged when CLI receives a hook invocation).
   */
  hookReceived(
    context: EventLogContext & { hook: string },
    metadata: { cwd?: string; mode?: 'hook' | 'interactive'; input?: Record<string, unknown> }
  ): HookReceivedEvent {
    return {
      type: 'hook:received',
      time: Date.now(),
      source: 'cli',
      context: { ...buildContext(context), hook: context.hook },
      payload: {
        hook: context.hook,
        cwd: metadata.cwd,
        mode: metadata.mode,
        input: metadata.input,
      },
    }
  },

  /**
   * Create a HookCompleted event (logged when CLI finishes hook processing).
   */
  hookCompleted(
    context: EventLogContext & { hook: string },
    metadata: { durationMs: number },
    state?: { reminderReturned?: boolean; responseType?: string; returnValue?: Record<string, unknown> }
  ): HookCompletedEvent {
    return {
      type: 'hook:completed',
      time: Date.now(),
      source: 'cli',
      context: { ...buildContext(context), hook: context.hook },
      payload: {
        hook: context.hook,
        durationMs: metadata.durationMs,
        reminderReturned: state?.reminderReturned,
        responseType: state?.responseType,
        returnValue: state?.returnValue,
      },
    }
  },

  // --- Daemon Events ---

  /**
   * Create an EventReceived event (logged when Daemon receives IPC event from CLI).
   */
  eventReceived(
    context: EventLogContext,
    metadata: { eventKind: 'hook' | 'transcript'; eventType?: string; hook?: string }
  ): EventReceivedEvent {
    return {
      type: 'event:received',
      time: Date.now(),
      source: 'daemon',
      context: buildContext(context),
      payload: {
        eventKind: metadata.eventKind,
        ...(metadata.eventType !== undefined && { eventType: metadata.eventType }),
        ...(metadata.hook !== undefined && { hook: metadata.hook }),
      },
    }
  },

  /**
   * Create an EventProcessed event (logged when a handler completes).
   * (Renamed from handlerExecuted for consistency with eventReceived)
   */
  eventProcessed(
    context: EventLogContext,
    state: { handlerId: string; success: boolean },
    metadata: { durationMs: number; error?: string }
  ): EventProcessedEvent {
    return {
      type: 'event:processed',
      time: Date.now(),
      source: 'daemon',
      context: buildContext(context),
      payload: {
        handlerId: state.handlerId,
        success: state.success,
        durationMs: metadata.durationMs,
        error: metadata.error,
      },
    }
  },

  /**
   * Create a ReminderStaged event (logged when Daemon stages a reminder file).
   */
  reminderStaged(
    context: EventLogContext,
    state: {
      reminderName: string
      hookName: string
      blocking: boolean
      priority: number
      persistent: boolean
      reason?: string
      triggeredBy?: string
      thresholdState?: { current: number; threshold: number }
      reminderText?: string
    },
    _metadata?: { stagingPath?: string }
  ): ReminderStagedEvent {
    return {
      type: 'reminder:staged',
      time: Date.now(),
      source: 'daemon',
      context: buildContext(context),
      payload: {
        reminderName: state.reminderName,
        hookName: state.hookName,
        blocking: state.blocking,
        priority: state.priority,
        persistent: state.persistent,
        ...(state.reason !== undefined && { reason: state.reason }),
        ...(state.triggeredBy !== undefined && { triggeredBy: state.triggeredBy }),
        ...(state.thresholdState !== undefined && { thresholdState: state.thresholdState }),
        ...(state.reminderText !== undefined && { reminderText: state.reminderText }),
      },
    }
  },

  // --- Daemon Lifecycle Events ---

  /**
   * Create a DaemonStarting event (logged at beginning of daemon initialization).
   */
  daemonStarting(metadata: { projectDir: string; pid: number }): DaemonStartingEvent {
    return {
      type: 'daemon:starting',
      time: Date.now(),
      source: 'daemon',
      context: EMPTY_CONTEXT,
      payload: {
        projectDir: metadata.projectDir,
        pid: metadata.pid,
      },
    }
  },

  /**
   * Create a DaemonStarted event (logged when daemon initialization completes).
   */
  daemonStarted(metadata: { startupDurationMs: number }): DaemonStartedEvent {
    return {
      type: 'daemon:started',
      time: Date.now(),
      source: 'daemon',
      context: EMPTY_CONTEXT,
      payload: {
        startupDurationMs: metadata.startupDurationMs,
      },
    }
  },

  /**
   * Create an IpcServerStarted event (logged when Unix socket is ready).
   */
  ipcServerStarted(metadata: { socketPath: string }): IpcServerStartedEvent {
    return {
      type: 'ipc:started',
      time: Date.now(),
      source: 'daemon',
      context: EMPTY_CONTEXT,
      payload: {
        socketPath: metadata.socketPath,
      },
    }
  },

  /**
   * Create a ConfigWatcherStarted event (logged when file watcher starts).
   */
  configWatcherStarted(metadata: { projectDir: string; watchedFiles: string[] }): ConfigWatcherStartedEvent {
    return {
      type: 'config:watcher-started',
      time: Date.now(),
      source: 'daemon',
      context: EMPTY_CONTEXT,
      payload: {
        projectDir: metadata.projectDir,
        watchedFiles: metadata.watchedFiles,
      },
    }
  },

  /**
   * Create a SessionEvictionStarted event (logged when cleanup timer starts).
   */
  sessionEvictionStarted(metadata: { intervalMs: number }): SessionEvictionStartedEvent {
    return {
      type: 'session:eviction-started',
      time: Date.now(),
      source: 'daemon',
      context: EMPTY_CONTEXT,
      payload: {
        intervalMs: metadata.intervalMs,
      },
    }
  },

  // --- Statusline Events ---

  /**
   * Create a StatuslineRendered event (logged when statusline renders successfully).
   * @see docs/design/FEATURE-STATUSLINE.md §8.5
   */
  statuslineRendered(
    context: EventLogContext,
    state: {
      displayMode: 'session_summary' | 'resume_message' | 'empty_summary' | 'setup_warning'
      staleData: boolean
    },
    metadata: {
      model?: string
      tokens?: number
      durationMs: number
      renderedText?: string
      hookInput?: Record<string, unknown>
    }
  ): StatuslineRenderedEvent {
    return {
      type: 'statusline:rendered',
      time: Date.now(),
      source: 'cli',
      context: buildContext(context),
      payload: {
        displayMode: state.displayMode,
        staleData: state.staleData,
        model: metadata.model,
        tokens: metadata.tokens,
        durationMs: metadata.durationMs,
        ...(metadata.renderedText !== undefined && { renderedText: metadata.renderedText }),
        ...(metadata.hookInput !== undefined && { hookInput: metadata.hookInput }),
      },
    }
  },

  /**
   * Create a StatuslineError event (logged when statusline render fails with fallback).
   * @see docs/design/FEATURE-STATUSLINE.md §8.5
   */
  statuslineError(
    context: EventLogContext,
    reason: 'state_file_missing' | 'parse_error' | 'git_timeout' | 'unknown',
    metadata: {
      file?: string
      fallbackUsed: boolean
      error?: string
    }
  ): StatuslineErrorEvent {
    return {
      type: 'statusline:error',
      time: Date.now(),
      source: 'cli',
      context: buildContext(context),
      payload: {
        reason,
        file: metadata.file,
        fallbackUsed: metadata.fallbackUsed,
        error: metadata.error,
      },
    }
  },

  // --- Resume Events ---

  /**
   * Create a ResumeGenerating event (logged when resume generation starts).
   * @see docs/design/FEATURE-RESUME.md §5.3
   */
  resumeGenerating(
    context: EventLogContext,
    metadata: {
      title_confidence: number
      intent_confidence: number
    }
  ): ResumeGeneratingEvent {
    return {
      type: 'resume-message:start',
      time: Date.now(),
      source: 'daemon',
      context: buildContext(context),
      payload: {
        title_confidence: metadata.title_confidence,
        intent_confidence: metadata.intent_confidence,
      },
    }
  },

  /**
   * Create a ResumeUpdated event (logged when resume artifact is written).
   * @see docs/design/FEATURE-RESUME.md §5.3
   */
  resumeUpdated(
    context: EventLogContext,
    state: {
      snarky_comment: string
      timestamp: string
    }
  ): ResumeUpdatedEvent {
    return {
      type: 'resume-message:finish',
      time: Date.now(),
      source: 'daemon',
      context: buildContext(context),
      payload: {
        snarky_comment: state.snarky_comment,
        timestamp: state.timestamp,
      },
    }
  },

  /**
   * Create a ResumeSkipped event (logged when resume generation is skipped).
   * @see docs/design/FEATURE-RESUME.md §5.3
   */
  resumeSkipped(
    context: EventLogContext,
    metadata: {
      title_confidence: number
      intent_confidence: number
      min_confidence: number
    },
    reason: 'confidence_below_threshold' | 'no_pivot_detected'
  ): ResumeSkippedEvent {
    return {
      type: 'resume-message:skipped',
      time: Date.now(),
      source: 'daemon',
      context: buildContext(context),
      payload: {
        title_confidence: metadata.title_confidence,
        intent_confidence: metadata.intent_confidence,
        min_confidence: metadata.min_confidence,
        reason,
      },
    }
  },

  // --- Persona Events ---

  /**
   * Create a PersonaSelected event (logged when a persona is selected for a session).
   */
  personaSelected(context: EventLogContext, payload: PersonaSelectedPayload): PersonaSelectedEvent {
    return {
      type: 'persona:selected',
      time: Date.now(),
      source: 'daemon',
      context: buildContext(context),
      payload,
    }
  },

  /**
   * Create a PersonaChanged event (logged when persona changes mid-session).
   */
  personaChanged(context: EventLogContext, payload: PersonaChangedPayload): PersonaChangedEvent {
    return {
      type: 'persona:changed',
      time: Date.now(),
      source: 'daemon',
      context: buildContext(context),
      payload,
    }
  },

  // --- Transcript Events (logged to transcript-events.log) ---

  /**
   * Create a TranscriptEventEmitted event (logged when TranscriptService emits an event).
   * @see packages/sidekick-ui/docs/MONITORING-UI.md §4.1
   */
  transcriptEventEmitted(
    context: EventLogContext,
    state: {
      eventType: TranscriptEventType
      lineNumber: number
      uuid?: string
      toolName?: string
    },
    metadata: {
      transcriptPath: string
      contentPreview?: string
      metrics: TranscriptMetrics
    }
  ): TranscriptEventEmittedEvent {
    return {
      type: 'transcript:emitted',
      time: Date.now(),
      source: 'transcript',
      context: buildContext(context),
      payload: {
        eventType: state.eventType,
        lineNumber: state.lineNumber,
        uuid: state.uuid,
        toolName: state.toolName,
        transcriptPath: metadata.transcriptPath,
        contentPreview: metadata.contentPreview,
        metrics: metadata.metrics,
      },
    }
  },

  /**
   * Create a PreCompactCaptured event (logged when pre-compact snapshot is saved).
   * @see packages/sidekick-ui/docs/MONITORING-UI.md §4.1
   */
  preCompactCaptured(
    context: EventLogContext,
    state: {
      snapshotPath: string
      lineCount: number
    },
    metadata: {
      transcriptPath: string
      metrics: TranscriptMetrics
    }
  ): PreCompactCapturedEvent {
    return {
      type: 'transcript:pre-compact',
      time: Date.now(),
      source: 'transcript',
      context: buildContext(context),
      payload: {
        snapshotPath: state.snapshotPath,
        lineCount: state.lineCount,
        transcriptPath: metadata.transcriptPath,
        metrics: metadata.metrics,
      },
    }
  },

  // --- Error Events ---

  /**
   * Create a daemon ErrorOccurred event.
   * @see packages/sidekick-daemon/src/daemon.ts — HookableLogger error hook calls this factory.
   */
  daemonErrorOccurred(
    context: EventLogContext,
    state: {
      errorMessage: string
      errorStack?: string
    }
  ): DaemonErrorOccurredEvent {
    return {
      type: 'error:occurred',
      time: Date.now(),
      source: 'daemon',
      context: buildContext(context),
      payload: {
        errorMessage: state.errorMessage,
        errorStack: state.errorStack,
      },
    }
  },

  /**
   * Create a CLI ErrorOccurred event.
   * Available for CLI error hook implementations.
   */
  cliErrorOccurred(
    context: EventLogContext,
    state: {
      errorMessage: string
      errorStack?: string
    }
  ): CliErrorOccurredEvent {
    return {
      type: 'error:occurred',
      time: Date.now(),
      source: 'cli',
      context: buildContext(context),
      payload: {
        errorMessage: state.errorMessage,
        errorStack: state.errorStack,
      },
    }
  },

  // --- Bulk Processing Lifecycle Events ---

  /**
   * Create a BulkProcessingStart event (logged when transcript bulk replay begins).
   */
  bulkProcessingStart(context: EventLogContext, metadata: { fileSize: number }): BulkProcessingStartEvent {
    return {
      type: 'bulk-processing:start',
      time: Date.now(),
      source: 'transcript',
      context: buildContext(context),
      payload: {
        fileSize: metadata.fileSize,
      },
    }
  },

  /**
   * Create a BulkProcessingFinish event (logged when transcript bulk replay completes).
   */
  bulkProcessingFinish(
    context: EventLogContext,
    metadata: { totalLinesProcessed: number; durationMs: number }
  ): BulkProcessingFinishEvent {
    return {
      type: 'bulk-processing:finish',
      time: Date.now(),
      source: 'transcript',
      context: buildContext(context),
      payload: {
        totalLinesProcessed: metadata.totalLinesProcessed,
        durationMs: metadata.durationMs,
      },
    }
  },
}
/* v8 ignore stop */

/**
 * Log a structured event using a ContextLogger.
 * The event is logged at INFO level with all fields flattened appropriately.
 */
export function logEvent(logger: Logger, event: LoggingEventBase): void {
  const payload = event.payload
  const meta = payload != null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const reason = 'reason' in meta ? String(meta.reason) : undefined
  logger.info(reason ?? `${event.type}`, {
    type: event.type,
    source: event.source,
    ...meta,
  })

  // Write to per-session log file (fire-and-forget)
  if (sessionLogWriter && event.context.sessionId) {
    // cli → sidekick.log, daemon/transcript → sidekickd.log
    const logFile = event.source === 'cli' ? 'sidekick.log' : 'sidekickd.log'
    const line =
      JSON.stringify({
        time: event.time,
        type: event.type,
        source: event.source,
        context: event.context,
        ...meta,
      }) + '\n'
    sessionLogWriter.write(event.context.sessionId, logFile, line).catch(() => {
      // Silently ignore per-session write failures — aggregate log is the fallback
    })
  }
}
