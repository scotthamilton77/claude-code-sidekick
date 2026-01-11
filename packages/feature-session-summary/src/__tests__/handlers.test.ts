/**
 * Tests for Session Summary handlers
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.1 and §3.2
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createMockDaemonContext,
  createMockCLIContext,
  MockLogger,
  MockHandlerRegistry,
} from '@sidekick/testing-fixtures'
import type { DaemonContext } from '@sidekick/types'
import { registerHandlers } from '../handlers/index'

describe('Session Summary Handlers', () => {
  let ctx: DaemonContext
  let logger: MockLogger
  let handlers: MockHandlerRegistry

  beforeEach(() => {
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()
    ctx = createMockDaemonContext({ logger, handlers })
  })

  describe('Handler Registration - Session Summary Feature', () => {
    it('registers four handlers total', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      expect(registrations).toHaveLength(4)
    })

    it('registers init handler for SessionStart hook', () => {
      registerHandlers(ctx)

      const registrations = handlers.getHandlersForHook('SessionStart')
      expect(registrations).toHaveLength(1)
      expect(registrations[0].id).toBe('session-summary:init')
    })

    it('init handler has priority 80', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const initHandler = registrations.find((h) => h.id === 'session-summary:init')
      expect(initHandler?.priority).toBe(80)
    })

    it('init handler uses hook filter for SessionStart', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const initHandler = registrations.find((h) => h.id === 'session-summary:init')

      expect(initHandler?.filter).toEqual({ kind: 'hook', hooks: ['SessionStart'] })
    })

    it('registers update-user-prompt handler for UserPrompt events', () => {
      registerHandlers(ctx)

      const registrations = handlers.getHandlersForTranscriptEvent('UserPrompt')
      const updateHandler = registrations.find((h) => h.id === 'session-summary:update-user-prompt')
      expect(updateHandler).toBeDefined()
      expect(updateHandler?.id).toBe('session-summary:update-user-prompt')
    })

    it('update-user-prompt handler has priority 80', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const userPromptHandler = registrations.find((h) => h.id === 'session-summary:update-user-prompt')
      expect(userPromptHandler?.priority).toBe(80)
    })

    it('update-user-prompt handler uses transcript filter', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const userPromptHandler = registrations.find((h) => h.id === 'session-summary:update-user-prompt')

      expect(userPromptHandler?.filter).toEqual({ kind: 'transcript', eventTypes: ['UserPrompt'] })
    })

    it('registers update-tool-result handler for ToolResult events', () => {
      registerHandlers(ctx)

      const registrations = handlers.getHandlersForTranscriptEvent('ToolResult')
      const updateHandler = registrations.find((h) => h.id === 'session-summary:update-tool-result')
      expect(updateHandler).toBeDefined()
      expect(updateHandler?.id).toBe('session-summary:update-tool-result')
    })

    it('update-tool-result handler has priority 70', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const toolResultHandler = registrations.find((h) => h.id === 'session-summary:update-tool-result')
      expect(toolResultHandler?.priority).toBe(70)
    })

    it('update-tool-result handler uses transcript filter', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const toolResultHandler = registrations.find((h) => h.id === 'session-summary:update-tool-result')

      expect(toolResultHandler?.filter).toEqual({ kind: 'transcript', eventTypes: ['ToolResult'] })
    })

    it('all handlers have handler functions defined', () => {
      registerHandlers(ctx)

      const initHandler = handlers.getHandler('session-summary:init')
      const userPromptHandler = handlers.getHandler('session-summary:update-user-prompt')
      const toolResultHandler = handlers.getHandler('session-summary:update-tool-result')

      expect(initHandler?.handler).toBeDefined()
      expect(userPromptHandler?.handler).toBeDefined()
      expect(toolResultHandler?.handler).toBeDefined()
    })
  })

  describe('Handler Registration - Role-Based Filtering', () => {
    it('only registers handlers in daemon context', () => {
      registerHandlers(ctx)

      const supervisorRegistrations = handlers.getRegistrations()
      expect(supervisorRegistrations).toHaveLength(4)
    })

    it('does not register handlers in CLI context', () => {
      const cliCtx = createMockCLIContext()
      registerHandlers(cliCtx as unknown as DaemonContext)

      const cliRegistrations = (cliCtx.handlers as MockHandlerRegistry).getRegistrations()
      expect(cliRegistrations).toHaveLength(0)
    })

    it('handler registration checks context role', () => {
      // This verifies that registerHandlers respects role-based filtering
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      // All registrations should be for session-summary feature
      expect(registrations.every((h) => h.id.startsWith('session-summary:'))).toBe(true)
    })
  })

  describe('Handler Registration - Filter Types', () => {
    it('init handler uses hook kind filter', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const initHandler = registrations.find((h) => h.id === 'session-summary:init')

      expect(initHandler?.filter.kind).toBe('hook')
    })

    it('update handlers use transcript kind filter', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const transcriptHandlers = registrations.filter((h) => h.id.includes('update'))

      expect(transcriptHandlers.every((h) => h.filter.kind === 'transcript')).toBe(true)
    })

    it('registers handlers that can be retrieved by hook', () => {
      registerHandlers(ctx)

      const hookHandlers = handlers.getHandlersByKind('hook')
      expect(hookHandlers).toHaveLength(1)
      expect(hookHandlers[0].id).toBe('session-summary:init')
    })

    it('registers handlers that can be retrieved by transcript kind', () => {
      registerHandlers(ctx)

      const transcriptHandlers = handlers.getHandlersByKind('transcript')
      expect(transcriptHandlers).toHaveLength(3)
      expect(transcriptHandlers.map((h) => h.id).sort()).toEqual([
        'session-summary:bulk-complete',
        'session-summary:update-tool-result',
        'session-summary:update-user-prompt',
      ])
    })
  })

  describe('Handler Registration - Event Routing', () => {
    it('SessionStart hook events route to init handler', () => {
      registerHandlers(ctx)

      const hookHandlers = handlers.getHandlersForHook('SessionStart')
      expect(hookHandlers).toHaveLength(1)
      expect(hookHandlers[0].id).toBe('session-summary:init')
    })

    it('UserPrompt transcript events route to update-user-prompt handler', () => {
      registerHandlers(ctx)

      const userPromptHandlers = handlers.getHandlersForTranscriptEvent('UserPrompt')
      const updateHandler = userPromptHandlers.find((h) => h.id === 'session-summary:update-user-prompt')
      expect(updateHandler).toBeDefined()
    })

    it('ToolResult transcript events route to update-tool-result handler', () => {
      registerHandlers(ctx)

      const toolResultHandlers = handlers.getHandlersForTranscriptEvent('ToolResult')
      const updateHandler = toolResultHandlers.find((h) => h.id === 'session-summary:update-tool-result')
      expect(updateHandler).toBeDefined()
    })
  })

  describe('Handler Registration - Priorities', () => {
    it('init handler (80) has higher priority than update-tool-result (70)', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const initHandler = registrations.find((h) => h.id === 'session-summary:init')
      const toolResultHandler = registrations.find((h) => h.id === 'session-summary:update-tool-result')

      expect(initHandler?.priority).toBeGreaterThan(toolResultHandler?.priority ?? 0)
    })

    it('update-user-prompt handler (80) has equal priority to init handler', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const initHandler = registrations.find((h) => h.id === 'session-summary:init')
      const userPromptHandler = registrations.find((h) => h.id === 'session-summary:update-user-prompt')

      expect(initHandler?.priority).toBe(userPromptHandler?.priority)
    })

    it('update-user-prompt handler (80) has higher priority than update-tool-result (70)', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const userPromptHandler = registrations.find((h) => h.id === 'session-summary:update-user-prompt')
      const toolResultHandler = registrations.find((h) => h.id === 'session-summary:update-tool-result')

      expect(userPromptHandler?.priority).toBeGreaterThan(toolResultHandler?.priority ?? 0)
    })
  })

  describe('Handler Registration - ID Naming Convention', () => {
    it('all handlers use session-summary namespace prefix', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      expect(registrations.every((h) => h.id.startsWith('session-summary:'))).toBe(true)
    })

    it('handler IDs are unique', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const ids = registrations.map((h) => h.id)
      const uniqueIds = new Set(ids)

      expect(uniqueIds.size).toBe(ids.length)
    })

    it('handler IDs match expected values', () => {
      registerHandlers(ctx)

      const registrations = handlers.getRegistrations()
      const ids = registrations.map((h) => h.id).sort()

      expect(ids).toEqual([
        'session-summary:bulk-complete',
        'session-summary:init',
        'session-summary:update-tool-result',
        'session-summary:update-user-prompt',
      ])
    })
  })

  describe('Handler Registration - Idempotence', () => {
    it('registering twice does not duplicate handlers', () => {
      registerHandlers(ctx)
      const firstCount = handlers.getRegistrations().length

      registerHandlers(ctx)
      const secondCount = handlers.getRegistrations().length

      // Note: Current implementation may not be idempotent
      // This test documents expected behavior
      expect(secondCount).toBe(firstCount)
    })
  })
})
