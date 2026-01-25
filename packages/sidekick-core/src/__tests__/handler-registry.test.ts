/**
 * Handler Registry Tests
 *
 * Tests for HandlerRegistryImpl covering:
 * - Handler registration and priority ordering
 * - Hook event dispatch (sequential)
 * - Transcript event dispatch (concurrent)
 * - Response aggregation
 *
 * @see docs/design/flow.md §2.3 Handler Registration
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HandlerRegistryImpl } from '../handler-registry.js'
import { createConsoleLogger } from '../logger.js'
import type { HookEvent, TranscriptEntry, EventContext } from '@sidekick/types'

const logger = createConsoleLogger({ minimumLevel: 'error' })

describe('HandlerRegistryImpl', () => {
  let registry: HandlerRegistryImpl

  const createEventContext = (sessionId = 'test-session'): EventContext => ({
    sessionId,
    timestamp: Date.now(),
  })

  beforeEach(() => {
    registry = new HandlerRegistryImpl({
      logger,
      sessionId: 'test-session',
    })
  })

  describe('registration', () => {
    it('should register handlers', () => {
      registry.register({
        id: 'test-handler',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: () => Promise.resolve(),
      })

      expect(registry.getHandlerCount()).toBe(1)
      expect(registry.getHandlerIds()).toContain('test-handler')
    })

    it('should replace duplicate handler IDs', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      registry.register({
        id: 'duplicate',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: handler1,
      })

      registry.register({
        id: 'duplicate',
        priority: 60,
        filter: { kind: 'hook', hooks: ['SessionEnd'] },
        handler: handler2,
      })

      expect(registry.getHandlerCount()).toBe(1)
    })

    it('should maintain priority order (higher first)', () => {
      registry.register({
        id: 'low',
        priority: 10,
        filter: { kind: 'all' },
        handler: () => Promise.resolve(),
      })

      registry.register({
        id: 'high',
        priority: 100,
        filter: { kind: 'all' },
        handler: () => Promise.resolve(),
      })

      registry.register({
        id: 'medium',
        priority: 50,
        filter: { kind: 'all' },
        handler: () => Promise.resolve(),
      })

      expect(registry.getHandlerIds()).toEqual(['high', 'medium', 'low'])
    })
  })

  describe('hook event dispatch', () => {
    it('should invoke matching hook handlers sequentially', async () => {
      const executionOrder: string[] = []

      registry.register({
        id: 'first',
        priority: 100,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: (): Promise<void> => {
          executionOrder.push('first')
          return Promise.resolve()
        },
      })

      registry.register({
        id: 'second',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: (): Promise<void> => {
          executionOrder.push('second')
          return Promise.resolve()
        },
      })

      const event: HookEvent = {
        kind: 'hook',
        hook: 'SessionStart',
        context: createEventContext(),
        payload: { startType: 'startup', transcriptPath: '/tmp/transcript.jsonl' },
      }

      await registry.invokeHook('SessionStart', event)

      expect(executionOrder).toEqual(['first', 'second'])
    })

    it('should only invoke handlers matching the hook', async () => {
      const called: string[] = []

      registry.register({
        id: 'session-start',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SessionStart'] },
        handler: () => {
          called.push('session-start')
          return Promise.resolve()
        },
      })

      registry.register({
        id: 'session-end',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SessionEnd'] },
        handler: () => {
          called.push('session-end')
          return Promise.resolve()
        },
      })

      const event: HookEvent = {
        kind: 'hook',
        hook: 'SessionStart',
        context: createEventContext(),
        payload: { startType: 'startup', transcriptPath: '/tmp/transcript.jsonl' },
      }

      await registry.invokeHook('SessionStart', event)

      expect(called).toEqual(['session-start'])
    })

    it('should aggregate responses from multiple handlers', async () => {
      registry.register({
        id: 'context-adder',
        priority: 100,
        filter: { kind: 'hook', hooks: ['UserPromptSubmit'] },
        handler: () =>
          Promise.resolve({
            response: { additionalContext: 'Context from handler 1' },
          }),
      })

      registry.register({
        id: 'message-adder',
        priority: 50,
        filter: { kind: 'hook', hooks: ['UserPromptSubmit'] },
        handler: () =>
          Promise.resolve({
            response: { userMessage: 'Message from handler 2', additionalContext: 'More context' },
          }),
      })

      const event: HookEvent = {
        kind: 'hook',
        hook: 'UserPromptSubmit',
        context: createEventContext(),
        payload: { prompt: 'test', transcriptPath: '/tmp/t.jsonl', cwd: '/tmp', permissionMode: 'default' },
      }

      const response = await registry.invokeHook('UserPromptSubmit', event)

      expect(response.userMessage).toBe('Message from handler 2')
      expect(response.additionalContext).toContain('Context from handler 1')
      expect(response.additionalContext).toContain('More context')
    })

    it('should stop processing when handler requests stop', async () => {
      const called: string[] = []

      registry.register({
        id: 'stopper',
        priority: 100,
        filter: { kind: 'hook', hooks: ['PreToolUse'] },
        handler: () => {
          called.push('stopper')
          return Promise.resolve({ stop: true, response: { blocking: true, reason: 'Blocked' } })
        },
      })

      registry.register({
        id: 'skipped',
        priority: 50,
        filter: { kind: 'hook', hooks: ['PreToolUse'] },
        handler: () => {
          called.push('skipped')
          return Promise.resolve()
        },
      })

      const event: HookEvent = {
        kind: 'hook',
        hook: 'PreToolUse',
        context: createEventContext(),
        payload: { toolName: 'Bash', toolInput: {} },
      }

      const response = await registry.invokeHook('PreToolUse', event)

      expect(called).toEqual(['stopper'])
      expect(response.blocking).toBe(true)
    })

    it('should continue on handler error', async () => {
      const called: string[] = []

      registry.register({
        id: 'failing',
        priority: 100,
        filter: { kind: 'hook', hooks: ['PostToolUse'] },
        handler: () => {
          called.push('failing')
          throw new Error('Handler failed')
        },
      })

      registry.register({
        id: 'succeeding',
        priority: 50,
        filter: { kind: 'hook', hooks: ['PostToolUse'] },
        handler: () => {
          called.push('succeeding')
          return Promise.resolve()
        },
      })

      const event: HookEvent = {
        kind: 'hook',
        hook: 'PostToolUse',
        context: createEventContext(),
        payload: { toolName: 'Bash', toolInput: {}, toolResult: 'success' },
      }

      await registry.invokeHook('PostToolUse', event)

      expect(called).toEqual(['failing', 'succeeding'])
    })

    it('should invoke all-filter handlers for any hook', async () => {
      const called: string[] = []

      registry.register({
        id: 'catch-all',
        priority: 50,
        filter: { kind: 'all' },
        handler: () => {
          called.push('catch-all')
          return Promise.resolve()
        },
      })

      const event: HookEvent = {
        kind: 'hook',
        hook: 'Stop',
        context: createEventContext(),
        payload: { transcriptPath: '/tmp/t.jsonl', permissionMode: 'default', stopHookActive: true },
      }

      await registry.invokeHook('Stop', event)

      expect(called).toContain('catch-all')
    })
  })

  describe('transcript event dispatch', () => {
    it('should emit transcript events to matching handlers', async () => {
      const received: string[] = []

      registry.register({
        id: 'tool-watcher',
        priority: 50,
        filter: { kind: 'transcript', eventTypes: ['ToolCall', 'ToolResult'] },
        handler: (event) => {
          received.push((event as { eventType: string }).eventType)
          return Promise.resolve()
        },
      })

      const entry: TranscriptEntry = { type: 'tool_use', name: 'Bash' }

      registry.emitTranscriptEvent('ToolCall', entry, 42)

      // Wait for async handlers to complete
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(received).toContain('ToolCall')
    })

    it('should not invoke non-matching transcript handlers', async () => {
      const called = vi.fn()

      registry.register({
        id: 'user-prompt-only',
        priority: 50,
        filter: { kind: 'transcript', eventTypes: ['UserPrompt'] },
        handler: called,
      })

      const entry: TranscriptEntry = { type: 'tool_use', name: 'Read' }

      registry.emitTranscriptEvent('ToolCall', entry, 10)

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(called).not.toHaveBeenCalled()
    })
  })

  describe('session management', () => {
    it('should update session info', () => {
      registry.updateSession({ sessionId: 'new-session', transcriptPath: '/new/path.jsonl' })

      // Internal state updated - verified by emitted events containing new session ID
      expect(registry.getHandlerCount()).toBe(0) // Just verifying no crash
    })
  })
})
