/**
 * Owns the counting logger, per-session/global log counters,
 * heartbeat writer, and log-metrics persistence.
 */
import {
  createHookableLogger,
  DaemonGlobalLogMetricsDescriptor,
  GlobalStateAccessor,
  LogEvents,
  logEvent,
  type Logger,
  type LogManager,
  toErrorMessage,
  type StateService,
} from '@sidekick/core'
import type { DaemonStatus, HookName, LogMetricsState } from '@sidekick/types'
import { LogMetricsStateSchema } from '@sidekick/types'
import { DaemonStatusDescriptor } from './state-descriptors.js'
import { VERSION } from './daemon-helpers.js'

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

export class LogMetricsManager {
  readonly logCounters = new Map<string, { warnings: number; errors: number }>()
  readonly globalLogCounters = { warnings: 0, errors: 0 }

  private _daemonStatusAccessor?: GlobalStateAccessor<DaemonStatus, DaemonStatus>
  private _globalLogMetricsAccessor?: GlobalStateAccessor<LogMetricsState, LogMetricsState>
  private logger?: Logger

  constructor(private deps: LogMetricsDeps) {}

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

  /**
   * Create a counting logger that wraps the base logger with warn/error/fatal hooks.
   * Increments per-session and global counters, emits error:occurred events.
   * Must be called once during daemon construction.
   */
  createCountingLogger(): Logger {
    const logManager = this.deps.logManager
    const logger = createHookableLogger(logManager.getLogger(), {
      levels: ['warn', 'error', 'fatal'],
      hook: (level, msg, meta) => {
        const sessionId =
          (meta?.context as { sessionId?: string })?.sessionId ?? (meta as { sessionId?: string })?.sessionId
        if (sessionId) {
          const counters = this.logCounters.get(sessionId)
          if (counters) {
            if (level === 'warn') counters.warnings++
            else counters.errors++
          }
        } else {
          if (level === 'warn') this.globalLogCounters.warnings++
          else this.globalLogCounters.errors++
        }

        if (level === 'error' || level === 'fatal') {
          const errorObj = (meta?.error ?? meta?.err) as { message?: string; stack?: string } | undefined
          const errorMessage = errorObj?.message ?? msg
          const errorStack = errorObj?.stack

          const metaContext = (meta?.context ?? {}) as {
            sessionId?: string
            correlationId?: string
            traceId?: string
            hook?: HookName
            taskId?: string
          }

          // Use base logger to avoid infinite recursion through the hookable wrapper
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

  /** Initialize log counters for a session. If reset, start at zero; otherwise load persisted counts. */
  async initSessionCounters(sessionId: string, reset: boolean): Promise<void> {
    if (reset) {
      this.logCounters.set(sessionId, { warnings: 0, errors: 0 })
    } else {
      const existing = await this.loadExistingLogCounts(sessionId)
      this.logCounters.set(sessionId, existing)
    }
  }

  /** Remove counters for a session. */
  deleteSessionCounters(sessionId: string): void {
    this.logCounters.delete(sessionId)
  }

  /** Whether counters exist for a session. */
  hasSession(sessionId: string): boolean {
    return this.logCounters.has(sessionId)
  }

  /** IDs of all sessions with active counters. */
  getActiveSessionIds(): string[] {
    return [...this.logCounters.keys()]
  }

  /** Write daemon status to state file and persist log metrics for all active sessions. */
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
      this.logger?.warn('Failed to write heartbeat status', {
        error: toErrorMessage(err),
      })
    }

    await this.persistLogMetrics()
  }

  /** Load existing log counts from persisted daemon-log-metrics.json. */
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

  /** Persist log metrics for all active sessions and global daemon metrics. */
  async persistLogMetrics(): Promise<void> {
    const now = Date.now()
    const stateService = this.deps.getStateService()

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
        this.logger?.warn('Failed to persist log metrics', {
          sessionId,
          error: toErrorMessage(err),
        })
      }
    }

    const globalMetrics: LogMetricsState = {
      warningCount: this.globalLogCounters.warnings,
      errorCount: this.globalLogCounters.errors,
      lastUpdatedAt: now,
    }

    try {
      await this.globalLogMetricsAccessor.write(globalMetrics)
    } catch (err) {
      this.logger?.warn('Failed to persist global log metrics', {
        error: toErrorMessage(err),
      })
    }
  }
}
