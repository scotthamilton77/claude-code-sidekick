/**
 * Regression test: throttle-restage handlers must use invocation-time context
 *
 * Verifies that all four daemon-only handlers in stage-default-user-prompt.ts
 * use the ctx parameter passed at invocation time (not a closed-over registration
 * context which may have staging: null).
 *
 * Root cause: commit 72177d0 consolidated isDaemonContext guards into a single
 * early-return, replacing invocation-time ctx with closed-over daemonCtx captured
 * at registration time. The registration context has staging: null.
 *
 * @see packages/feature-reminders/src/handlers/staging/stage-default-user-prompt.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonContext, TranscriptEvent, SessionStartHookEvent, ReminderThrottleState } from '@sidekick/types'
import {
  createMockDaemonContext,
  MockHandlerRegistry,
  MockStagingService,
  MockStateService,
  MockConfigService,
} from '@sidekick/testing-fixtures'
import { registerStageDefaultUserPrompt } from '../stage-default-user-prompt.js'
import { ReminderIds } from '../../../types.js'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a registration context (simulates daemon.ts line 1770).
 * We use a normal DaemonContext — the key insight is that handler registration
 * captures `this` reference. The test proves handlers use the INVOCATION context
 * (passed as second arg) not the registration context.
 */
function createRegistrationContext(): DaemonContext & { handlers: MockHandlerRegistry } {
  const handlers = new MockHandlerRegistry()
  const ctx = createMockDaemonContext({ handlers })
  return ctx as DaemonContext & { handlers: MockHandlerRegistry }
}

/**
 * Create a separate invocation context with real mock services.
 * This is what HandlerRegistryImpl.setContext() would provide at runtime.
 */
function createInvocationContext(): DaemonContext & {
  staging: MockStagingService
  stateService: MockStateService
  config: MockConfigService
} {
  const config = new MockConfigService()
  config.set({
    features: {
      reminders: {
        enabled: true,
        settings: {
          reminder_thresholds: {
            [ReminderIds.USER_PROMPT_SUBMIT]: 3,
          },
        },
      },
    },
  })

  return createMockDaemonContext({
    staging: new MockStagingService(),
    stateService: new MockStateService(),
    config,
  }) as DaemonContext & {
    staging: MockStagingService
    stateService: MockStateService
    config: MockConfigService
  }
}

function createTranscriptEvent(
  eventType: 'UserPrompt' | 'AssistantMessage' | 'BulkProcessingComplete',
  sessionId: string,
  overrides?: { isBulkProcessing?: boolean }
): TranscriptEvent {
  return {
    kind: 'transcript',
    eventType,
    context: { sessionId, timestamp: Date.now() },
    payload: {
      lineNumber: 1,
      entry: { type: 'text' },
    },
    metadata: {
      transcriptPath: '/mock/transcript.jsonl',
      metrics: {
        turnCount: 5,
        toolCount: 3,
        toolsThisTurn: 1,
        messageCount: 10,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          cacheTiers: { ephemeral5mInputTokens: 0, ephemeral1hInputTokens: 0 },
          serviceTierCounts: {},
          byModel: {},
        },
        currentContextTokens: null,
        isPostCompactIndeterminate: false,
        toolsPerTurn: 0,
        lastProcessedLine: 0,
        lastUpdatedAt: 0,
      },
      isBulkProcessing: overrides?.isBulkProcessing ?? false,
    },
  }
}

function createSessionStartEvent(sessionId: string): SessionStartHookEvent {
  return {
    kind: 'hook',
    hook: 'SessionStart',
    context: {
      sessionId,
      timestamp: Date.now(),
    },
    payload: {
      startType: 'startup',
      transcriptPath: '/mock/transcript.jsonl',
    },
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('throttle-restage handlers use invocation-time context', () => {
  const SESSION_ID = 'test-session-123'
  let registrationCtx: DaemonContext & { handlers: MockHandlerRegistry }
  let invocationCtx: ReturnType<typeof createInvocationContext>

  beforeEach(() => {
    vi.restoreAllMocks()

    registrationCtx = createRegistrationContext()
    invocationCtx = createInvocationContext()

    // Register handlers using the registration context
    registerStageDefaultUserPrompt(registrationCtx)
  })

  it('Handler 3 (throttle-restage) calls stageReminder on invocation context', async () => {
    // Seed throttle state in the INVOCATION context's state service
    const throttleStatePath = invocationCtx.stateService.sessionStatePath(SESSION_ID, 'reminder-throttle.json')
    const throttleState: ReminderThrottleState = {
      [ReminderIds.USER_PROMPT_SUBMIT]: {
        messagesSinceLastStaging: 2, // threshold is 3, one more will trigger
        targetHook: 'UserPromptSubmit',
        cachedReminder: {
          name: ReminderIds.USER_PROMPT_SUBMIT,
          blocking: false,
          priority: 50,
          persistent: true,
        },
      },
    }
    invocationCtx.stateService.setStored(throttleStatePath, throttleState)

    // Spy on invocation context's staging service
    const stageSpy = vi.spyOn(invocationCtx.staging, 'stageReminder')

    // Get the throttle-restage handler
    const handler = registrationCtx.handlers.getHandler('reminders:throttle-restage')
    expect(handler).toBeDefined()

    // Fire the handler with INVOCATION context (simulating HandlerRegistryImpl dispatch)
    const event = createTranscriptEvent('UserPrompt', SESSION_ID)
    await handler!.handler(event, invocationCtx as unknown as Record<string, unknown>)

    // Should have called stageReminder on the INVOCATION context's staging service
    expect(stageSpy).toHaveBeenCalledTimes(1)
    expect(stageSpy).toHaveBeenCalledWith(
      'UserPromptSubmit',
      ReminderIds.USER_PROMPT_SUBMIT,
      expect.objectContaining({
        name: ReminderIds.USER_PROMPT_SUBMIT,
        stagedAt: expect.objectContaining({
          turnCount: 5,
          toolsThisTurn: 1,
          toolCount: 3,
        }),
      }),
      undefined
    )
  })

  it('Handler 3 uses invocation context config for thresholds', async () => {
    // Seed throttle state -- set counter to 9 with default threshold 10
    // but invocation context has threshold=3, so at counter=2 it should trigger
    const throttleStatePath = invocationCtx.stateService.sessionStatePath(SESSION_ID, 'reminder-throttle.json')
    invocationCtx.stateService.setStored(throttleStatePath, {
      [ReminderIds.USER_PROMPT_SUBMIT]: {
        messagesSinceLastStaging: 2,
        targetHook: 'UserPromptSubmit',
        cachedReminder: {
          name: ReminderIds.USER_PROMPT_SUBMIT,
          blocking: false,
          priority: 50,
          persistent: true,
        },
      },
    })

    const stageSpy = vi.spyOn(invocationCtx.staging, 'stageReminder')

    const handler = registrationCtx.handlers.getHandler('reminders:throttle-restage')
    const event = createTranscriptEvent('UserPrompt', SESSION_ID)
    await handler!.handler(event, invocationCtx as unknown as Record<string, unknown>)

    // Threshold=3, counter was 2, newCount=3 -> should trigger
    expect(stageSpy).toHaveBeenCalledTimes(1)
  })

  it('Handler 1b (throttle-reset-session-start) uses invocation context stateService', async () => {
    const throttleStatePath = invocationCtx.stateService.sessionStatePath(SESSION_ID, 'reminder-throttle.json')
    invocationCtx.stateService.setStored(throttleStatePath, {
      [ReminderIds.USER_PROMPT_SUBMIT]: {
        messagesSinceLastStaging: 5,
        targetHook: 'UserPromptSubmit',
        cachedReminder: {
          name: ReminderIds.USER_PROMPT_SUBMIT,
          blocking: false,
          priority: 50,
          persistent: true,
        },
      },
    })

    const handler = registrationCtx.handlers.getHandler('reminders:throttle-reset-session-start')
    expect(handler).toBeDefined()

    const event = createSessionStartEvent(SESSION_ID)
    await handler!.handler(event, invocationCtx as unknown as Record<string, unknown>)

    // Verify the counter was reset via the invocation context's state service
    const stored = invocationCtx.stateService.getStored(throttleStatePath) as ReminderThrottleState
    expect(stored[ReminderIds.USER_PROMPT_SUBMIT].messagesSinceLastStaging).toBe(0)
  })

  it('Handler 2b (throttle-reset-bulk) uses invocation context stateService', async () => {
    const throttleStatePath = invocationCtx.stateService.sessionStatePath(SESSION_ID, 'reminder-throttle.json')
    invocationCtx.stateService.setStored(throttleStatePath, {
      [ReminderIds.USER_PROMPT_SUBMIT]: {
        messagesSinceLastStaging: 7,
        targetHook: 'UserPromptSubmit',
        cachedReminder: {
          name: ReminderIds.USER_PROMPT_SUBMIT,
          blocking: false,
          priority: 50,
          persistent: true,
        },
      },
    })

    const handler = registrationCtx.handlers.getHandler('reminders:throttle-reset-bulk')
    expect(handler).toBeDefined()

    // BulkProcessingComplete with isBulkProcessing=false (post-bulk signal)
    const event = createTranscriptEvent('BulkProcessingComplete', SESSION_ID, {
      isBulkProcessing: false,
    })
    await handler!.handler(event, invocationCtx as unknown as Record<string, unknown>)

    const stored = invocationCtx.stateService.getStored(throttleStatePath) as ReminderThrottleState
    expect(stored[ReminderIds.USER_PROMPT_SUBMIT].messagesSinceLastStaging).toBe(0)
  })

  it('Handler 1c (throttle-register) uses invocation context assets and stateService', async () => {
    // Set up the invocation context's assets resolver to return a valid reminder YAML
    vi.spyOn(invocationCtx.assets, 'resolve').mockReturnValue(
      [
        `id: ${ReminderIds.USER_PROMPT_SUBMIT}`,
        'blocking: false',
        'priority: 50',
        'persistent: true',
        'userMessage: "test"',
      ].join('\n')
    )

    const handler = registrationCtx.handlers.getHandler('reminders:throttle-register-ups-session-start')
    expect(handler).toBeDefined()

    const event = createSessionStartEvent(SESSION_ID)
    await handler!.handler(event, invocationCtx as unknown as Record<string, unknown>)

    // Verify the invocation context's assets.resolve was called
    expect(invocationCtx.assets.resolve).toHaveBeenCalled()

    // Verify throttle state was written via invocation context's state service
    const throttleStatePath = invocationCtx.stateService.sessionStatePath(SESSION_ID, 'reminder-throttle.json')
    const stored = invocationCtx.stateService.getStored(throttleStatePath) as ReminderThrottleState
    expect(stored[ReminderIds.USER_PROMPT_SUBMIT]).toBeDefined()
    expect(stored[ReminderIds.USER_PROMPT_SUBMIT].messagesSinceLastStaging).toBe(0)
  })

  it('proves handlers use ctx param not closed-over registration context', async () => {
    // The registration and invocation contexts are DIFFERENT objects
    expect(registrationCtx).not.toBe(invocationCtx)
    expect(registrationCtx.staging).not.toBe(invocationCtx.staging)
    expect(registrationCtx.stateService).not.toBe(invocationCtx.stateService)

    // Seed state only in invocation context
    const throttleStatePath = invocationCtx.stateService.sessionStatePath(SESSION_ID, 'reminder-throttle.json')
    invocationCtx.stateService.setStored(throttleStatePath, {
      [ReminderIds.USER_PROMPT_SUBMIT]: {
        messagesSinceLastStaging: 2,
        targetHook: 'UserPromptSubmit',
        cachedReminder: {
          name: ReminderIds.USER_PROMPT_SUBMIT,
          blocking: false,
          priority: 50,
          persistent: true,
        },
      },
    })

    // Spy on BOTH contexts' staging services
    const invocationStageSpy = vi.spyOn(invocationCtx.staging, 'stageReminder')
    const registrationStageSpy = vi.spyOn(registrationCtx.staging, 'stageReminder')

    const handler = registrationCtx.handlers.getHandler('reminders:throttle-restage')
    const event = createTranscriptEvent('UserPrompt', SESSION_ID)
    await handler!.handler(event, invocationCtx as unknown as Record<string, unknown>)

    // Invocation context's staging should be called, not registration context's
    expect(invocationStageSpy).toHaveBeenCalledTimes(1)
    expect(registrationStageSpy).not.toHaveBeenCalled()
  })
})
