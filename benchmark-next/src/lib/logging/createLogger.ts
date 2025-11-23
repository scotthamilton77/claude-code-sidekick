import pino, { Logger as PinoLogger } from 'pino'
import { mkdir } from 'fs/promises'
import { dirname } from 'path'

/**
 * Log level type (matches Track 1 bash logging levels)
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Output destination configuration
 */
export type LogOutput = 'stdout' | 'file' | 'both'

/**
 * Logger configuration options
 */
export interface CreateLoggerOptions {
  /**
   * Minimum log level to output (default: 'info')
   */
  level?: LogLevel

  /**
   * Output destination (default: 'stdout')
   */
  output?: LogOutput

  /**
   * File path for file/both output modes
   */
  filePath?: string

  /**
   * Pretty print (human-readable) output for development (default: false)
   * When true, outputs formatted text instead of JSON
   */
  prettyPrint?: boolean

  /**
   * Custom context fields to include in all log entries
   */
  context?: Record<string, unknown>
}

/**
 * Create a configured Pino logger instance
 *
 * Simple factory function that sets up Pino with directory creation,
 * validation, and multi-stream support. Returns Pino's Logger directly.
 *
 * @param options - Logger configuration
 * @returns Promise<PinoLogger> - Configured Pino logger
 * @throws Error if file path is required but not provided
 *
 * @example
 * ```typescript
 * // Stdout logging
 * const logger = await createLogger({ level: 'info' })
 * logger.info({ model: 'gpt-4' }, 'Starting benchmark')
 *
 * // File logging with directory creation
 * const fileLogger = await createLogger({
 *   level: 'debug',
 *   output: 'file',
 *   filePath: './logs/app.log'
 * })
 *
 * // Child logger with additional context
 * const child = logger.child({ provider: 'openai' })
 * child.debug({ attempt: 1 }, 'Retrying API call')
 * ```
 */
export async function createLogger(options: CreateLoggerOptions = {}): Promise<PinoLogger> {
  const { level = 'info', output = 'stdout', filePath, prettyPrint = false, context = {} } = options

  // Validate file path requirement
  if ((output === 'file' || output === 'both') && !filePath) {
    throw new Error('filePath is required when output is "file" or "both"')
  }

  // Ensure directory exists for file output
  if (filePath) {
    await mkdir(dirname(filePath), { recursive: true })
  }

  // Configure Pino base options
  const pinoOptions = {
    level,
    base: {
      pid: process.pid,
      ...context,
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  }

  // Pretty print mode (development)
  if (prettyPrint) {
    return pino(
      pinoOptions,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      })
    )
  }

  // Configure destination based on output mode
  if (output === 'stdout') {
    return pino(pinoOptions, pino.destination({ dest: 1, sync: false }))
  }

  if (output === 'file' && filePath) {
    return pino(pinoOptions, pino.destination({ dest: filePath, sync: false }))
  }

  if (output === 'both' && filePath) {
    return pino(
      pinoOptions,
      pino.multistream([
        { level, stream: pino.destination({ dest: 1, sync: false }) },
        { level, stream: pino.destination({ dest: filePath, sync: false }) },
      ])
    )
  }

  // Fallback to stdout
  return pino(pinoOptions, pino.destination({ dest: 1, sync: false }))
}

/**
 * Create a synchronous logger instance (for testing)
 * Note: Does not support file output
 *
 * @param options - Logger configuration (output is always 'stdout')
 * @returns PinoLogger instance
 *
 * @example
 * ```typescript
 * const logger = createLoggerSync({ level: 'debug' })
 * logger.info('Test log message')
 * ```
 */
export function createLoggerSync(
  options: Omit<CreateLoggerOptions, 'output' | 'filePath'> = {}
): PinoLogger {
  const { level = 'info', prettyPrint = false, context = {} } = options

  const pinoOptions = {
    level,
    base: {
      pid: process.pid,
      ...context,
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  }

  if (prettyPrint) {
    return pino(
      pinoOptions,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      })
    )
  }

  return pino(pinoOptions, pino.destination({ dest: 1, sync: true }))
}

// Re-export Pino's Logger type for convenience
export type { Logger as PinoLogger } from 'pino'
