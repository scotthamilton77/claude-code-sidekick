/**
 * Tests for track-verification-tools staging handler
 *
 * Watches ToolCall transcript events to:
 * 1. Stage per-tool VC reminders when source files are edited
 * 2. Unstage per-tool VC reminders when verification commands are observed
 * 3. Manage STAGED → VERIFIED → COOLDOWN state machine with clearing threshold
 *
 * @see docs/plans/2026-03-05-dynamic-vc-tool-tracking-design.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createMockDaemonContext,
  MockStagingService,
  MockLogger,
  MockHandlerRegistry,
  MockAssetResolver,
  MockStateService,
  createDefaultMetrics,
} from '@sidekick/testing-fixtures'
import type { DaemonContext, TranscriptEvent, TranscriptMetrics, StagedReminder, EventHandler } from '@sidekick/types'
import {
  registerTrackVerificationTools,
  stageToolsForFiles,
} from '../../../handlers/staging/track-verification-tools.js'
import { ReminderIds } from '../../../types.js'

// ============================================================================
// Test Helpers
// ============================================================================

function createToolCallEvent(
  metrics: Partial<TranscriptMetrics>,
  toolName: string,
  input: Record<string, unknown> = {},
  sessionId = 'test-session'
): TranscriptEvent {
  return {
    kind: 'transcript',
    eventType: 'ToolCall',
    context: {
      sessionId,
      timestamp: Date.now(),
    },
    payload: {
      lineNumber: 1,
      entry: { input },
      toolName,
    },
    metadata: {
      transcriptPath: '/test/transcript.jsonl',
      metrics: { ...createDefaultMetrics(), ...metrics },
    },
  }
}

function createFileEditEvent(
  metrics: Partial<TranscriptMetrics>,
  filePath: string,
  toolName = 'Edit',
  sessionId = 'test-session'
): TranscriptEvent {
  return createToolCallEvent(metrics, toolName, { file_path: filePath }, sessionId)
}

function createBashEvent(
  metrics: Partial<TranscriptMetrics>,
  command: string,
  sessionId = 'test-session'
): TranscriptEvent {
  return createToolCallEvent(metrics, 'Bash', { command }, sessionId)
}

function getStagedNames(staging: MockStagingService, hook = 'Stop'): string[] {
  return staging.getRemindersForHook(hook).map((r: StagedReminder) => r.name)
}

function getHandlerFromContext(ctx: DaemonContext, handlers: MockHandlerRegistry): EventHandler {
  registerTrackVerificationTools(ctx)
  const reg = handlers.getHandler('reminders:track-verification-tools')
  expect(reg).toBeDefined()
  return reg!.handler
}

// ============================================================================
// Tests
// ============================================================================

describe('registerTrackVerificationTools', () => {
  let ctx: DaemonContext
  let staging: MockStagingService
  let logger: MockLogger
  let handlers: MockHandlerRegistry
  let assets: MockAssetResolver
  let stateService: MockStateService

  beforeEach(() => {
    staging = new MockStagingService()
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()
    assets = new MockAssetResolver()
    stateService = new MockStateService()

    // Register per-tool reminder YAMLs
    assets.registerAll({
      'reminders/verify-completion.yaml': `id: verify-completion
blocking: true
priority: 51
persistent: false
additionalContext: "Wrapper"
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

    ctx = createMockDaemonContext({ staging, logger, handlers, assets, stateService })
  })

  function getRegisteredHandler(): EventHandler {
    registerTrackVerificationTools(ctx)
    const reg = handlers.getHandler('reminders:track-verification-tools')
    expect(reg).toBeDefined()
    return reg!.handler
  }

  // --------------------------------------------------------------------------
  // File edit staging
  // --------------------------------------------------------------------------

  it('stages per-tool VC reminders + wrapper on source file edit', async () => {
    const handler = getRegisteredHandler()
    const event = createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')

    await handler(event, ctx as any)

    const names = getStagedNames(staging)
    expect(names).toContain(ReminderIds.VERIFY_COMPLETION)
    expect(names).toContain(ReminderIds.VC_BUILD)
    expect(names).toContain(ReminderIds.VC_TYPECHECK)
    expect(names).toContain(ReminderIds.VC_TEST)
    expect(names).toContain(ReminderIds.VC_LINT)
  })

  it('ignores file edits outside projectDir', async () => {
    const handler = getRegisteredHandler()
    const event = createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/other-project/src/index.ts')

    await handler(event, ctx as any)

    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  it('ignores file edits to non-matching patterns (e.g. .md files)', async () => {
    const handler = getRegisteredHandler()
    const event = createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/docs/README.md')

    await handler(event, ctx as any)

    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  it('ignores non-file-edit, non-Bash tool calls', async () => {
    const handler = getRegisteredHandler()
    const event = createToolCallEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Read', {
      file_path: '/mock/project/src/index.ts',
    })

    await handler(event, ctx as any)

    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  it('does not re-stage if reminders already exist (idempotent)', async () => {
    const handler = getRegisteredHandler()
    const event1 = createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/a.ts')
    const event2 = createFileEditEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, '/mock/project/src/b.ts')

    await handler(event1, ctx as any)
    await handler(event2, ctx as any)

    // Should still be exactly 5 (wrapper + 4 tools), not doubled
    expect(staging.getRemindersForHook('Stop')).toHaveLength(5)
  })

  it('skips bulk processing events', async () => {
    const handler = getRegisteredHandler()
    const event = createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')
    event.metadata.isBulkProcessing = true

    await handler(event, ctx as any)

    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  // --------------------------------------------------------------------------
  // Verification command detection
  // --------------------------------------------------------------------------

  it('unstages vc-build when build command is observed', async () => {
    const handler = getRegisteredHandler()

    // Stage by editing a file
    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts'),
      ctx as any
    )
    expect(getStagedNames(staging)).toContain(ReminderIds.VC_BUILD)

    // Observe a build command
    await handler(createBashEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build'), ctx as any)

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_BUILD)
  })

  it('unstages vc-test when test command is observed', async () => {
    const handler = getRegisteredHandler()

    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts'),
      ctx as any
    )
    await handler(
      createBashEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm test -- --run src/__tests__/foo.test.ts'),
      ctx as any
    )

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_TEST)
  })

  it('unstages multiple tools for chained commands', async () => {
    const handler = getRegisteredHandler()

    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts'),
      ctx as any
    )
    await handler(
      createBashEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build && pnpm test'),
      ctx as any
    )

    const names = getStagedNames(staging)
    expect(names).not.toContain(ReminderIds.VC_BUILD)
    expect(names).not.toContain(ReminderIds.VC_TEST)
  })

  it('unstages wrapper when all per-tool reminders are unstaged', async () => {
    const handler = getRegisteredHandler()

    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts'),
      ctx as any
    )

    // Verify all commands
    await handler(
      createBashEvent(
        { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
        'pnpm build && pnpm typecheck && pnpm test && pnpm lint'
      ),
      ctx as any
    )

    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  it('unstages vc-test when workspace-scoped test command is observed', async () => {
    const handler = getRegisteredHandler()

    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts'),
      ctx as any
    )
    await handler(
      createBashEvent(
        { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
        'pnpm --filter @sidekick/core test -- --exclude foo'
      ),
      ctx as any
    )

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_TEST)
  })

  it('unstages vc-build when workspace-scoped build command is observed', async () => {
    const handler = getRegisteredHandler()

    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts'),
      ctx as any
    )
    await handler(
      createBashEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm --filter @sidekick/core build'),
      ctx as any
    )

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_BUILD)
  })

  it('stores lastMatchedToolId and lastMatchedScope on verification', async () => {
    const handler = getRegisteredHandler()

    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts'),
      ctx as any
    )
    await handler(createBashEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build'), ctx as any)

    const statePath = stateService.sessionStatePath('test-session', 'verification-tools.json')
    const state = stateService.getStored(statePath) as Record<string, Record<string, unknown>>
    expect(state.build.lastMatchedToolId).toBe('pnpm-build')
    expect(state.build.lastMatchedScope).toBe('project')
  })

  // --------------------------------------------------------------------------
  // Cooldown and re-staging
  // --------------------------------------------------------------------------

  it('does not immediately re-stage after verification (cooldown)', async () => {
    const handler = getRegisteredHandler()

    // Edit → stage all
    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/a.ts'),
      ctx as any
    )
    // Verify build
    await handler(createBashEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build'), ctx as any)

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_BUILD)

    // One more edit — should NOT re-stage build (threshold is 3)
    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 3, toolCount: 3 }, '/mock/project/src/b.ts'),
      ctx as any
    )

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_BUILD)
  })

  it('re-stages after clearing threshold edits post-verification', async () => {
    const handler = getRegisteredHandler()

    // Edit → stage all
    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/a.ts'),
      ctx as any
    )
    // Verify build (threshold = 3)
    await handler(createBashEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build'), ctx as any)

    // 3 more qualifying edits to hit threshold
    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 3, toolCount: 3 }, '/mock/project/src/b.ts'),
      ctx as any
    )
    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 4, toolCount: 4 }, '/mock/project/src/c.ts'),
      ctx as any
    )
    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 5, toolCount: 5 }, '/mock/project/src/d.ts'),
      ctx as any
    )

    const names = getStagedNames(staging)
    expect(names).toContain(ReminderIds.VC_BUILD)
    expect(names).toContain(ReminderIds.VERIFY_COMPLETION)
  })

  // --------------------------------------------------------------------------
  // Write tool support
  // --------------------------------------------------------------------------

  it('stages on Write tool (not just Edit)', async () => {
    const handler = getRegisteredHandler()
    const event = createFileEditEvent(
      { turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      '/mock/project/src/new-file.ts',
      'Write'
    )

    await handler(event, ctx as any)

    expect(getStagedNames(staging)).toContain(ReminderIds.VC_BUILD)
  })

  it('stages on MultiEdit tool', async () => {
    const handler = getRegisteredHandler()
    const event = createFileEditEvent(
      { turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      '/mock/project/src/refactored.ts',
      'MultiEdit'
    )

    await handler(event, ctx as any)

    expect(getStagedNames(staging)).toContain(ReminderIds.VC_BUILD)
  })
})

describe('stageToolsForFiles', () => {
  it('is exported as a function', () => {
    expect(typeof stageToolsForFiles).toBe('function')
  })
})

// --------------------------------------------------------------------------
// reminder:not-staged event emission
// --------------------------------------------------------------------------

describe('reminder:not-staged events in track-verification-tools', () => {
  let ctx: DaemonContext
  let staging: MockStagingService
  let logger: MockLogger
  let handlers: MockHandlerRegistry
  let assets: MockAssetResolver
  let stateService: MockStateService

  function getNotStagedEvents(): import('@sidekick/testing-fixtures').LogRecord[] {
    return logger.recordedLogs.filter((log) => log.level === 'info' && log.meta?.type === 'reminder:not-staged')
  }

  beforeEach(() => {
    staging = new MockStagingService()
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()
    assets = new MockAssetResolver()
    stateService = new MockStateService()

    assets.registerAll({
      'reminders/verify-completion.yaml': `id: verify-completion
blocking: true
priority: 51
persistent: false
additionalContext: "Wrapper"
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

    ctx = createMockDaemonContext({ staging, logger, handlers, assets, stateService })
  })

  function getRegisteredHandler(): EventHandler {
    registerTrackVerificationTools(ctx)
    const reg = handlers.getHandler('reminders:track-verification-tools')
    expect(reg).toBeDefined()
    return reg!.handler
  }

  it('should emit not-staged event when file does not match clearing patterns', async () => {
    const handler = getRegisteredHandler()
    // .md files don't match default clearing_patterns (**/*.ts, **/*.tsx, etc.)
    const event = createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/docs/README.md')

    await handler(event, ctx as any)

    const notStagedEvents = getNotStagedEvents()
    // Each of the 4 tools should emit a pattern_mismatch event
    const patternMismatches = notStagedEvents.filter((e) => e.meta?.reason === 'pattern_mismatch')
    expect(patternMismatches.length).toBeGreaterThanOrEqual(4)
  })

  it('should emit not-staged event when below clearing threshold', async () => {
    const handler = getRegisteredHandler()

    // Edit → stage all tools
    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/a.ts'),
      ctx as any
    )
    // Verify build (moves to "verified" state)
    await handler(createBashEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build'), ctx as any)

    logger.reset()

    // One more edit — should NOT re-stage build (threshold is 3), should emit below_threshold
    await handler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 3, toolCount: 3 }, '/mock/project/src/b.ts'),
      ctx as any
    )

    const notStagedEvents = getNotStagedEvents()
    const belowThreshold = notStagedEvents.filter(
      (e) => e.meta?.reason === 'below_threshold' && e.meta?.reminderName === 'vc-build'
    )
    expect(belowThreshold).toHaveLength(1)
    expect(belowThreshold[0].meta?.threshold).toBe(3)
    expect(belowThreshold[0].meta?.currentValue).toBe(1)
    expect(belowThreshold[0].meta?.triggeredBy).toBe('file_edit')
  })
})

// --------------------------------------------------------------------------
// ensureToolReminderStaged failure handling
// --------------------------------------------------------------------------

describe('ensureToolReminderStaged failure does not pollute state', () => {
  let staging: MockStagingService
  let logger: MockLogger
  let handlers: MockHandlerRegistry
  let assets: MockAssetResolver
  let stateService: MockStateService
  let ctx: DaemonContext

  let cwdSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    staging = new MockStagingService()
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()
    assets = new MockAssetResolver()
    stateService = new MockStateService()
    // Prevent file-system fallback from finding real YAML files
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent')
  })

  afterEach(() => {
    cwdSpy.mockRestore()
  })

  it('does not stage wrapper when all per-tool reminders fail to resolve', async () => {
    // Register ONLY the wrapper — per-tool YAMLs are missing
    assets.registerAll({
      'reminders/verify-completion.yaml': `id: verify-completion
blocking: true
priority: 51
persistent: false
additionalContext: "Wrapper"
`,
    })

    ctx = createMockDaemonContext({ staging, logger, handlers, assets, stateService })
    const handler = getHandlerFromContext(ctx, handlers)
    const event = createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')

    await handler(event, ctx as any)

    // No per-tool reminders could resolve, so wrapper must NOT be staged
    const names = getStagedNames(staging)
    expect(names).not.toContain(ReminderIds.VERIFY_COMPLETION)
    expect(names).toHaveLength(0)
  })

  it('does not mark tool as staged when its reminder fails to resolve', async () => {
    // Register wrapper + only vc-build — others missing
    assets.registerAll({
      'reminders/verify-completion.yaml': `id: verify-completion
blocking: true
priority: 51
persistent: false
additionalContext: "Wrapper"
`,
      'reminders/vc-build.yaml': `id: vc-build
blocking: true
priority: 50
persistent: false
additionalContext: "Build needed"
`,
    })

    ctx = createMockDaemonContext({ staging, logger, handlers, assets, stateService })
    const handler = getHandlerFromContext(ctx, handlers)
    const event = createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')

    await handler(event, ctx as any)

    // Only vc-build + wrapper should be staged (the others failed to resolve)
    const names = getStagedNames(staging)
    expect(names).toContain(ReminderIds.VC_BUILD)
    expect(names).toContain(ReminderIds.VERIFY_COMPLETION)
    expect(names).not.toContain(ReminderIds.VC_TYPECHECK)
    expect(names).not.toContain(ReminderIds.VC_TEST)
    expect(names).not.toContain(ReminderIds.VC_LINT)
    expect(names).toHaveLength(2)
  })

  it('returns false from stageToolsForFiles when all reminders fail', async () => {
    // No reminder YAMLs registered at all
    ctx = createMockDaemonContext({ staging, logger, handlers, assets, stateService })

    const { createRemindersState } = await import('../../../state.js')
    const remindersState = createRemindersState(stateService as any)
    const verificationTools = {
      build: { enabled: true, patterns: [], clearing_patterns: ['**/*.ts'], clearing_threshold: 3 },
    }

    const result = await stageToolsForFiles(
      ['/mock/project/src/index.ts'],
      ctx,
      'test-session',
      verificationTools,
      {},
      remindersState
    )

    expect(result).toBe(false)
  })
})
