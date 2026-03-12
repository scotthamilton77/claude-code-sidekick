import { describe, it, expect, vi } from 'vitest'
import { LogEvents, logEvent } from '../structured-logging'
import type { Logger } from '@sidekick/types'

describe('LogEvents.errorOccurred', () => {
  const context = {
    sessionId: 'test-session-123',
    correlationId: 'corr-456',
    traceId: 'trace-789',
    hook: undefined,
    taskId: undefined,
  }

  it('creates event with required fields', () => {
    const event = LogEvents.errorOccurred(context, {
      errorMessage: 'Something broke',
      source: 'daemon',
    })

    expect(event.type).toBe('error:occurred')
    expect(event.source).toBe('daemon')
    expect(event.time).toBeGreaterThan(0)
    expect(event.context.sessionId).toBe('test-session-123')
    expect(event.payload.errorMessage).toBe('Something broke')
    expect(event.payload.errorStack).toBeUndefined()
    expect(event.payload.source).toBe('daemon')
  })

  it('includes optional errorStack', () => {
    const event = LogEvents.errorOccurred(context, {
      errorMessage: 'Kaboom',
      errorStack: 'Error: Kaboom\n    at foo.ts:42',
      source: 'daemon',
    })

    expect(event.payload.errorStack).toBe('Error: Kaboom\n    at foo.ts:42')
  })

  it('works with cli source', () => {
    const event = LogEvents.errorOccurred(context, {
      errorMessage: 'CLI error',
      source: 'cli',
    })

    expect(event.source).toBe('cli')
    expect(event.payload.source).toBe('cli')
  })

  it('preserves context fields', () => {
    const event = LogEvents.errorOccurred(context, {
      errorMessage: 'Test error',
      source: 'daemon',
    })

    expect(event.context).toEqual({
      sessionId: 'test-session-123',
      correlationId: 'corr-456',
      traceId: 'trace-789',
      hook: undefined,
      taskId: undefined,
    })
  })

  it('works with logEvent helper', () => {
    const mockLogger: Logger = {
      trace: vi.fn() as any,
      debug: vi.fn() as any,
      info: vi.fn() as any,
      warn: vi.fn() as any,
      error: vi.fn() as any,
      fatal: vi.fn() as any,
      child: vi.fn() as any,
      flush: vi.fn() as any,
    }

    const event = LogEvents.errorOccurred(context, {
      errorMessage: 'Test error',
      source: 'daemon',
    })
    logEvent(mockLogger, event)

    expect(mockLogger.info).toHaveBeenCalledWith(
      'error:occurred',
      expect.objectContaining({
        type: 'error:occurred',
        source: 'daemon',
        errorMessage: 'Test error',
      })
    )
  })
})
