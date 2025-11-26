/**
 * Structured Logging & Telemetry Module
 *
 * Implements Phase 3 of the Sidekick Node runtime per LLD-STRUCTURED-LOGGING.md.
 * Provides a Pino-based logging system with:
 *
 * - Two-phase initialization (bootstrap console → full Pino logger)
 * - Automatic redaction of sensitive fields (apiKey, token, secret, etc.)
 * - Context binding (scope, correlationId, command, component)
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
 *   context: { scope: 'project', correlationId: 'abc-123' },
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
 * @see LLD-STRUCTURED-LOGGING.md
 * @see TARGET-ARCHITECTURE.md §3.5 LLM Providers & Telemetry
 */

import pino, { type Logger as PinoLogger, type LoggerOptions as PinoOptions } from 'pino'
import { mkdirSync, existsSync, appendFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Writable } from 'node:stream'

// =============================================================================
// Types & Constants
// =============================================================================

export const LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const

export type LogLevel = keyof typeof LOG_LEVELS

export interface LogContext {
  scope?: 'user' | 'project'
  correlationId?: string
  sessionId?: string
  component?: string
  command?: string
}

export interface Logger {
  trace(msg: string, meta?: Record<string, unknown>): void
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
  fatal(msg: string, meta?: Record<string, unknown>): void
  child(bindings: Record<string, unknown>): Logger
  flush(): Promise<void>
}

export interface TelemetryMetric {
  name: string
  type: 'counter' | 'gauge' | 'histogram'
  value: number
  unit?: string
  tags?: Record<string, string>
}

export interface Telemetry {
  increment(name: string, tags?: Record<string, string>): void
  gauge(name: string, value: number, tags?: Record<string, string>): void
  histogram(name: string, value: number, unit: string, tags?: Record<string, string>): void
}

export interface LogManagerOptions {
  name?: string
  level?: LogLevel
  context?: LogContext
  destinations?: {
    file?: {
      path: string
      rotateSize?: number
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
    const fileDir = dirname(filePath)

    // Ensure directory exists
    if (!existsSync(fileDir)) {
      mkdirSync(fileDir, { recursive: true })
    }

    // Create a simple file destination stream
    const fileStream = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        try {
          appendFileSync(filePath, chunk)
          callback()
        } catch (err) {
          callback(err as Error)
        }
      },
    })

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
