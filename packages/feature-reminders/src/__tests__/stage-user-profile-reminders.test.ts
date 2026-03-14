/**
 * Tests for user profile reminder staging handler
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createMockDaemonContext,
  createMockCLIContext,
  MockStagingService,
  MockLogger,
  MockHandlerRegistry,
  MockAssetResolver,
  MockConfigService,
  MockStateService,
} from '@sidekick/testing-fixtures'
import type { DaemonContext, RuntimeContext } from '@sidekick/types'
import {
  stageUserProfileRemindersForSession,
  registerStageUserProfileReminders,
} from '../handlers/staging/stage-user-profile-reminders'

// Mock @sidekick/core — mock loadUserProfile
vi.mock('@sidekick/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...mod,
    loadUserProfile: vi.fn().mockReturnValue(null),
  }
})

import { loadUserProfile } from '@sidekick/core'
const mockLoadUserProfile = loadUserProfile as ReturnType<typeof vi.fn>

describe('stageUserProfileRemindersForSession', () => {
  let ctx: DaemonContext
  let staging: MockStagingService
  let mockLogger: MockLogger
  let mockAssets: MockAssetResolver

  beforeEach(() => {
    mockLoadUserProfile.mockClear()

    staging = new MockStagingService()
    mockLogger = new MockLogger()
    mockAssets = new MockAssetResolver()

    // Set up asset resolver to return the reminder YAML
    mockAssets.register(
      'reminders/user-profile.yaml',
      [
        'id: user-profile',
        'blocking: false',
        'priority: 4',
        'persistent: true',
        'additionalContext: |',
        '  This session is with {{user_name}}.',
      ].join('\n')
    )

    ctx = createMockDaemonContext({
      staging,
      logger: mockLogger,
      assets: mockAssets,
      handlers: new MockHandlerRegistry(),
      config: new MockConfigService(),
      stateService: new MockStateService(),
    })
  })

  it('clears reminders when no profile exists', async () => {
    mockLoadUserProfile.mockReturnValue(null)

    // Pre-stage a reminder so we can verify it gets deleted
    await staging.stageReminder('UserPromptSubmit', 'user-profile', {
      name: 'user-profile',
      blocking: false,
      priority: 4,
      persistent: true,
      additionalContext: 'old content',
    })

    await stageUserProfileRemindersForSession(ctx, 'test-session')

    // Reminders should be cleared
    expect(staging.getRemindersForHook('UserPromptSubmit').some((r) => r.name === 'user-profile')).toBe(false)
    expect(staging.getRemindersForHook('SessionStart').some((r) => r.name === 'user-profile')).toBe(false)
  })

  it('stages reminders when profile exists', async () => {
    mockLoadUserProfile.mockReturnValue({
      name: 'Scott',
      role: 'Software Architect',
      interests: ['Sci-Fi', '80s sitcoms'],
    })

    await stageUserProfileRemindersForSession(ctx, 'test-session')

    // Should have staged for both hooks
    const upsReminders = staging.getRemindersForHook('UserPromptSubmit')
    const ssReminders = staging.getRemindersForHook('SessionStart')

    expect(upsReminders.some((r) => r.name === 'user-profile')).toBe(true)
    expect(ssReminders.some((r) => r.name === 'user-profile')).toBe(true)
  })

  it('stages reminder with interpolated user name', async () => {
    mockLoadUserProfile.mockReturnValue({
      name: 'Scott',
      role: 'Software Architect',
      interests: ['Sci-Fi'],
    })

    await stageUserProfileRemindersForSession(ctx, 'test-session')

    const reminders = staging.getRemindersForHook('UserPromptSubmit')
    const profileReminder = reminders.find((r) => r.name === 'user-profile')
    expect(profileReminder).toBeDefined()
    expect(profileReminder!.additionalContext).toContain('Scott')
  })

  it('logs debug message when profile is staged', async () => {
    mockLoadUserProfile.mockReturnValue({
      name: 'Scott',
      role: 'Dev',
      interests: [],
    })

    await stageUserProfileRemindersForSession(ctx, 'test-session')

    const debugLog = mockLogger.recordedLogs.find(
      (l) => l.level === 'debug' && l.msg === 'Staged user profile reminders'
    )
    expect(debugLog).toBeDefined()
    expect(debugLog!.meta).toMatchObject({ sessionId: 'test-session', userName: 'Scott' })
  })

  describe('when reminder YAML cannot be resolved', () => {
    let cwdSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      // Prevent file-system fallback from finding real YAML files
      cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent')
    })

    afterEach(() => {
      cwdSpy.mockRestore()
    })

    it('logs warning when reminder YAML cannot be resolved', async () => {
      mockLoadUserProfile.mockReturnValue({
        name: 'Scott',
        role: 'Dev',
        interests: [],
      })

      // Remove the YAML asset so resolveReminder returns null
      mockAssets.reset()

      await stageUserProfileRemindersForSession(ctx, 'test-session')

      expect(mockLogger.wasLoggedAtLevel('Failed to resolve user-profile reminder', 'warn')).toBe(true)
      // No reminders should be staged
      expect(staging.getRemindersForHook('UserPromptSubmit')).toHaveLength(0)
      expect(staging.getRemindersForHook('SessionStart')).toHaveLength(0)
    })
  })
})

describe('registerStageUserProfileReminders', () => {
  beforeEach(() => {
    mockLoadUserProfile.mockClear()
  })

  it('registers handler in daemon context for SessionStart', () => {
    const handlers = new MockHandlerRegistry()
    const ctx = createMockDaemonContext({
      handlers,
      staging: new MockStagingService(),
      logger: new MockLogger(),
    })

    registerStageUserProfileReminders(ctx)

    const registrations = handlers.getHandlersForHook('SessionStart')
    expect(registrations.some((h) => h.id === 'reminders:stage-user-profile-reminders')).toBe(true)
  })

  it('does not register in CLI context', () => {
    const cliCtx = createMockCLIContext()

    registerStageUserProfileReminders(cliCtx as RuntimeContext)

    expect((cliCtx.handlers as MockHandlerRegistry).getRegistrations()).toHaveLength(0)
  })

  it('invokes stageUserProfileRemindersForSession on SessionStart event', async () => {
    mockLoadUserProfile.mockReturnValue({
      name: 'Test',
      role: 'Dev',
      interests: [],
    })

    const handlers = new MockHandlerRegistry()
    const staging = new MockStagingService()
    const assets = new MockAssetResolver()
    assets.register(
      'reminders/user-profile.yaml',
      'id: user-profile\nblocking: false\npriority: 4\npersistent: true\nadditionalContext: "Hello {{user_name}}"\n'
    )

    const ctx = createMockDaemonContext({
      handlers,
      staging,
      logger: new MockLogger(),
      assets,
      config: new MockConfigService(),
      stateService: new MockStateService(),
    })

    registerStageUserProfileReminders(ctx)

    const handler = handlers.getHandler('reminders:stage-user-profile-reminders')
    expect(handler).toBeDefined()

    const event = {
      kind: 'hook' as const,
      hook: 'SessionStart' as const,
      context: { sessionId: 'test-session', timestamp: Date.now() },
      payload: { startType: 'startup' as const, transcriptPath: '/test/transcript.jsonl' },
    }

    await handler!.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

    const reminders = staging.getRemindersForHook('UserPromptSubmit')
    expect(reminders.some((r) => r.name === 'user-profile')).toBe(true)
  })
})
