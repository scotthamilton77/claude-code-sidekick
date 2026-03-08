/**
 * Reproduction tests for orphaned verify-completion wrapper bug
 *
 * The wrapper reminder (`verify-completion`) can become orphaned — staged
 * with zero per-tool VC children — via two independent paths:
 *
 * Scenario A: stage-stop-bash-changes stages wrapper independently of per-tool state
 * Scenario B: unstage-verify-completion re-stages wrapper without re-staging per-tool reminders
 *
 * @see https://github.com/scotthamilton77/claude-code-sidekick/issues/sidekick-tw9t
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  UserPromptSubmitHookEvent,
} from '@sidekick/types'
import { registerTrackVerificationTools } from '../../../handlers/staging/track-verification-tools.js'
import { registerUnstageVerifyCompletion } from '../../../handlers/staging/unstage-verify-completion.js'
import { registerStageBashChanges } from '../../../handlers/staging/stage-stop-bash-changes.js'
import { ReminderIds, VC_TOOL_REMINDER_IDS } from '../../../types.js'
import { getGitFileStatus } from '@sidekick/core'

// Mock git status for stage-stop-bash-changes
vi.mock('@sidekick/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...mod,
    getGitFileStatus: vi.fn().mockResolvedValue([]),
  }
})
const mockGetGitFileStatus = getGitFileStatus as ReturnType<typeof vi.fn>

// ============================================================================
// Helpers
// ============================================================================

function createFileEditEvent(
  metrics: Partial<TranscriptMetrics>,
  filePath: string,
  sessionId = 'test-session'
): TranscriptEvent {
  return {
    kind: 'transcript',
    eventType: 'ToolCall',
    context: { sessionId, timestamp: Date.now() },
    payload: { lineNumber: 1, entry: { input: { file_path: filePath } }, toolName: 'Edit' },
    metadata: { transcriptPath: '/test/transcript.jsonl', metrics: { ...createDefaultMetrics(), ...metrics } },
  }
}

function createBashToolCallEvent(
  metrics: Partial<TranscriptMetrics>,
  command: string,
  sessionId = 'test-session'
): TranscriptEvent {
  return {
    kind: 'transcript',
    eventType: 'ToolCall',
    context: { sessionId, timestamp: Date.now() },
    payload: { lineNumber: 1, entry: { input: { command } }, toolName: 'Bash' },
    metadata: { transcriptPath: '/test/transcript.jsonl', metrics: { ...createDefaultMetrics(), ...metrics } },
  }
}

function createBashToolResultEvent(
  metrics: Partial<TranscriptMetrics>,
  sessionId = 'test-session'
): TranscriptEvent {
  return {
    kind: 'transcript',
    eventType: 'ToolResult',
    context: { sessionId, timestamp: Date.now() },
    payload: { lineNumber: 1, entry: {}, toolName: 'Bash' },
    metadata: { transcriptPath: '/test/transcript.jsonl', metrics: { ...createDefaultMetrics(), ...metrics } },
  }
}

function createUserPromptSubmitEvent(sessionId = 'test-session'): UserPromptSubmitHookEvent {
  return {
    kind: 'hook',
    hook: 'UserPromptSubmit',
    context: { sessionId, timestamp: Date.now() },
    payload: { prompt: 'continue', transcriptPath: '/test/transcript.jsonl', cwd: '/mock/project', permissionMode: 'default' },
  }
}

function getStagedNames(staging: MockStagingService, hook = 'Stop'): string[] {
  return staging.getRemindersForHook(hook).map((r: StagedReminder) => r.name)
}

function getPerToolNames(staging: MockStagingService): string[] {
  const perToolSet = new Set<string>(VC_TOOL_REMINDER_IDS)
  return getStagedNames(staging).filter((n) => perToolSet.has(n))
}

function hasWrapper(staging: MockStagingService): boolean {
  return getStagedNames(staging).includes(ReminderIds.VERIFY_COMPLETION)
}

function snapshotStaging(staging: MockStagingService, label: string): void {
  const names = getStagedNames(staging)
  const perTool = getPerToolNames(staging)
  const wrapper = hasWrapper(staging)
  // eslint-disable-next-line no-console
  console.log(`  [${label}] staged=${names.length} | wrapper=${wrapper} | per-tool=[${perTool.join(',')}]`)
}

// ============================================================================
// Scenario A: stage-stop-bash-changes stages wrapper without per-tool children
// ============================================================================

describe('Orphaned VC wrapper — Scenario A: bash-changes stages wrapper independently', () => {
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
    mockGetGitFileStatus.mockClear()
    mockGetGitFileStatus.mockResolvedValue([])

    assets.registerAll({
      'reminders/verify-completion.yaml': 'id: verify-completion\nblocking: true\npriority: 51\npersistent: false\nadditionalContext: "Wrapper"\n',
      'reminders/vc-build.yaml': 'id: vc-build\nblocking: true\npriority: 50\npersistent: false\nadditionalContext: "Build needed"\n',
      'reminders/vc-typecheck.yaml': 'id: vc-typecheck\nblocking: true\npriority: 50\npersistent: false\nadditionalContext: "Typecheck needed"\n',
      'reminders/vc-test.yaml': 'id: vc-test\nblocking: true\npriority: 50\npersistent: false\nadditionalContext: "Test needed"\n',
      'reminders/vc-lint.yaml': 'id: vc-lint\nblocking: true\npriority: 50\npersistent: false\nadditionalContext: "Lint needed"\n',
    })

    ctx = createMockDaemonContext({ staging, logger, handlers, assets, stateService })
  })

  it('no longer orphans wrapper: bash-changes respects per-tool cooldown after verification', async () => {
    // Register both handlers
    registerTrackVerificationTools(ctx)
    registerStageBashChanges(ctx)

    const trackHandler = handlers.getHandler('reminders:track-verification-tools')!.handler
    const gitBaselineHandler = handlers.getHandler('reminders:git-baseline-capture')!.handler
    const bashChangesHandler = handlers.getHandler('reminders:stage-stop-bash-changes')!.handler

    // --- Step 1: Capture git baseline on UserPromptSubmit ---
    mockGetGitFileStatus.mockResolvedValue(['src/existing.ts'])
    await gitBaselineHandler(createUserPromptSubmitEvent(), ctx as any)
    snapshotStaging(staging, 'Step 1: After git baseline capture')
    expect(getStagedNames(staging)).toHaveLength(0)

    // --- Step 2: Agent edits a source file → per-tool + wrapper staged ---
    await trackHandler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts'),
      ctx as any
    )
    snapshotStaging(staging, 'Step 2: After file edit')
    expect(hasWrapper(staging)).toBe(true)
    expect(getPerToolNames(staging).length).toBeGreaterThan(0)

    // --- Step 3: Agent runs `pnpm build && pnpm typecheck && pnpm test && pnpm lint` → all verified ---
    await trackHandler(
      createBashToolCallEvent(
        { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
        'pnpm build && pnpm typecheck && pnpm test && pnpm lint'
      ),
      ctx as any
    )
    snapshotStaging(staging, 'Step 3: After all verification commands')
    expect(getPerToolNames(staging)).toHaveLength(0)
    expect(hasWrapper(staging)).toBe(false) // wrapper correctly removed

    // --- Step 4: Same bash command modified source files (git status changed) ---
    // stage-stop-bash-changes fires on ToolResult — now uses stageToolsForFiles
    // which respects cooldown: tools just verified, single file doesn't hit threshold
    mockGetGitFileStatus.mockResolvedValue(['src/existing.ts', 'src/generated-output.ts'])
    await bashChangesHandler(
      createBashToolResultEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }),
      ctx as any
    )
    snapshotStaging(staging, 'Step 4: After bash-changes detects new source file')

    // FIX: neither wrapper NOR per-tool staged — cooldown respected, no orphan possible
    expect(hasWrapper(staging)).toBe(false)
    expect(getPerToolNames(staging)).toHaveLength(0)
  })

  it('stages per-tool + wrapper when bash creates files before any verification', async () => {
    // Register both handlers
    registerTrackVerificationTools(ctx)
    registerStageBashChanges(ctx)

    const gitBaselineHandler = handlers.getHandler('reminders:git-baseline-capture')!.handler
    const bashChangesHandler = handlers.getHandler('reminders:stage-stop-bash-changes')!.handler

    // --- Step 1: Capture empty baseline ---
    mockGetGitFileStatus.mockResolvedValue([])
    await gitBaselineHandler(createUserPromptSubmitEvent(), ctx as any)

    // --- Step 2: Bash creates a source file (no prior verification) ---
    mockGetGitFileStatus.mockResolvedValue(['src/new-feature.ts'])
    await bashChangesHandler(
      createBashToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }),
      ctx as any
    )

    // FIX: wrapper staged WITH per-tool children — no orphan
    expect(hasWrapper(staging)).toBe(true)
    expect(getPerToolNames(staging).length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Scenario B: unstage-verify-completion re-stages wrapper without per-tool children
// ============================================================================

describe('Orphaned VC wrapper — Scenario B: unverified re-stage without per-tool children', () => {
  let ctx: DaemonContext
  let staging: MockStagingService
  let logger: MockLogger
  let handlers: MockHandlerRegistry
  let assets: MockAssetResolver
  let stateService: MockStateService
  const sessionId = 'test-session'

  beforeEach(() => {
    staging = new MockStagingService()
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()
    assets = new MockAssetResolver()
    stateService = new MockStateService()

    assets.registerAll({
      'reminders/verify-completion.yaml': 'id: verify-completion\nblocking: true\npriority: 51\npersistent: false\nadditionalContext: "Wrapper"\n',
      'reminders/vc-build.yaml': 'id: vc-build\nblocking: true\npriority: 50\npersistent: false\nadditionalContext: "Build needed"\n',
      'reminders/vc-typecheck.yaml': 'id: vc-typecheck\nblocking: true\npriority: 50\npersistent: false\nadditionalContext: "Typecheck needed"\n',
      'reminders/vc-test.yaml': 'id: vc-test\nblocking: true\npriority: 50\npersistent: false\nadditionalContext: "Test needed"\n',
      'reminders/vc-lint.yaml': 'id: vc-lint\nblocking: true\npriority: 50\npersistent: false\nadditionalContext: "Lint needed"\n',
    })

    ctx = createMockDaemonContext({ staging, logger, handlers, assets, stateService })
  })

  it('reproduces orphaned wrapper: vc-unverified re-stages wrapper but not per-tool reminders', async () => {
    registerTrackVerificationTools(ctx)
    registerUnstageVerifyCompletion(ctx)

    const trackHandler = handlers.getHandler('reminders:track-verification-tools')!.handler
    const unstageHandler = handlers.getHandler('reminders:unstage-verify-completion')!.handler

    // --- Step 1: Agent edits file → all per-tool + wrapper staged ---
    await trackHandler(
      createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts'),
      ctx as any
    )
    snapshotStaging(staging, 'Step 1: After file edit')
    expect(hasWrapper(staging)).toBe(true)
    expect(getPerToolNames(staging).length).toBeGreaterThan(0)

    // --- Step 2: Agent verifies all tools ---
    await trackHandler(
      createBashToolCallEvent(
        { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
        'pnpm build && pnpm typecheck && pnpm test && pnpm lint'
      ),
      ctx as any
    )
    snapshotStaging(staging, 'Step 2: After all verified')
    expect(hasWrapper(staging)).toBe(false)
    expect(getPerToolNames(staging)).toHaveLength(0)

    // --- Step 3: Simulate that wrapper was staged by stage-stop-bash-changes ---
    // (In real flow, bash-changes would stage it; here we manually stage to isolate scenario B)
    await staging.stageReminder('Stop', ReminderIds.VERIFY_COMPLETION, {
      name: ReminderIds.VERIFY_COMPLETION,
      blocking: true,
      priority: 51,
      persistent: false,
      stagedAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
    })
    snapshotStaging(staging, 'Step 3: Wrapper manually staged (simulating bash-changes)')

    // --- Step 4: Stop hook fires, classifier returns non-blocking ---
    // Simulate: inject-stop sets vc-unverified state (normally done via IPC)
    const vcUnverifiedPath = stateService.sessionStatePath(sessionId, 'vc-unverified.json')
    stateService.setStored(vcUnverifiedPath, {
      hasUnverifiedChanges: true,
      cycleCount: 1,
      setAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
      lastClassification: { category: 'OTHER', confidence: 0.4 },
    })

    // Delete wrapper (simulates what happens after stop hook consumption)
    await staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)
    snapshotStaging(staging, 'Step 4: After stop hook consumes wrapper')

    // --- Step 5: User submits new prompt → unstage-verify-completion fires ---
    // With vc-unverified state, it should RE-STAGE the wrapper
    await unstageHandler(createUserPromptSubmitEvent(), ctx as any)
    snapshotStaging(staging, 'Step 5: After UserPromptSubmit with vc-unverified')

    // FIX: wrapper is NOT re-staged because all tools are verified
    expect(hasWrapper(staging)).toBe(false)
    expect(getPerToolNames(staging)).toHaveLength(0)
  })
})
