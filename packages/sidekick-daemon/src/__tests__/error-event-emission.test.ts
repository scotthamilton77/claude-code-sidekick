import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHookableLogger } from '@sidekick/core'
import type { Logger } from '@sidekick/types'

describe('HookableLogger error event emission', () => {
  let baseLogger: Logger
  let hookCalls: Array<{ level: string; msg: string; meta?: Record<string, unknown> }>

  beforeEach(() => {
    hookCalls = []
    baseLogger = {
      trace: vi.fn() as any,
      debug: vi.fn() as any,
      info: vi.fn() as any,
      warn: vi.fn() as any,
      error: vi.fn() as any,
      fatal: vi.fn() as any,
      child: vi.fn(() => baseLogger) as any,
      flush: vi.fn() as any,
    }
  })

  it('hook fires for error level logs', () => {
    const logger = createHookableLogger(baseLogger, {
      levels: ['error', 'fatal'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
      },
    })

    logger.error('Something failed', { error: new Error('boom') })

    expect(hookCalls).toHaveLength(1)
    expect(hookCalls[0].level).toBe('error')
    expect(hookCalls[0].msg).toBe('Something failed')
  })

  it('hook fires for fatal level logs', () => {
    const logger = createHookableLogger(baseLogger, {
      levels: ['error', 'fatal'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
      },
    })

    logger.fatal('Critical failure', { error: new Error('catastrophe') })

    expect(hookCalls).toHaveLength(1)
    expect(hookCalls[0].level).toBe('fatal')
  })

  it('hook does not fire for warn level when only error/fatal configured', () => {
    const logger = createHookableLogger(baseLogger, {
      levels: ['error', 'fatal'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
      },
    })

    logger.warn('Just a warning')

    expect(hookCalls).toHaveLength(0)
  })

  it('meta includes error object for stack extraction', () => {
    const logger = createHookableLogger(baseLogger, {
      levels: ['error'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
      },
    })

    const err = new Error('test error')
    logger.error('Operation failed', { error: err, context: { sessionId: 'sess-1' } })

    expect(hookCalls[0].meta).toEqual(
      expect.objectContaining({
        error: err,
        context: expect.objectContaining({ sessionId: 'sess-1' }),
      })
    )
  })
})
