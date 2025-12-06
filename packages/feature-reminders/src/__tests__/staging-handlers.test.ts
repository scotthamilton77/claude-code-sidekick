/**
 * Tests for staging handler factory and individual staging handlers
 * @see docs/design/FEATURE-REMINDERS.md §3.1
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createMockSupervisorContext,
  createMockCLIContext,
  MockStagingService,
  MockLogger,
  MockHandlerRegistry,
  MockAssetResolver,
  createDefaultMetrics,
} from '@sidekick/testing-fixtures'
import type { SupervisorContext, TranscriptEvent, TranscriptMetrics } from '@sidekick/types'
import { registerStageAreYouStuck } from '../handlers/staging/stage-are-you-stuck'
import { registerStageTimeForUpdate } from '../handlers/staging/stage-time-for-update'
import { registerStageDefaultUserPrompt } from '../handlers/staging/stage-default-user-prompt'
import { registerStageStopReminders } from '../handlers/staging/stage-stop-reminders'

function createTestTranscriptEvent(metrics: Partial<TranscriptMetrics>, toolName?: string): TranscriptEvent {
  return {
    kind: 'transcript',
    eventType: 'ToolCall',
    context: {
      sessionId: 'test-session',
      timestamp: Date.now(),
    },
    payload: {
      lineNumber: 1,
      entry: {},
      toolName,
    },
    metadata: {
      transcriptPath: '/test/transcript.jsonl',
      metrics: { ...createDefaultMetrics(), ...metrics },
    },
  }
}

describe('staging handlers', () => {
  let ctx: SupervisorContext
  let staging: MockStagingService
  let logger: MockLogger
  let handlers: MockHandlerRegistry
  let assets: MockAssetResolver

  beforeEach(() => {
    staging = new MockStagingService()
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()
    assets = new MockAssetResolver()

    // Register test reminder definitions using MockAssetResolver
    assets.registerAll({
      'reminders/are-you-stuck.yaml': `id: are-you-stuck
blocking: true
priority: 80
persistent: false
additionalContext: "Stuck at {{toolsThisTurn}} tools"
stopReason: "Agent stuck - {{toolsThisTurn}} tools used"
`,
      'reminders/time-for-user-update.yaml': `id: time-for-user-update
blocking: true
priority: 70
persistent: false
additionalContext: "Update at {{toolsThisTurn}} tools"
`,
      'reminders/user-prompt-submit.yaml': `id: user-prompt-submit
blocking: false
priority: 10
persistent: true
additionalContext: "Standard user prompt reminder"
`,
      'reminders/verify-completion.yaml': `id: verify-completion
blocking: true
priority: 50
persistent: false
stopReason: "Verify completion before stopping"
`,
    })

    ctx = createMockSupervisorContext({ staging, logger, handlers, assets })
  })

  describe('createStagingHandler factory', () => {
    it('only registers handler in supervisor context', () => {
      const cliCtx = createMockCLIContext()

      // Try to register in CLI context - should not register
      registerStageAreYouStuck(cliCtx as unknown as SupervisorContext)

      expect((cliCtx.handlers as MockHandlerRegistry).getRegistrations()).toHaveLength(0)
    })

    it('registers handler in supervisor context', () => {
      registerStageAreYouStuck(ctx)

      const registrations = handlers.getRegistrations()
      expect(registrations).toHaveLength(1)
      expect(registrations[0].id).toBe('reminders:stage-are-you-stuck')
    })

    it('registers handler with correct filter type', () => {
      registerStageAreYouStuck(ctx)

      const registrations = handlers.getHandlersByKind('transcript')
      expect(registrations).toHaveLength(1)
      expect(registrations[0].filter).toEqual({
        kind: 'transcript',
        eventTypes: ['ToolCall'],
      })
    })

    it('registers handler with correct priority', () => {
      registerStageAreYouStuck(ctx)

      const registrations = handlers.getRegistrations()
      expect(registrations[0].priority).toBe(80)
    })
  })

  describe('registerStageAreYouStuck', () => {
    it('registers with transcript filter for ToolCall events', () => {
      registerStageAreYouStuck(ctx)

      const registrations = handlers.getHandlersForTranscriptEvent('ToolCall')
      expect(registrations).toHaveLength(1)
      expect(registrations[0].id).toBe('reminders:stage-are-you-stuck')
    })

    it('does not stage reminder when below threshold', async () => {
      registerStageAreYouStuck(ctx)

      const handler = handlers.getHandler('reminders:stage-are-you-stuck')
      const event = createTestTranscriptEvent({ toolsThisTurn: 15 }) // Below default 20

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)
    })

    it('stages reminder when at or above threshold', async () => {
      registerStageAreYouStuck(ctx)

      const handler = handlers.getHandler('reminders:stage-are-you-stuck')
      const event = createTestTranscriptEvent({ toolsThisTurn: 20 })

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('PreToolUse')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('are-you-stuck')
      expect(reminders[0].priority).toBe(80)
      expect(reminders[0].blocking).toBe(true)
    })

    it('suppresses Stop hook after staging', async () => {
      registerStageAreYouStuck(ctx)

      const handler = handlers.getHandler('reminders:stage-are-you-stuck')
      const event = createTestTranscriptEvent({ toolsThisTurn: 25 })

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(await staging.isHookSuppressed('Stop')).toBe(true)
    })

    it('is idempotent - does not re-stage if already exists', async () => {
      registerStageAreYouStuck(ctx)

      const handler = handlers.getHandler('reminders:stage-are-you-stuck')
      const event = createTestTranscriptEvent({ toolsThisTurn: 25 })

      // First call stages
      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)
      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)

      // Second call should not duplicate
      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)
      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
    })

    it('interpolates template variables', async () => {
      registerStageAreYouStuck(ctx)

      const handler = handlers.getHandler('reminders:stage-are-you-stuck')
      const event = createTestTranscriptEvent({ toolsThisTurn: 30 })

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('PreToolUse')
      expect(reminders[0].additionalContext).toBe('Stuck at 30 tools')
      expect(reminders[0].stopReason).toBe('Agent stuck - 30 tools used')
    })
  })

  describe('registerStageTimeForUpdate', () => {
    it('registers with lower priority than are-you-stuck', () => {
      registerStageTimeForUpdate(ctx)

      const registrations = handlers.getRegistrations()
      expect(registrations[0].priority).toBe(70)
    })

    it('stages reminder at update threshold (15)', async () => {
      registerStageTimeForUpdate(ctx)

      const handler = handlers.getHandler('reminders:stage-time-for-update')
      const event = createTestTranscriptEvent({ toolsThisTurn: 15 })

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('PreToolUse')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('time-for-user-update')
    })

    it('does not stage when below threshold', async () => {
      registerStageTimeForUpdate(ctx)

      const handler = handlers.getHandler('reminders:stage-time-for-update')
      const event = createTestTranscriptEvent({ toolsThisTurn: 10 })

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)
    })
  })

  describe('registerStageStopReminders', () => {
    it('registers for ToolCall transcript events', () => {
      registerStageStopReminders(ctx)

      const registrations = handlers.getHandlersForTranscriptEvent('ToolCall')
      expect(registrations).toHaveLength(1)
      expect(registrations[0].id).toBe('reminders:stage-stop-reminders')
    })

    it('stages verify-completion reminder on Write tool', async () => {
      registerStageStopReminders(ctx)

      const handler = handlers.getHandler('reminders:stage-stop-reminders')
      const event = createTestTranscriptEvent({ toolsThisTurn: 1 }, 'Write')

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('Stop')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('verify-completion')
    })

    it('stages verify-completion reminder on Edit tool', async () => {
      registerStageStopReminders(ctx)

      const handler = handlers.getHandler('reminders:stage-stop-reminders')
      const event = createTestTranscriptEvent({ toolsThisTurn: 1 }, 'Edit')

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('Stop')
      expect(reminders).toHaveLength(1)
    })

    it('stages verify-completion reminder on MultiEdit tool', async () => {
      registerStageStopReminders(ctx)

      const handler = handlers.getHandler('reminders:stage-stop-reminders')
      const event = createTestTranscriptEvent({ toolsThisTurn: 1 }, 'MultiEdit')

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('Stop')
      expect(reminders).toHaveLength(1)
    })

    it('does not stage on non-edit tools', async () => {
      registerStageStopReminders(ctx)

      const handler = handlers.getHandler('reminders:stage-stop-reminders')
      const event = createTestTranscriptEvent({ toolsThisTurn: 1 }, 'Read')

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
    })
  })

  describe('registerStageDefaultUserPrompt', () => {
    it('registers for SessionStart hook event', () => {
      registerStageDefaultUserPrompt(ctx)

      const registrations = handlers.getHandlersForHook('SessionStart')
      expect(registrations).toHaveLength(1)
      expect(registrations[0].id).toBe('reminders:stage-default-user-prompt')
    })

    it('stages persistent reminder on SessionStart', async () => {
      registerStageDefaultUserPrompt(ctx)

      const handler = handlers.getHandler('reminders:stage-default-user-prompt')
      const event = {
        kind: 'hook' as const,
        hook: 'SessionStart' as const,
        context: { sessionId: 'test-session', timestamp: Date.now() },
        payload: { startType: 'startup' as const, transcriptPath: '/test/transcript.jsonl' },
      }

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('UserPromptSubmit')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('user-prompt-submit')
      expect(reminders[0].persistent).toBe(true)
      expect(reminders[0].priority).toBe(10)
    })
  })

  describe('handler registration filters', () => {
    it('staging handlers use transcript filters', () => {
      registerStageAreYouStuck(ctx)
      registerStageTimeForUpdate(ctx)
      registerStageStopReminders(ctx)

      const transcriptHandlers = handlers.getHandlersByKind('transcript')
      expect(transcriptHandlers).toHaveLength(3)
    })

    it('SessionStart handler uses hook filter', () => {
      registerStageDefaultUserPrompt(ctx)

      const hookHandlers = handlers.getHandlersByKind('hook')
      expect(hookHandlers).toHaveLength(1)
    })
  })
})
