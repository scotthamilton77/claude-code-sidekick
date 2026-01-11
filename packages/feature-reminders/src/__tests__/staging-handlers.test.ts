/**
 * Tests for staging handler factory and individual staging handlers
 * @see docs/design/FEATURE-REMINDERS.md §3.1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  createMockSupervisorContext,
  createMockCLIContext,
  MockStagingService,
  MockLogger,
  MockHandlerRegistry,
  MockAssetResolver,
  createDefaultMetrics,
} from '@sidekick/testing-fixtures'
import type { SupervisorContext, TranscriptEvent, TranscriptMetrics, PRBaselineState } from '@sidekick/types'
import { registerStagePauseAndReflect } from '../handlers/staging/stage-pause-and-reflect'
import { registerStageDefaultUserPrompt } from '../handlers/staging/stage-default-user-prompt'
import { registerStageStopReminders } from '../handlers/staging/stage-stop-reminders'

function createTestTranscriptEvent(
  metrics: Partial<TranscriptMetrics>,
  toolName?: string,
  filePath?: string
): TranscriptEvent {
  return {
    kind: 'transcript',
    eventType: 'ToolCall',
    context: {
      sessionId: 'test-session',
      timestamp: Date.now(),
    },
    payload: {
      lineNumber: 1,
      entry: filePath ? { input: { file_path: filePath } } : {},
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

    describe('P&R baseline threshold adjustment', () => {
      const testProjectDir = '/tmp/claude/test-pr-baseline'
      const sessionId = 'test-session'

      beforeEach(() => {
        // Create state directory structure
        const stateDir = join(testProjectDir, '.sidekick', 'sessions', sessionId, 'state')
        mkdirSync(stateDir, { recursive: true })
      })

      afterEach(() => {
        rmSync(testProjectDir, { recursive: true, force: true })
      })

      function createEventWithSession(metrics: Partial<TranscriptMetrics>, toolName?: string): TranscriptEvent {
        return {
          kind: 'transcript',
          eventType: 'ToolCall',
          context: {
            sessionId,
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

      it('uses default threshold when no baseline file exists', async () => {
        // Create context with test project dir
        const ctxWithPath = createMockSupervisorContext({
          staging,
          logger,
          handlers,
          assets,
          paths: {
            projectDir: testProjectDir,
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })

        registerStagePauseAndReflect(ctxWithPath)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
        // Default threshold is 15, so this should trigger
        const event = createEventWithSession({ turnCount: 1, toolsThisTurn: 15, toolCount: 15 })

        await handler?.handler(event, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })

      it('adjusts threshold based on baseline when VC was consumed same turn', async () => {
        // Write baseline file indicating VC was consumed at tool 8 on turn 1
        const stateDir = join(testProjectDir, '.sidekick', 'sessions', sessionId, 'state')
        const baseline: PRBaselineState = {
          turnCount: 1,
          toolsThisTurn: 8,
          timestamp: Date.now(),
        }
        writeFileSync(join(stateDir, 'pr-baseline.json'), JSON.stringify(baseline))

        const ctxWithPath = createMockSupervisorContext({
          staging,
          logger,
          handlers,
          assets,
          paths: {
            projectDir: testProjectDir,
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })

        registerStagePauseAndReflect(ctxWithPath)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')

        // At tool 15 on turn 1: 15 - 8 = 7 < 15 threshold, should NOT fire
        const event15 = createEventWithSession({ turnCount: 1, toolsThisTurn: 15, toolCount: 15 })
        await handler?.handler(event15, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)

        // At tool 23 on turn 1: 23 - 8 = 15 >= 15 threshold, SHOULD fire
        const event23 = createEventWithSession({ turnCount: 1, toolsThisTurn: 23, toolCount: 23 })
        await handler?.handler(event23, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })

      it('ignores baseline from different turn', async () => {
        // Write baseline file from turn 1
        const stateDir = join(testProjectDir, '.sidekick', 'sessions', sessionId, 'state')
        const baseline: PRBaselineState = {
          turnCount: 1,
          toolsThisTurn: 8,
          timestamp: Date.now(),
        }
        writeFileSync(join(stateDir, 'pr-baseline.json'), JSON.stringify(baseline))

        const ctxWithPath = createMockSupervisorContext({
          staging,
          logger,
          handlers,
          assets,
          paths: {
            projectDir: testProjectDir,
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })

        registerStagePauseAndReflect(ctxWithPath)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')

        // On turn 2, baseline from turn 1 should be ignored
        // At tool 15 on turn 2: uses default threshold (0), so 15 >= 15, SHOULD fire
        const event = createEventWithSession({ turnCount: 2, toolsThisTurn: 15, toolCount: 100 })
        await handler?.handler(event, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })

      it('handles malformed baseline file gracefully', async () => {
        // Write invalid JSON
        const stateDir = join(testProjectDir, '.sidekick', 'sessions', sessionId, 'state')
        writeFileSync(join(stateDir, 'pr-baseline.json'), 'not valid json {')

        const ctxWithPath = createMockSupervisorContext({
          staging,
          logger,
          handlers,
          assets,
          paths: {
            projectDir: testProjectDir,
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })

        registerStagePauseAndReflect(ctxWithPath)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
        // Should use default threshold (0) and not crash
        const event = createEventWithSession({ turnCount: 1, toolsThisTurn: 15, toolCount: 15 })

        await handler?.handler(event, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })
    })
  })

  describe('registerStageStopReminders', () => {
    it('registers for ToolCall transcript events', () => {
      registerStageStopReminders(ctx)

      const registrations = handlers.getHandlersForTranscriptEvent('ToolCall')
      expect(registrations).toHaveLength(1)
      expect(registrations[0].id).toBe('reminders:stage-stop-reminders')
    })

    it.each(['Write', 'Edit', 'MultiEdit'] as const)(
      'stages verify-completion reminder on %s tool',
      async (toolName) => {
        registerStageStopReminders(ctx)

        const handler = handlers.getHandler('reminders:stage-stop-reminders')
        const event = createTestTranscriptEvent({ toolsThisTurn: 1 }, toolName, '/src/app.ts')

        await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        const reminders = staging.getRemindersForHook('Stop')
        expect(reminders).toHaveLength(1)
        expect(reminders[0].name).toBe('verify-completion')
      }
    )

    it('does not stage on non-edit tools', async () => {
      registerStageStopReminders(ctx)

      const handler = handlers.getHandler('reminders:stage-stop-reminders')
      const event = createTestTranscriptEvent({ toolsThisTurn: 1 }, 'Read')

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
    })

    describe('source code pattern filtering', () => {
      it('stages reminder when editing source code file (.ts)', async () => {
        registerStageStopReminders(ctx)

        const handler = handlers.getHandler('reminders:stage-stop-reminders')
        const event = createTestTranscriptEvent({ toolsThisTurn: 1 }, 'Edit', '/src/app.ts')

        await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        const reminders = staging.getRemindersForHook('Stop')
        expect(reminders).toHaveLength(1)
        expect(reminders[0].name).toBe('verify-completion')
      })

      it('stages reminder when editing package.json', async () => {
        registerStageStopReminders(ctx)

        const handler = handlers.getHandler('reminders:stage-stop-reminders')
        const event = createTestTranscriptEvent({ toolsThisTurn: 1 }, 'Edit', '/project/package.json')

        await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        const reminders = staging.getRemindersForHook('Stop')
        expect(reminders).toHaveLength(1)
      })

      it('does not stage reminder when editing documentation file (.md)', async () => {
        registerStageStopReminders(ctx)

        const handler = handlers.getHandler('reminders:stage-stop-reminders')
        const event = createTestTranscriptEvent({ toolsThisTurn: 1 }, 'Edit', '/docs/README.md')

        await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
      })

      it('does not stage reminder when editing CLAUDE.md', async () => {
        registerStageStopReminders(ctx)

        const handler = handlers.getHandler('reminders:stage-stop-reminders')
        const event = createTestTranscriptEvent({ toolsThisTurn: 1 }, 'Write', '/project/CLAUDE.md')

        await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
      })

      it('uses configured source_code_patterns', async () => {
        // Configure only .py and .rb patterns
        ;(ctx.config as import('@sidekick/testing-fixtures').MockConfigService).set({
          features: {
            reminders: {
              enabled: true,
              settings: {
                source_code_patterns: ['**/*.py', '**/*.rb'],
              },
            },
          },
        })

        registerStageStopReminders(ctx)

        const handler = handlers.getHandler('reminders:stage-stop-reminders')

        // .ts should NOT trigger (not in custom patterns)
        const tsEvent = createTestTranscriptEvent({ toolsThisTurn: 1 }, 'Edit', '/src/app.ts')
        await handler?.handler(tsEvent, ctx as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('Stop')).toHaveLength(0)

        // .py SHOULD trigger
        const pyEvent = createTestTranscriptEvent({ toolsThisTurn: 1, toolCount: 2 }, 'Edit', '/src/app.py')
        await handler?.handler(pyEvent, ctx as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('Stop')).toHaveLength(1)
      })

      it('handles missing file_path gracefully (no staging)', async () => {
        registerStageStopReminders(ctx)

        const handler = handlers.getHandler('reminders:stage-stop-reminders')
        // No file path provided
        const event = createTestTranscriptEvent({ toolsThisTurn: 1 }, 'Edit')

        await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
      })
    })

    describe('VC once-per-turn reactivation', () => {
      it('does NOT re-stage VC after consumption within same turn', async () => {
        registerStageStopReminders(ctx)

        const handler = handlers.getHandler('reminders:stage-stop-reminders')

        // First edit - stages VC
        const event1 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Edit', '/src/a.ts')
        await handler?.handler(event1, ctx as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('Stop')).toHaveLength(1)

        // Simulate consumption: add to consumed list and clear staged
        staging.addConsumedReminder('Stop', 'verify-completion', {
          name: 'verify-completion',
          blocking: true,
          priority: 50,
          persistent: false,
          stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
        })
        await staging.deleteReminder('Stop', 'verify-completion')
        expect(staging.getRemindersForHook('Stop')).toHaveLength(0)

        // Second edit in SAME turn - should NOT re-stage
        const event2 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 5, toolCount: 5 }, 'Edit', '/src/b.ts')
        await handler?.handler(event2, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
      })

      it('DOES re-stage VC after consumption on NEW turn', async () => {
        registerStageStopReminders(ctx)

        const handler = handlers.getHandler('reminders:stage-stop-reminders')

        // First edit on turn 1 - stages VC
        const event1 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Edit', '/src/a.ts')
        await handler?.handler(event1, ctx as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('Stop')).toHaveLength(1)

        // Simulate consumption
        staging.addConsumedReminder('Stop', 'verify-completion', {
          name: 'verify-completion',
          blocking: true,
          priority: 50,
          persistent: false,
          stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
        })
        await staging.deleteReminder('Stop', 'verify-completion')

        // Edit on NEW turn (turn 2) - SHOULD re-stage
        const event2 = createTestTranscriptEvent({ turnCount: 2, toolsThisTurn: 1, toolCount: 10 }, 'Edit', '/src/b.ts')
        await handler?.handler(event2, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('Stop')).toHaveLength(1)
      })

      it('stages VC normally when no consumption history exists', async () => {
        registerStageStopReminders(ctx)

        const handler = handlers.getHandler('reminders:stage-stop-reminders')

        // No prior consumption - should stage
        const event = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Edit', '/src/a.ts')
        await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('Stop')).toHaveLength(1)
      })
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
