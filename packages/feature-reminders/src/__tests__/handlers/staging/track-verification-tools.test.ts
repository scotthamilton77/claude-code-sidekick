/**
 * Tests for track-verification-tools staging handler
 *
 * Uses two-phase staging: ToolCall captures intent, ToolResult confirms execution.
 * Tests send ToolCall+ToolResult pairs via simulateToolExecution() helper.
 *
 * @see docs/plans/2026-03-05-dynamic-vc-tool-tracking-design.md
 * @see docs/superpowers/specs/2026-04-04-pr-staging-toolresult-fix-design.md
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
import type { LogRecord } from '@sidekick/testing-fixtures'
import type { DaemonContext, TranscriptEvent, TranscriptMetrics, StagedReminder, EventHandler } from '@sidekick/types'
import {
  registerTrackVerificationTools,
  stageToolsForFiles,
} from '../../../handlers/staging/track-verification-tools.js'
import { ReminderIds } from '../../../types.js'

// ============================================================================
// Test Helpers
// ============================================================================

let toolUseIdCounter = 0

function nextToolUseId(): string {
  return `tool-use-${++toolUseIdCounter}`
}

function createToolCallEvent(
  metrics: Partial<TranscriptMetrics>,
  toolName: string,
  input: Record<string, unknown> = {},
  sessionId = 'test-session',
  toolUseId?: string
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
      entry: { id: toolUseId ?? nextToolUseId(), input },
      toolName,
    },
    metadata: {
      transcriptPath: '/test/transcript.jsonl',
      metrics: { ...createDefaultMetrics(), ...metrics },
    },
  }
}

function createToolResultEvent(
  metrics: Partial<TranscriptMetrics>,
  toolName: string,
  toolUseId: string,
  sessionId = 'test-session'
): TranscriptEvent {
  return {
    kind: 'transcript',
    eventType: 'ToolResult',
    context: {
      sessionId,
      timestamp: Date.now(),
    },
    payload: {
      lineNumber: 2,
      entry: { tool_use_id: toolUseId },
      toolName,
    },
    metadata: {
      transcriptPath: '/test/transcript.jsonl',
      metrics: { ...createDefaultMetrics(), ...metrics },
    },
  }
}

/**
 * Simulate a complete tool execution: ToolCall (capture intent) + ToolResult (confirm execution).
 * Returns both events in case tests need to inspect them.
 */
async function simulateToolExecution(
  handler: EventHandler,
  ctx: DaemonContext,
  metrics: Partial<TranscriptMetrics>,
  toolName: string,
  input: Record<string, unknown> = {},
  sessionId = 'test-session'
): Promise<{ toolCallEvent: TranscriptEvent; toolResultEvent: TranscriptEvent }> {
  const toolUseId = nextToolUseId()
  const toolCallEvent = createToolCallEvent(metrics, toolName, input, sessionId, toolUseId)
  const toolResultEvent = createToolResultEvent(metrics, toolName, toolUseId, sessionId)

  await handler(toolCallEvent, ctx as any)
  await handler(toolResultEvent, ctx as any)

  return { toolCallEvent, toolResultEvent }
}

async function simulateFileEdit(
  handler: EventHandler,
  ctx: DaemonContext,
  metrics: Partial<TranscriptMetrics>,
  filePath: string,
  toolName = 'Edit',
  sessionId = 'test-session'
): Promise<void> {
  await simulateToolExecution(handler, ctx, metrics, toolName, { file_path: filePath }, sessionId)
}

async function simulateBashCommand(
  handler: EventHandler,
  ctx: DaemonContext,
  metrics: Partial<TranscriptMetrics>,
  command: string,
  sessionId = 'test-session'
): Promise<void> {
  await simulateToolExecution(handler, ctx, metrics, 'Bash', { command }, sessionId)
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

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')

    const names = getStagedNames(staging)
    expect(names).toContain(ReminderIds.VERIFY_COMPLETION)
    expect(names).toContain(ReminderIds.VC_BUILD)
    expect(names).toContain(ReminderIds.VC_TYPECHECK)
    expect(names).toContain(ReminderIds.VC_TEST)
    expect(names).toContain(ReminderIds.VC_LINT)
  })

  it('ignores file edits outside projectDir', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(
      handler,
      ctx,
      { turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      '/other-project/src/index.ts'
    )

    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  it('ignores file edits to non-matching patterns (e.g. .md files)', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(
      handler,
      ctx,
      { turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      '/mock/project/docs/README.md'
    )

    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  it('ignores non-file-edit, non-Bash tool calls', async () => {
    const handler = getRegisteredHandler()

    await simulateToolExecution(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Read', {
      file_path: '/mock/project/src/index.ts',
    })

    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  it('does not re-stage if reminders already exist (idempotent)', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/a.ts')
    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, '/mock/project/src/b.ts')

    // Should still be exactly 5 (wrapper + 4 tools), not doubled
    expect(staging.getRemindersForHook('Stop')).toHaveLength(5)
  })

  it('skips bulk processing events', async () => {
    const handler = getRegisteredHandler()
    const toolUseId = nextToolUseId()
    const event = createToolCallEvent(
      { turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      'Edit',
      { file_path: '/mock/project/src/index.ts' },
      'test-session',
      toolUseId
    )
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
    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')
    expect(getStagedNames(staging)).toContain(ReminderIds.VC_BUILD)

    // Observe a build command
    await simulateBashCommand(handler, ctx, { turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build')

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_BUILD)
  })

  it('unstages vc-test when test command is observed', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')
    await simulateBashCommand(
      handler,
      ctx,
      { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
      'pnpm test -- --run src/__tests__/foo.test.ts'
    )

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_TEST)
  })

  it('unstages multiple tools for chained commands', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')
    await simulateBashCommand(handler, ctx, { turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build && pnpm test')

    const names = getStagedNames(staging)
    expect(names).not.toContain(ReminderIds.VC_BUILD)
    expect(names).not.toContain(ReminderIds.VC_TEST)
  })

  it('unstages wrapper when all per-tool reminders are unstaged', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')

    // Verify all commands
    await simulateBashCommand(
      handler,
      ctx,
      { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
      'pnpm build && pnpm typecheck && pnpm test && pnpm lint'
    )

    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  it('unstages vc-test when workspace-scoped test command is observed', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')
    await simulateBashCommand(
      handler,
      ctx,
      { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
      'pnpm --filter @sidekick/core test -- --exclude foo'
    )

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_TEST)
  })

  it('unstages vc-build when workspace-scoped build command is observed', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')
    await simulateBashCommand(
      handler,
      ctx,
      { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
      'pnpm --filter @sidekick/core build'
    )

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_BUILD)
  })

  // --------------------------------------------------------------------------
  // Runner-wrapped command detection
  // --------------------------------------------------------------------------

  it('unstages vc-typecheck when mypy is invoked through uv run', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/app.py')
    expect(getStagedNames(staging)).toContain(ReminderIds.VC_TYPECHECK)

    await simulateBashCommand(
      handler,
      ctx,
      { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
      'uv run mypy tests/test_feedback_server.py --ignore-missing-imports'
    )

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_TYPECHECK)
  })

  it('unstages vc-test when pytest is invoked through uv run', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/app.py')
    await simulateBashCommand(handler, ctx, { turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'uv run pytest tests/')

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_TEST)
  })

  it('unstages vc-lint when ruff is invoked through poetry run', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/app.py')
    await simulateBashCommand(
      handler,
      ctx,
      { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
      'poetry run ruff check src/'
    )

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_LINT)
  })

  it('stores lastMatchedToolId and lastMatchedScope on verification', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')
    await simulateBashCommand(handler, ctx, { turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build')

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
    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/a.ts')
    // Verify build
    await simulateBashCommand(handler, ctx, { turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build')

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_BUILD)

    // One more edit — should NOT re-stage build (threshold is 3)
    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 3, toolCount: 3 }, '/mock/project/src/b.ts')

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_BUILD)
  })

  it('re-stages after clearing threshold edits post-verification', async () => {
    const handler = getRegisteredHandler()

    // Edit → stage all
    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/a.ts')
    // Verify build (threshold = 3)
    await simulateBashCommand(handler, ctx, { turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build')

    // 3 more qualifying edits to hit threshold
    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 3, toolCount: 3 }, '/mock/project/src/b.ts')
    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 4, toolCount: 4 }, '/mock/project/src/c.ts')
    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 5, toolCount: 5 }, '/mock/project/src/d.ts')

    const names = getStagedNames(staging)
    expect(names).toContain(ReminderIds.VC_BUILD)
    expect(names).toContain(ReminderIds.VERIFY_COMPLETION)
  })

  // --------------------------------------------------------------------------
  // Write tool support
  // --------------------------------------------------------------------------

  it('stages on Write tool (not just Edit)', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(
      handler,
      ctx,
      { turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      '/mock/project/src/new-file.ts',
      'Write'
    )

    expect(getStagedNames(staging)).toContain(ReminderIds.VC_BUILD)
  })

  it('stages on MultiEdit tool', async () => {
    const handler = getRegisteredHandler()

    await simulateFileEdit(
      handler,
      ctx,
      { turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      '/mock/project/src/refactored.ts',
      'MultiEdit'
    )

    expect(getStagedNames(staging)).toContain(ReminderIds.VC_BUILD)
  })

  // --------------------------------------------------------------------------
  // decision:recorded event emission
  // --------------------------------------------------------------------------

  describe('decision:recorded events', () => {
    function getDecisionRecordedEvents(): LogRecord[] {
      return logger.recordedLogs.filter((log) => log.level === 'info' && log.meta?.type === 'decision:recorded')
    }

    it('emits decision:recorded with decision=staged when re-staging after threshold reached', async () => {
      const handler = getRegisteredHandler()

      // Edit → stage all tools initially
      await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/a.ts')
      // Verify build (moves to "verified" state, threshold = 3)
      await simulateBashCommand(handler, ctx, { turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build')

      logger.reset()

      // 3 more qualifying edits to hit clearing threshold
      await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 3, toolCount: 3 }, '/mock/project/src/b.ts')
      await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 4, toolCount: 4 }, '/mock/project/src/c.ts')
      await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 5, toolCount: 5 }, '/mock/project/src/d.ts')

      const decisionEvents = getDecisionRecordedEvents()
      const staged = decisionEvents.filter((e) => e.meta?.decision === 'staged' && e.meta?.subsystem === 'vc-reminders')
      expect(staged.length).toBeGreaterThanOrEqual(1)
      expect(staged[0].meta?.title).toBe('Re-stage VC reminder (threshold reached)')
    })

    it('emits decision:recorded with decision=unstaged when verification passes', async () => {
      const handler = getRegisteredHandler()

      // Edit → stage all tools
      await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/a.ts')

      logger.reset()

      // Observe a build command → unstages vc-build
      await simulateBashCommand(handler, ctx, { turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build')

      const decisionEvents = getDecisionRecordedEvents()
      const unstaged = decisionEvents.filter(
        (e) => e.meta?.decision === 'unstaged' && e.meta?.subsystem === 'vc-reminders'
      )
      expect(unstaged.length).toBeGreaterThanOrEqual(1)
      expect(unstaged[0].meta?.title).toBe('Unstage VC reminder (verified)')
    })
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

  function getNotStagedEvents(): LogRecord[] {
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
    await simulateFileEdit(
      handler,
      ctx,
      { turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      '/mock/project/docs/README.md'
    )

    const notStagedEvents = getNotStagedEvents()
    // Each of the 4 tools should emit a pattern_mismatch event
    const patternMismatches = notStagedEvents.filter((e) => e.meta?.reason === 'pattern_mismatch')
    expect(patternMismatches.length).toBeGreaterThanOrEqual(4)
  })

  it('should emit not-staged event when below clearing threshold', async () => {
    const handler = getRegisteredHandler()

    // Edit → stage all tools
    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/a.ts')
    // Verify build (moves to "verified" state)
    await simulateBashCommand(handler, ctx, { turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build')

    logger.reset()

    // One more edit — should NOT re-stage build (threshold is 3), should emit below_threshold
    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 3, toolCount: 3 }, '/mock/project/src/b.ts')

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

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')

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

    await simulateFileEdit(handler, ctx, { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts')

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

// --------------------------------------------------------------------------
// Per-tool error handling in stageToolsForFiles inner loop
// --------------------------------------------------------------------------

describe('stageToolsForFiles inner loop error handling', () => {
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
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent')

    // Register all reminder YAMLs so resolution succeeds
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

  afterEach(() => {
    cwdSpy.mockRestore()
  })

  it('continues staging other tools when one tool throws during staging', async () => {
    // Make stageReminder throw only for vc-build
    const originalStageReminder = staging.stageReminder.bind(staging)
    staging.stageReminder = async (hookName: string, reminderName: string, data: any) => {
      if (reminderName === 'vc-build') {
        throw new Error('Simulated staging failure for vc-build')
      }
      return originalStageReminder(hookName, reminderName, data)
    }

    const { createRemindersState } = await import('../../../state.js')
    const remindersState = createRemindersState(stateService as any)

    const verificationTools = {
      build: { enabled: true, patterns: [], clearing_patterns: ['**/*.ts'], clearing_threshold: 3 },
      typecheck: { enabled: true, patterns: [], clearing_patterns: ['**/*.ts'], clearing_threshold: 3 },
      test: { enabled: true, patterns: [], clearing_patterns: ['**/*.ts'], clearing_threshold: 3 },
      lint: { enabled: true, patterns: [], clearing_patterns: ['**/*.ts'], clearing_threshold: 5 },
    }

    const result = await stageToolsForFiles(
      ['/mock/project/src/index.ts'],
      ctx,
      'test-session',
      verificationTools,
      {},
      remindersState
    )

    // Should still succeed — other tools were staged
    expect(result).toBe(true)

    // vc-build failed, but typecheck/test/lint should be staged
    const names = getStagedNames(staging)
    expect(names).not.toContain(ReminderIds.VC_BUILD)
    expect(names).toContain(ReminderIds.VC_TYPECHECK)
    expect(names).toContain(ReminderIds.VC_TEST)
    expect(names).toContain(ReminderIds.VC_LINT)
    // Wrapper should still be staged since some tools succeeded
    expect(names).toContain(ReminderIds.VERIFY_COMPLETION)
  })

  it('logs a warning when a tool throws during staging', async () => {
    const originalStageReminder = staging.stageReminder.bind(staging)
    staging.stageReminder = async (hookName: string, reminderName: string, data: any) => {
      if (reminderName === 'vc-test') {
        throw new Error('Test staging kaboom')
      }
      return originalStageReminder(hookName, reminderName, data)
    }

    const { createRemindersState } = await import('../../../state.js')
    const remindersState = createRemindersState(stateService as any)

    const verificationTools = {
      test: { enabled: true, patterns: [], clearing_patterns: ['**/*.ts'], clearing_threshold: 3 },
      lint: { enabled: true, patterns: [], clearing_patterns: ['**/*.ts'], clearing_threshold: 5 },
    }

    await stageToolsForFiles(['/mock/project/src/index.ts'], ctx, 'test-session', verificationTools, {}, remindersState)

    // Should have logged a warning about the failed tool
    const warnLogs = logger.recordedLogs.filter(
      (log) => log.level === 'warn' && log.msg?.includes('stage tool reminder')
    )
    expect(warnLogs.length).toBeGreaterThanOrEqual(1)
    expect(warnLogs[0].meta?.toolName).toBe('test')
    expect(warnLogs[0].meta?.error).toBe('Test staging kaboom')
  })

  it('does not throw when a tool fails — partial staging succeeds', async () => {
    const originalStageReminder = staging.stageReminder.bind(staging)
    staging.stageReminder = async (hookName: string, reminderName: string, data: any) => {
      if (reminderName === 'vc-lint') {
        throw new Error('Lint staging explosion')
      }
      return originalStageReminder(hookName, reminderName, data)
    }

    const { createRemindersState } = await import('../../../state.js')
    const remindersState = createRemindersState(stateService as any)

    const verificationTools = {
      build: { enabled: true, patterns: [], clearing_patterns: ['**/*.ts'], clearing_threshold: 3 },
      lint: { enabled: true, patterns: [], clearing_patterns: ['**/*.ts'], clearing_threshold: 5 },
    }

    // Must NOT throw
    await expect(
      stageToolsForFiles(['/mock/project/src/index.ts'], ctx, 'test-session', verificationTools, {}, remindersState)
    ).resolves.toBe(true)

    // State should still be written (build succeeded)
    const statePath = stateService.sessionStatePath('test-session', 'verification-tools.json')
    const state = stateService.getStored(statePath) as Record<string, unknown>
    expect(state).toBeDefined()
    expect(state.build).toBeDefined()
  })
})
