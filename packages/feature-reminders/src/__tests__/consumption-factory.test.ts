/**
 * Tests for consumption handler factory
 * @see docs/design/FEATURE-REMINDERS.md §3.1 Consumption Handlers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  createMockCLIContext,
  createMockSupervisorContext,
  MockLogger,
  MockHandlerRegistry,
} from '@sidekick/testing-fixtures'
import type { CLIContext, PreToolUseHookEvent, StopHookEvent } from '@sidekick/types'
import { createConsumptionHandler } from '../handlers/consumption/consumption-handler-factory'

// Test staging directory
const testStateDir = '/tmp/test-consumption-factory'
const sessionId = 'test-session-factory'

function createPreToolUseEvent(): PreToolUseHookEvent {
  return {
    kind: 'hook',
    hook: 'PreToolUse',
    context: { sessionId, timestamp: Date.now() },
    payload: { toolName: 'Read', toolInput: {} },
  }
}

function createStopEvent(): StopHookEvent {
  return {
    kind: 'hook',
    hook: 'Stop',
    context: { sessionId, timestamp: Date.now() },
    payload: {
      transcriptPath: '/test/transcript.jsonl',
      permissionMode: 'default',
      stopHookActive: true,
    },
  }
}

describe('createConsumptionHandler', () => {
  let ctx: CLIContext
  let logger: MockLogger
  let handlers: MockHandlerRegistry

  beforeEach(() => {
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()

    // Create staging directory structure
    // CLIStagingReader uses: projectConfigDir/sessions/sessionId/stage/hook
    const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage')
    mkdirSync(join(stagingDir, 'PreToolUse'), { recursive: true })
    mkdirSync(join(stagingDir, 'Stop'), { recursive: true })

    ctx = createMockCLIContext({
      logger,
      handlers,
      paths: {
        projectDir: '/mock/project',
        userConfigDir: '/mock/user',
        projectConfigDir: testStateDir, // CLIStagingReader uses projectConfigDir
      },
    })
  })

  afterEach(() => {
    rmSync(testStateDir, { recursive: true, force: true })
  })

  describe('registration', () => {
    it('only registers handler in CLI context', () => {
      const supervisorCtx = createMockSupervisorContext()

      createConsumptionHandler(supervisorCtx as unknown as CLIContext, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      expect((supervisorCtx.handlers as MockHandlerRegistry).getRegistrations()).toHaveLength(0)
    })

    it('registers handler in CLI context', () => {
      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      const registrations = handlers.getRegistrations()
      expect(registrations).toHaveLength(1)
      expect(registrations[0].id).toBe('test:consume')
    })

    it('registers with hook filter', () => {
      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'Stop',
      })

      const registrations = handlers.getHandlersForHook('Stop')
      expect(registrations).toHaveLength(1)
    })

    it('uses default priority of 50', () => {
      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      expect(handlers.getRegistrations()[0].priority).toBe(50)
    })

    it('accepts custom priority', () => {
      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
        priority: 75,
      })

      expect(handlers.getRegistrations()[0].priority).toBe(75)
    })
  })

  describe('consumption behavior', () => {
    it('returns empty response when no reminders staged', async () => {
      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      const handler = handlers.getHandler('test:consume')
      const result = await handler?.handler(
        createPreToolUseEvent(),
        ctx as unknown as import('@sidekick/types').HandlerContext
      )

      expect(result).toEqual({ response: {} })
    })

    it('returns reminder content from staged file', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')
      writeFileSync(
        join(stagingDir, 'test-reminder.json'),
        JSON.stringify({
          name: 'test-reminder',
          blocking: false,
          priority: 50,
          persistent: false,
          additionalContext: 'Test context',
        })
      )

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      const handler = handlers.getHandler('test:consume')
      const result = await handler?.handler(
        createPreToolUseEvent(),
        ctx as unknown as import('@sidekick/types').HandlerContext
      )

      expect(result).toEqual({
        response: { additionalContext: 'Test context' },
      })
    })

    it('includes userMessage in response when present', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')
      writeFileSync(
        join(stagingDir, 'test.json'),
        JSON.stringify({
          name: 'test',
          priority: 50,
          userMessage: 'Hello user',
          additionalContext: 'Context here',
        })
      )

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      const handler = handlers.getHandler('test:consume')
      const result = await handler?.handler(
        createPreToolUseEvent(),
        ctx as unknown as import('@sidekick/types').HandlerContext
      )

      expect(result).toEqual({
        response: {
          userMessage: 'Hello user',
          additionalContext: 'Context here',
        },
      })
    })

    it('deletes non-persistent reminder after consumption', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')
      const reminderPath = join(stagingDir, 'one-shot.json')
      writeFileSync(
        reminderPath,
        JSON.stringify({
          name: 'one-shot',
          priority: 50,
          persistent: false,
        })
      )

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      const handler = handlers.getHandler('test:consume')
      await handler?.handler(createPreToolUseEvent(), ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(existsSync(reminderPath)).toBe(false)
    })

    it('preserves persistent reminder after consumption', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')
      const reminderPath = join(stagingDir, 'persistent.json')
      writeFileSync(
        reminderPath,
        JSON.stringify({
          name: 'persistent',
          priority: 50,
          persistent: true,
        })
      )

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      const handler = handlers.getHandler('test:consume')
      await handler?.handler(createPreToolUseEvent(), ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(existsSync(reminderPath)).toBe(true)
    })
  })

  describe('blocking behavior', () => {
    it('does not include blocking fields when supportsBlocking is false', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')
      writeFileSync(
        join(stagingDir, 'blocking.json'),
        JSON.stringify({
          name: 'blocking',
          blocking: true,
          priority: 80,
          reason: 'Should not appear',
        })
      )

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
        supportsBlocking: false,
      })

      const handler = handlers.getHandler('test:consume')
      const result = await handler?.handler(
        createPreToolUseEvent(),
        ctx as unknown as import('@sidekick/types').HandlerContext
      )

      expect(result).toEqual({ response: {} })
      expect((result as { response: Record<string, unknown> }).response.blocking).toBeUndefined()
    })

    it('includes blocking fields when supportsBlocking is true', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'Stop')
      writeFileSync(
        join(stagingDir, 'blocking.json'),
        JSON.stringify({
          name: 'blocking',
          blocking: true,
          priority: 80,
          reason: 'Verify completion',
        })
      )

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'Stop',
        supportsBlocking: true,
      })

      const handler = handlers.getHandler('test:consume')
      const result = await handler?.handler(
        createStopEvent(),
        ctx as unknown as import('@sidekick/types').HandlerContext
      )

      expect(result).toEqual({
        response: {
          blocking: true,
          reason: 'Verify completion',
        },
      })
    })

    it('does not block when reminder.blocking is false', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'Stop')
      writeFileSync(
        join(stagingDir, 'non-blocking.json'),
        JSON.stringify({
          name: 'non-blocking',
          blocking: false,
          priority: 50,
          additionalContext: 'Just info',
        })
      )

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'Stop',
        supportsBlocking: true,
      })

      const handler = handlers.getHandler('test:consume')
      const result = await handler?.handler(
        createStopEvent(),
        ctx as unknown as import('@sidekick/types').HandlerContext
      )

      expect(result).toEqual({
        response: { additionalContext: 'Just info' },
      })
    })
  })

  describe('suppression behavior', () => {
    it('returns empty response when hook is suppressed', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'Stop')
      writeFileSync(join(stagingDir, 'reminder.json'), JSON.stringify({ name: 'reminder', priority: 50 }))
      writeFileSync(join(stagingDir, '.suppressed'), '')

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'Stop',
      })

      const handler = handlers.getHandler('test:consume')
      const result = await handler?.handler(
        createStopEvent(),
        ctx as unknown as import('@sidekick/types').HandlerContext
      )

      expect(result).toEqual({ response: {} })
    })

    it('clears suppression marker after check', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'Stop')
      const suppressedPath = join(stagingDir, '.suppressed')
      writeFileSync(suppressedPath, '')

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'Stop',
      })

      const handler = handlers.getHandler('test:consume')
      await handler?.handler(createStopEvent(), ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(existsSync(suppressedPath)).toBe(false)
    })
  })

  describe('logging', () => {
    it('logs when reminder is injected', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')
      writeFileSync(join(stagingDir, 'test.json'), JSON.stringify({ name: 'test', priority: 50 }))

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      const handler = handlers.getHandler('test:consume')
      await handler?.handler(createPreToolUseEvent(), ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(logger.wasLoggedAtLevel('Injected reminder', 'info')).toBe(true)
    })
  })
})
