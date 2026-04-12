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
import { toErrorMessage } from './error-utils.js'

// Re-export event factories and logEvent from log-events.ts for backward compatibility
export { LogEvents, logEvent, setSessionLogWriter, type EventLogContext } from './log-events'

// Re-export SessionLogWriter for per-session log file management
export { SessionLogWriter, type SessionLogWriterOptions } from './session-log-writer'

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

/** Default max file size before rotation (2MB — aggregate logs are an ephemeral debug window). */
export const DEFAULT_ROTATE_SIZE_BYTES = 2 * 1024 * 1024

/** Default number of rotated files to retain (2 — aggregate logs are an ephemeral debug window). */
export const DEFAULT_MAX_FILES = 2

// Default sensitive keys to redact (pino redaction is case-sensitive and path-exact)
const DEFAULT_REDACT_KEYS = [
  'apiKey',
  'token',
  'secret',
  'authorization',
  'password',
  'key',
  // Defense-in-depth: env var names that may leak into log metadata
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'GITHUB_API_KEY',
]

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
  /** Non-null while pino-roll init is in progress; set to null once resolved or rejected. */
  private initPending = true
  private readonly filePath: string

  constructor(filePath: string, maxSizeBytes: number, maxFiles: number) {
    super()
    this.filePath = filePath

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

    pinoRoll({
      file: filePath,
      size: `${maxSizeBytes}b`,
      limit: { count: maxFiles },
      mkdir: true,
    })
      .then((stream) => {
        this.realStream = stream
        this.drainPending((chunk, cb) => {
          stream.write(chunk)
          cb()
        })
      })
      .catch((err) => {
        process.stderr.write(`[sidekick] pino-roll init failed, using appendFileSync fallback: ${err}\n`)
        this.drainPending((chunk, cb) => this.appendFallback(chunk, cb))
      })
  }

  _write(chunk: Buffer | string, _encoding: string, callback: (err?: Error | null) => void): void {
    if (this.realStream) {
      // pino-roll returns a SonicBoom stream, not a standard Node.js Writable.
      // SonicBoom.write() ignores the callback parameter, so we must call it
      // ourselves. Without this, the Writable base class hangs waiting for a
      // callback that never fires, silently dropping all subsequent writes.
      this.realStream.write(chunk)
      callback()
    } else if (this.initPending) {
      this.pending.push({ chunk, callback })
    } else {
      // pino-roll failed — use appendFileSync fallback for all subsequent writes
      this.appendFallback(chunk, callback)
    }
  }

  _final(callback: () => void): void {
    if (this.realStream) {
      this.realStream.end(callback)
    } else {
      callback()
    }
  }

  private drainPending(writer: (chunk: Buffer | string, cb: (err?: Error | null) => void) => void): void {
    this.initPending = false
    for (const { chunk, callback } of this.pending) {
      writer(chunk, callback)
    }
    this.pending.length = 0
  }

  private appendFallback(chunk: Buffer | string, callback: (err?: Error | null) => void): void {
    try {
      appendFileSync(this.filePath, chunk)
      callback()
    } catch (err) {
      callback(err as Error)
    }
  }
}

/**
 * Create a file-output Writable stream, choosing rotation or legacy append.
 *
 * @internal Shared by createLogManager and createContextLogger.
 */
function createFileStream(filePath: string, maxSizeBytes?: number, maxFiles?: number): Writable {
  if (maxSizeBytes !== undefined && maxFiles !== undefined) {
    return new BufferedRotatingStream(filePath, maxSizeBytes, maxFiles)
  }

  // Legacy: simple append (no rotation)
  const fileDir = dirname(filePath)
  if (!existsSync(fileDir)) {
    mkdirSync(fileDir, { recursive: true })
  }
  return new Writable({
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
// Shared PinoOptions Builder
// =============================================================================

/**
 * Build common PinoOptions shared by createLogManager and createContextLogger.
 * Eliminates duplicate construction of redaction, formatters, and serializers.
 *
 * @internal
 */
function buildPinoOptions(name: string, level: LogLevel, redactPaths?: string[]): PinoOptions {
  return {
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

  const pinoOptions = buildPinoOptions(name, level, redactPaths)

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
    // File destination (rotating or legacy append)
    const { path: filePath, maxSizeBytes, maxFiles } = destinations.file
    pinoInstance = pino(pinoOptions, createFileStream(filePath, maxSizeBytes, maxFiles))
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

  const pinoOptions = buildPinoOptions(name, level, redactPaths)

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
    pinoInstance = pino(pinoOptions, createFileStream(logPath, maxSizeBytes, maxFiles))
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

  /** Dispatch a log call, buffering if pre-upgrade buffering is enabled. */
  const bufferedLog = (level: LogLevel, msg: string, meta?: Record<string, unknown>): void => {
    if (bufferPreUpgrade && !upgraded) {
      buffer.push({ level, msg, meta, timestamp: Date.now() })
    } else {
      activeLogger[level](msg, meta)
    }
  }

  const facade: LoggerFacade = {
    trace: (msg, meta) => bufferedLog('trace', msg, meta),
    debug: (msg, meta) => bufferedLog('debug', msg, meta),
    info: (msg, meta) => bufferedLog('info', msg, meta),
    warn: (msg, meta) => bufferedLog('warn', msg, meta),
    error: (msg, meta) => bufferedLog('error', msg, meta),
    fatal: (msg, meta) => bufferedLog('fatal', msg, meta),
    child(bindings) {
      if (upgraded) {
        return activeLogger.child(bindings)
      }
      // Before upgrade, return a proxy that will use the upgraded logger
      const childFacade = createLoggerFacade({ bootstrapSink, bufferPreUpgrade })
      return childFacade
    },
    async flush() {
      // Replay buffer to the active logger (upgraded Pino or bootstrap/stderr fallback)
      if (buffer.length > 0) {
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
          error: toErrorMessage(err),
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
// Global Error Handlers
// =============================================================================

export function setupGlobalErrorHandlers(logger: Logger): () => void {
  const uncaughtHandler = (err: Error): void => {
    logger.fatal('Uncaught exception', { err })
  }

  const rejectionHandler = (reason: unknown): void => {
    logger.fatal('Unhandled promise rejection', {
      reason: toErrorMessage(reason),
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
