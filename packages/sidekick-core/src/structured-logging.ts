/**
 * Structured Logging & Telemetry Module
 *
 * Implements structured logging per docs/design/STRUCTURED-LOGGING.md.
 * Provides a Pino-based logging system with:
 *
 * - Two-phase initialization (bootstrap console → full Pino logger)
 * - Automatic redaction of sensitive fields (apiKey, token, secret, etc.)
 * - Context binding (correlationId, sessionId, command, component)
 * - Telemetry emission (counters, gauges, histograms) to the same log stream
 * - File transport with auto-directory creation
 * - Configurable console output for interactive/hook modes
 *
 * @example
 * ```typescript
 * // Create a log manager with file output
 * const logManager = createLogManager({
 *   name: 'sidekick:cli',
 *   level: 'info',
 *   context: { correlationId: 'abc-123' },
 *   destinations: { file: { path: '.sidekick/logs/sidekick.log' } },
 * })
 *
 * const logger = logManager.getLogger()
 * logger.info('Hook executed', { hook: 'session-start' })
 *
 * const telemetry = logManager.getTelemetry()
 * telemetry.histogram('hook_duration', 45, 'ms', { hook: 'session-start' })
 * ```
 *
 * @see docs/design/STRUCTURED-LOGGING.md
 * @see docs/ARCHITECTURE.md §3.5 LLM Providers & Telemetry
 */

import pino, { type Logger as PinoLogger, type LoggerOptions as PinoOptions } from 'pino'
import { mkdirSync, existsSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Writable } from 'node:stream'

// =============================================================================
// Types & Constants
// =============================================================================

// Re-export core types from @sidekick/types for backward compatibility
export type { Logger, Telemetry, LogLevel, LogSource } from '@sidekick/types'
import type { Logger, Telemetry, LogLevel, LogSource } from '@sidekick/types'

export const LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const

/**
 * Get the effective log level for a component.
 * Checks component-specific overrides first, then falls back to the default level.
 *
 * @param componentLevels - Map of component names to log levels (from config.core.logging.components)
 * @param componentName - The component to get the level for
 * @param defaultLevel - The default log level (from config.core.logging.level)
 * @returns The effective log level for this component
 *
 * @example
 * ```typescript
 * const level = getComponentLogLevel(
 *   config.core.logging.components,
 *   'reminders',
 *   config.core.logging.level
 * )
 * const componentLogger = logger.child({ level, context: { component: 'reminders' } })
 * ```
 */
export function getComponentLogLevel(
  componentLevels: Record<string, string> | undefined,
  componentName: string,
  defaultLevel: LogLevel
): LogLevel {
  const override = componentLevels?.[componentName]
  if (override && override in LOG_LEVELS) {
    return override as LogLevel
  }
  return defaultLevel
}

export interface LogContext {
  correlationId?: string
  sessionId?: string
  component?: string
  command?: string
}

export interface TelemetryMetric {
  name: string
  type: 'counter' | 'gauge' | 'histogram'
  value: number
  unit?: string
  tags?: Record<string, string>
}

export interface LogManagerOptions {
  name?: string
  level?: LogLevel
  context?: LogContext
  destinations?: {
    file?: {
      path: string
      maxSizeBytes?: number
      maxFiles?: number
    }
    console?: {
      enabled: boolean
      pretty?: boolean
      stream?: Writable
    }
  }
  redactPaths?: string[]
  testStream?: Writable
}

// Default sensitive keys to redact
const DEFAULT_REDACT_KEYS = ['apiKey', 'token', 'secret', 'authorization', 'password', 'key']

// =============================================================================
// BufferedRotatingStream — async pino-roll initialization with write buffering
// =============================================================================

/**
 * A Writable stream that initializes pino-roll rotation asynchronously.
 * Buffers writes until pino-roll is ready, then delegates.
 * Falls back to appendFileSync if pino-roll initialization fails.
 *
 * @internal
 */
class BufferedRotatingStream extends Writable {
  private realStream: Writable | null = null
  private readonly pending: Array<{
    chunk: Buffer | string
    callback: (err?: Error | null) => void
  }> = []
  private fallbackPath: string | null = null

  constructor(filePath: string, maxSizeBytes: number, maxFiles: number) {
    super()
    this.fallbackPath = filePath

    // Ensure log directory exists before passing to pino-roll
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pinoRoll = require('pino-roll') as (opts: {
      file: string
      size: string
      limit: { count: number }
      mkdir: boolean
    }) => Promise<Writable>

    const sizeMB = Math.max(1, Math.round(maxSizeBytes / (1024 * 1024)))

    pinoRoll({
      file: filePath,
      size: `${sizeMB}m`,
      limit: { count: maxFiles },
      mkdir: true,
    })
      .then((stream) => {
        this.realStream = stream
        this.fallbackPath = null
        // Flush pending writes
        for (const { chunk, callback } of this.pending) {
          this.realStream.write(chunk, callback)
        }
        this.pending.length = 0
      })
      .catch(() => {
        // pino-roll failed — drain pending via appendFileSync fallback
        for (const { chunk, callback } of this.pending) {
          try {
            appendFileSync(filePath, chunk)
            callback()
          } catch (writeErr) {
            callback(writeErr as Error)
          }
        }
        this.pending.length = 0
      })
  }

  _write(chunk: Buffer | string, _encoding: string, callback: (err?: Error | null) => void): void {
    if (this.realStream) {
      this.realStream.write(chunk, callback)
    } else if (this.fallbackPath === null) {
      // Init failed and fallback already drained
      callback()
    } else {
      this.pending.push({ chunk, callback })
    }
  }

  _final(callback: () => void): void {
    if (this.realStream) {
      this.realStream.end(callback)
    } else {
      callback()
    }
  }
}

// =============================================================================
// Redaction Utilities
// =============================================================================

function buildRedactPaths(customPaths?: string[]): string[] {
  const paths: string[] = []

  // Add default keys at multiple nesting levels
  for (const key of DEFAULT_REDACT_KEYS) {
    paths.push(key)
    paths.push(`*.${key}`)
    paths.push(`*.*.${key}`)
    paths.push(`*.*.*.${key}`)
  }

  // Add custom paths
  if (customPaths) {
    for (const p of customPaths) {
      paths.push(p)
      if (!p.includes('*')) {
        paths.push(`*.${p}`)
      }
    }
  }

  return paths
}

// =============================================================================
// Logger Wrapper
// =============================================================================

function wrapPinoLogger(pinoInstance: PinoLogger): Logger {
  const log = (level: LogLevel, msg: string, meta?: Record<string, unknown>): void => {
    if (meta) {
      pinoInstance[level](meta, msg)
    } else {
      pinoInstance[level](msg)
    }
  }

  return {
    trace: (msg, meta) => log('trace', msg, meta),
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
    fatal: (msg, meta) => log('fatal', msg, meta),
    child: (bindings) => wrapPinoLogger(pinoInstance.child(bindings)),
    flush: () =>
      new Promise<void>((resolve) => {
        pinoInstance.flush?.()
        // Small delay to ensure async writes complete
        setImmediate(resolve)
      }),
  }
}

// =============================================================================
// LogManager
// =============================================================================

export interface LogManager {
  getLogger(): Logger
  getTelemetry(): Telemetry
  setLevel(level: LogLevel): void
}

export function createLogManager(options: LogManagerOptions): LogManager {
  const { name = 'sidekick', level = 'info', context, destinations, redactPaths, testStream } = options

  // Build pino options
  const pinoOptions: PinoOptions = {
    name,
    level,
    timestamp: pino.stdTimeFunctions.epochTime,
    redact: {
      paths: buildRedactPaths(redactPaths),
      censor: '[Redacted]',
    },
    formatters: {
      level: (_label, number) => ({ level: number }),
    },
    // Serialize errors properly
    serializers: {
      err: pino.stdSerializers.err,
    },
  }

  // Add context bindings if provided
  const bindings: Record<string, unknown> = {}
  if (context) {
    bindings.context = context
  }

  // Build transport streams
  let pinoInstance: PinoLogger

  if (testStream) {
    // Testing mode: write directly to provided stream
    pinoInstance = pino(pinoOptions, testStream)
  } else if (destinations?.file) {
    // File destination
    const filePath = destinations.file.path
    const { maxSizeBytes, maxFiles } = destinations.file

    let fileStream: Writable

    if (maxSizeBytes !== undefined && maxFiles !== undefined) {
      // Use rotating stream via pino-roll
      fileStream = new BufferedRotatingStream(filePath, maxSizeBytes, maxFiles)
    } else {
      // Legacy: simple append (no rotation)
      const fileDir = dirname(filePath)
      if (!existsSync(fileDir)) {
        mkdirSync(fileDir, { recursive: true })
      }
      fileStream = new Writable({
        write(chunk: Buffer | string, _encoding, callback) {
          try {
            appendFileSync(filePath, chunk)
            callback()
          } catch (err) {
            callback(err as Error)
          }
        },
      })
    }

    pinoInstance = pino(pinoOptions, fileStream)
  } else {
    // Default to console (disabled console means silent but still creates logger)
    if (destinations?.console?.enabled === false) {
      // Silent mode - create a no-op stream
      const nullStream = new Writable({
        write(_chunk, _encoding, callback) {
          callback()
        },
      })
      pinoInstance = pino(pinoOptions, nullStream)
    } else if (destinations?.console?.stream) {
      // Custom console stream provided (useful for testing)
      pinoInstance = pino(pinoOptions, destinations.console.stream)
    } else {
      // Default to stdout
      pinoInstance = pino(pinoOptions)
    }
  }

  // Apply context bindings
  if (Object.keys(bindings).length > 0) {
    pinoInstance = pinoInstance.child(bindings)
  }

  const logger = wrapPinoLogger(pinoInstance)

  // Telemetry uses the same logger stream
  const telemetry: Telemetry = {
    increment(metricName, tags) {
      pinoInstance.info({
        event_type: 'telemetry',
        metric: {
          name: metricName,
          type: 'counter',
          value: 1,
          tags,
        },
      })
    },
    gauge(metricName, value, tags) {
      pinoInstance.info({
        event_type: 'telemetry',
        metric: {
          name: metricName,
          type: 'gauge',
          value,
          tags,
        },
      })
    },
    histogram(metricName, value, unit, tags) {
      pinoInstance.info({
        event_type: 'telemetry',
        metric: {
          name: metricName,
          type: 'histogram',
          value,
          unit,
          tags,
        },
      })
    },
  }

  return {
    getLogger: () => logger,
    getTelemetry: () => telemetry,
    setLevel: (newLevel: LogLevel) => {
      pinoInstance.level = newLevel
    },
  }
}

// =============================================================================
// ContextLogger - Deep-Merging Child Logger Wrapper
// =============================================================================

/**
 * Options for creating a ContextLogger.
 * Per docs/design/STRUCTURED-LOGGING.md §3.7
 */
export interface ContextLoggerOptions {
  name?: string
  level?: LogLevel
  /** Component source - included in log context */
  source: LogSource
  /** Initial context bindings */
  context?: Record<string, unknown>
  /** Directory for log files */
  logsDir?: string
  /** Log filename (required when logsDir is set) */
  logFile?: string
  /** Max size in bytes before rotating. If set, maxFiles must also be set. */
  maxSizeBytes?: number
  /** Max number of rotated files to keep. */
  maxFiles?: number
  /** Custom redaction paths */
  redactPaths?: string[]
  /** Test stream (bypasses file output) */
  testStream?: Writable
}

/**
 * Extended Logger interface with deep-merging child() method.
 * Per docs/design/STRUCTURED-LOGGING.md §3.7
 */
export interface ContextLogger extends Logger {
  /** Create child logger with deep-merged context */
  child(bindings: { context?: Record<string, unknown>; [key: string]: unknown }): ContextLogger
}

/**
 * Create a ContextLogger that deep-merges context when creating child loggers.
 *
 * Unlike Pino's default shallow merge, this wrapper ensures that the `context`
 * object is deep-merged so child loggers inherit parent context fields.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §3.7
 *
 * @example Console output (default):
 * ```typescript
 * const logger = createContextLogger({
 *   source: 'cli',
 *   context: { sessionId: 'abc-123' }
 * })
 *
 * const hookLogger = logger.child({
 *   context: { hook: 'UserPromptSubmit' }
 * })
 *
 * // hookLogger has: { sessionId: 'abc-123', hook: 'UserPromptSubmit' }
 * ```
 *
 * @example File output (requires logFile):
 * ```typescript
 * const logger = createContextLogger({
 *   source: 'daemon',
 *   logsDir: '/path/to/.sidekick/logs',
 *   logFile: 'sidekickd.log',
 * })
 * ```
 */
export function createContextLogger(options: ContextLoggerOptions): ContextLogger {
  const {
    name = `sidekick:${options.source}`,
    level = 'info',
    source,
    context = {},
    logsDir,
    logFile,
    maxSizeBytes,
    maxFiles,
    redactPaths,
    testStream,
  } = options

  // Build pino options
  const pinoOptions: PinoOptions = {
    name,
    level,
    timestamp: pino.stdTimeFunctions.epochTime,
    redact: {
      paths: buildRedactPaths(redactPaths),
      censor: '[Redacted]',
    },
    formatters: {
      level: (_label, number) => ({ level: number }),
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
  }

  // Determine output stream
  let pinoInstance: PinoLogger

  if (testStream) {
    // Testing mode: write directly to provided stream
    pinoInstance = pino(pinoOptions, testStream)
  } else if (logsDir) {
    // File output - caller specifies log filename
    if (!logFile) {
      throw new Error('logFile is required when logsDir is set')
    }
    const logPath = join(logsDir, logFile)

    let fileStream: Writable
    if (maxSizeBytes !== undefined && maxFiles !== undefined) {
      fileStream = new BufferedRotatingStream(logPath, maxSizeBytes, maxFiles)
    } else {
      const logDir = dirname(logPath)
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true })
      }
      fileStream = new Writable({
        write(chunk: Buffer | string, _encoding, callback) {
          try {
            appendFileSync(logPath, chunk)
            callback()
          } catch (err) {
            callback(err as Error)
          }
        },
      })
    }

    pinoInstance = pino(pinoOptions, fileStream)
  } else {
    // Default to stdout
    pinoInstance = pino(pinoOptions)
  }

  // Apply initial bindings including source
  pinoInstance = pinoInstance.child({ source, context })

  return wrapWithContextMerge(pinoInstance, context)
}

/**
 * Wrap a Pino logger to deep-merge context on child creation.
 */
function wrapWithContextMerge(pinoInstance: PinoLogger, currentContext: Record<string, unknown>): ContextLogger {
  const log = (level: LogLevel, msg: string, meta?: Record<string, unknown>): void => {
    if (meta) {
      pinoInstance[level](meta, msg)
    } else {
      pinoInstance[level](msg)
    }
  }

  return {
    trace: (msg, meta) => log('trace', msg, meta),
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
    fatal: (msg, meta) => log('fatal', msg, meta),

    child(bindings: { context?: Record<string, unknown>; [key: string]: unknown }): ContextLogger {
      const { context: newContext, ...otherBindings } = bindings

      // Deep-merge context (child overrides parent for conflicting keys)
      const mergedContext = newContext ? { ...currentContext, ...newContext } : currentContext

      // Create Pino child with merged context
      const childPino = pinoInstance.child({
        ...otherBindings,
        context: mergedContext,
      })

      return wrapWithContextMerge(childPino, mergedContext)
    },

    flush: () =>
      new Promise<void>((resolve) => {
        pinoInstance.flush?.()
        setImmediate(resolve)
      }),
  }
}

// =============================================================================
// Two-Phase Logger Facade
// =============================================================================

interface BufferedLog {
  level: LogLevel
  msg: string
  meta?: Record<string, unknown>
  timestamp: number
}

export interface LoggerFacadeOptions {
  bootstrapSink?: Writable
  bufferPreUpgrade?: boolean
}

export interface UpgradeOptions extends LogManagerOptions {
  onUpgradeError?: (err: Error) => void
}

export interface LoggerFacade extends Logger {
  upgrade(options: UpgradeOptions): void
  isUpgraded(): boolean
}

function createBootstrapLogger(sink: Writable): Logger {
  const write = (level: LogLevel, msg: string, meta?: Record<string, unknown>): void => {
    const timestamp = new Date().toISOString()
    const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
    sink.write(`[${timestamp}] [${level.toUpperCase()}] ${msg}${suffix}\n`)
  }

  const self: Logger = {
    trace: (msg, meta) => write('trace', msg, meta),
    debug: (msg, meta) => write('debug', msg, meta),
    info: (msg, meta) => write('info', msg, meta),
    warn: (msg, meta) => write('warn', msg, meta),
    error: (msg, meta) => write('error', msg, meta),
    fatal: (msg, meta) => write('fatal', msg, meta),
    child: () => self, // Bootstrap logger doesn't support children
    flush: () => Promise.resolve(),
  }

  return self
}

export function createLoggerFacade(options: LoggerFacadeOptions = {}): LoggerFacade {
  const { bootstrapSink = process.stderr, bufferPreUpgrade = false } = options

  let upgraded = false
  let activeLogger: Logger = createBootstrapLogger(bootstrapSink)
  const buffer: BufferedLog[] = []

  const facade: LoggerFacade = {
    trace(msg, meta) {
      if (bufferPreUpgrade && !upgraded) {
        buffer.push({ level: 'trace', msg, meta, timestamp: Date.now() })
      } else {
        activeLogger.trace(msg, meta)
      }
    },
    debug(msg, meta) {
      if (bufferPreUpgrade && !upgraded) {
        buffer.push({ level: 'debug', msg, meta, timestamp: Date.now() })
      } else {
        activeLogger.debug(msg, meta)
      }
    },
    info(msg, meta) {
      if (bufferPreUpgrade && !upgraded) {
        buffer.push({ level: 'info', msg, meta, timestamp: Date.now() })
      } else {
        activeLogger.info(msg, meta)
      }
    },
    warn(msg, meta) {
      if (bufferPreUpgrade && !upgraded) {
        buffer.push({ level: 'warn', msg, meta, timestamp: Date.now() })
      } else {
        activeLogger.warn(msg, meta)
      }
    },
    error(msg, meta) {
      if (bufferPreUpgrade && !upgraded) {
        buffer.push({ level: 'error', msg, meta, timestamp: Date.now() })
      } else {
        activeLogger.error(msg, meta)
      }
    },
    fatal(msg, meta) {
      if (bufferPreUpgrade && !upgraded) {
        buffer.push({ level: 'fatal', msg, meta, timestamp: Date.now() })
      } else {
        activeLogger.fatal(msg, meta)
      }
    },
    child(bindings) {
      if (upgraded) {
        return activeLogger.child(bindings)
      }
      // Before upgrade, return a proxy that will use the upgraded logger
      const childFacade = createLoggerFacade({ bootstrapSink, bufferPreUpgrade })
      return childFacade
    },
    async flush() {
      // Replay buffer if we have one and are now upgraded
      if (upgraded && buffer.length > 0) {
        for (const entry of buffer) {
          activeLogger[entry.level](entry.msg, entry.meta)
        }
        buffer.length = 0
      }
      await activeLogger.flush()
    },
    upgrade(upgradeOptions) {
      try {
        const logManager = createLogManager(upgradeOptions)
        activeLogger = logManager.getLogger()
        upgraded = true
      } catch (err) {
        // Fallback: keep using bootstrap logger
        if (upgradeOptions.onUpgradeError) {
          upgradeOptions.onUpgradeError(err as Error)
        }
        // Log the error to bootstrap logger
        activeLogger.error('Failed to upgrade to Pino logger', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },
    isUpgraded() {
      return upgraded
    },
  }

  return facade
}

// =============================================================================
// Event Logging Helpers
// =============================================================================

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
  StatuslineRenderedEvent,
  StatuslineErrorEvent,
  TranscriptEventEmittedEvent,
  PreCompactCapturedEvent,
  LoggingEventBase,
  TranscriptEventType,
  TranscriptMetrics,
  EventLogContext,
} from '@sidekick/types'

// Re-export for backward compatibility
export type { EventLogContext } from '@sidekick/types'

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
    metadata: { cwd?: string; mode?: 'hook' | 'interactive' }
  ): HookReceivedEvent {
    return {
      type: 'HookReceived',
      time: Date.now(),
      source: 'cli',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
      },
      payload: {
        metadata,
      },
    }
  },

  /**
   * Create a HookCompleted event (logged when CLI finishes hook processing).
   */
  hookCompleted(
    context: EventLogContext & { hook: string },
    metadata: { durationMs: number },
    state?: { reminderReturned?: boolean; responseType?: string }
  ): HookCompletedEvent {
    return {
      type: 'HookCompleted',
      time: Date.now(),
      source: 'cli',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
      },
      payload: {
        state,
        metadata,
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
      type: 'EventReceived',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        metadata,
      },
    }
  },

  /**
   * Create an EventProcessed event (logged when a handler completes).
   * (Renamed from handlerExecuted for consistency with eventReceived)
   */
  eventProcessed(
    context: EventLogContext,
    state: { handlerId: string; success: boolean; stopped?: boolean },
    metadata: { durationMs: number; error?: string }
  ): EventProcessedEvent {
    return {
      type: 'EventProcessed',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        state,
        metadata,
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
    },
    metadata?: { stagingPath?: string }
  ): ReminderStagedEvent {
    return {
      type: 'ReminderStaged',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        state,
        metadata,
      },
    }
  },

  // --- Daemon Lifecycle Events ---

  /**
   * Create a DaemonStarting event (logged at beginning of daemon initialization).
   */
  daemonStarting(metadata: { projectDir: string; pid: number }): DaemonStartingEvent {
    return {
      type: 'DaemonStarting',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: '',
      },
      payload: {
        metadata,
      },
    }
  },

  /**
   * Create a DaemonStarted event (logged when daemon initialization completes).
   */
  daemonStarted(metadata: { startupDurationMs: number }): DaemonStartedEvent {
    return {
      type: 'DaemonStarted',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: '',
      },
      payload: {
        metadata,
      },
    }
  },

  /**
   * Create an IpcServerStarted event (logged when Unix socket is ready).
   */
  ipcServerStarted(metadata: { socketPath: string }): IpcServerStartedEvent {
    return {
      type: 'IpcServerStarted',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: '',
      },
      payload: {
        metadata,
      },
    }
  },

  /**
   * Create a ConfigWatcherStarted event (logged when file watcher starts).
   */
  configWatcherStarted(metadata: { projectDir: string; watchedFiles: string[] }): ConfigWatcherStartedEvent {
    return {
      type: 'ConfigWatcherStarted',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: '',
      },
      payload: {
        metadata,
      },
    }
  },

  /**
   * Create a SessionEvictionStarted event (logged when cleanup timer starts).
   */
  sessionEvictionStarted(metadata: { intervalMs: number }): SessionEvictionStartedEvent {
    return {
      type: 'SessionEvictionStarted',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: '',
      },
      payload: {
        metadata,
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
    }
  ): StatuslineRenderedEvent {
    return {
      type: 'StatuslineRendered',
      time: Date.now(),
      source: 'cli',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        state,
        metadata,
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
      type: 'StatuslineError',
      time: Date.now(),
      source: 'cli',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        reason,
        metadata,
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
      type: 'ResumeGenerating',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        metadata,
        reason: 'pivot_detected',
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
      type: 'ResumeUpdated',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        state,
        reason: 'generation_complete',
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
      type: 'ResumeSkipped',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        metadata,
        reason,
      },
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
      type: 'TranscriptEventEmitted',
      time: Date.now(),
      source: 'transcript',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        state,
        metadata,
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
      type: 'PreCompactCaptured',
      time: Date.now(),
      source: 'transcript',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        state,
        metadata,
        reason: 'pre_compact_hook',
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
  logger.info(event.payload.reason ?? `${event.type}`, {
    type: event.type,
    source: event.source,
    ...event.payload,
  })
}

// =============================================================================
// Global Error Handlers
// =============================================================================

export function setupGlobalErrorHandlers(logger: Logger): () => void {
  const uncaughtHandler = (err: Error): void => {
    logger.fatal('Uncaught exception', { err })
  }

  const rejectionHandler = (reason: unknown): void => {
    logger.fatal('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    })
  }

  process.on('uncaughtException', uncaughtHandler)
  process.on('unhandledRejection', rejectionHandler)

  // Return cleanup function
  return () => {
    process.off('uncaughtException', uncaughtHandler)
    process.off('unhandledRejection', rejectionHandler)
  }
}
