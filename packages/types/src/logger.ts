/**
 * Logger and Telemetry Interface Definitions
 *
 * Core observability contracts for the Sidekick runtime.
 * These interfaces are implemented by sidekick-core's structured-logging module.
 *
 * @see sidekick-core/src/structured-logging.ts for Pino-based implementation
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/**
 * Structured logger interface compatible with Pino API.
 * Supports hierarchical child loggers with context inheritance.
 */
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

/**
 * Telemetry interface for emitting metrics.
 * Metrics are typically emitted as structured log entries.
 */
export interface Telemetry {
  /** Increment a counter by 1 */
  increment(name: string, tags?: Record<string, string>): void
  /** Set a gauge to an arbitrary value */
  gauge(name: string, value: number, tags?: Record<string, string>): void
  /** Record a histogram value with unit */
  histogram(name: string, value: number, unit: string, tags?: Record<string, string>): void
}
