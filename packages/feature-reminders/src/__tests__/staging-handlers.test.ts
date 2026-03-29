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
import type { LogRecord } from '@sidekick/testing-fixtures'
import type {
  DaemonContext,
  SessionStartHookEvent,
  TranscriptEvent,
  TranscriptMetrics,
  PRBaselineState,
  UserPromptSubmitHookEvent,
} from '@sidekick/types'
import { LastStagedPersonaSchema } from '@sidekick/types'
import { registerStagePauseAndReflect } from '../handlers/staging/stage-pause-and-reflect'
import { registerStageDefaultUserPrompt } from '../handlers/staging/stage-default-user-prompt'
import { registerThrottledReminder } from '../handlers/staging/throttle-utils'
import { registerUnstageVerifyCompletion } from '../handlers/staging/unstage-verify-completion'
import { registerStageBashChanges } from '../handlers/staging/stage-stop-bash-changes'
import {
  registerStagePersonaReminders,
  stagePersonaRemindersForSession,
  restagePersonaRemindersForActiveSessions,
} from '../handlers/staging/stage-persona-reminders'
import { getGitFileStatus } from '@sidekick/core'
import { createRemindersState } from '../state'

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

function createConversationTranscriptEvent(
  eventType: 'UserPrompt' | 'AssistantMessage',
  sessionId: string = 'test-session',
  metrics?: Partial<TranscriptMetrics>
): TranscriptEvent {
  return {
    kind: 'transcript',
    eventType,
    context: {
      sessionId,
      timestamp: Date.now(),
    },
    payload: {
      lineNumber: 1,
      entry: {},
    },
    metadata: {
      transcriptPath: '/test/transcript.jsonl',
      metrics: { ...createDefaultMetrics(), ...(metrics ?? {}) },
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
persistent: false
additionalContext: "Standard user prompt reminder"
`,
      'reminders/verify-completion.yaml': `id: verify-completion
blocking: true
priority: 50
persistent: false
reason: "Verify completion before stopping"
`,
      'reminders/vc-build.yaml': `id: vc-build
blocking: true
priority: 50
persistent: false
additionalContext: "Build needed"
`,
      'reminders/vc-typecheck.yaml': `id: vc-typecheck
blocking: true
priority: 50
persistent: false
additionalContext: "Typecheck needed"
`,
      'reminders/vc-test.yaml': `id: vc-test
blocking: true
priority: 50
persistent: false
additionalContext: "Test needed"
`,
      'reminders/vc-lint.yaml': `id: vc-lint
blocking: true
priority: 50
persistent: false
additionalContext: "Lint needed"
`,
    })

    ctx = createMockDaemonContext({ staging, logger, handlers, assets })
  })

  function getDecisionRecordedEvents(): LogRecord[] {
    return logger.recordedLogs.filter((log) => log.level === 'info' && log.meta?.type === 'decision:recorded')
  }

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

    it('skips staging during bulk transcript reconstruction', async () => {
      registerStagePauseAndReflect(ctx)

      const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
      expect(handler).toBeDefined()
      const event = createTestTranscriptEvent({ toolsThisTurn: 100 }) // Well above threshold
      // Mark as bulk processing
      event.metadata.isBulkProcessing = true

      await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      // Should not stage despite exceeding threshold
      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)
    })

    describe('when reminder definition cannot be resolved', () => {
      let cwdSpy: ReturnType<typeof vi.spyOn>

      beforeEach(() => {
        // Prevent file-system fallback from finding real YAML files
        cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent')
      })

      afterEach(() => {
        cwdSpy.mockRestore()
      })

      it('logs warning when reminder definition cannot be resolved', async () => {
        // Use empty assets so resolveReminder returns null
        const emptyAssets = new MockAssetResolver()
        const ctxNoAssets = createMockDaemonContext({ staging, logger, handlers, assets: emptyAssets })

        registerStagePauseAndReflect(ctxNoAssets)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
        expect(handler).toBeDefined()
        const event = createTestTranscriptEvent({ toolsThisTurn: 100 })

        await handler!.handler(event, ctxNoAssets as unknown as import('@sidekick/types').HandlerContext)

        // Should not stage and should log warning
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)
        expect(logger.wasLoggedAtLevel('Failed to resolve reminder', 'warn')).toBe(true)
      })
    })

    it('calls orchestrator.onReminderStaged after staging', async () => {
      const mockOrchestrator = {
        onReminderStaged: vi.fn().mockResolvedValue(undefined),
        onReminderConsumed: vi.fn().mockResolvedValue(undefined),
        onUserPromptSubmit: vi.fn().mockResolvedValue(undefined),
      }

      const ctxWithOrchestrator = createMockDaemonContext({
        staging,
        logger,
        handlers,
        assets,
        orchestrator: mockOrchestrator,
      })

      registerStagePauseAndReflect(ctxWithOrchestrator)

      const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
      expect(handler).toBeDefined()
      const event = createTestTranscriptEvent({ toolsThisTurn: 60 })

      await handler!.handler(event, ctxWithOrchestrator as unknown as import('@sidekick/types').HandlerContext)

      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      expect(mockOrchestrator.onReminderStaged).toHaveBeenCalledWith(
        { name: 'pause-and-reflect', hook: 'PreToolUse' },
        'test-session'
      )
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
      expect(handler).toBeDefined()
      const event = createTestTranscriptEvent({ toolsThisTurn: 10 }) // Below default 60

      await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)
    })

    it('stages reminder when at or above threshold', async () => {
      registerStagePauseAndReflect(ctx)

      const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
      expect(handler).toBeDefined()
      const event = createTestTranscriptEvent({ toolsThisTurn: 60 })

      await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('PreToolUse')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('pause-and-reflect')
      expect(reminders[0].priority).toBe(80)
      expect(reminders[0].blocking).toBe(true)
    })

    it('emits decision:recorded when threshold reached', async () => {
      registerStagePauseAndReflect(ctx)

      const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
      expect(handler).toBeDefined()
      const event = createTestTranscriptEvent({ toolsThisTurn: 60 })

      await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const decisionEvents = getDecisionRecordedEvents()
      expect(decisionEvents).toHaveLength(1)
      expect(decisionEvents[0].meta?.decision).toBe('staged')
      expect(decisionEvents[0].meta?.subsystem).toBe('pause-reflect')
      expect(decisionEvents[0].meta?.title).toBe('Stage pause-and-reflect reminder')
    })

    it('is idempotent - does not re-stage if already exists', async () => {
      registerStagePauseAndReflect(ctx)

      const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
      expect(handler).toBeDefined()
      const event = createTestTranscriptEvent({ toolsThisTurn: 65 })

      // First call stages
      await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)
      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)

      // Second call should not duplicate
      await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)
      expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
    })

    it('interpolates template variables', async () => {
      registerStagePauseAndReflect(ctx)

      const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
      expect(handler).toBeDefined()
      const event = createTestTranscriptEvent({ toolsThisTurn: 65 })

      await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

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
        expect(handler).toBeDefined()
        // Default threshold is 60, so this should trigger
        const event = createEventWithSession({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })

        await handler!.handler(event, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

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
        expect(handler).toBeDefined()

        // At tool 60 on turn 1: 60 - 20 = 40 < 60 threshold, should NOT fire
        const event60 = createEventWithSession({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })
        await handler!.handler(event60, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)

        // At tool 80 on turn 1: 80 - 20 = 60 >= 60 threshold, SHOULD fire
        const event80 = createEventWithSession({ turnCount: 1, toolsThisTurn: 80, toolCount: 80 })
        await handler!.handler(event80, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)
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
        expect(handler).toBeDefined()

        // On turn 2, baseline from turn 1 should be ignored
        // At tool 60 on turn 2: uses default threshold (0), so 60 >= 60, SHOULD fire
        const event = createEventWithSession({ turnCount: 2, toolsThisTurn: 60, toolCount: 100 })
        await handler!.handler(event, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

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
        expect(handler).toBeDefined()
        // Should use default threshold (0) and not crash
        const event = createEventWithSession({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })

        await handler!.handler(event, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })
    })

    describe('P&R reactivation after consumption', () => {
      it('uses last P&R consumption as baseline when consumed same turn', async () => {
        registerStagePauseAndReflect(ctx)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
        expect(handler).toBeDefined()

        // First trigger at tool 60 - stages P&R
        const event60 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })
        await handler!.handler(event60, ctx as unknown as import('@sidekick/types').HandlerContext)
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
        await handler!.handler(event80, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)
      })

      it('reactivates when threshold crossed since last consumption same turn', async () => {
        registerStagePauseAndReflect(ctx)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
        expect(handler).toBeDefined()

        // First trigger at tool 60 - stages P&R
        const event60 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })
        await handler!.handler(event60, ctx as unknown as import('@sidekick/types').HandlerContext)
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
        await handler!.handler(event120, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })

      it('reactivates on new turn regardless of tool count', async () => {
        registerStagePauseAndReflect(ctx)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
        expect(handler).toBeDefined()

        // First trigger at tool 60 on turn 1
        const event1 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })
        await handler!.handler(event1, ctx as unknown as import('@sidekick/types').HandlerContext)
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
        await handler!.handler(event2, ctx as unknown as import('@sidekick/types').HandlerContext)

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
        expect(handler).toBeDefined()

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
        await handler!.handler(event80, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)
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
        await handler!.handler(event120, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(0)

        // At tool 140: 140 >= 80 + 60 threshold, SHOULD fire
        const event140 = createEventWithSession({ turnCount: 1, toolsThisTurn: 140, toolCount: 140 })
        await handler!.handler(event140, ctxWithPath as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('PreToolUse')).toHaveLength(1)
      })
    })

    describe('reminder:not-staged events', () => {
      it('should emit not-staged event when reactivation skipped (same turn)', async () => {
        registerStagePauseAndReflect(ctx)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
        expect(handler).toBeDefined()

        // First trigger at tool 60 - stages P&R
        const event60 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 60, toolCount: 60 })
        await handler!.handler(event60, ctx as unknown as import('@sidekick/types').HandlerContext)
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

        logger.reset()

        // At tool 80 same turn: 80 - 60 = 20 < 60 threshold, should NOT re-stage
        const event80 = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 80, toolCount: 80 })
        await handler!.handler(event80, ctx as unknown as import('@sidekick/types').HandlerContext)

        const notStagedEvents = logger.recordedLogs.filter(
          (log) => log.level === 'info' && log.meta?.type === 'reminder:not-staged'
        )
        expect(notStagedEvents).toHaveLength(1)
        expect(notStagedEvents[0].meta?.reason).toBe('same_turn')
        expect(notStagedEvents[0].meta?.reminderName).toBe('pause-and-reflect')
      })

      it('should emit not-staged event when tools below threshold', async () => {
        registerStagePauseAndReflect(ctx)

        const handler = handlers.getHandler('reminders:stage-pause-and-reflect')
        expect(handler).toBeDefined()

        // toolsThisTurn = 10 is below default threshold of 60
        const event = createTestTranscriptEvent({ turnCount: 1, toolsThisTurn: 10, toolCount: 10 })
        await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        const notStagedEvents = logger.recordedLogs.filter(
          (log) => log.level === 'info' && log.meta?.type === 'reminder:not-staged'
        )
        expect(notStagedEvents).toHaveLength(1)
        expect(notStagedEvents[0].meta?.reason).toBe('below_threshold')
        expect(notStagedEvents[0].meta?.reminderName).toBe('pause-and-reflect')
        expect(notStagedEvents[0].meta?.threshold).toBe(60)
        expect(notStagedEvents[0].meta?.currentValue).toBe(10)
      })
    })
  })

  describe('registerStageDefaultUserPrompt', () => {
    it('registers for SessionStart hook event', () => {
      registerStageDefaultUserPrompt(ctx)

      const registrations = handlers.getHandlersForHook('SessionStart')
      const stageHandler = registrations.find((h) => h.id === 'reminders:stage-default-user-prompt')
      expect(stageHandler).toBeDefined()
    })

    it('stages non-persistent reminder on SessionStart', async () => {
      registerStageDefaultUserPrompt(ctx)

      const handler = handlers.getHandler('reminders:stage-default-user-prompt')
      expect(handler).toBeDefined()
      const event = {
        kind: 'hook' as const,
        hook: 'SessionStart' as const,
        context: { sessionId: 'test-session', timestamp: Date.now() },
        payload: { startType: 'startup' as const, transcriptPath: '/test/transcript.jsonl' },
      }

      await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const reminders = staging.getRemindersForHook('UserPromptSubmit')
      expect(reminders).toHaveLength(1)
      expect(reminders[0].name).toBe('user-prompt-submit')
      expect(reminders[0].persistent).toBe(false)
      expect(reminders[0].priority).toBe(10)
    })

    it('also registers for BulkProcessingComplete transcript event', () => {
      registerStageDefaultUserPrompt(ctx)

      const transcriptHandlers = handlers.getHandlersByKind('transcript')
      const bulkHandler = transcriptHandlers.find((h) => h.id === 'reminders:stage-default-user-prompt-after-bulk')
      expect(bulkHandler).toBeDefined()
    })

    it('stages reminder on BulkProcessingComplete with skipIfExists', async () => {
      registerStageDefaultUserPrompt(ctx)

      const handler = handlers.getHandler('reminders:stage-default-user-prompt-after-bulk')
      expect(handler).toBeDefined()
      const event = createTestTranscriptEvent({ turnCount: 5, toolCount: 10, toolsThisTurn: 2 }, undefined, undefined)
      // Override event type for BulkProcessingComplete
      const bulkEvent = {
        ...event,
        eventType: 'BulkProcessingComplete' as const,
      }

      await handler!.handler(bulkEvent, ctx as unknown as import('@sidekick/types').HandlerContext)

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

    describe('throttle re-staging', () => {
      let stateService: MockStateService

      beforeEach(async () => {
        stateService = new MockStateService()
        staging = new MockStagingService()
        logger = new MockLogger()
        handlers = new MockHandlerRegistry()
        assets = new MockAssetResolver()

        assets.registerAll({
          'reminders/user-prompt-submit.yaml': `id: user-prompt-submit
blocking: false
priority: 10
persistent: false
additionalContext: "Standard user prompt reminder"
`,
        })

        ctx = createMockDaemonContext({ staging, logger, handlers, assets, stateService })

        // Seed throttle state so the generic handler has a registered entry
        const seedState = createRemindersState(stateService)
        await seedState.reminderThrottle.write('test-session', {
          'user-prompt-submit': {
            messagesSinceLastStaging: 0,
            targetHook: 'UserPromptSubmit',
            cachedReminder: {
              name: 'user-prompt-submit',
              blocking: false,
              priority: 10,
              persistent: false,
              additionalContext: 'Standard user prompt reminder',
            },
          },
        })
      })

      it('registers a transcript handler for UserPrompt and AssistantMessage', () => {
        registerStageDefaultUserPrompt(ctx)

        const transcriptHandlers = handlers.getHandlersByKind('transcript')
        const throttleHandler = transcriptHandlers.find((h) => h.id === 'reminders:throttle-restage')
        expect(throttleHandler).toBeDefined()
      })

      it('increments message counter on UserPrompt event', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()
        const event = createConversationTranscriptEvent('UserPrompt')
        await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        const remindersState = createRemindersState(stateService)
        const result = await remindersState.reminderThrottle.read('test-session')
        expect(result.data['user-prompt-submit'].messagesSinceLastStaging).toBe(1)
      })

      it('increments message counter on AssistantMessage event', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()
        const event = createConversationTranscriptEvent('AssistantMessage')
        await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        const remindersState = createRemindersState(stateService)
        const result = await remindersState.reminderThrottle.read('test-session')
        expect(result.data['user-prompt-submit'].messagesSinceLastStaging).toBe(1)
      })

      it('does not re-stage when below threshold', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()

        // Fire 9 events (below default threshold of 10)
        for (let i = 0; i < 9; i++) {
          const event = createConversationTranscriptEvent('UserPrompt')
          await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)
        }

        // No SessionStart was fired, so only throttle could have staged.
        // 9 events is below threshold (10), so nothing should be staged.
        const reminders = staging.getRemindersForHook('UserPromptSubmit')
        expect(reminders.filter((r) => r.name === 'user-prompt-submit')).toHaveLength(0)
      })

      it('re-stages reminder when threshold is met', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()

        // Fire 10 events (meets default threshold of 10)
        for (let i = 0; i < 10; i++) {
          const event = createConversationTranscriptEvent('UserPrompt')
          await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)
        }

        const reminders = staging.getRemindersForHook('UserPromptSubmit')
        expect(reminders.some((r) => r.name === 'user-prompt-submit')).toBe(true)
      })

      it('emits decision:recorded when throttle threshold reached', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()

        // Fire 10 events (meets default threshold of 10)
        for (let i = 0; i < 10; i++) {
          const event = createConversationTranscriptEvent('UserPrompt')
          await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)
        }

        const decisionEvents = getDecisionRecordedEvents()
        expect(decisionEvents).toHaveLength(1)
        expect(decisionEvents[0].meta?.decision).toBe('staged')
        expect(decisionEvents[0].meta?.subsystem).toBe('reminder-throttle')
        expect(decisionEvents[0].meta?.title).toBe('Re-stage user-prompt-submit reminder')
      })

      it('includes stagedAt metrics from triggering event when re-staging', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()

        // Fire 9 events to get just below threshold
        for (let i = 0; i < 9; i++) {
          const event = createConversationTranscriptEvent('UserPrompt')
          await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)
        }

        // Fire the 10th event with specific metrics — this triggers re-staging
        const triggeringEvent = createConversationTranscriptEvent('UserPrompt', 'test-session', {
          turnCount: 5,
          toolsThisTurn: 3,
          toolCount: 42,
        })
        await handler!.handler(triggeringEvent, ctx as unknown as import('@sidekick/types').HandlerContext)

        const reminders = staging.getRemindersForHook('UserPromptSubmit')
        const restaged = reminders.find((r) => r.name === 'user-prompt-submit')
        expect(restaged).toBeDefined()
        expect(restaged!.stagedAt).toBeDefined()
        expect(restaged!.stagedAt!.turnCount).toBe(5)
        expect(restaged!.stagedAt!.toolsThisTurn).toBe(3)
        expect(restaged!.stagedAt!.toolCount).toBe(42)
        expect(restaged!.stagedAt!.timestamp).toBeGreaterThan(0)
      })

      it('resets counter after re-staging', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()

        // Fire 10 events to trigger re-staging
        for (let i = 0; i < 10; i++) {
          const event = createConversationTranscriptEvent('UserPrompt')
          await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)
        }

        const remindersState = createRemindersState(stateService)
        const result = await remindersState.reminderThrottle.read('test-session')
        expect(result.data['user-prompt-submit'].messagesSinceLastStaging).toBe(0)
      })

      it('skips bulk replay events', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()
        const event = createConversationTranscriptEvent('UserPrompt')
        // Add bulk processing flag
        const bulkEvent = {
          ...event,
          metadata: { ...event.metadata, isBulkProcessing: true },
        }
        await handler!.handler(bulkEvent, ctx as unknown as import('@sidekick/types').HandlerContext)

        const remindersState = createRemindersState(stateService)
        const result = await remindersState.reminderThrottle.read('test-session')
        expect(result.data['user-prompt-submit'].messagesSinceLastStaging).toBe(0)
      })

      it('skips when no sessionId in event', async () => {
        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()
        const event = createConversationTranscriptEvent('UserPrompt')
        // Remove sessionId
        const noSessionEvent = {
          ...event,
          context: { ...event.context, sessionId: undefined },
        }
        await handler!.handler(noSessionEvent as any, ctx as unknown as import('@sidekick/types').HandlerContext)

        const remindersState = createRemindersState(stateService)
        const result = await remindersState.reminderThrottle.read('test-session')
        // Counter should remain unchanged
        expect(result.data['user-prompt-submit'].messagesSinceLastStaging).toBe(0)
      })

      it('skips when no throttle entries registered', async () => {
        // Use a state service with no throttle state
        const emptyStateService = new MockStateService()
        const emptyCtx = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService: emptyStateService,
        })

        registerStageDefaultUserPrompt(emptyCtx)

        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()
        const event = createConversationTranscriptEvent('UserPrompt')
        await handler!.handler(event, emptyCtx as unknown as import('@sidekick/types').HandlerContext)

        // Should not stage anything (no entries to process)
        expect(staging.getRemindersForHook('UserPromptSubmit')).toHaveLength(0)
      })

      it('skips entries with no configured threshold', async () => {
        // Seed throttle state with a reminder that has no threshold in config
        const remindersState = createRemindersState(stateService)
        await remindersState.reminderThrottle.write('test-session', {
          'unknown-reminder': {
            messagesSinceLastStaging: 0,
            targetHook: 'UserPromptSubmit',
            cachedReminder: {
              name: 'unknown-reminder',
              blocking: false,
              priority: 10,
              persistent: false,
            },
          },
        })

        registerStageDefaultUserPrompt(ctx)

        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()
        // Fire enough events that would exceed any threshold
        for (let i = 0; i < 15; i++) {
          const event = createConversationTranscriptEvent('UserPrompt')
          await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)
        }

        // Should not have staged (threshold is undefined for this reminder)
        expect(staging.getRemindersForHook('UserPromptSubmit')).toHaveLength(0)
      })

      it('respects configurable threshold', async () => {
        const configWithThreshold = new MockConfigService()
        configWithThreshold.set({
          features: {
            reminders: { enabled: true, settings: { reminder_thresholds: { 'user-prompt-submit': 3 } } },
          },
        })

        const customCtx = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService,
          config: configWithThreshold,
        })

        registerStageDefaultUserPrompt(customCtx)

        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()

        // Fire 3 events (meets custom threshold of 3)
        for (let i = 0; i < 3; i++) {
          const event = createConversationTranscriptEvent('UserPrompt')
          await handler!.handler(event, customCtx as unknown as import('@sidekick/types').HandlerContext)
        }

        const reminders = staging.getRemindersForHook('UserPromptSubmit')
        expect(reminders.some((r) => r.name === 'user-prompt-submit')).toBe(true)
      })

      it('resets counter on SessionStart', async () => {
        registerStageDefaultUserPrompt(ctx)

        // Write state with existing counter
        const remindersState = createRemindersState(stateService)
        await remindersState.reminderThrottle.write('test-session', {
          'user-prompt-submit': {
            messagesSinceLastStaging: 5,
            targetHook: 'UserPromptSubmit',
            cachedReminder: { name: 'user-prompt-submit', blocking: false, priority: 10, persistent: false },
          },
        })

        // Fire SessionStart via the reset handler
        const resetHandler = handlers.getHandler('reminders:throttle-reset-session-start')
        const sessionEvent = {
          kind: 'hook' as const,
          hook: 'SessionStart' as const,
          context: { sessionId: 'test-session', timestamp: Date.now() },
          payload: { startType: 'startup' as const, transcriptPath: '/test/transcript.jsonl' },
        }
        await resetHandler?.handler(sessionEvent, ctx as unknown as import('@sidekick/types').HandlerContext)

        const result = await remindersState.reminderThrottle.read('test-session')
        expect(result.data['user-prompt-submit'].messagesSinceLastStaging).toBe(0)
      })

      it('resets counter on BulkProcessingComplete', async () => {
        registerStageDefaultUserPrompt(ctx)

        // Write state with existing counter
        const remindersState = createRemindersState(stateService)
        await remindersState.reminderThrottle.write('test-session', {
          'user-prompt-submit': {
            messagesSinceLastStaging: 5,
            targetHook: 'UserPromptSubmit',
            cachedReminder: { name: 'user-prompt-submit', blocking: false, priority: 10, persistent: false },
          },
        })

        // Fire BulkProcessingComplete via the reset handler
        const resetHandler = handlers.getHandler('reminders:throttle-reset-bulk')
        const bulkCompleteEvent: TranscriptEvent = {
          kind: 'transcript',
          eventType: 'BulkProcessingComplete',
          context: { sessionId: 'test-session', timestamp: Date.now() },
          payload: { lineNumber: 1, entry: {} },
          metadata: {
            transcriptPath: '/test/transcript.jsonl',
            metrics: createDefaultMetrics(),
            isBulkProcessing: false,
          },
        }
        await resetHandler?.handler(bulkCompleteEvent, ctx as unknown as import('@sidekick/types').HandlerContext)

        const result = await remindersState.reminderThrottle.read('test-session')
        expect(result.data['user-prompt-submit'].messagesSinceLastStaging).toBe(0)
      })

      it('throttles multiple reminders independently', async () => {
        // Seed both UPS and persona in throttle state
        const remindersState = createRemindersState(stateService)
        await remindersState.reminderThrottle.write('test-session', {
          'user-prompt-submit': {
            messagesSinceLastStaging: 0,
            targetHook: 'UserPromptSubmit',
            cachedReminder: {
              name: 'user-prompt-submit',
              blocking: false,
              priority: 10,
              persistent: false,
              additionalContext: 'UPS content',
            },
          },
          'remember-your-persona': {
            messagesSinceLastStaging: 0,
            targetHook: 'UserPromptSubmit',
            cachedReminder: {
              name: 'remember-your-persona',
              blocking: false,
              priority: 5,
              persistent: false,
              additionalContext: 'Persona content',
            },
          },
        })

        const configWithThresholds = new MockConfigService()
        configWithThresholds.set({
          features: {
            reminders: {
              enabled: true,
              settings: {
                reminder_thresholds: {
                  'user-prompt-submit': 10,
                  'remember-your-persona': 3,
                },
              },
            },
          },
        })

        const customCtx = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService,
          config: configWithThresholds,
        })

        registerStageDefaultUserPrompt(customCtx)
        const handler = handlers.getHandler('reminders:throttle-restage')
        expect(handler).toBeDefined()

        // Fire 3 events — persona should fire, UPS should not
        for (let i = 0; i < 3; i++) {
          const event = createConversationTranscriptEvent('UserPrompt')
          await handler!.handler(event, customCtx as unknown as import('@sidekick/types').HandlerContext)
        }

        const reminders = staging.getRemindersForHook('UserPromptSubmit')
        expect(reminders.some((r) => r.name === 'remember-your-persona')).toBe(true)
        expect(reminders.some((r) => r.name === 'user-prompt-submit')).toBe(false)

        // Verify persona counter reset, UPS counter at 3
        const result = await remindersState.reminderThrottle.read('test-session')
        expect(result.data['remember-your-persona'].messagesSinceLastStaging).toBe(0)
        expect(result.data['user-prompt-submit'].messagesSinceLastStaging).toBe(3)
      })

      it('registerThrottledReminder caches reminder for re-staging', async () => {
        const stateService2 = new MockStateService()
        const testCtx = createMockDaemonContext({ staging, logger, handlers, assets, stateService: stateService2 })

        await registerThrottledReminder(testCtx, 'test-session', 'test-reminder', 'UserPromptSubmit', {
          name: 'test-reminder',
          blocking: false,
          priority: 10,
          persistent: false,
          additionalContext: 'Test content',
        })

        const remindersState = createRemindersState(stateService2)
        const result = await remindersState.reminderThrottle.read('test-session')
        expect(result.data['test-reminder']).toBeDefined()
        expect(result.data['test-reminder'].messagesSinceLastStaging).toBe(0)
        expect(result.data['test-reminder'].cachedReminder.additionalContext).toBe('Test content')
      })
    })
  })

  describe('handler registration filters', () => {
    it('staging handlers use transcript filters', () => {
      registerStagePauseAndReflect(ctx)

      const transcriptHandlers = handlers.getHandlersByKind('transcript')
      expect(transcriptHandlers).toHaveLength(1)
    })

    it('SessionStart handler uses hook filter', () => {
      registerStageDefaultUserPrompt(ctx)

      const hookHandlers = handlers.getHandlersByKind('hook')
      const stageHandler = hookHandlers.find((h) => h.id === 'reminders:stage-default-user-prompt')
      expect(stageHandler).toBeDefined()
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
      expect(handler).toBeDefined()
      await handler!.handler(createHookEvent(), ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

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
      expect(handler).toBeDefined()
      await handler!.handler(createHookEvent(), ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

      // Wrapper + all 4 per-tool reminders should be re-staged (no prior tool state = all need verification)
      const reminders = staging.getRemindersForHook('Stop')
      const reminderNames = reminders.map((r) => r.name).sort()
      expect(reminderNames).toEqual(['vc-build', 'vc-lint', 'vc-test', 'vc-typecheck', 'verify-completion'])
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
      expect(handler).toBeDefined()
      await handler!.handler(createHookEvent(), ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

      // Reminder should be deleted, not re-staged
      expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
      expect(logger.wasLogged('VC unstage: cycle limit reached, clearing')).toBe(true)
    })

    it('emits decision:recorded when cycle limit reached', async () => {
      const configWithCycleLimit = new MockConfigService()
      configWithCycleLimit.set({
        features: {
          reminders: { enabled: true, settings: { max_verification_cycles: 2 } },
        },
      })

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
      expect(handler).toBeDefined()
      await handler!.handler(createHookEvent(), ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

      const decisionEvents = getDecisionRecordedEvents()
      expect(decisionEvents).toHaveLength(1)
      expect(decisionEvents[0].meta?.decision).toBe('unstaged-all')
      expect(decisionEvents[0].meta?.subsystem).toBe('vc-reminders')
      expect(decisionEvents[0].meta?.title).toBe('Unstage all VC reminders (cycle limit)')
    })

    it('does not re-stage wrapper when all tools are verified with zero pending edits', async () => {
      const stateService = new MockStateService(testProjectDir)

      // Set vc-unverified state (would normally trigger re-staging)
      const vcUnverifiedPath = stateService.sessionStatePath(sessionId, 'vc-unverified.json')
      stateService.setStored(vcUnverifiedPath, {
        hasUnverifiedChanges: true,
        cycleCount: 1,
        setAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 5, toolCount: 5 },
        lastClassification: { category: 'OTHER', confidence: 0.5 },
      })

      // Set verification-tools state: all tools verified, zero pending edits
      const vtPath = stateService.sessionStatePath(sessionId, 'verification-tools.json')
      stateService.setStored(vtPath, {
        build: { status: 'verified', editsSinceVerified: 0, lastVerifiedAt: Date.now(), lastStagedAt: Date.now() },
        typecheck: { status: 'verified', editsSinceVerified: 0, lastVerifiedAt: Date.now(), lastStagedAt: Date.now() },
        test: { status: 'verified', editsSinceVerified: 0, lastVerifiedAt: Date.now(), lastStagedAt: Date.now() },
        lint: { status: 'verified', editsSinceVerified: 0, lastVerifiedAt: Date.now(), lastStagedAt: Date.now() },
      })

      const ctxWithPath = createMockDaemonContext({
        staging,
        logger,
        handlers,
        assets,
        stateService,
        paths: { projectDir: testProjectDir, userConfigDir: '/mock/user', projectConfigDir: '/mock/project-config' },
      })

      registerUnstageVerifyCompletion(ctxWithPath)
      const handler = handlers.getHandler('reminders:unstage-verify-completion')
      expect(handler).toBeDefined()
      await handler!.handler(createHookEvent(), ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

      // Wrapper should NOT be re-staged — nothing needs verification
      expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
    })

    it('handles missing sessionId gracefully', async () => {
      registerUnstageVerifyCompletion(ctx)

      const handler = handlers.getHandler('reminders:unstage-verify-completion')
      expect(handler).toBeDefined()
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

      await handler!.handler(eventWithoutSession as any, ctx as unknown as import('@sidekick/types').HandlerContext)

      expect(logger.wasLogged('No sessionId in UserPromptSubmit event')).toBe(true)
    })

    it('does not register when context is not DaemonContext', () => {
      const cliCtx = createMockCLIContext({ logger, handlers })

      registerUnstageVerifyCompletion(cliCtx)

      // Should not register any handlers
      expect(handlers.getHandlersForHook('UserPromptSubmit')).toHaveLength(0)
    })

    it('should emit not-staged when no unverified changes exist', async () => {
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

      registerUnstageVerifyCompletion(ctxWithPath)

      logger.reset()

      const handler = handlers.getHandler('reminders:unstage-verify-completion')
      expect(handler).toBeDefined()
      await handler!.handler(createHookEvent(), ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

      const notStagedEvents = logger.recordedLogs.filter(
        (log) => log.level === 'info' && log.meta?.type === 'reminder:not-staged'
      )
      expect(notStagedEvents).toHaveLength(1)
      expect(notStagedEvents[0].meta?.reason).toBe('no_unverified_changes')
      expect(notStagedEvents[0].meta?.reminderName).toBe('verify-completion')
    })

    it('re-stages per-tool reminders alongside wrapper when unverified changes exist', async () => {
      const stateService = new MockStateService(testProjectDir)

      // Set vc-unverified state
      const vcUnverifiedPath = stateService.sessionStatePath(sessionId, 'vc-unverified.json')
      stateService.setStored(vcUnverifiedPath, {
        hasUnverifiedChanges: true,
        cycleCount: 1,
        setAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 5, toolCount: 5 },
        lastClassification: { category: 'OTHER', confidence: 0.5 },
      })

      // Set verification-tools state: all 4 tools in 'staged' status (need verification)
      const vtPath = stateService.sessionStatePath(sessionId, 'verification-tools.json')
      stateService.setStored(vtPath, {
        build: { status: 'staged', editsSinceVerified: 0, lastVerifiedAt: null, lastStagedAt: Date.now() },
        typecheck: { status: 'staged', editsSinceVerified: 0, lastVerifiedAt: null, lastStagedAt: Date.now() },
        test: { status: 'staged', editsSinceVerified: 0, lastVerifiedAt: null, lastStagedAt: Date.now() },
        lint: { status: 'staged', editsSinceVerified: 0, lastVerifiedAt: null, lastStagedAt: Date.now() },
      })

      const ctxWithPath = createMockDaemonContext({
        staging,
        logger,
        handlers,
        assets,
        stateService,
        paths: { projectDir: testProjectDir, userConfigDir: '/mock/user', projectConfigDir: '/mock/project-config' },
      })

      registerUnstageVerifyCompletion(ctxWithPath)
      const handler = handlers.getHandler('reminders:unstage-verify-completion')
      expect(handler).toBeDefined()
      await handler!.handler(createHookEvent(), ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

      // Should contain wrapper + all 4 per-tool reminders (5 total)
      const reminders = staging.getRemindersForHook('Stop')
      const reminderNames = reminders.map((r) => r.name).sort()
      expect(reminderNames).toEqual(['vc-build', 'vc-lint', 'vc-test', 'vc-typecheck', 'verify-completion'])
    })

    it('only re-stages per-tool reminders for tools that need verification', async () => {
      const stateService = new MockStateService(testProjectDir)

      // Set vc-unverified state
      const vcUnverifiedPath = stateService.sessionStatePath(sessionId, 'vc-unverified.json')
      stateService.setStored(vcUnverifiedPath, {
        hasUnverifiedChanges: true,
        cycleCount: 1,
        setAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 5, toolCount: 5 },
        lastClassification: { category: 'OTHER', confidence: 0.5 },
      })

      // Set verification-tools state: build needs verification, typecheck is verified (below threshold)
      const vtPath = stateService.sessionStatePath(sessionId, 'verification-tools.json')
      stateService.setStored(vtPath, {
        build: { status: 'staged', editsSinceVerified: 0, lastVerifiedAt: null, lastStagedAt: Date.now() },
        typecheck: { status: 'verified', editsSinceVerified: 0, lastVerifiedAt: Date.now(), lastStagedAt: Date.now() },
        test: { status: 'verified', editsSinceVerified: 0, lastVerifiedAt: Date.now(), lastStagedAt: Date.now() },
        lint: { status: 'verified', editsSinceVerified: 0, lastVerifiedAt: Date.now(), lastStagedAt: Date.now() },
      })

      const ctxWithPath = createMockDaemonContext({
        staging,
        logger,
        handlers,
        assets,
        stateService,
        paths: { projectDir: testProjectDir, userConfigDir: '/mock/user', projectConfigDir: '/mock/project-config' },
      })

      registerUnstageVerifyCompletion(ctxWithPath)
      const handler = handlers.getHandler('reminders:unstage-verify-completion')
      expect(handler).toBeDefined()
      await handler!.handler(createHookEvent(), ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

      // Should contain wrapper + only vc-build (not the verified tools)
      const reminders = staging.getRemindersForHook('Stop')
      const reminderNames = reminders.map((r) => r.name).sort()
      expect(reminderNames).toEqual(['vc-build', 'verify-completion'])
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

    it('does not register when projectDir is missing', () => {
      const ctxNoProjectDir = createMockDaemonContext({
        staging,
        logger,
        handlers,
        assets,
        paths: { projectDir: '', userConfigDir: '/mock/user', projectConfigDir: '/mock/project-config' },
      })

      registerStageBashChanges(ctxNoProjectDir)

      // Should not register any handlers when projectDir is empty/missing
      const hookHandlers = handlers.getHandlersForHook('UserPromptSubmit')
      const transcriptHandlers = handlers.getHandlersByKind('transcript')
      const baselineHandler = hookHandlers.find((h: any) => h.id === 'reminders:git-baseline-capture')
      const bashHandler = transcriptHandlers.find((h: any) => h.id === 'reminders:stage-stop-bash-changes')
      expect(baselineHandler).toBeUndefined()
      expect(bashHandler).toBeUndefined()
    })

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
      expect(handler).toBeDefined()
      await handler!.handler(createUserPromptSubmitEvent(), ctx as unknown as import('@sidekick/types').HandlerContext)

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

      const names = staging.getRemindersForHook('Stop').map((r) => r.name)
      // Should stage per-tool reminders AND wrapper
      expect(names).toContain('verify-completion')
      expect(names).toContain('vc-build')
    })

    it('stages per-tool VC reminders when Bash modifies source files', async () => {
      registerStageBashChanges(ctx)

      // Capture baseline with no files
      mockGetGitFileStatus.mockResolvedValue([])
      const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
      await baselineHandler?.handler(
        createUserPromptSubmitEvent(),
        ctx as unknown as import('@sidekick/types').HandlerContext
      )

      // Bash creates a source file
      mockGetGitFileStatus.mockResolvedValue(['src/new-feature.ts'])
      const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
      const event = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')
      await bashHandler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

      const names = staging.getRemindersForHook('Stop').map((r) => r.name)
      // Should have per-tool reminders AND wrapper
      expect(names).toContain('vc-build')
      expect(names).toContain('vc-typecheck')
      expect(names).toContain('vc-test')
      expect(names).toContain('vc-lint')
      expect(names).toContain('verify-completion')
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
        expect(staging.getRemindersForHook('Stop').map((r) => r.name)).toContain('verify-completion')

        // Simulate consumption on turn 1
        staging.addConsumedReminder('Stop', 'verify-completion', {
          name: 'verify-completion',
          blocking: true,
          priority: 50,
          persistent: false,
          stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
        })
        await staging.deleteReminder('Stop', 'verify-completion')

        // Second Bash in SAME turn — should NOT re-stage wrapper
        mockGetGitFileStatus.mockResolvedValue(['src/a.ts', 'src/b.ts'])
        const event2 = createToolResultEvent({ turnCount: 1, toolsThisTurn: 5, toolCount: 5 }, 'Bash')
        await bashHandler?.handler(event2, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('Stop').map((r) => r.name)).not.toContain('verify-completion')
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
        expect(staging.getRemindersForHook('Stop').map((r) => r.name)).toContain('verify-completion')

        // Simulate consumption on turn 1
        staging.addConsumedReminder('Stop', 'verify-completion', {
          name: 'verify-completion',
          blocking: true,
          priority: 50,
          persistent: false,
          stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
        })
        await staging.deleteReminder('Stop', 'verify-completion')

        // Bash on NEW turn (turn 2) — SHOULD re-stage wrapper
        mockGetGitFileStatus.mockResolvedValue(['src/a.ts', 'src/c.ts'])
        const event2 = createToolResultEvent({ turnCount: 2, toolsThisTurn: 1, toolCount: 10 }, 'Bash')
        await bashHandler?.handler(event2, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('Stop').map((r) => r.name)).toContain('verify-completion')
      })
    })

    describe('edge cases', () => {
      it('concurrent Bash executions use updated baseline from first execution', async () => {
        registerStageBashChanges(ctx)

        // Capture initial baseline with no files
        mockGetGitFileStatus.mockResolvedValue([])
        const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
        await baselineHandler?.handler(
          createUserPromptSubmitEvent(),
          ctx as unknown as import('@sidekick/types').HandlerContext
        )

        // First Bash creates src/a.ts — stages VC, baseline updated to ['src/a.ts']
        mockGetGitFileStatus.mockResolvedValue(['src/a.ts'])
        const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
        const event1 = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')
        await bashHandler?.handler(event1, ctx as unknown as import('@sidekick/types').HandlerContext)
        expect(staging.getRemindersForHook('Stop').map((r) => r.name)).toContain('verify-completion')

        // Delete all staged reminders to allow re-staging (simulate idempotency gate reset)
        for (const r of staging.getRemindersForHook('Stop')) {
          await staging.deleteReminder('Stop', r.name)
        }

        // Second Bash — git status still returns ['src/a.ts'] (no NEW files since updated baseline)
        // If it used the stale baseline ([]), it would incorrectly detect src/a.ts as new
        mockGetGitFileStatus.mockResolvedValue(['src/a.ts'])
        const event2 = createToolResultEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'Bash')
        await bashHandler?.handler(event2, ctx as unknown as import('@sidekick/types').HandlerContext)

        // Should NOT stage because no new files relative to updated baseline
        expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
      })

      it('malformed source_code_patterns config falls back gracefully', async () => {
        // Configure empty source_code_patterns array
        ;(ctx.config as import('@sidekick/testing-fixtures').MockConfigService).set({
          features: {
            reminders: {
              enabled: true,
              settings: {
                source_code_patterns: [],
              },
            },
          },
        })

        registerStageBashChanges(ctx)

        // Capture baseline with no files
        mockGetGitFileStatus.mockResolvedValue([])
        const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
        await baselineHandler?.handler(
          createUserPromptSubmitEvent(),
          ctx as unknown as import('@sidekick/types').HandlerContext
        )

        // Bash creates a source file
        mockGetGitFileStatus.mockResolvedValue(['src/app.ts'])
        const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
        const event = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')

        // Should not crash and should not stage (no patterns match)
        await bashHandler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
      })

      it('does not stage when getGitFileStatus returns empty (git unavailable)', async () => {
        registerStageBashChanges(ctx)

        // Capture baseline with some files
        mockGetGitFileStatus.mockResolvedValue(['src/existing.ts'])
        const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
        await baselineHandler?.handler(
          createUserPromptSubmitEvent(),
          ctx as unknown as import('@sidekick/types').HandlerContext
        )

        // After Bash, getGitFileStatus returns [] (git unavailable or errored)
        mockGetGitFileStatus.mockResolvedValue([])
        const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
        const event = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')
        await bashHandler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        // No new files detected (empty current minus baseline = nothing new)
        expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
      })
    })

    describe('reminder:not-staged events', () => {
      it('should emit not-staged when reactivation skipped (same turn)', async () => {
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
        expect(staging.getRemindersForHook('Stop').map((r) => r.name)).toContain('verify-completion')

        // Simulate consumption
        staging.addConsumedReminder('Stop', 'verify-completion', {
          name: 'verify-completion',
          blocking: true,
          priority: 51,
          persistent: false,
          stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
        })
        await staging.deleteReminder('Stop', 'verify-completion')

        logger.reset()

        // Second Bash same turn — should skip reactivation
        mockGetGitFileStatus.mockResolvedValue(['src/a.ts', 'src/b.ts'])
        const event2 = createToolResultEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'Bash')
        await bashHandler?.handler(event2, ctx as unknown as import('@sidekick/types').HandlerContext)

        const notStagedEvents = logger.recordedLogs.filter(
          (log) => log.level === 'info' && log.meta?.type === 'reminder:not-staged'
        )
        expect(notStagedEvents).toHaveLength(1)
        expect(notStagedEvents[0].meta?.reason).toBe('same_turn')
        expect(notStagedEvents[0].meta?.triggeredBy).toBe('bash_command')
      })

      it('should emit not-staged when no new files detected', async () => {
        registerStageBashChanges(ctx)

        // Capture baseline
        mockGetGitFileStatus.mockResolvedValue(['src/a.ts'])
        const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
        await baselineHandler?.handler(
          createUserPromptSubmitEvent(),
          ctx as unknown as import('@sidekick/types').HandlerContext
        )

        logger.reset()

        // Bash runs but git status unchanged
        mockGetGitFileStatus.mockResolvedValue(['src/a.ts'])
        const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
        const event = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')
        await bashHandler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        const notStagedEvents = logger.recordedLogs.filter(
          (log) => log.level === 'info' && log.meta?.type === 'reminder:not-staged'
        )
        expect(notStagedEvents).toHaveLength(1)
        expect(notStagedEvents[0].meta?.reason).toBe('no_changes_detected')
      })

      it('should emit not-staged when new files dont match source patterns', async () => {
        registerStageBashChanges(ctx)

        // Capture baseline with no files
        mockGetGitFileStatus.mockResolvedValue([])
        const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
        await baselineHandler?.handler(
          createUserPromptSubmitEvent(),
          ctx as unknown as import('@sidekick/types').HandlerContext
        )

        logger.reset()

        // Bash creates a markdown file (not in source_code_patterns)
        mockGetGitFileStatus.mockResolvedValue(['docs/README.md'])
        const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
        const event = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')
        await bashHandler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

        const notStagedEvents = logger.recordedLogs.filter(
          (log) => log.level === 'info' && log.meta?.type === 'reminder:not-staged'
        )
        expect(notStagedEvents).toHaveLength(1)
        expect(notStagedEvents[0].meta?.reason).toBe('pattern_mismatch')
      })
    })
  })

  describe('registerStagePersonaReminders', () => {
    const sessionId = 'test-session'

    function createSessionStartEvent(): SessionStartHookEvent {
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
      expect(handler).toBeDefined()
      await handler!.handler(
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
      expect(handler).toBeDefined()
      await handler!.handler(
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
      expect(handler).toBeDefined()
      await handler!.handler(
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
      expect(handler).toBeDefined()
      await handler!.handler(
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

    describe('reminder:not-staged events', () => {
      it('should emit not-staged when persona injection disabled', async () => {
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

        const stateService = new MockStateService('/tmp/claude/test-persona-not-staged-disabled')
        const ctxWithConfig = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService,
          config,
          paths: {
            projectDir: '/tmp/claude/test-persona-not-staged-disabled',
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })

        setupPersonaState(stateService, 'skippy')
        setupPersonaLoader('skippy', testPersona)

        logger.reset()

        await stagePersonaRemindersForSession(ctxWithConfig, sessionId)

        const notStagedEvents = logger.recordedLogs.filter(
          (log) => log.level === 'info' && log.meta?.type === 'reminder:not-staged'
        )
        expect(notStagedEvents).toHaveLength(1)
        expect(notStagedEvents[0].meta?.reason).toBe('feature_disabled')
        expect(notStagedEvents[0].meta?.reminderName).toBe('remember-your-persona')
      })

      it('should emit not-staged when no persona loaded', async () => {
        // No persona state written — stateService returns null
        const stateService = new MockStateService('/tmp/claude/test-persona-not-staged-none')
        const ctxWithState = createMockDaemonContext({
          staging,
          logger,
          handlers,
          assets,
          stateService,
          paths: {
            projectDir: '/tmp/claude/test-persona-not-staged-none',
            userConfigDir: '/mock/user',
            projectConfigDir: '/mock/project-config',
          },
        })

        logger.reset()

        await stagePersonaRemindersForSession(ctxWithState, sessionId)

        const notStagedEvents = logger.recordedLogs.filter(
          (log) => log.level === 'info' && log.meta?.type === 'reminder:not-staged'
        )
        expect(notStagedEvents).toHaveLength(1)
        expect(notStagedEvents[0].meta?.reason).toBe('no_persona')
        expect(notStagedEvents[0].meta?.reminderName).toBe('remember-your-persona')
      })
    })
  })
})
