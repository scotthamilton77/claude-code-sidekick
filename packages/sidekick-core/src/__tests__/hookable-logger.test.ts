/**
 * Tests for hookable-logger.ts
 *
 * @see STATUS_LOGS.md for design context
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHookableLogger, type LogHook, type HookableLoggerOptions } from '../hookable-logger'
import type { Logger, LogLevel } from '@sidekick/types'

/**
 * Create a mock logger for testing.
 */
function createMockLogger(): Logger & {
  calls: { method: LogLevel; msg: string; meta?: Record<string, unknown> }[]
} {
  const calls: { method: LogLevel; msg: string; meta?: Record<string, unknown> }[] = []

  const logger: Logger & { calls: typeof calls } = {
    calls,
    trace: (msg, meta) => calls.push({ method: 'trace', msg, meta }),
    debug: (msg, meta) => calls.push({ method: 'debug', msg, meta }),
    info: (msg, meta) => calls.push({ method: 'info', msg, meta }),
    warn: (msg, meta) => calls.push({ method: 'warn', msg, meta }),
    error: (msg, meta) => calls.push({ method: 'error', msg, meta }),
    fatal: (msg, meta) => calls.push({ method: 'fatal', msg, meta }),
    child: () => createMockLogger(),
    flush: () => Promise.resolve(),
  }

  return logger
}

describe('createHookableLogger', () => {
  let mockLogger: ReturnType<typeof createMockLogger>
  let hookCalls: { level: LogLevel; msg: string; meta?: Record<string, unknown> }[]
  let hook: LogHook

  beforeEach(() => {
    mockLogger = createMockLogger()
    hookCalls = []
    hook = (level, msg, meta) => {
      hookCalls.push({ level, msg, meta })
    }
  })

  describe('basic functionality', () => {
    it('should pass through all log calls to base logger', () => {
      const hookableLogger = createHookableLogger(mockLogger, { hook })

      hookableLogger.trace('trace msg', { a: 1 })
      hookableLogger.debug('debug msg', { b: 2 })
      hookableLogger.info('info msg', { c: 3 })
      hookableLogger.warn('warn msg', { d: 4 })
      hookableLogger.error('error msg', { e: 5 })
      hookableLogger.fatal('fatal msg', { f: 6 })

      expect(mockLogger.calls).toHaveLength(6)
      expect(mockLogger.calls[0]).toEqual({ method: 'trace', msg: 'trace msg', meta: { a: 1 } })
      expect(mockLogger.calls[1]).toEqual({ method: 'debug', msg: 'debug msg', meta: { b: 2 } })
      expect(mockLogger.calls[2]).toEqual({ method: 'info', msg: 'info msg', meta: { c: 3 } })
      expect(mockLogger.calls[3]).toEqual({ method: 'warn', msg: 'warn msg', meta: { d: 4 } })
      expect(mockLogger.calls[4]).toEqual({ method: 'error', msg: 'error msg', meta: { e: 5 } })
      expect(mockLogger.calls[5]).toEqual({ method: 'fatal', msg: 'fatal msg', meta: { f: 6 } })
    })

    it('should call hook for all levels when no levels filter specified', () => {
      const hookableLogger = createHookableLogger(mockLogger, { hook })

      hookableLogger.trace('trace')
      hookableLogger.debug('debug')
      hookableLogger.info('info')
      hookableLogger.warn('warn')
      hookableLogger.error('error')
      hookableLogger.fatal('fatal')

      expect(hookCalls).toHaveLength(6)
      expect(hookCalls.map((c) => c.level)).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    })
  })

  describe('level filtering', () => {
    it('should only call hook for specified levels', () => {
      const hookableLogger = createHookableLogger(mockLogger, {
        levels: ['warn', 'error', 'fatal'],
        hook,
      })

      hookableLogger.trace('trace')
      hookableLogger.debug('debug')
      hookableLogger.info('info')
      hookableLogger.warn('warn')
      hookableLogger.error('error')
      hookableLogger.fatal('fatal')

      // All should be logged
      expect(mockLogger.calls).toHaveLength(6)

      // But only warn/error/fatal should trigger hook
      expect(hookCalls).toHaveLength(3)
      expect(hookCalls.map((c) => c.level)).toEqual(['warn', 'error', 'fatal'])
    })

    it('should work with single level filter', () => {
      const hookableLogger = createHookableLogger(mockLogger, {
        levels: ['error'],
        hook,
      })

      hookableLogger.warn('warn')
      hookableLogger.error('error')
      hookableLogger.fatal('fatal')

      expect(hookCalls).toHaveLength(1)
      expect(hookCalls[0].level).toBe('error')
    })

    it('should handle empty levels array (no hooks fire)', () => {
      const hookableLogger = createHookableLogger(mockLogger, {
        levels: [],
        hook,
      })

      hookableLogger.warn('warn')
      hookableLogger.error('error')

      expect(mockLogger.calls).toHaveLength(2)
      expect(hookCalls).toHaveLength(0)
    })
  })

  describe('metadata handling', () => {
    it('should pass metadata to hook', () => {
      const hookableLogger = createHookableLogger(mockLogger, { hook })

      const meta = { sessionId: 'abc123', context: { foo: 'bar' } }
      hookableLogger.warn('warning message', meta)

      expect(hookCalls).toHaveLength(1)
      expect(hookCalls[0].msg).toBe('warning message')
      expect(hookCalls[0].meta).toEqual(meta)
    })

    it('should handle undefined metadata', () => {
      const hookableLogger = createHookableLogger(mockLogger, { hook })

      hookableLogger.error('error without meta')

      expect(hookCalls).toHaveLength(1)
      expect(hookCalls[0].meta).toBeUndefined()
    })
  })

  describe('child logger', () => {
    it('should wrap child loggers with the same hook', () => {
      const hookableLogger = createHookableLogger(mockLogger, {
        levels: ['warn', 'error'],
        hook,
      })

      const childLogger = hookableLogger.child({ component: 'test' })

      childLogger.info('info from child')
      childLogger.warn('warn from child')
      childLogger.error('error from child')

      // Only warn and error should trigger hook from child
      expect(hookCalls).toHaveLength(2)
      expect(hookCalls[0].level).toBe('warn')
      expect(hookCalls[1].level).toBe('error')
    })
  })

  describe('flush', () => {
    it('should call flush on base logger', async () => {
      const flushSpy = vi.fn().mockResolvedValue(undefined)
      mockLogger.flush = flushSpy

      const hookableLogger = createHookableLogger(mockLogger, { hook })
      await hookableLogger.flush()

      expect(flushSpy).toHaveBeenCalledOnce()
    })
  })

  describe('use case: log counting', () => {
    it('should enable counting warnings and errors by session', () => {
      // Simulate the use case from STATUS_LOGS.md
      const counters = new Map<string, { warnings: number; errors: number }>()
      counters.set('session-1', { warnings: 0, errors: 0 })
      counters.set('session-2', { warnings: 0, errors: 0 })

      const countingHook: LogHook = (level, _msg, meta) => {
        const sessionId =
          (meta?.context as { sessionId?: string })?.sessionId ?? (meta as { sessionId?: string })?.sessionId
        if (sessionId && counters.has(sessionId)) {
          const counter = counters.get(sessionId)!
          if (level === 'warn') counter.warnings++
          else counter.errors++ // error and fatal
        }
      }

      const hookableLogger = createHookableLogger(mockLogger, {
        levels: ['warn', 'error', 'fatal'],
        hook: countingHook,
      })

      // Log to session-1
      hookableLogger.warn('warning 1', { sessionId: 'session-1' })
      hookableLogger.error('error 1', { sessionId: 'session-1' })
      hookableLogger.error('error 2', { context: { sessionId: 'session-1' } })

      // Log to session-2
      hookableLogger.warn('warning 2', { sessionId: 'session-2' })
      hookableLogger.fatal('fatal 1', { sessionId: 'session-2' })

      // Log without session (should not count)
      hookableLogger.warn('warning without session')
      hookableLogger.error('error without session')

      expect(counters.get('session-1')).toEqual({ warnings: 1, errors: 2 })
      expect(counters.get('session-2')).toEqual({ warnings: 1, errors: 1 })
    })
  })
})
