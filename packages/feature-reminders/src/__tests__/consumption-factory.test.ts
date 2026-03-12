/**
 * Tests for consumption handler factory
 * @see docs/design/FEATURE-REMINDERS.md §3.1 Consumption Handlers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  createMockCLIContext,
  createMockDaemonContext,
  MockLogger,
  MockHandlerRegistry,
} from '@sidekick/testing-fixtures'
import type { CLIContext, PreToolUseHookEvent, StopHookEvent, StagedReminder } from '@sidekick/types'
import { createConsumptionHandler } from '../handlers/consumption/consumption-handler-factory'

/** Create a valid StagedReminder with required fields */
function createReminder(overrides: Partial<StagedReminder> & { name: string; priority: number }): StagedReminder {
  return {
    blocking: false,
    persistent: false,
    ...overrides,
  }
}

// Test staging directory - using /tmp/claude/ for sandbox compatibility
const testStateDir = '/tmp/claude/test-consumption-factory'
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
      const daemonCtx = createMockDaemonContext()

      createConsumptionHandler(daemonCtx as unknown as CLIContext, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      expect((daemonCtx.handlers as MockHandlerRegistry).getRegistrations()).toHaveLength(0)
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

    it('consumes highest-priority reminder when multiple are staged', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')

      // Stage three reminders with different priorities
      writeFileSync(
        join(stagingDir, 'low-priority.json'),
        JSON.stringify(
          createReminder({
            name: 'low-priority',
            priority: 10,
            additionalContext: 'Low priority context',
          })
        )
      )
      writeFileSync(
        join(stagingDir, 'high-priority.json'),
        JSON.stringify(
          createReminder({
            name: 'high-priority',
            priority: 90,
            additionalContext: 'High priority context',
          })
        )
      )
      writeFileSync(
        join(stagingDir, 'medium-priority.json'),
        JSON.stringify(
          createReminder({
            name: 'medium-priority',
            priority: 50,
            additionalContext: 'Medium priority context',
          })
        )
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

      // Should concatenate all contexts, highest priority first
      expect(result).toEqual({
        response: {
          additionalContext: 'High priority context\n\nMedium priority context\n\nLow priority context',
        },
      })

      // All non-persistent reminders should be consumed (renamed)
      expect(existsSync(join(stagingDir, 'high-priority.json'))).toBe(false)
      expect(existsSync(join(stagingDir, 'low-priority.json'))).toBe(false)
      expect(existsSync(join(stagingDir, 'medium-priority.json'))).toBe(false)
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
        JSON.stringify(
          createReminder({
            name: 'test',
            priority: 50,
            userMessage: 'Hello user',
            additionalContext: 'Context here',
          })
        )
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

    it('renames non-persistent reminder with timestamp suffix after consumption', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')
      const reminderPath = join(stagingDir, 'one-shot.json')
      writeFileSync(
        reminderPath,
        JSON.stringify(
          createReminder({
            name: 'one-shot',
            priority: 50,
          })
        )
      )

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      const handler = handlers.getHandler('test:consume')
      await handler?.handler(createPreToolUseEvent(), ctx as unknown as import('@sidekick/types').HandlerContext)

      // Original file should be gone
      expect(existsSync(reminderPath)).toBe(false)

      // Should have a timestamped file instead (one-shot.{timestamp}.json)
      const files = readdirSync(stagingDir).filter((f: string) => f.startsWith('one-shot.') && f.endsWith('.json'))
      expect(files.length).toBe(1)
      expect(files[0]).toMatch(/^one-shot\.\d+\.json$/)
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
        JSON.stringify(
          createReminder({
            name: 'blocking',
            blocking: true,
            priority: 80,
            reason: 'Verify completion',
          })
        )
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
        JSON.stringify(
          createReminder({
            name: 'non-blocking',
            priority: 50,
            additionalContext: 'Just info',
          })
        )
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

  describe('multi-reminder concatenation', () => {
    it('concatenates additionalContext from ALL reminders by priority', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')

      writeFileSync(
        join(stagingDir, 'low-priority.json'),
        JSON.stringify(
          createReminder({
            name: 'low-priority',
            priority: 10,
            persistent: true,
            additionalContext: 'Low priority context',
          })
        )
      )
      writeFileSync(
        join(stagingDir, 'high-priority.json'),
        JSON.stringify(
          createReminder({
            name: 'high-priority',
            priority: 90,
            persistent: true,
            additionalContext: 'High priority context',
          })
        )
      )
      writeFileSync(
        join(stagingDir, 'medium-priority.json'),
        JSON.stringify(
          createReminder({
            name: 'medium-priority',
            priority: 50,
            persistent: true,
            additionalContext: 'Medium priority context',
          })
        )
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

      // Should concatenate all contexts, highest priority first
      expect(result).toEqual({
        response: {
          additionalContext: 'High priority context\n\nMedium priority context\n\nLow priority context',
        },
      })
    })

    it('uses highest-priority reminder for blocking and userMessage', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'Stop')

      writeFileSync(
        join(stagingDir, 'high-priority.json'),
        JSON.stringify(
          createReminder({
            name: 'high-priority',
            priority: 90,
            persistent: true,
            blocking: true,
            reason: 'High priority reason',
            userMessage: 'High priority message',
            additionalContext: 'High context',
          })
        )
      )
      writeFileSync(
        join(stagingDir, 'low-priority.json'),
        JSON.stringify(
          createReminder({
            name: 'low-priority',
            priority: 10,
            persistent: true,
            blocking: true,
            reason: 'Low priority reason',
            userMessage: 'Low priority message',
            additionalContext: 'Low context',
          })
        )
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

      // Blocking and userMessage from highest-priority; additionalContext concatenated
      expect(result).toEqual({
        response: {
          blocking: true,
          reason: 'High priority reason',
          userMessage: 'High priority message',
          additionalContext: 'High context\n\nLow context',
        },
      })
    })

    it('renames all non-persistent reminders after consumption', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')

      writeFileSync(
        join(stagingDir, 'one-shot-a.json'),
        JSON.stringify(
          createReminder({
            name: 'one-shot-a',
            priority: 90,
            additionalContext: 'A context',
          })
        )
      )
      writeFileSync(
        join(stagingDir, 'one-shot-b.json'),
        JSON.stringify(
          createReminder({
            name: 'one-shot-b',
            priority: 10,
            additionalContext: 'B context',
          })
        )
      )
      writeFileSync(
        join(stagingDir, 'persistent-c.json'),
        JSON.stringify(
          createReminder({
            name: 'persistent-c',
            priority: 50,
            persistent: true,
            additionalContext: 'C context',
          })
        )
      )

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      const handler = handlers.getHandler('test:consume')
      await handler?.handler(createPreToolUseEvent(), ctx as unknown as import('@sidekick/types').HandlerContext)

      // Non-persistent reminders should be renamed
      expect(existsSync(join(stagingDir, 'one-shot-a.json'))).toBe(false)
      expect(existsSync(join(stagingDir, 'one-shot-b.json'))).toBe(false)
      // Persistent reminder should still exist
      expect(existsSync(join(stagingDir, 'persistent-c.json'))).toBe(true)
    })

    it('skips reminders without additionalContext in concatenation', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')

      writeFileSync(
        join(stagingDir, 'with-context.json'),
        JSON.stringify(
          createReminder({
            name: 'with-context',
            priority: 90,
            persistent: true,
            additionalContext: 'Has context',
          })
        )
      )
      writeFileSync(
        join(stagingDir, 'no-context.json'),
        JSON.stringify(
          createReminder({
            name: 'no-context',
            priority: 50,
            persistent: true,
          })
        )
      )
      writeFileSync(
        join(stagingDir, 'also-has-context.json'),
        JSON.stringify(
          createReminder({
            name: 'also-has-context',
            priority: 10,
            persistent: true,
            additionalContext: 'Also has context',
          })
        )
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

      // Should skip the reminder without additionalContext
      expect(result).toEqual({
        response: {
          additionalContext: 'Has context\n\nAlso has context',
        },
      })
    })
  })

  describe('logging', () => {
    it('logs ReminderConsumed event when reminder is consumed', async () => {
      const stagingDir = join(testStateDir, 'sessions', sessionId, 'stage', 'PreToolUse')
      writeFileSync(join(stagingDir, 'test.json'), JSON.stringify(createReminder({ name: 'test', priority: 50 })))

      createConsumptionHandler(ctx, {
        id: 'test:consume',
        hook: 'PreToolUse',
      })

      const handler = handlers.getHandler('test:consume')
      await handler?.handler(createPreToolUseEvent(), ctx as unknown as import('@sidekick/types').HandlerContext)

      // Verify structured log event was recorded (logEvent logs with message = event.type)
      expect(logger.wasLoggedAtLevel('reminder:consumed', 'info')).toBe(true)

      // Verify the log contains expected metadata
      const logRecord = logger.recordedLogs.find((log) => log.msg === 'reminder:consumed')
      expect(logRecord).toBeDefined()
      expect(logRecord?.meta?.type).toBe('reminder:consumed')
      // Payload is flat (no state/metadata nesting)
      expect(logRecord?.meta?.reminderName).toBe('test')
    })
  })
})
