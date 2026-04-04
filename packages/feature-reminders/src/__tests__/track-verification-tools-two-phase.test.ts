/**
 * Tests for two-phase staging in track-verification-tools
 *
 * Validates that:
 * - ToolCall alone does NOT trigger staging (pending only)
 * - ToolCall + ToolResult together triggers staging
 * - Orphaned pending entries are cleaned on UserPromptSubmit/Stop
 * - ToolResult without preceding ToolCall is a graceful no-op
 * - Cross-session isolation (session A's pending doesn't affect session B)
 *
 * @see docs/superpowers/specs/2026-04-04-pr-staging-toolresult-fix-design.md
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createMockDaemonContext,
  MockStagingService,
  MockLogger,
  MockHandlerRegistry,
  MockAssetResolver,
  MockStateService,
  createDefaultMetrics,
} from '@sidekick/testing-fixtures'
import type {
  DaemonContext,
  TranscriptEvent,
  TranscriptMetrics,
  StagedReminder,
  EventHandler,
  UserPromptSubmitHookEvent,
  HookEvent,
} from '@sidekick/types'
import { registerTrackVerificationTools } from '../handlers/staging/track-verification-tools.js'
import { ReminderIds } from '../types.js'

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
    context: { sessionId, timestamp: Date.now() },
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
    context: { sessionId, timestamp: Date.now() },
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

function createUserPromptSubmitEvent(sessionId = 'test-session'): UserPromptSubmitHookEvent {
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

function createStopHookEvent(sessionId = 'test-session'): HookEvent {
  return {
    kind: 'hook',
    hook: 'Stop',
    context: { sessionId, timestamp: Date.now() },
    payload: {
      transcriptPath: '/test/transcript.jsonl',
    },
  } as HookEvent
}

function getStagedNames(staging: MockStagingService, hook = 'Stop'): string[] {
  return staging.getRemindersForHook(hook).map((r: StagedReminder) => r.name)
}

// ============================================================================
// Tests
// ============================================================================

describe('track-verification-tools two-phase staging', () => {
  let ctx: DaemonContext
  let staging: MockStagingService
  let logger: MockLogger
  let handlers: MockHandlerRegistry
  let assets: MockAssetResolver
  let stateService: MockStateService

  beforeEach(() => {
    toolUseIdCounter = 0
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

  function registerHandlers(): { mainHandler: EventHandler; cleanupHandler: EventHandler } {
    registerTrackVerificationTools(ctx)
    const main = handlers.getHandler('reminders:track-verification-tools')
    const cleanup = handlers.getHandler('reminders:track-verification-tools-cleanup')
    expect(main).toBeDefined()
    expect(cleanup).toBeDefined()
    return { mainHandler: main!.handler, cleanupHandler: cleanup!.handler }
  }

  function getMainHandler(): EventHandler {
    return registerHandlers().mainHandler
  }

  // --------------------------------------------------------------------------
  // Phase 1 only: ToolCall without ToolResult -> no staging
  // --------------------------------------------------------------------------

  it('ToolCall without ToolResult does not trigger staging', async () => {
    const handler = getMainHandler()
    const toolUseId = nextToolUseId()
    const event = createToolCallEvent(
      { turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      'Edit',
      { file_path: '/mock/project/src/index.ts' },
      'test-session',
      toolUseId
    )

    await handler(event, ctx as any)

    // No staging should have occurred — intent captured, not executed
    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  // --------------------------------------------------------------------------
  // Phase 1 + Phase 2: ToolCall + ToolResult -> staging occurs
  // --------------------------------------------------------------------------

  it('ToolCall + ToolResult sequence triggers staging with correct file_path', async () => {
    const handler = getMainHandler()
    const toolUseId = nextToolUseId()
    const metrics = { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }

    // Phase 1: ToolCall captures intent
    const callEvent = createToolCallEvent(
      metrics,
      'Edit',
      { file_path: '/mock/project/src/index.ts' },
      'test-session',
      toolUseId
    )
    await handler(callEvent, ctx as any)
    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)

    // Phase 2: ToolResult confirms execution
    const resultEvent = createToolResultEvent(metrics, 'Edit', toolUseId)
    await handler(resultEvent, ctx as any)

    // Now staging should have occurred
    const names = getStagedNames(staging)
    expect(names).toContain(ReminderIds.VC_BUILD)
    expect(names).toContain(ReminderIds.VERIFY_COMPLETION)
  })

  it('ToolCall + ToolResult for Bash triggers staging with correct command', async () => {
    const handler = getMainHandler()
    const metrics = { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }

    // First stage some reminders via a file edit
    const editId = nextToolUseId()
    await handler(
      createToolCallEvent(metrics, 'Edit', { file_path: '/mock/project/src/index.ts' }, 'test-session', editId),
      ctx as any
    )
    await handler(createToolResultEvent(metrics, 'Edit', editId), ctx as any)
    expect(getStagedNames(staging)).toContain(ReminderIds.VC_BUILD)

    // Now verify via Bash command
    const bashId = nextToolUseId()
    const bashMetrics = { turnCount: 1, toolsThisTurn: 2, toolCount: 2 }
    await handler(
      createToolCallEvent(bashMetrics, 'Bash', { command: 'pnpm build' }, 'test-session', bashId),
      ctx as any
    )
    await handler(createToolResultEvent(bashMetrics, 'Bash', bashId), ctx as any)

    expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_BUILD)
  })

  // --------------------------------------------------------------------------
  // Cleanup: Orphaned entries cleaned on UserPromptSubmit
  // --------------------------------------------------------------------------

  it('orphaned pending entries cleaned on UserPromptSubmit hook event', async () => {
    const { mainHandler, cleanupHandler } = registerHandlers()
    const toolUseId = nextToolUseId()

    // Phase 1: ToolCall captures intent (simulates tool being blocked at PreToolUse)
    const callEvent = createToolCallEvent(
      { turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      'Edit',
      { file_path: '/mock/project/src/index.ts' },
      'test-session',
      toolUseId
    )
    await mainHandler(callEvent, ctx as any)

    // UserPromptSubmit fires — should clean up orphaned pending entry
    const submitEvent = createUserPromptSubmitEvent('test-session')
    await cleanupHandler(submitEvent, ctx as any)

    // Now if a ToolResult arrives for the old toolUseId, it should be a no-op
    const resultEvent = createToolResultEvent({ turnCount: 2, toolsThisTurn: 1, toolCount: 2 }, 'Edit', toolUseId)
    await mainHandler(resultEvent, ctx as any)

    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  // --------------------------------------------------------------------------
  // Cleanup: Orphaned entries cleaned on Stop
  // --------------------------------------------------------------------------

  it('orphaned pending entries cleaned on Stop hook event', async () => {
    const { mainHandler, cleanupHandler } = registerHandlers()
    const toolUseId = nextToolUseId()

    // Phase 1: ToolCall captures intent
    const callEvent = createToolCallEvent(
      { turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      'Edit',
      { file_path: '/mock/project/src/index.ts' },
      'test-session',
      toolUseId
    )
    await mainHandler(callEvent, ctx as any)

    // Stop fires — should clean up orphaned pending entry
    const stopEvent = createStopHookEvent('test-session')
    await cleanupHandler(stopEvent, ctx as any)

    // ToolResult after cleanup is a no-op
    const resultEvent = createToolResultEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'Edit', toolUseId)
    await mainHandler(resultEvent, ctx as any)

    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  // --------------------------------------------------------------------------
  // ToolResult without preceding ToolCall -> graceful no-op
  // --------------------------------------------------------------------------

  it('ToolResult without preceding ToolCall is a graceful no-op', async () => {
    const handler = getMainHandler()

    // Send ToolResult with a tool_use_id that was never registered via ToolCall
    const resultEvent = createToolResultEvent(
      { turnCount: 1, toolsThisTurn: 1, toolCount: 1 },
      'Edit',
      'nonexistent-tool-use-id'
    )
    await handler(resultEvent, ctx as any)

    // No staging, no errors
    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
  })

  // --------------------------------------------------------------------------
  // Cross-session isolation
  // --------------------------------------------------------------------------

  it('session A pending entries do not affect session B', async () => {
    const handler = getMainHandler()
    const metrics = { turnCount: 1, toolsThisTurn: 1, toolCount: 1 }

    // Session A: ToolCall
    const toolUseIdA = nextToolUseId()
    const callA = createToolCallEvent(
      metrics,
      'Edit',
      { file_path: '/mock/project/src/index.ts' },
      'session-A',
      toolUseIdA
    )
    await handler(callA, ctx as any)

    // Session B: ToolResult with same tool_use_id but different session
    const resultB = createToolResultEvent(metrics, 'Edit', toolUseIdA, 'session-B')
    await handler(resultB, ctx as any)

    // No staging should occur — session B has no pending entries
    expect(staging.getRemindersForHook('Stop')).toHaveLength(0)

    // Session A: ToolResult completes normally
    const resultA = createToolResultEvent(metrics, 'Edit', toolUseIdA, 'session-A')
    await handler(resultA, ctx as any)

    // Now staging occurs for session A
    const names = getStagedNames(staging)
    expect(names).toContain(ReminderIds.VC_BUILD)
  })

  // --------------------------------------------------------------------------
  // Handler registration
  // --------------------------------------------------------------------------

  it('registers both main handler and cleanup handler', () => {
    registerTrackVerificationTools(ctx)

    const main = handlers.getHandler('reminders:track-verification-tools')
    const cleanup = handlers.getHandler('reminders:track-verification-tools-cleanup')
    expect(main).toBeDefined()
    expect(cleanup).toBeDefined()
  })

  it('main handler filters on ToolCall and ToolResult events', () => {
    registerTrackVerificationTools(ctx)

    const toolCallHandlers = handlers.getHandlersForTranscriptEvent('ToolCall')
    const toolResultHandlers = handlers.getHandlersForTranscriptEvent('ToolResult')
    expect(toolCallHandlers.some((h) => h.id === 'reminders:track-verification-tools')).toBe(true)
    expect(toolResultHandlers.some((h) => h.id === 'reminders:track-verification-tools')).toBe(true)
  })

  it('cleanup handler filters on UserPromptSubmit and Stop hooks', () => {
    registerTrackVerificationTools(ctx)

    const userPromptHandlers = handlers.getHandlersForHook('UserPromptSubmit')
    const stopHandlers = handlers.getHandlersForHook('Stop')
    expect(userPromptHandlers.some((h) => h.id === 'reminders:track-verification-tools-cleanup')).toBe(true)
    expect(stopHandlers.some((h) => h.id === 'reminders:track-verification-tools-cleanup')).toBe(true)
  })
})
