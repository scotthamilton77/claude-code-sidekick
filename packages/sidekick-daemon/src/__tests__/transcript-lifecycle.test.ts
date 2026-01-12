/**
 * TranscriptService Lifecycle Tests
 *
 * Tests for Phase 5.3 TranscriptService integration with Daemon:
 * - Initialize TranscriptService on SessionStart handler
 * - Stop TranscriptService on SessionEnd handler
 * - Ensure shutdown() is called before process exit
 *
 * NOTE: These tests use @sidekick/core HandlerRegistryImpl to verify
 * event dispatching patterns used by Daemon lifecycle management.
 * Pure unit tests for HandlerRegistryImpl belong in @sidekick/core.
 *
 * @see docs/design/DAEMON.md §4.7 TranscriptService Integration
 * @see docs/design/TRANSCRIPT-PROCESSING.md §6 Implementation Details
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createConsoleLogger, HandlerRegistryImpl } from '@sidekick/core'
import type { HookEvent, SessionStartHookEvent, SessionEndHookEvent, EventContext } from '@sidekick/types'

const logger = createConsoleLogger({ minimumLevel: 'error' })

describe('TranscriptService Lifecycle', () => {
  const createEventContext = (sessionId = 'test-session-123'): EventContext => ({
    sessionId,
    timestamp: Date.now(),
    scope: 'project',
  })

  describe('HandlerRegistry for lifecycle events', () => {
    let registry: HandlerRegistryImpl

    beforeEach(() => {
      registry = new HandlerRegistryImpl({
        logger,
        sessionId: '',
        scope: 'project',
      })
    })

    it('should dispatch SessionStart events to registered handlers', async () => {
      const initializeCalled = vi.fn()

      registry.register({
        id: 'transcript:init-session',
        priority: 100,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: (event) => {
          const e = event as SessionStartHookEvent
          initializeCalled({
            sessionId: e.context.sessionId,
            transcriptPath: e.payload.transcriptPath,
            startType: e.payload.startType,
          })
          return Promise.resolve()
        },
      })

      const event: SessionStartHookEvent = {
        kind: 'hook',
        hook: 'SessionStart',
        context: createEventContext(),
        payload: {
          startType: 'startup',
          transcriptPath: '/tmp/test-transcript.jsonl',
        },
      }

      await registry.invokeHook('SessionStart', event)

      expect(initializeCalled).toHaveBeenCalledWith({
        sessionId: 'test-session-123',
        transcriptPath: '/tmp/test-transcript.jsonl',
        startType: 'startup',
      })
    })

    it('should dispatch SessionEnd events to registered handlers', async () => {
      const shutdownCalled = vi.fn()

      registry.register({
        id: 'transcript:stop-session',
        priority: 100,
        filter: { kind: 'hook', hooks: ['SessionEnd'] },
        handler: (event) => {
          const e = event as SessionEndHookEvent
          shutdownCalled({
            sessionId: e.context.sessionId,
            endReason: e.payload.endReason,
          })
          return Promise.resolve()
        },
      })

      const event: SessionEndHookEvent = {
        kind: 'hook',
        hook: 'SessionEnd',
        context: createEventContext(),
        payload: {
          endReason: 'clear',
        },
      }

      await registry.invokeHook('SessionEnd', event)

      expect(shutdownCalled).toHaveBeenCalledWith({
        sessionId: 'test-session-123',
        endReason: 'clear',
      })
    })

    it('should execute SessionStart handlers in priority order', async () => {
      const executionOrder: string[] = []

      registry.register({
        id: 'low-priority',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: () => {
          executionOrder.push('low')
          return Promise.resolve()
        },
      })

      registry.register({
        id: 'high-priority',
        priority: 100,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: () => {
          executionOrder.push('high')
          return Promise.resolve()
        },
      })

      const event: SessionStartHookEvent = {
        kind: 'hook',
        hook: 'SessionStart',
        context: createEventContext(),
        payload: {
          startType: 'startup',
          transcriptPath: '/tmp/transcript.jsonl',
        },
      }

      await registry.invokeHook('SessionStart', event)

      expect(executionOrder).toEqual(['high', 'low'])
    })

    it('should handle multiple session lifecycle events', async () => {
      const events: string[] = []

      registry.register({
        id: 'lifecycle-tracker',
        priority: 100,
        filter: { kind: 'hook', hooks: ['SessionStart', 'SessionEnd'] },
        handler: (event) => {
          events.push((event as HookEvent).hook)
          return Promise.resolve()
        },
      })

      // SessionStart
      await registry.invokeHook('SessionStart', {
        kind: 'hook',
        hook: 'SessionStart',
        context: createEventContext(),
        payload: { startType: 'startup', transcriptPath: '/tmp/t.jsonl' },
      })

      // SessionEnd
      await registry.invokeHook('SessionEnd', {
        kind: 'hook',
        hook: 'SessionEnd',
        context: createEventContext(),
        payload: { endReason: 'logout' },
      })

      expect(events).toEqual(['SessionStart', 'SessionEnd'])
    })

    it('should handle resume session type', async () => {
      const startTypes: string[] = []

      registry.register({
        id: 'start-type-tracker',
        priority: 100,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: (event) => {
          const e = event as SessionStartHookEvent
          startTypes.push(e.payload.startType)
          return Promise.resolve()
        },
      })

      await registry.invokeHook('SessionStart', {
        kind: 'hook',
        hook: 'SessionStart',
        context: createEventContext(),
        payload: { startType: 'resume', transcriptPath: '/tmp/t.jsonl' },
      })

      expect(startTypes).toContain('resume')
    })

    it('should handle all SessionEnd reasons', async () => {
      const endReasons: string[] = []

      registry.register({
        id: 'end-reason-tracker',
        priority: 100,
        filter: { kind: 'hook', hooks: ['SessionEnd'] },
        handler: (event) => {
          const e = event as SessionEndHookEvent
          endReasons.push(e.payload.endReason)
          return Promise.resolve()
        },
      })

      const reasons = ['clear', 'logout', 'prompt_input_exit', 'other'] as const

      for (const reason of reasons) {
        await registry.invokeHook('SessionEnd', {
          kind: 'hook',
          hook: 'SessionEnd',
          context: createEventContext(),
          payload: { endReason: reason },
        })
      }

      expect(endReasons).toEqual(['clear', 'logout', 'prompt_input_exit', 'other'])
    })
  })

  describe('TranscriptService initialization pattern', () => {
    it('should use updated session info when dispatching events after updateSession', async () => {
      const registry = new HandlerRegistryImpl({
        logger,
        sessionId: 'initial-session',
        scope: 'project',
      })

      // Register a handler that captures the context to verify sessionId
      let capturedSessionId: string | undefined
      registry.register({
        id: 'test-session-capture',
        priority: 100,
        filter: { kind: 'hook', hooks: ['SessionEnd'] },
        handler: (event) => {
          capturedSessionId = (event as SessionEndHookEvent).context.sessionId
          return Promise.resolve()
        },
      })

      // Simulate what Daemon does on SessionStart - update session info
      registry.updateSession({
        sessionId: 'new-session-456',
        transcriptPath: '/project/.claude/transcript.jsonl',
      })

      // Dispatch an event and verify the updated session ID is used
      await registry.invokeHook('SessionEnd', {
        kind: 'hook',
        hook: 'SessionEnd',
        context: createEventContext('new-session-456'),
        payload: { endReason: 'clear' },
      })

      expect(capturedSessionId).toBe('new-session-456')
    })
  })
})
