/**
 * Log Metrics Manager — extracted from Daemon class (Step 4).
 *
 * Owns the counting logger, per-session/global log counters,
 * heartbeat writer, and log-metrics persistence.
 *
 * @see docs/design/DAEMON.md §4.6 Heartbeat
 */
import {
  createHookableLogger,
  DaemonGlobalLogMetricsDescriptor,
  GlobalStateAccessor,
  LogEvents,
  logEvent,
  type Logger,
  type LogManager,
  type StateService,
} from '@sidekick/core'
import type { DaemonStatus, HookName, LogMetricsState } from '@sidekick/types'
import { LogMetricsStateSchema } from '@sidekick/types'
import { DaemonStatusDescriptor } from './state-descriptors.js'
import { VERSION } from './daemon-helpers.js'

// ── DI deps ────────────────────────────────────────────────────────────────

export interface LogMetricsDeps {
  logManager: LogManager
  /** Lazy — stateService is created after the logger. */
  getStateService: () => StateService
  /** Lazy — taskEngine is created after the logger. */
  getTaskEngine: () => {
    getStatus(): {
      pending: number
      active: number
      activeTasks: Array<{ type: string; id: string; startTime: number }>
    }
  }
  /** Lazy — startTime lives on TimerManager, which is created after stateService. */
  getStartTime: () => number
}

// ── Class ──────────────────────────────────────────────────────────────────

export class LogMetricsManager {
  /** Per-session log counters for statusline {logs} indicator. */
  readonly logCounters = new Map<string, { warnings: number; errors: number }>()
  /** Global log counters for daemon-level errors (not tied to any session). */
  readonly globalLogCounters = { warnings: 0, errors: 0 }

  // Lazy-initialized state accessors (stateService isn't available at construction time)
  private _daemonStatusAccessor?: GlobalStateAccessor<DaemonStatus, DaemonStatus>
  private _globalLogMetricsAccessor?: GlobalStateAccessor<LogMetricsState, LogMetricsState>

  /** Logger created by createCountingLogger — needed for internal logging. */
  private logger?: Logger

  constructor(private deps: LogMetricsDeps) {}

  // ── Lazy accessors ─────────────────────────────────────────────────────

  private get daemonStatusAccessor(): GlobalStateAccessor<DaemonStatus, DaemonStatus> {
    if (!this._daemonStatusAccessor) {
      this._daemonStatusAccessor = new GlobalStateAccessor(this.deps.getStateService(), DaemonStatusDescriptor)
    }
    return this._daemonStatusAccessor
  }

  private get globalLogMetricsAccessor(): GlobalStateAccessor<LogMetricsState, LogMetricsState> {
    if (!this._globalLogMetricsAccessor) {
      this._globalLogMetricsAccessor = new GlobalStateAccessor(
        this.deps.getStateService(),
        DaemonGlobalLogMetricsDescriptor
      )
    }
    return this._globalLogMetricsAccessor
  }

  // ── Logger creation ────────────────────────────────────────────────────

  /**
   * Create a counting logger that wraps the base logger with warn/error/fatal hooks.
   *
   * The hook increments per-session and global counters, and emits structured
   * error:occurred events on error/fatal.
   *
   * Must be called once during daemon construction; the returned Logger is used
   * throughout the daemon's lifetime.
   */
  createCountingLogger(): Logger {
    const logManager = this.deps.logManager
    const logger = createHookableLogger(logManager.getLogger(), {
      levels: ['warn', 'error', 'fatal'],
      hook: (level, msg, meta) => {
        // Extract sessionId from log metadata context
        const sessionId =
          (meta?.context as { sessionId?: string })?.sessionId ?? (meta as { sessionId?: string })?.sessionId
        if (sessionId) {
          // Session-specific counter
          const counters = this.logCounters.get(sessionId)
          if (counters) {
            if (level === 'warn') counters.warnings++
            else counters.errors++ // error and fatal
          }
        } else {
          // Global counter for daemon-level logs without session context
          if (level === 'warn') this.globalLogCounters.warnings++
          else this.globalLogCounters.errors++ // error and fatal
        }

        // Emit structured error:occurred event for error/fatal levels
        if (level === 'error' || level === 'fatal') {
          const errorObj = (meta?.error ?? meta?.err) as { message?: string; stack?: string } | undefined
          const errorMessage = errorObj?.message ?? msg
          const errorStack = errorObj?.stack

          // Extract context fields accumulated by child loggers
          const metaContext = (meta?.context ?? {}) as {
            sessionId?: string
            correlationId?: string
            traceId?: string
            hook?: HookName
            taskId?: string
          }

          // Log on the BASE logger to avoid infinite recursion through the hookable wrapper
          const event = LogEvents.daemonErrorOccurred(
            {
              sessionId: sessionId ?? '',
              correlationId: metaContext.correlationId,
              traceId: metaContext.traceId,
              hook: metaContext.hook,
              taskId: metaContext.taskId,
            },
            {
              errorMessage,
              errorStack,
            }
          )
          const baseLogger = logManager.getLogger()
          const eventLogger = sessionId ? baseLogger.child({ context: { sessionId } }) : baseLogger
          logEvent(eventLogger, event)
        }
      },
    })
    this.logger = logger
    return logger
  }

  // ── Session counter management ─────────────────────────────────────────

  /**
   * Initialize log counters for a session.
   * @param reset - true → start at zero (clear); false → load from persisted file
   */
  async initSessionCounters(sessionId: string, reset: boolean): Promise<void> {
    if (reset) {
      this.logCounters.set(sessionId, { warnings: 0, errors: 0 })
    } else {
      const existing = await this.loadExistingLogCounts(sessionId)
      this.logCounters.set(sessionId, existing)
    }
  }

  /** Remove counters for a session (e.g. on SessionEnd). */
  deleteSessionCounters(sessionId: string): void {
    this.logCounters.delete(sessionId)
  }

  /** Check whether counters exist for a session. */
  hasSession(sessionId: string): boolean {
    return this.logCounters.has(sessionId)
  }

  /** Return IDs of all sessions with active counters. */
  getActiveSessionIds(): string[] {
    return [...this.logCounters.keys()]
  }

  // ── Heartbeat & persistence ────────────────────────────────────────────

  /**
   * Write current daemon status to state file and persist log metrics.
   * Per design/DAEMON.md §4.6: Includes timestamp, pid, uptime, memory, queue stats.
   */
  async writeHeartbeat(): Promise<void> {
    const memUsage = process.memoryUsage()
    const taskStatus = this.deps.getTaskEngine().getStatus()

    const status: DaemonStatus = {
      timestamp: Date.now(),
      pid: process.pid,
      version: VERSION,
      uptimeSeconds: Math.floor((Date.now() - this.deps.getStartTime()) / 1000),
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
      },
      queue: {
        pending: taskStatus.pending,
        active: taskStatus.active,
      },
      activeTasks: taskStatus.activeTasks,
    }

    try {
      await this.daemonStatusAccessor.write(status)
    } catch (err) {
      // Log but don't crash - heartbeat is non-critical
      this.logger?.warn('Failed to write heartbeat status', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Persist log metrics for each active session
    await this.persistLogMetrics()
  }

  /**
   * Load existing log counts from daemon-log-metrics.json.
   * Used to restore counts after daemon restart mid-session.
   */
  async loadExistingLogCounts(sessionId: string): Promise<{ warnings: number; errors: number }> {
    const stateService = this.deps.getStateService()
    const logMetricsPath = stateService.sessionStatePath(sessionId, 'daemon-log-metrics.json')

    const defaultMetrics: LogMetricsState = {
      sessionId,
      warningCount: 0,
      errorCount: 0,
      lastUpdatedAt: 0,
    }

    const result = await stateService.read(logMetricsPath, LogMetricsStateSchema, defaultMetrics)
    const existing = {
      warnings: result.data.warningCount,
      errors: result.data.errorCount,
    }

    if (result.source !== 'default') {
      this.logger?.debug('Loaded existing daemon log counts', { sessionId, existing })
    }

    return existing
  }

  /**
   * Persist log metrics for all active sessions and global daemon metrics.
   * Writes daemon-log-metrics.json to each session's state directory,
   * and daemon-global-log-metrics.json to the daemon state directory.
   */
  async persistLogMetrics(): Promise<void> {
    const now = Date.now()
    const stateService = this.deps.getStateService()

    // Persist per-session log metrics
    for (const [sessionId, counts] of this.logCounters) {
      const logMetricsPath = stateService.sessionStatePath(sessionId, 'daemon-log-metrics.json')

      const logMetrics: LogMetricsState = {
        sessionId,
        warningCount: counts.warnings,
        errorCount: counts.errors,
        lastUpdatedAt: now,
      }

      try {
        await stateService.write(logMetricsPath, logMetrics, LogMetricsStateSchema)
      } catch (err) {
        // Log but don't crash - log metrics are non-critical
        this.logger?.warn('Failed to persist log metrics', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Persist global daemon log metrics (for logs without session context)
    const globalMetrics: LogMetricsState = {
      warningCount: this.globalLogCounters.warnings,
      errorCount: this.globalLogCounters.errors,
      lastUpdatedAt: now,
    }

    try {
      await this.globalLogMetricsAccessor.write(globalMetrics)
    } catch (err) {
      // Log but don't crash - log metrics are non-critical
      // Note: This log itself won't cause infinite recursion since the hook
      // only increments counters, it doesn't trigger persistence
      this.logger?.warn('Failed to persist global log metrics', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
