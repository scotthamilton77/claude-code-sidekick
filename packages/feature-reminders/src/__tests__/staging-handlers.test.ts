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
import { registerStagePauseAndReflect } from '../handlers/staging/stage-pause-and-reflect'
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
      'reminders/pause-and-reflect.yaml': `id: pause-and-reflect
blocking: true
priority: 80
persistent: false
additionalContext: "Checkpoint at {{toolsThisTurn}} tools"
reason: "Checkpoint - {{toolsThisTurn}} tools used"
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
reason: "Verify completion before stopping"
`,
    })

    ctx = createMockSupervisorContext({ staging, logger, handlers, assets })
  })

  describe('createStagingHandler factory', () => {
    it('only registers handler in supervisor context', () => {
      const cliCtx = createMockCLIContext()

      // Try to register in CLI context - should not register
      registerStagePauseAndReflect(cliCtx as unknown as SupervisorContext)

      expect((cliCtx.handlers as MockHandlerRegistry).getRegistrations()).toHaveLength(0)
    })

    it('registers handler in supervisor context', () => {
      registerStagePauseAndReflect(ctx)

      const registrations = handlers.getRegistrations()
      expect(registrations).toHaveLength(1)
      expect(registrations[0].id).toBe('reminders:stage-pause-and-reflect')
    })

    it('registers handler with correct filter type', () => {
      registerStagePauseAndReflect(ctx)

      const registrations = handlers.getHandlersByKind('transcript')
      expect(registrations).toHaveLength(1)
      expect(registrations[0].filter).toEqual({
        kind: 'transcript',
        eventTypes: ['ToolCall'],
      })
    })

    it('registers handler with correct priority', () => {
      registerStagePauseAndReflect(ctx)

      const registrations = handlers.getRegistrations()
      expect(registrations[0].priority).toBe(80)
    })
  })

  describe('registerStagePauseAndReflect', () => {
    it('registers with transcript filter for ToolCall events', () => {
      registerStagePauseAndReflect(ctx)

      const registrations = handlers.getHandlersForTranscriptEvent('ToolCall')
      expect(registrations).toHaveLength(1)
      expect(registrations[0].id).toBe('reminders:stage-pause-and-reflect')
    })

    it('does not stage reminder when below threshold', async () => {
      registerStagePauseAndReflect(ctx)

      const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
      const event = createTestTranscriptEvent({ toolsThisTurn: 10 }) // Below default 15

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)
    })

    it('stages reminder when at or above threshold', async () => {
      registerStagePauseAndReflect(ctx)

      const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
      const event = createTestTranscriptEvent({ toolsThisTurn: 15 })

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('PreToolUse')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('pause-and-reflect')
      expect(reminders[0].priority).toBe(80)
      expect(reminders[0].blocking).toBe(true)
    })

    it('is idempotent - does not re-stage if already exists', async () => {
      registerStagePauseAndReflect(ctx)

      const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
      const event = createTestTranscriptEvent({ toolsThisTurn: 20 })

      // First call stages
      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)
      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)

      // Second call should not duplicate
      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)
      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
    })

    it('interpolates template variables', async () => {
      registerStagePauseAndReflect(ctx)

      const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
      const event = createTestTranscriptEvent({ toolsThisTurn: 30 })

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('PreToolUse')
      expect(reminders[0].additionalContext).toBe('Checkpoint at 30 tools')
      expect(reminders[0].reason).toBe('Checkpoint - 30 tools used')
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
      registerStagePauseAndReflect(ctx)
      registerStageStopReminders(ctx)

      const transcriptHandlers = handlers.getHandlersByKind('transcript')
      expect(transcriptHandlers).toHaveLength(2)
    })

    it('SessionStart handler uses hook filter', () => {
      registerStageDefaultUserPrompt(ctx)

      const hookHandlers = handlers.getHandlersByKind('hook')
      expect(hookHandlers).toHaveLength(1)
    })
  })
})
