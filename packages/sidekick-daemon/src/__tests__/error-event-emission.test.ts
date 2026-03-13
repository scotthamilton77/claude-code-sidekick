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

  it('hook fires and base logger receives the original error log', () => {
    const logger = createHookableLogger(baseLogger, {
      levels: ['error', 'fatal'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
      },
    })

    logger.error('Something failed', { error: new Error('boom') })

    // Hook was invoked
    expect(hookCalls).toHaveLength(1)
    expect(hookCalls[0].level).toBe('error')
    expect(hookCalls[0].msg).toBe('Something failed')

    // Base logger received the original error call (delegation, not swallowed)
    expect(baseLogger.error).toHaveBeenCalledWith('Something failed', { error: expect.any(Error) })
  })

  it('hook fires for fatal level and base logger receives it', () => {
    const logger = createHookableLogger(baseLogger, {
      levels: ['error', 'fatal'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
      },
    })

    logger.fatal('Critical failure', { error: new Error('catastrophe') })

    expect(hookCalls).toHaveLength(1)
    expect(hookCalls[0].level).toBe('fatal')
    expect(baseLogger.fatal).toHaveBeenCalledOnce()
  })

  it('no recursion: hook logging to base logger info does not re-trigger hook', () => {
    // Simulate what daemon does: hook logs error:occurred event via base logger info
    const logger = createHookableLogger(baseLogger, {
      levels: ['error', 'fatal'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
        // Daemon emits error:occurred as info-level on the BASE logger (not the hookable one)
        // This verifies the pattern doesn't cause recursion
        baseLogger.info('error:occurred', { type: 'error:occurred', errorMessage: msg })
      },
    })

    logger.error('Test error')

    // Hook fired exactly once (no recursion)
    expect(hookCalls).toHaveLength(1)
    // Base logger got both the original error AND the info-level error:occurred event
    expect(baseLogger.error).toHaveBeenCalledOnce()
    expect(baseLogger.info).toHaveBeenCalledWith(
      'error:occurred',
      expect.objectContaining({
        type: 'error:occurred',
        errorMessage: 'Test error',
      })
    )
  })

  it('hook does not fire for non-configured levels', () => {
    const logger = createHookableLogger(baseLogger, {
      levels: ['error', 'fatal'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
      },
    })

    logger.warn('Just a warning')
    logger.info('Just info')

    expect(hookCalls).toHaveLength(0)
    // But base logger still receives them
    expect(baseLogger.warn).toHaveBeenCalledOnce()
    expect(baseLogger.info).toHaveBeenCalledOnce()
  })

  it('meta includes context for field extraction', () => {
    const logger = createHookableLogger(baseLogger, {
      levels: ['error'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
      },
    })

    const err = new Error('test error')
    logger.error('Operation failed', {
      error: err,
      context: { sessionId: 'sess-1', hook: 'Stop', taskId: 'task-42' },
    })

    expect(hookCalls[0].meta).toEqual(
      expect.objectContaining({
        error: err,
        context: expect.objectContaining({
          sessionId: 'sess-1',
          hook: 'Stop',
          taskId: 'task-42',
        }),
      })
    )
  })
})
