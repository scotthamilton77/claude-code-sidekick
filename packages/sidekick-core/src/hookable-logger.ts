/**
 * Hookable Logger - Logger wrapper with level-filtered callbacks
 *
 * Enables log counting/monitoring by injecting hooks that fire for specific log levels.
 * Used by Supervisor and CLI to track warnings/errors per session.
 *
 * @see STATUS_LOGS.md for design context
 */

import type { Logger, LogLevel } from '@sidekick/types'

/**
 * Callback invoked when a log at a matching level is emitted.
 * Receives the full metadata including sessionId from context.
 */
export interface LogHook {
  (level: LogLevel, msg: string, meta?: Record<string, unknown>): void
}

/**
 * Options for creating a hookable logger wrapper.
 */
export interface HookableLoggerOptions {
  /** Levels to trigger the hook (default: all levels) */
  levels?: LogLevel[]
  /** Callback invoked for matching log levels */
  hook: LogHook
}

/**
 * Wrap a logger to add hooks for specific log levels.
 * Hooks receive the full metadata including sessionId from context.
 *
 * @example
 * ```typescript
 * const countingLogger = createHookableLogger(baseLogger, {
 *   levels: ['warn', 'error', 'fatal'],
 *   hook: (level, msg, meta) => {
 *     const sessionId = meta?.sessionId
 *     if (sessionId) {
 *       if (level === 'warn') counters[sessionId].warnings++
 *       else counters[sessionId].errors++
 *     }
 *   }
 * })
 * ```
 */
export function createHookableLogger(baseLogger: Logger, options: HookableLoggerOptions): Logger {
  const { levels, hook } = options
  const allLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
  const targetLevels = new Set(levels ?? allLevels)

  const maybeHook = (level: LogLevel, msg: string, meta?: Record<string, unknown>): void => {
    if (targetLevels.has(level)) {
      hook(level, msg, meta)
    }
  }

  return {
    trace: (msg, meta) => {
      maybeHook('trace', msg, meta)
      baseLogger.trace(msg, meta)
    },
    debug: (msg, meta) => {
      maybeHook('debug', msg, meta)
      baseLogger.debug(msg, meta)
    },
    info: (msg, meta) => {
      maybeHook('info', msg, meta)
      baseLogger.info(msg, meta)
    },
    warn: (msg, meta) => {
      maybeHook('warn', msg, meta)
      baseLogger.warn(msg, meta)
    },
    error: (msg, meta) => {
      maybeHook('error', msg, meta)
      baseLogger.error(msg, meta)
    },
    fatal: (msg, meta) => {
      maybeHook('fatal', msg, meta)
      baseLogger.fatal(msg, meta)
    },
    child: (bindings) => createHookableLogger(baseLogger.child(bindings), options),
    flush: () => baseLogger.flush(),
  }
}
