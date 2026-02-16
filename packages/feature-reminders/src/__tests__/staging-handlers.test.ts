/**
 * Tests for staging handler factory and individual staging handlers
 * @see docs/design/FEATURE-REMINDERS.md §3.1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  createMockDaemonContext,
  createMockCLIContext,
  MockStagingService,
  MockLogger,
  MockHandlerRegistry,
  MockAssetResolver,
  MockConfigService,
  MockStateService,
  createDefaultMetrics,
} from '@sidekick/testing-fixtures'
import type {
  DaemonContext,
  TranscriptEvent,
  TranscriptMetrics,
  PRBaselineState,
  UserPromptSubmitHookEvent,
} from '@sidekick/types'
import { LastStagedPersonaSchema } from '@sidekick/types'
import { registerStagePauseAndReflect } from '../handlers/staging/stage-pause-and-reflect'
import { registerStageDefaultUserPrompt } from '../handlers/staging/stage-default-user-prompt'
import { registerStageStopReminders } from '../handlers/staging/stage-stop-reminders'
import { registerUnstageVerifyCompletion } from '../handlers/staging/unstage-verify-completion'
import { registerStageBashChanges } from '../handlers/staging/stage-stop-bash-changes'
import {
  registerStagePersonaReminders,
  stagePersonaRemindersForSession,
  restagePersonaRemindersForActiveSessions,
} from '../handlers/staging/stage-persona-reminders'
import { getGitFileStatus } from '@sidekick/core'

// Mock @sidekick/core — preserves all other exports, mocks specific functions
vi.mock('@sidekick/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...mod,
    getGitFileStatus: vi.fn().mockResolvedValue([]),
    createPersonaLoader: vi.fn().mockReturnValue({
      discover: () => new Map(),
    }),
    getDefaultPersonasDir: vi.fn().mockReturnValue('/mock/personas'),
  }
})
const mockGetGitFileStatus = getGitFileStatus as ReturnType<typeof vi.fn>

// Import the mocked function for persona tests
import { createPersonaLoader } from '@sidekick/core'
const mockCreatePersonaLoader = createPersonaLoader as ReturnType<typeof vi.fn>

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
  let ctx: DaemonContext
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
reason: "Checkpoint - {{toolsSinceBaseline}} tools since last checkpoint"
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

    ctx = createMockDaemonContext({ staging, logger, handlers, assets })
  })

  describe('createStagingHandler factory', () => {
    it('only registers handler in daemon context', () => {
      const cliCtx = createMockCLIContext()

      // Try to register in CLI context - should not register
      registerStagePauseAndReflect(cliCtx as unknown as DaemonContext)

      expect((cliCtx.handlers as MockHandlerRegistry).getRegistrations()).toHaveLength(0)
    })

    it('registers handler in daemon context', () => {
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
      const event = createTestTranscriptEvent({ toolsThisTurn: 10 }) // Below default 60

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)
    })

    it('stages reminder when at or above threshold', async () => {
      registerStagePauseAndReflect(ctx)

      const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
      const event = createTestTranscriptEvent({ toolsThisTurn: 60 })

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
      const event = createTestTranscriptEvent({ toolsThisTurn: 65 })

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
      const event = createTestTranscriptEvent({ toolsThisTurn: 65 })

      await handler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('PreToolUse')
      expect(reminders[0].additionalContext).toBe('Checkpoint at 65 tools')
      expect(reminders[0].reason).toBe('Checkpoint - 65 tools since last checkpoint')
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
        const ctxWithPath = createMockDaemonContext({
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
        // Default threshold is 60, so this should trigger
        const event = createEventWithSession({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })

        await handler?.handler(event, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })

      it('adjusts threshold based on baseline when VC was consumed same turn', async () => {
        // Set up baseline indicating VC was consumed at tool 20 on turn 1
        const stateService = new MockStateService(testProjectDir)
        const baseline: PRBaselineState = {
          turnCount: 1,
          toolsThisTurn: 20,
          timestamp: Date.now(),
        }
        const baselinePath = stateService.sessionStatePath(sessionId, 'pr-baseline.json')
        stateService.setStored(baselinePath, baseline)

        const ctxWithPath = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService,
          paths: {
            projectDir: testProjectDir,
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })

        registerStagePauseAndReflect(ctxWithPath)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')

        // At tool 60 on turn 1: 60 - 20 = 40 < 60 threshold, should NOT fire
        const event60 = createEventWithSession({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })
        await handler?.handler(event60, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)

        // At tool 80 on turn 1: 80 - 20 = 60 >= 60 threshold, SHOULD fire
        const event80 = createEventWithSession({ turnCount: 1, toolsThisTurn: 80, toolCount: 80 })
        await handler?.handler(event80, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })

      it('ignores baseline from different turn', async () => {
        // Set up baseline from turn 1
        const stateService = new MockStateService(testProjectDir)
        const baseline: PRBaselineState = {
          turnCount: 1,
          toolsThisTurn: 20,
          timestamp: Date.now(),
        }
        const baselinePath = stateService.sessionStatePath(sessionId, 'pr-baseline.json')
        stateService.setStored(baselinePath, baseline)

        const ctxWithPath = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService,
          paths: {
            projectDir: testProjectDir,
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })

        registerStagePauseAndReflect(ctxWithPath)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')

        // On turn 2, baseline from turn 1 should be ignored
        // At tool 60 on turn 2: uses default threshold (0), so 60 >= 60, SHOULD fire
        const event = createEventWithSession({ turnCount: 2, toolsThisTurn: 60, toolCount: 100 })
        await handler?.handler(event, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })

      it('handles malformed baseline file gracefully', async () => {
        // Set up invalid data that won't pass schema validation
        const stateService = new MockStateService(testProjectDir)
        const baselinePath = stateService.sessionStatePath(sessionId, 'pr-baseline.json')
        stateService.setStored(baselinePath, { invalid: 'data' }) // Missing required fields

        const ctxWithPath = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService,
          paths: {
            projectDir: testProjectDir,
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })

        registerStagePauseAndReflect(ctxWithPath)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
        // Should use default threshold (0) and not crash
        const event = createEventWithSession({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })

        await handler?.handler(event, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })
    })

    describe('P&R reactivation after consumption', () => {
      it('uses last P&R consumption as baseline when consumed same turn', async () => {
        registerStagePauseAndReflect(ctx)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')

        // First trigger at tool 60 - stages P&R
        const event60 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })
        await handler?.handler(event60, ctx as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)

        // Simulate consumption: add to consumed list with stagedAt metrics
        staging.addConsumedReminder('PreToolUse', 'pause-and-reflect', {
          name: 'pause-and-reflect',
          blocking: true,
          priority: 80,
          persistent: false,
          stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 60, toolCount: 60 },
        })
        await staging.deleteReminder('PreToolUse', 'pause-and-reflect')
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)

        // At tool 80 same turn: 80 - 60 = 20 < 60 threshold, should NOT re-stage
        const event80 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 80, toolCount: 80 })
        await handler?.handler(event80, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)
      })

      it('reactivates when threshold crossed since last consumption same turn', async () => {
        registerStagePauseAndReflect(ctx)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')

        // First trigger at tool 60 - stages P&R
        const event60 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })
        await handler?.handler(event60, ctx as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)

        // Simulate consumption
        staging.addConsumedReminder('PreToolUse', 'pause-and-reflect', {
          name: 'pause-and-reflect',
          blocking: true,
          priority: 80,
          persistent: false,
          stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 60, toolCount: 60 },
        })
        await staging.deleteReminder('PreToolUse', 'pause-and-reflect')

        // At tool 120 same turn: 120 >= 60 + 60 threshold, SHOULD re-stage
        const event120 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 120, toolCount: 120 })
        await handler?.handler(event120, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })

      it('reactivates on new turn regardless of tool count', async () => {
        registerStagePauseAndReflect(ctx)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')

        // First trigger at tool 60 on turn 1
        const event1 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })
        await handler?.handler(event1, ctx as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)

        // Simulate consumption on turn 1
        staging.addConsumedReminder('PreToolUse', 'pause-and-reflect', {
          name: 'pause-and-reflect',
          blocking: true,
          priority: 80,
          persistent: false,
          stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 60, toolCount: 60 },
        })
        await staging.deleteReminder('PreToolUse', 'pause-and-reflect')

        // Turn 2 at tool 60: new turn, should reactivate
        const event2 = createTestTranscriptEvent({ turnCount: 2, toolsThisTurn: 60, toolCount: 120 })
        await handler?.handler(event2, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })

      it('uses max of VC baseline and P&R consumption baseline', async () => {
        const testProjectDir = '/tmp/claude/test-pr-max-baseline'
        const sessionId = 'test-session'

        // Set up baseline indicating VC was consumed at tool 20 on turn 1
        const stateService = new MockStateService(testProjectDir)
        const baseline: PRBaselineState = {
          turnCount: 1,
          toolsThisTurn: 20,
          timestamp: Date.now(),
        }
        const baselinePath = stateService.sessionStatePath(sessionId, 'pr-baseline.json')
        stateService.setStored(baselinePath, baseline)

        const ctxWithPath = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService,
          paths: {
            projectDir: testProjectDir,
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })

        registerStagePauseAndReflect(ctxWithPath)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')

        function createEventWithSession(metrics: Partial<TranscriptMetrics>): TranscriptEvent {
          return {
            kind: 'transcript',
            eventType: 'ToolCall',
            context: { sessionId, timestamp: Date.now() },
            payload: { lineNumber: 1, entry: {} },
            metadata: {
              transcriptPath: '/test/transcript.jsonl',
              metrics: { ...createDefaultMetrics(), ...metrics },
            },
          }
        }

        // First P&R triggered at tool 80 (20 + 60 threshold)
        const event80 = createEventWithSession({ turnCount: 1, toolsThisTurn: 80, toolCount: 80 })
        await handler?.handler(event80, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)

        // Simulate P&R consumption at tool 80
        staging.addConsumedReminder('PreToolUse', 'pause-and-reflect', {
          name: 'pause-and-reflect',
          blocking: true,
          priority: 80,
          persistent: false,
          stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 80, toolCount: 80 },
        })
        await staging.deleteReminder('PreToolUse', 'pause-and-reflect')

        // At tool 120: max(20, 80) = 80 baseline, 120 - 80 = 40 < 60 threshold, should NOT fire
        const event120 = createEventWithSession({ turnCount: 1, toolsThisTurn: 120, toolCount: 120 })
        await handler?.handler(event120, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)

        // At tool 140: 140 >= 80 + 60 threshold, SHOULD fire
        const event140 = createEventWithSession({ turnCount: 1, toolsThisTurn: 140, toolCount: 140 })
        await handler?.handler(event140, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)
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

    it('also registers for BulkProcessingComplete transcript event', () => {
      registerStageDefaultUserPrompt(ctx)

      const transcriptHandlers = handlers.getHandlersByKind('transcript')
      expect(transcriptHandlers).toHaveLength(1)
      expect(transcriptHandlers[0].id).toBe('reminders:stage-default-user-prompt-after-bulk')
    })

    it('stages reminder on BulkProcessingComplete with skipIfExists', async () => {
      registerStageDefaultUserPrompt(ctx)

      const handler = handlers.getHandler('reminders:stage-default-user-prompt-after-bulk')
      const event = createTestTranscriptEvent({ turnCount: 5, toolCount: 10, toolsThisTurn: 2 }, undefined, undefined)
      // Override event type for BulkProcessingComplete
      const bulkEvent = {
        ...event,
        eventType: 'BulkProcessingComplete' as const,
      }

      await handler?.handler(bulkEvent, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('UserPromptSubmit')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('user-prompt-submit')
    })

    it('BulkProcessingComplete handler skips if reminder already exists', async () => {
      registerStageDefaultUserPrompt(ctx)

      // First, stage via SessionStart
      const sessionHandler = handlers.getHandler('reminders:stage-default-user-prompt')
      const sessionEvent = {
        kind: 'hook' as const,
        hook: 'SessionStart' as const,
        context: { sessionId: 'test-session', timestamp: Date.now() },
        payload: { startType: 'startup' as const, transcriptPath: '/test/transcript.jsonl' },
      }
      await sessionHandler?.handler(sessionEvent, ctx as unknown as import('@sidekick/types').HandlerContext)
      expect(staging.getRemindersForHook('UserPromptSubmit')).toHaveLength(1)

      // Then try to stage via BulkProcessingComplete - should skip
      const bulkHandler = handlers.getHandler('reminders:stage-default-user-prompt-after-bulk')
      const bulkEvent = {
        kind: 'transcript' as const,
        eventType: 'BulkProcessingComplete' as const,
        context: { sessionId: 'test-session', timestamp: Date.now() },
        payload: { lineNumber: 100, entry: { type: 'text', uuid: 'test', message: { role: 'user', content: 'test' } } },
        metadata: {
          transcriptPath: '/test/transcript.jsonl',
          metrics: createDefaultMetrics(),
          isBulkProcessing: false,
        },
      }
      await bulkHandler?.handler(bulkEvent, ctx as unknown as import('@sidekick/types').HandlerContext)

      // Should still only have one reminder (not duplicated)
      expect(staging.getRemindersForHook('UserPromptSubmit')).toHaveLength(1)
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

  describe('registerUnstageVerifyCompletion', () => {
    const sessionId = 'test-session-vc'
    let testProjectDir: string

    beforeEach(() => {
      testProjectDir = join('/tmp/claude', `test-vc-${Date.now()}`)
      const stateDir = join(testProjectDir, '.sidekick', 'sessions', sessionId, 'state')
      mkdirSync(stateDir, { recursive: true })
    })

    afterEach(() => {
      try {
        rmSync(testProjectDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    function createHookEvent(): UserPromptSubmitHookEvent {
      return {
        kind: 'hook',
        hook: 'UserPromptSubmit',
        context: { sessionId, timestamp: Date.now() },
        payload: {
          prompt: 'Continue please',
          transcriptPath: '/mock/transcript.jsonl',
          cwd: testProjectDir,
          permissionMode: 'default',
        },
      }
    }

    it('registers for UserPromptSubmit hook', () => {
      registerUnstageVerifyCompletion(ctx)

      const hookHandlers = handlers.getHandlersForHook('UserPromptSubmit')
      expect(hookHandlers).toHaveLength(1)
      expect(hookHandlers[0].id).toBe('reminders:unstage-verify-completion')
    })

    it('deletes verify-completion reminder when no unverified state', async () => {
      const ctxWithPath = createMockDaemonContext({
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

      // Pre-stage a verify-completion reminder
      await staging.stageReminder('Stop', 'verify-completion', {
        name: 'verify-completion',
        blocking: true,
        priority: 50,
        persistent: false,
        stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      })
      expect(staging.getRemindersForHook('Stop')).toHaveLength(1)

      registerUnstageVerifyCompletion(ctxWithPath)

      const handler = handlers.getHandler('reminders:unstage-verify-completion')
      await handler?.handler(createHookEvent(), ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

      // Reminder should be deleted
      expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
    })

    it('re-stages verify-completion when unverified changes exist', async () => {
      // Set up unverified state using MockStateService
      const stateService = new MockStateService(testProjectDir)
      const unverifiedState = {
        hasUnverifiedChanges: true,
        cycleCount: 1,
        setAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 5, toolCount: 5 },
        lastClassification: { category: 'OTHER', confidence: 0.5 },
      }
      const vcUnverifiedPath = stateService.sessionStatePath(sessionId, 'vc-unverified.json')
      stateService.setStored(vcUnverifiedPath, unverifiedState)

      const ctxWithPath = createMockDaemonContext({
        staging,
        logger,
        handlers,
        assets,
        stateService,
        paths: {
          projectDir: testProjectDir,
          userConfigDir: '/mock/user',
          projectConfigDir: '/mock/project-config',
        },
      })

      registerUnstageVerifyCompletion(ctxWithPath)

      const handler = handlers.getHandler('reminders:unstage-verify-completion')
      await handler?.handler(createHookEvent(), ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

      // Reminder should be re-staged
      const reminders = staging.getRemindersForHook('Stop')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('verify-completion')
      expect(logger.wasLogged('VC unstage: re-staged for next Stop')).toBe(true)
    })

    it('does not re-stage when cycle limit reached', async () => {
      const configWithCycleLimit = new MockConfigService()
      configWithCycleLimit.set({
        features: {
          reminders: { enabled: true, settings: { max_verification_cycles: 2 } },
        },
      })

      // Set up unverified state with cycle count at limit
      const stateService = new MockStateService(testProjectDir)
      const unverifiedState = {
        hasUnverifiedChanges: true,
        cycleCount: 2, // At limit
        setAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 5, toolCount: 5 },
        lastClassification: { category: 'OTHER', confidence: 0.5 },
      }
      const vcUnverifiedPath = stateService.sessionStatePath(sessionId, 'vc-unverified.json')
      stateService.setStored(vcUnverifiedPath, unverifiedState)

      const ctxWithPath = createMockDaemonContext({
        staging,
        logger,
        handlers,
        assets,
        stateService,
        paths: {
          projectDir: testProjectDir,
          userConfigDir: '/mock/user',
          projectConfigDir: '/mock/project-config',
        },
        config: configWithCycleLimit,
      })

      registerUnstageVerifyCompletion(ctxWithPath)

      const handler = handlers.getHandler('reminders:unstage-verify-completion')
      await handler?.handler(createHookEvent(), ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

      // Reminder should be deleted, not re-staged
      expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
      expect(logger.wasLogged('VC unstage: cycle limit reached, clearing')).toBe(true)
    })

    it('handles missing sessionId gracefully', async () => {
      registerUnstageVerifyCompletion(ctx)

      const handler = handlers.getHandler('reminders:unstage-verify-completion')
      // Intentionally omit sessionId to test error handling
      const eventWithoutSession = {
        kind: 'hook' as const,
        hook: 'UserPromptSubmit' as const,
        context: { timestamp: Date.now() }, // No sessionId
        payload: {
          prompt: 'test',
          transcriptPath: '/mock/transcript.jsonl',
          cwd: testProjectDir,
          permissionMode: 'default',
        },
      }

      await handler?.handler(eventWithoutSession as any, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(logger.wasLogged('No sessionId in UserPromptSubmit event')).toBe(true)
    })

    it('does not register when context is not DaemonContext', () => {
      const cliCtx = createMockCLIContext({ logger, handlers })

      registerUnstageVerifyCompletion(cliCtx)

      // Should not register any handlers
      expect(handlers.getHandlersForHook('UserPromptSubmit')).toHaveLength(0)
    })
  })

  describe('registerStageBashChanges', () => {
    beforeEach(() => {
      mockGetGitFileStatus.mockClear()
      mockGetGitFileStatus.mockResolvedValue([])
    })

    function createToolResultEvent(metrics: Partial<TranscriptMetrics>, toolName?: string): TranscriptEvent {
      return {
        kind: 'transcript',
        eventType: 'ToolResult',
        context: { sessionId: 'test-session', timestamp: Date.now() },
        payload: { lineNumber: 1, entry: {}, toolName },
        metadata: {
          transcriptPath: '/test/transcript.jsonl',
          metrics: { ...createDefaultMetrics(), ...metrics },
        },
      }
    }

    function createUserPromptSubmitEvent(sessionId: string = 'test-session'): UserPromptSubmitHookEvent {
      return {
        kind: 'hook',
        hook: 'UserPromptSubmit',
        context: { sessionId, timestamp: Date.now() },
        payload: {
          prompt: 'do something',
          transcriptPath: '/test/transcript.jsonl',
          cwd: '/test/project',
          permissionMode: 'default',
        },
      }
    }

    it('registers two handlers — one hook, one transcript', () => {
      registerStageBashChanges(ctx)

      const hookHandlers = handlers.getHandlersForHook('UserPromptSubmit')
      const transcriptHandlers = handlers.getHandlersForTranscriptEvent('ToolResult')

      // Find our specific handlers by id
      const baselineHandler = hookHandlers.find((h) => h.id === 'reminders:git-baseline-capture')
      const bashHandler = transcriptHandlers.find((h) => h.id === 'reminders:stage-stop-bash-changes')

      expect(baselineHandler).toBeDefined()
      expect(baselineHandler!.priority).toBe(40)
      expect(bashHandler).toBeDefined()
      expect(bashHandler!.priority).toBe(55)
    })

    it('captures git baseline on UserPromptSubmit', async () => {
      mockGetGitFileStatus.mockResolvedValue(['src/a.ts'])

      registerStageBashChanges(ctx)

      const handler = handlers.getHandler('reminders:git-baseline-capture')
      await handler?.handler(createUserPromptSubmitEvent(), ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(mockGetGitFileStatus).toHaveBeenCalledWith(
        expect.any(String), // cwd
        200 // timeout
      )
    })

    it('stages VC when Bash modifies a source file', async () => {
      registerStageBashChanges(ctx)

      // Capture baseline with one file
      mockGetGitFileStatus.mockResolvedValue(['src/a.ts'])
      const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
      await baselineHandler?.handler(
        createUserPromptSubmitEvent(),
        ctx as unknown as import('@sidekick/types').HandlerContext
      )

      // Simulate Bash creating a new source file
      mockGetGitFileStatus.mockResolvedValue(['src/a.ts', 'src/b.ts'])
      const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
      const event = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')
      await bashHandler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('Stop')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('verify-completion')
    })

    it('does not stage when Bash does not modify files', async () => {
      registerStageBashChanges(ctx)

      // Capture baseline
      mockGetGitFileStatus.mockResolvedValue(['src/a.ts'])
      const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
      await baselineHandler?.handler(
        createUserPromptSubmitEvent(),
        ctx as unknown as import('@sidekick/types').HandlerContext
      )

      // Bash runs but git status unchanged
      mockGetGitFileStatus.mockResolvedValue(['src/a.ts'])
      const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
      const event = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')
      await bashHandler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
    })

    it('does not stage for non-Bash ToolResult', async () => {
      registerStageBashChanges(ctx)

      // Capture baseline
      mockGetGitFileStatus.mockResolvedValue([])
      const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
      await baselineHandler?.handler(
        createUserPromptSubmitEvent(),
        ctx as unknown as import('@sidekick/types').HandlerContext
      )

      // Read tool result — should be ignored
      mockGetGitFileStatus.mockResolvedValue(['src/new.ts'])
      const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
      const event = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Read')
      await bashHandler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
      // Should not have called getGitFileStatus for the ToolResult (only baseline call)
      expect(mockGetGitFileStatus).toHaveBeenCalledTimes(1) // Only the baseline call
    })

    it('does not stage when changed file is not source code', async () => {
      registerStageBashChanges(ctx)

      // Capture baseline with no files
      mockGetGitFileStatus.mockResolvedValue([])
      const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
      await baselineHandler?.handler(
        createUserPromptSubmitEvent(),
        ctx as unknown as import('@sidekick/types').HandlerContext
      )

      // Bash creates a markdown file (not in source_code_patterns)
      mockGetGitFileStatus.mockResolvedValue(['docs/README.md'])
      const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
      const event = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')
      await bashHandler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
    })

    it('skips when no baseline exists (daemon restart mid-turn)', async () => {
      registerStageBashChanges(ctx)

      // Do NOT capture a baseline — simulate daemon restart mid-turn

      mockGetGitFileStatus.mockResolvedValue(['src/new.ts'])
      const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
      const event = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')
      await bashHandler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
      // Should not call getGitFileStatus for the ToolResult (no baseline = early return)
      expect(mockGetGitFileStatus).not.toHaveBeenCalled()
    })

    describe('once-per-turn reactivation', () => {
      it('does NOT re-stage VC after consumption within same turn', async () => {
        registerStageBashChanges(ctx)

        // Capture baseline
        mockGetGitFileStatus.mockResolvedValue([])
        const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
        await baselineHandler?.handler(
          createUserPromptSubmitEvent(),
          ctx as unknown as import('@sidekick/types').HandlerContext
        )

        // First Bash creates a source file — stages VC
        mockGetGitFileStatus.mockResolvedValue(['src/a.ts'])
        const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
        const event1 = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')
        await bashHandler?.handler(event1, ctx as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('Stop')).toHaveLength(1)

        // Simulate consumption on turn 1
        staging.addConsumedReminder('Stop', 'verify-completion', {
          name: 'verify-completion',
          blocking: true,
          priority: 50,
          persistent: false,
          stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
        })
        await staging.deleteReminder('Stop', 'verify-completion')
        expect(staging.getRemindersForHook('Stop')).toHaveLength(0)

        // Second Bash in SAME turn — should NOT re-stage
        mockGetGitFileStatus.mockResolvedValue(['src/a.ts', 'src/b.ts'])
        const event2 = createToolResultEvent({ turnCount: 1, toolsThisTurn: 5, toolCount: 5 }, 'Bash')
        await bashHandler?.handler(event2, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
      })

      it('DOES re-stage VC after consumption on NEW turn', async () => {
        registerStageBashChanges(ctx)

        // Capture baseline
        mockGetGitFileStatus.mockResolvedValue([])
        const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
        await baselineHandler?.handler(
          createUserPromptSubmitEvent(),
          ctx as unknown as import('@sidekick/types').HandlerContext
        )

        // First Bash creates a source file — stages VC
        mockGetGitFileStatus.mockResolvedValue(['src/a.ts'])
        const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
        const event1 = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')
        await bashHandler?.handler(event1, ctx as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('Stop')).toHaveLength(1)

        // Simulate consumption on turn 1
        staging.addConsumedReminder('Stop', 'verify-completion', {
          name: 'verify-completion',
          blocking: true,
          priority: 50,
          persistent: false,
          stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
        })
        await staging.deleteReminder('Stop', 'verify-completion')

        // Bash on NEW turn (turn 2) — SHOULD re-stage
        mockGetGitFileStatus.mockResolvedValue(['src/a.ts', 'src/c.ts'])
        const event2 = createToolResultEvent({ turnCount: 2, toolsThisTurn: 1, toolCount: 10 }, 'Bash')
        await bashHandler?.handler(event2, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('Stop')).toHaveLength(1)
      })
    })
  })

  describe('registerStagePersonaReminders', () => {
    const sessionId = 'test-session'

    function createSessionStartEvent() {
      return {
        kind: 'hook' as const,
        hook: 'SessionStart' as const,
        context: { sessionId, timestamp: Date.now() },
        payload: { startType: 'startup' as const, transcriptPath: '/test/transcript.jsonl' },
      }
    }

    function setupPersonaState(stateService: MockStateService, personaId: string): void {
      const personaPath = stateService.sessionStatePath(sessionId, 'session-persona.json')
      stateService.setStored(personaPath, {
        persona_id: personaId,
        selected_from: [personaId],
        timestamp: new Date().toISOString(),
      })
    }

    function setupPersonaLoader(personaId: string, persona: Record<string, unknown>): void {
      mockCreatePersonaLoader.mockReturnValue({
        discover: () => new Map([[personaId, persona]]),
      })
    }

    const testPersona = {
      id: 'skippy',
      display_name: 'Skippy',
      theme: 'A sarcastic AI',
      personality_traits: ['arrogant', 'brilliant'],
      tone_traits: ['snarky', 'playful'],
      snarky_examples: ['Still confused?', 'Typical monkey.'],
    }

    beforeEach(() => {
      mockCreatePersonaLoader.mockClear()
      mockCreatePersonaLoader.mockReturnValue({
        discover: () => new Map(),
      })
    })

    it('registers for SessionStart hook', () => {
      registerStagePersonaReminders(ctx)

      const hookHandlers = handlers.getHandlersForHook('SessionStart')
      const personaHandler = hookHandlers.find((h) => h.id === 'reminders:stage-persona-reminders')
      expect(personaHandler).toBeDefined()
    })

    it('stages remember-your-persona for UserPromptSubmit and SessionStart when persona is active', async () => {
      const stateService = new MockStateService('/tmp/claude/test-persona-staging')
      const ctxWithState = createMockDaemonContext({
        staging,
        logger,
        handlers,
        assets,
        stateService,
        paths: {
          projectDir: '/tmp/claude/test-persona-staging',
          userConfigDir: '/mock/user',
          projectConfigDir: '/mock/project-config',
        },
      })

      // Register persona reminder YAML in assets
      assets.registerAll({
        'reminders/remember-your-persona.yaml': `id: remember-your-persona
blocking: false
priority: 5
persistent: true
additionalContext: "Persona: {{persona_name}} - {{persona_tone}}"
`,
      })

      setupPersonaState(stateService, 'skippy')
      setupPersonaLoader('skippy', testPersona)

      registerStagePersonaReminders(ctxWithState)

      const handler = handlers.getHandler('reminders:stage-persona-reminders')
      await handler?.handler(
        createSessionStartEvent(),
        ctxWithState as unknown as import('@sidekick/types').HandlerContext
      )

      // Should be staged for both hooks
      const upsReminders = staging.getRemindersForHook('UserPromptSubmit')
      const ssReminders = staging.getRemindersForHook('SessionStart')

      expect(upsReminders.some((r) => r.name === 'remember-your-persona')).toBe(true)
      expect(ssReminders.some((r) => r.name === 'remember-your-persona')).toBe(true)

      // Verify template interpolation
      const upsReminder = upsReminders.find((r) => r.name === 'remember-your-persona')
      expect(upsReminder?.additionalContext).toContain('Skippy')
      expect(upsReminder?.additionalContext).toContain('snarky, playful')
    })

    it('does NOT stage when persona is disabled', async () => {
      const stateService = new MockStateService('/tmp/claude/test-persona-disabled')
      const ctxWithState = createMockDaemonContext({
        staging,
        logger,
        handlers,
        assets,
        stateService,
        paths: {
          projectDir: '/tmp/claude/test-persona-disabled',
          userConfigDir: '/mock/user',
          projectConfigDir: '/mock/project-config',
        },
      })

      setupPersonaState(stateService, 'disabled')

      registerStagePersonaReminders(ctxWithState)

      const handler = handlers.getHandler('reminders:stage-persona-reminders')
      await handler?.handler(
        createSessionStartEvent(),
        ctxWithState as unknown as import('@sidekick/types').HandlerContext
      )

      expect(staging.getRemindersForHook('UserPromptSubmit').some((r) => r.name === 'remember-your-persona')).toBe(
        false
      )
      expect(staging.getRemindersForHook('SessionStart').some((r) => r.name === 'remember-your-persona')).toBe(false)
    })

    it('does NOT stage when no persona is set', async () => {
      // No persona state written — stateService returns null
      const stateService = new MockStateService('/tmp/claude/test-no-persona')
      const ctxWithState = createMockDaemonContext({
        staging,
        logger,
        handlers,
        assets,
        stateService,
        paths: {
          projectDir: '/tmp/claude/test-no-persona',
          userConfigDir: '/mock/user',
          projectConfigDir: '/mock/project-config',
        },
      })

      registerStagePersonaReminders(ctxWithState)

      const handler = handlers.getHandler('reminders:stage-persona-reminders')
      await handler?.handler(
        createSessionStartEvent(),
        ctxWithState as unknown as import('@sidekick/types').HandlerContext
      )

      expect(staging.getRemindersForHook('UserPromptSubmit').some((r) => r.name === 'remember-your-persona')).toBe(
        false
      )
    })

    it('does NOT stage when injectPersonaIntoClaude config is false', async () => {
      const config = new MockConfigService()
      config.set({
        features: {
          'session-summary': {
            enabled: true,
            settings: {
              personas: {
                injectPersonaIntoClaude: false,
              },
            },
          },
        },
      })

      const stateService = new MockStateService('/tmp/claude/test-persona-config-off')
      const ctxWithConfig = createMockDaemonContext({
        staging,
        logger,
        handlers,
        assets,
        stateService,
        config,
        paths: {
          projectDir: '/tmp/claude/test-persona-config-off',
          userConfigDir: '/mock/user',
          projectConfigDir: '/mock/project-config',
        },
      })

      setupPersonaState(stateService, 'skippy')
      setupPersonaLoader('skippy', testPersona)

      registerStagePersonaReminders(ctxWithConfig)

      const handler = handlers.getHandler('reminders:stage-persona-reminders')
      await handler?.handler(
        createSessionStartEvent(),
        ctxWithConfig as unknown as import('@sidekick/types').HandlerContext
      )

      expect(staging.getRemindersForHook('UserPromptSubmit').some((r) => r.name === 'remember-your-persona')).toBe(
        false
      )
    })

    it('does not register when context is not DaemonContext', () => {
      const cliCtx = createMockCLIContext({ logger, handlers })

      registerStagePersonaReminders(cliCtx as unknown as DaemonContext)

      expect(
        handlers.getHandlersForHook('SessionStart').filter((h) => h.id === 'reminders:stage-persona-reminders')
      ).toHaveLength(0)
    })

    it('cleans up existing persona reminders when injectPersonaIntoClaude is false', async () => {
      const config = new MockConfigService()
      // Start with injection enabled
      config.set({
        features: {
          'session-summary': {
            enabled: true,
            settings: {
              personas: {
                injectPersonaIntoClaude: true,
              },
            },
          },
        },
      })

      const stateService = new MockStateService('/tmp/claude/test-persona-cleanup')
      const ctxEnabled = createMockDaemonContext({
        staging,
        logger,
        handlers,
        assets,
        stateService,
        config,
        paths: {
          projectDir: '/tmp/claude/test-persona-cleanup',
          userConfigDir: '/mock/user',
          projectConfigDir: '/mock/project-config',
        },
      })

      // Register persona reminder YAML
      assets.registerAll({
        'reminders/remember-your-persona.yaml': `id: remember-your-persona
blocking: false
priority: 5
persistent: true
additionalContext: "Persona: {{persona_name}} - {{persona_tone}}"
`,
      })

      setupPersonaState(stateService, 'skippy')
      setupPersonaLoader('skippy', testPersona)

      // Stage reminders with injection enabled
      await stagePersonaRemindersForSession(ctxEnabled, sessionId)

      // Verify reminders are staged
      expect(staging.getRemindersForHook('UserPromptSubmit').some((r) => r.name === 'remember-your-persona')).toBe(true)
      expect(staging.getRemindersForHook('SessionStart').some((r) => r.name === 'remember-your-persona')).toBe(true)

      // Now disable injection
      config.set({
        features: {
          'session-summary': {
            enabled: true,
            settings: {
              personas: {
                injectPersonaIntoClaude: false,
              },
            },
          },
        },
      })

      // Re-stage - should clean up
      await stagePersonaRemindersForSession(ctxEnabled, sessionId)

      // Verify reminders are cleaned up
      expect(staging.getRemindersForHook('UserPromptSubmit').some((r) => r.name === 'remember-your-persona')).toBe(
        false
      )
      expect(staging.getRemindersForHook('SessionStart').some((r) => r.name === 'remember-your-persona')).toBe(false)
    })

    describe('restagePersonaRemindersForActiveSessions', () => {
      it('calls stagePersonaRemindersForSession for each session ID', async () => {
        const stateService = new MockStateService('/tmp/claude/test-restage')
        const ctxForSession = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService,
          paths: {
            projectDir: '/tmp/claude/test-restage',
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })

        const ctxFactory = vi.fn().mockResolvedValue(ctxForSession)
        const sessionIds = ['session-1', 'session-2', 'session-3']

        await restagePersonaRemindersForActiveSessions(ctxFactory, sessionIds, logger as any)

        expect(ctxFactory).toHaveBeenCalledTimes(3)
        expect(ctxFactory).toHaveBeenCalledWith('session-1')
        expect(ctxFactory).toHaveBeenCalledWith('session-2')
        expect(ctxFactory).toHaveBeenCalledWith('session-3')
      })

      it('handles errors for individual sessions without failing the loop', async () => {
        const stateService = new MockStateService('/tmp/claude/test-restage-error')
        const ctxForSession = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService,
          paths: {
            projectDir: '/tmp/claude/test-restage-error',
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })

        const ctxFactory = vi
          .fn()
          .mockRejectedValueOnce(new Error('Session 1 context failed'))
          .mockResolvedValueOnce(ctxForSession)

        await restagePersonaRemindersForActiveSessions(ctxFactory, ['session-1', 'session-2'], logger as any)

        // Should have called factory for both sessions despite first failing
        expect(ctxFactory).toHaveBeenCalledTimes(2)
        // Should have logged the error
        expect(logger.wasLogged('Failed to restage persona reminders')).toBe(true)
      })

      it('handles empty session list gracefully', async () => {
        const ctxFactory = vi.fn()

        await restagePersonaRemindersForActiveSessions(ctxFactory, [], logger as any)

        expect(ctxFactory).not.toHaveBeenCalled()
      })
    })

    describe('persona change detection (last-staged tracking)', () => {
      const personaReminderYaml = {
        'reminders/remember-your-persona.yaml': `id: remember-your-persona
blocking: false
priority: 5
persistent: true
additionalContext: "Persona: {{persona_name}} - {{persona_tone}}"
`,
        'reminders/persona-changed.yaml': `id: persona-changed
blocking: false
priority: 8
persistent: false
additionalContext: "Your persona has changed to: {{persona_name}}"
`,
      }

      const personaB = {
        id: 'vader',
        display_name: 'Vader',
        theme: 'A Sith Lord',
        personality_traits: ['menacing', 'dramatic'],
        tone_traits: ['deep', 'commanding'],
        snarky_examples: ['I find your lack of faith disturbing.'],
      }

      /** Check whether a named reminder is staged for a given hook */
      function hasReminderStaged(hookName: string, reminderName: string): boolean {
        return staging.getRemindersForHook(hookName).some((r) => r.name === reminderName)
      }

      function createCtxWithState(projectDir: string): { stateService: MockStateService; ctx: DaemonContext } {
        const stateService = new MockStateService(projectDir)
        const ctxWithState = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService,
          paths: {
            projectDir,
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })
        assets.registerAll(personaReminderYaml)
        return { stateService, ctx: ctxWithState }
      }

      it('does NOT stage persona-changed on first staging (never_staged → persona)', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-1')
        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)

        await stagePersonaRemindersForSession(testCtx, sessionId, { includeChangedReminder: true })

        expect(hasReminderStaged('UserPromptSubmit', 'remember-your-persona')).toBe(true)
        expect(hasReminderStaged('UserPromptSubmit', 'persona-changed')).toBe(false)
      })

      it('stages persona-changed when persona genuinely changes (A → B)', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-2')

        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)
        await stagePersonaRemindersForSession(testCtx, sessionId)

        await staging.deleteReminder('UserPromptSubmit', 'remember-your-persona')
        await staging.deleteReminder('SessionStart', 'remember-your-persona')

        setupPersonaState(stateService, 'vader')
        setupPersonaLoader('vader', personaB)
        await stagePersonaRemindersForSession(testCtx, sessionId, { includeChangedReminder: true })

        expect(hasReminderStaged('UserPromptSubmit', 'persona-changed')).toBe(true)
      })

      it('does NOT stage persona-changed when same persona is re-staged', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-3')
        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)

        await stagePersonaRemindersForSession(testCtx, sessionId)
        await stagePersonaRemindersForSession(testCtx, sessionId, { includeChangedReminder: true })

        expect(hasReminderStaged('UserPromptSubmit', 'persona-changed')).toBe(false)
      })

      it('stages persona-changed when going from cleared → persona mid-session', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-4')

        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)
        await stagePersonaRemindersForSession(testCtx, sessionId)

        // Clear persona
        const personaPath = stateService.sessionStatePath(sessionId, 'session-persona.json')
        await stateService.delete(personaPath)
        mockCreatePersonaLoader.mockReturnValue({ discover: () => new Map() })
        await stagePersonaRemindersForSession(testCtx, sessionId)

        await staging.deleteReminder('UserPromptSubmit', 'remember-your-persona')
        await staging.deleteReminder('SessionStart', 'remember-your-persona')

        setupPersonaState(stateService, 'vader')
        setupPersonaLoader('vader', personaB)
        await stagePersonaRemindersForSession(testCtx, sessionId, { includeChangedReminder: true })

        expect(hasReminderStaged('UserPromptSubmit', 'persona-changed')).toBe(true)
      })

      it('does NOT stage persona-changed on SessionStart path (no includeChangedReminder)', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-5')
        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)

        await stagePersonaRemindersForSession(testCtx, sessionId)

        expect(hasReminderStaged('UserPromptSubmit', 'persona-changed')).toBe(false)
      })

      it('writes last-staged state after successful staging', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-6')
        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)

        await stagePersonaRemindersForSession(testCtx, sessionId)

        const lastStagedPath = stateService.sessionStatePath(sessionId, 'last-staged-persona.json')
        const result = await stateService.read(lastStagedPath, LastStagedPersonaSchema, null)
        expect(result.data).toEqual({ personaId: 'skippy' })
      })

      it('writes null personaId to last-staged state when clearing', async () => {
        const { stateService, ctx: testCtx } = createCtxWithState('/tmp/claude/test-change-detect-7')

        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)
        await stagePersonaRemindersForSession(testCtx, sessionId)

        const personaPath = stateService.sessionStatePath(sessionId, 'session-persona.json')
        await stateService.delete(personaPath)
        mockCreatePersonaLoader.mockReturnValue({ discover: () => new Map() })
        await stagePersonaRemindersForSession(testCtx, sessionId)

        const lastStagedPath = stateService.sessionStatePath(sessionId, 'last-staged-persona.json')
        const result = await stateService.read(lastStagedPath, LastStagedPersonaSchema, null)
        expect(result.data).toEqual({ personaId: null })
      })
    })
  })
})
