/**
 * Simple Console Logger (Phase 1 Bootstrap Logger)
 *
 * Provides a minimal console logger for early bootstrap before the full
 * Pino-based structured logging system initializes.
 *
 * @deprecated Superseded by structured-logging.ts in Phase 3. This module
 * remains for backward compatibility but new code should use createLogManager()
 * or createLoggerFacade() from structured-logging.ts instead.
 *
 * @see structured-logging.ts for the production logging system
 */

import { Logger } from '@sidekick/types'

// Re-export Logger interface for backward compatibility
export type { Logger }

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const levelOrder: Record<LogLevel, number> = {
  trace: 5,
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
}

export interface LoggerOptions {
  minimumLevel?: LogLevel
  sink?: NodeJS.WritableStream
}

function shouldLog(level: LogLevel, minimumLevel: LogLevel): boolean {
  return levelOrder[level] >= levelOrder[minimumLevel]
}

function formatLine(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString()
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${suffix}`
}

export function createConsoleLogger(options: LoggerOptions = {}): Logger {
  const minimumLevel = options.minimumLevel ?? 'info'
  const sink = options.sink ?? process.stderr

  const write = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    if (!shouldLog(level, minimumLevel)) {
      return
    }
    sink.write(formatLine(level, message, meta) + '\n')
  }

  const logger: Logger = {
    trace: (message, meta) => write('trace', message, meta),
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    fatal: (message, meta) => write('fatal', message, meta),
    child: (_bindings) => logger, // Return self for simple console logger
    flush: () => Promise.resolve(), // No-op for console logger
  }

  return logger
}
