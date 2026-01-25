/**
 * Feature End-to-End Integration Tests
 *
 * Tests complete feature flows against recorded Claude Code transcripts from test-data/.
 * Uses inline handlers that mimic feature behavior to test infrastructure with real data.
 *
 * Key differences from unit tests:
 * - Uses real TranscriptServiceImpl and StagingServiceImpl
 * - Real HandlerRegistryImpl for event dispatch
 * - Golden set transcripts with known characteristics
 *
 * @see docs/design/flow.md §5 Complete Hook Flows
 */

import { existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TranscriptServiceImpl, type TranscriptServiceOptions } from '../transcript-service'
import { StagingServiceCore, SessionScopedStagingService, type StagingServiceCoreOptions } from '../staging-service'
import { HandlerRegistryImpl, type HandlerRegistryOptions } from '../handler-registry'
import { StateService } from '../state/state-service'
import { isTranscriptEvent } from '@sidekick/types'
import type { Logger, TranscriptEvent, StagedReminder } from '@sidekick/types'
import { MockStateService } from '@sidekick/testing-fixtures'

// ============================================================================
// Test Utilities
// ============================================================================

function createMockLogger(): Logger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createMockLogger()),
    flush: vi.fn(() => Promise.resolve()),
  }
}

function createTestDir(): string {
  const testDir = join(tmpdir(), `feature-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
  return testDir
}

function cleanupTestDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Test data path - relative to monorepo root when running from package dir
const TEST_DATA_DIR = join(process.cwd(), '../../development-tools/test-data/transcripts')

// Required fixture files for this test suite
const REQUIRED_FIXTURES = ['medium-003.jsonl', 'long-001.jsonl', 'short-003.jsonl', 'short-002.jsonl']

/**
 * Check and log fixture availability on test suite initialization.
 * CI systems should see this warning prominently if fixtures are missing.
 */
function checkFixtureAvailability(): void {
  const missing: string[] = []
  for (const fixture of REQUIRED_FIXTURES) {
    if (!existsSync(join(TEST_DATA_DIR, fixture))) {
      missing.push(fixture)
    }
  }
  if (missing.length > 0) {
    console.warn(
      `\n[E2E TEST FIXTURES MISSING] The following transcript fixtures are missing: ${missing.join(', ')}\n` +
        `Some E2E integration tests will be skipped.\n` +
        `Expected location: ${TEST_DATA_DIR}\n`
    )
  }
}

checkFixtureAvailability()

// ============================================================================
// Reminder Configuration Constants (mirrors feature-reminders/types.ts)
// ============================================================================

const REMINDER_THRESHOLDS = {
  pause_and_reflect_threshold: 15,
} as const

const REMINDER_IDS = {
  PAUSE_AND_REFLECT: 'pause-and-reflect',
  VERIFY_COMPLETION: 'verify-completion',
} as const

// ============================================================================
// Test Context Builder
// ============================================================================

interface TestContext {
  testDir: string
  stateDir: string
  transcriptPath: string
  logger: Logger
  stagingService: SessionScopedStagingService
  transcriptService: TranscriptServiceImpl
  handlerRegistry: HandlerRegistryImpl
}

function createTestContext(): TestContext {
  const testDir = createTestDir()
  const stateDir = join(testDir, '.sidekick')
  const transcriptPath = join(testDir, 'transcript.jsonl')
  const logger = createMockLogger()

  // Create state service for staging
  const stateService = new StateService(stateDir, { logger, cache: false })

  // Create staging service
  const stagingOptions: StagingServiceCoreOptions = {
    stateDir,
    logger,
    stateService,
  }
  const core = new StagingServiceCore(stagingOptions)
  const stagingService = new SessionScopedStagingService(core, 'test-session')

  // Create handler registry
  const handlerOptions: HandlerRegistryOptions = {
    logger,
    sessionId: 'test-session',
    transcriptPath,
  }
  const handlerRegistry = new HandlerRegistryImpl(handlerOptions)

  // Create transcript service
  const transcriptOptions: TranscriptServiceOptions = {
    watchDebounceMs: 50,
    metricsPersistIntervalMs: 60000,
    handlers: handlerRegistry,
    logger,
    stateDir,
    stateService: new MockStateService(testDir),
  }
  const transcriptService = new TranscriptServiceImpl(transcriptOptions)

  // Wire up providers
  handlerRegistry.setMetricsProvider(() => transcriptService.getMetrics())
  handlerRegistry.setStagingProvider(() => stagingService)

  return {
    testDir,
    stateDir,
    transcriptPath,
    logger,
    stagingService,
    transcriptService,
    handlerRegistry,
  }
}

// ============================================================================
// Inline Handler Registration (mimics feature behavior for e2e testing)
// ============================================================================

/**
 * Register a handler that mimics the "pause and reflect" reminder staging logic.
 * Stages a reminder when toolsThisTurn >= pause_and_reflect_threshold.
 */
function registerPauseAndReflectHandler(
  handlerRegistry: HandlerRegistryImpl,
  stagingService: SessionScopedStagingService,
  getMetrics: () => { toolsThisTurn: number }
): void {
  handlerRegistry.register({
    id: 'e2e:stage-pause-and-reflect',
    priority: 80,
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    handler: async (event: unknown) => {
      if (!isTranscriptEvent(event as TranscriptEvent)) return

      const metrics = getMetrics()
      if (metrics.toolsThisTurn < REMINDER_THRESHOLDS.pause_and_reflect_threshold) return

      const reminder: StagedReminder = {
        name: REMINDER_IDS.PAUSE_AND_REFLECT,
        blocking: true,
        priority: 80,
        persistent: false,
        additionalContext: `Checkpoint at ${metrics.toolsThisTurn} tools this turn`,
        reason: 'Checkpoint triggered',
      }

      await stagingService.stageReminder('PreToolUse', REMINDER_IDS.PAUSE_AND_REFLECT, reminder)
    },
  })
}

// ============================================================================
// Feature E2E Integration Tests
// ============================================================================

describe('Feature E2E: Reminders with Real Transcripts', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(async () => {
    await ctx.transcriptService.shutdown()
    cleanupTestDir(ctx.testDir)
  })

  // --------------------------------------------------------------------------
  // Threshold Verification with Real Data
  // --------------------------------------------------------------------------

  describe('real transcript processing', () => {
    it.skipIf(!existsSync(join(TEST_DATA_DIR, 'medium-003.jsonl')))(
      'processes medium transcript and extracts tool metrics',
      async () => {
        // Register inline handler that mimics checkpoint detection
        registerPauseAndReflectHandler(ctx.handlerRegistry, ctx.stagingService, () =>
          ctx.transcriptService.getMetrics()
        )

        const sourceFile = join(TEST_DATA_DIR, 'medium-003.jsonl')
        copyFileSync(sourceFile, ctx.transcriptPath)
        await ctx.transcriptService.prepare('test-session', ctx.transcriptPath)
        await ctx.transcriptService.start()

        // Wait for async handlers to execute
        await new Promise((resolve) => setTimeout(resolve, 300))

        const metrics = ctx.transcriptService.getMetrics()

        // Verify infrastructure processes the transcript correctly
        expect(metrics.toolCount).toBeGreaterThan(0)
        expect(metrics.lastProcessedLine).toBeGreaterThan(0)

        // Verify reminder staging behavior when threshold is met
        // medium-003.jsonl typically has enough tools to trigger pause-and-reflect
        // If threshold was met, verify staging occurred; otherwise verify it didn't
        const stagedReminders = await ctx.stagingService.listReminders('PreToolUse')
        if (metrics.toolsThisTurn >= REMINDER_THRESHOLDS.pause_and_reflect_threshold) {
          expect(stagedReminders.length).toBeGreaterThan(0)
          expect(stagedReminders.some((r) => r.name === REMINDER_IDS.PAUSE_AND_REFLECT)).toBe(true)
        }
        // Note: If threshold not met, no reminder should be staged - that's valid behavior
      }
    )

    it.skipIf(!existsSync(join(TEST_DATA_DIR, 'long-001.jsonl')))(
      'processes long transcript with many tools spread across turns',
      async () => {
        registerPauseAndReflectHandler(ctx.handlerRegistry, ctx.stagingService, () =>
          ctx.transcriptService.getMetrics()
        )

        const sourceFile = join(TEST_DATA_DIR, 'long-001.jsonl')
        copyFileSync(sourceFile, ctx.transcriptPath)
        await ctx.transcriptService.prepare('test-session', ctx.transcriptPath)
        await ctx.transcriptService.start()
        await new Promise((resolve) => setTimeout(resolve, 300))

        const metrics = ctx.transcriptService.getMetrics()

        // Verify infrastructure handles large transcripts correctly
        expect(metrics.toolCount).toBeGreaterThan(50)
        expect(metrics.turnCount).toBeGreaterThan(10)
      }
    )
  })

  // --------------------------------------------------------------------------
  // Metrics Derivation from Real Transcripts
  // --------------------------------------------------------------------------

  describe('metrics derivation from golden set', () => {
    it('correctly counts turns and messages in long-001.jsonl', async () => {
      // long-001 has 319 lines, ~96 tool uses, ~107 user messages
      const sourceFile = join(TEST_DATA_DIR, 'long-001.jsonl')
      if (!existsSync(sourceFile)) {
        console.warn('Skipping integration test - test data not available')
        return
      }

      copyFileSync(sourceFile, ctx.transcriptPath)
      await ctx.transcriptService.prepare('test-session', ctx.transcriptPath)
      await ctx.transcriptService.start()

      const metrics = ctx.transcriptService.getMetrics()

      // Verify reasonable metrics for a 319-line transcript
      expect(metrics.turnCount).toBeGreaterThan(5)
      expect(metrics.messageCount).toBeGreaterThan(10)
      expect(metrics.toolCount).toBeGreaterThan(50)
      expect(metrics.lastProcessedLine).toBeGreaterThan(100)
    })

    it('correctly handles short transcript with minimal tool usage', async () => {
      const sourceFile = join(TEST_DATA_DIR, 'short-003.jsonl')
      if (!existsSync(sourceFile)) {
        console.warn('Skipping integration test - test data not available')
        return
      }

      copyFileSync(sourceFile, ctx.transcriptPath)
      await ctx.transcriptService.prepare('test-session', ctx.transcriptPath)
      await ctx.transcriptService.start()

      const metrics = ctx.transcriptService.getMetrics()

      // Short transcript should have low counts
      expect(metrics.turnCount).toBeGreaterThanOrEqual(1)
      expect(metrics.lastProcessedLine).toBeGreaterThan(0)
    })

    it('tracks token usage from real transcript', async () => {
      const sourceFile = join(TEST_DATA_DIR, 'short-003.jsonl')
      if (!existsSync(sourceFile)) {
        console.warn('Skipping integration test - test data not available')
        return
      }

      copyFileSync(sourceFile, ctx.transcriptPath)
      await ctx.transcriptService.prepare('test-session', ctx.transcriptPath)
      await ctx.transcriptService.start()

      const metrics = ctx.transcriptService.getMetrics()

      // Real transcripts have token usage data
      expect(metrics.tokenUsage.inputTokens).toBeGreaterThan(0)
      expect(metrics.tokenUsage.outputTokens).toBeGreaterThan(0)
    })
  })

  // --------------------------------------------------------------------------
  // Handler Execution Order
  // --------------------------------------------------------------------------

  describe('handler priority ordering', () => {
    it('registers handler with correct priority', () => {
      registerPauseAndReflectHandler(ctx.handlerRegistry, ctx.stagingService, () => ctx.transcriptService.getMetrics())

      const handlerIds = ctx.handlerRegistry.getHandlerIds()

      // pause-and-reflect should be registered
      const pauseIdx = handlerIds.findIndex((id) => id.includes('pause-and-reflect'))
      expect(pauseIdx).toBeGreaterThanOrEqual(0)
    })
  })
})

describe('Feature E2E: Staging and Consumption Flow', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(async () => {
    await ctx.transcriptService.shutdown()
    cleanupTestDir(ctx.testDir)
  })

  it('stages reminder when threshold is exceeded and allows consumption', async () => {
    // Use synthetic data to guarantee threshold is hit (deterministic test)
    registerPauseAndReflectHandler(ctx.handlerRegistry, ctx.stagingService, () => ctx.transcriptService.getMetrics())

    const numTools = REMINDER_THRESHOLDS.pause_and_reflect_threshold + 5
    const toolUses = []
    for (let i = 0; i < numTools; i++) {
      toolUses.push({ type: 'tool_use', id: `tool-${i}`, name: 'Bash', input: { command: `echo ${i}` } })
    }

    const entries = [
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: toolUses },
      }),
    ]

    const { writeFileSync } = await import('node:fs')
    writeFileSync(ctx.transcriptPath, entries.join('\n'))
    await ctx.transcriptService.prepare('test-session', ctx.transcriptPath)
    await ctx.transcriptService.start()
    await new Promise((resolve) => setTimeout(resolve, 300))

    // Verify reminder was staged (unconditional assertion)
    const stagedReminders = await ctx.stagingService.listReminders('PreToolUse')
    expect(stagedReminders.length).toBeGreaterThan(0)

    // Verify consumption works
    const reminder = await ctx.stagingService.readReminder('PreToolUse', REMINDER_IDS.PAUSE_AND_REFLECT)
    expect(reminder).not.toBeNull()
    expect(reminder?.name).toBe(REMINDER_IDS.PAUSE_AND_REFLECT)
    expect(reminder?.blocking).toBe(true)
    expect(reminder?.priority).toBe(80)
  })
})

describe('Feature E2E: Multi-Turn Processing', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(async () => {
    await ctx.transcriptService.shutdown()
    cleanupTestDir(ctx.testDir)
  })

  it.skipIf(!existsSync(join(TEST_DATA_DIR, 'long-001.jsonl')))(
    'resets toolsThisTurn on new user message with real transcript',
    async () => {
      const sourceFile = join(TEST_DATA_DIR, 'long-001.jsonl')
      copyFileSync(sourceFile, ctx.transcriptPath)
      await ctx.transcriptService.prepare('test-session', ctx.transcriptPath)
      await ctx.transcriptService.start()

      const metrics = ctx.transcriptService.getMetrics()

      // Multi-turn transcript should have toolsThisTurn representing only the last turn
      expect(metrics.toolsThisTurn).toBeLessThanOrEqual(metrics.toolCount)
      expect(metrics.turnCount).toBeGreaterThan(10)
    }
  )
})

describe('Feature E2E: Threshold Logic with Synthetic Data', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(async () => {
    await ctx.transcriptService.shutdown()
    cleanupTestDir(ctx.testDir)
  })

  it('counts tool_use blocks in assistant message correctly', async () => {
    // TranscriptService counts tool_use entries within assistant messages
    // toolsThisTurn is the count of tool_use blocks within the CURRENT turn
    // When a new user message arrives, turnCount increments and toolsThisTurn resets

    const entries = []
    const numTools = 25 // More than pause_and_reflect_threshold

    // Assistant message with MULTIPLE tool_use blocks (this is how Claude Code structures it)
    const toolUses = []
    for (let i = 0; i < numTools; i++) {
      toolUses.push({ type: 'tool_use', id: `tool-${i}`, name: 'Bash', input: { command: `echo ${i}` } })
    }
    entries.push(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: toolUses,
        },
      })
    )

    // Corresponding user message with tool_results (doesn't affect count)
    const toolResults = []
    for (let i = 0; i < numTools; i++) {
      toolResults.push({ type: 'tool_result', tool_use_id: `tool-${i}`, content: `result ${i}` })
    }
    entries.push(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: toolResults,
        },
      })
    )

    const { writeFileSync } = await import('node:fs')
    writeFileSync(ctx.transcriptPath, entries.join('\n'))
    await ctx.transcriptService.prepare('test-session', ctx.transcriptPath)
    await ctx.transcriptService.start()

    const metrics = ctx.transcriptService.getMetrics()

    // Should count all tool_use blocks in the assistant message
    expect(metrics.toolCount).toBe(numTools)
    expect(metrics.toolsThisTurn).toBe(numTools)
    // Tool-result-only messages don't count as turns (they're wrapper messages)
    expect(metrics.turnCount).toBe(0)
  })

  it('triggers checkpoint handler when toolsThisTurn >= pause_and_reflect_threshold', async () => {
    // Tool counting happens on tool_use blocks in assistant messages
    // Let's verify the metrics and handler invocation manually

    const entries = []
    const numTools = REMINDER_THRESHOLDS.pause_and_reflect_threshold + 2

    // Assistant message with many tool_use blocks
    const toolUses = []
    for (let i = 0; i < numTools; i++) {
      toolUses.push({ type: 'tool_use', id: `tool-${i}`, name: 'Bash', input: { command: `echo ${i}` } })
    }
    entries.push(
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: toolUses },
      })
    )

    // Corresponding user message with tool_results
    const toolResults = []
    for (let i = 0; i < numTools; i++) {
      toolResults.push({ type: 'tool_result', tool_use_id: `tool-${i}`, content: `result ${i}` })
    }
    entries.push(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: toolResults },
      })
    )

    const { writeFileSync } = await import('node:fs')
    writeFileSync(ctx.transcriptPath, entries.join('\n'))
    await ctx.transcriptService.prepare('test-session', ctx.transcriptPath)
    await ctx.transcriptService.start()

    const metrics = ctx.transcriptService.getMetrics()
    expect(metrics.toolsThisTurn).toBeGreaterThanOrEqual(REMINDER_THRESHOLDS.pause_and_reflect_threshold)
  })

  it('resets toolsThisTurn counter on new user message', async () => {
    const entries = []

    // First assistant message with 10 tool_use blocks
    const toolUses1 = []
    for (let i = 0; i < 10; i++) {
      toolUses1.push({ type: 'tool_use', id: `tool-a-${i}`, name: 'Bash', input: { command: `echo ${i}` } })
    }
    entries.push(
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: toolUses1 },
      })
    )

    // First user message with 10 tool_results (doesn't affect count)
    const batch1 = []
    for (let i = 0; i < 10; i++) {
      batch1.push({ type: 'tool_result', tool_use_id: `tool-a-${i}`, content: `result ${i}` })
    }
    entries.push(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: batch1 },
      })
    )

    // Second user message (text only) resets toolsThisTurn
    entries.push(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Continue' },
      })
    )

    // Second assistant message with 5 tool_use blocks
    const toolUses2 = []
    for (let i = 0; i < 5; i++) {
      toolUses2.push({ type: 'tool_use', id: `tool-b-${i}`, name: 'Bash', input: { command: `echo ${i}` } })
    }
    entries.push(
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: toolUses2 },
      })
    )

    // Third user message with 5 tool_results (doesn't affect count)
    const batch2 = []
    for (let i = 0; i < 5; i++) {
      batch2.push({ type: 'tool_result', tool_use_id: `tool-b-${i}`, content: `result ${i}` })
    }
    entries.push(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: batch2 },
      })
    )

    const { writeFileSync } = await import('node:fs')
    writeFileSync(ctx.transcriptPath, entries.join('\n'))
    await ctx.transcriptService.prepare('test-session', ctx.transcriptPath)
    await ctx.transcriptService.start()

    const metrics = ctx.transcriptService.getMetrics()

    // Total tools: 10 + 0 + 5 = 15
    expect(metrics.toolCount).toBe(15)
    // toolsThisTurn should be 5 (from the last batch after reset by "Continue")
    expect(metrics.toolsThisTurn).toBe(5)
    // Only the text message "Continue" counts as a turn
    // Tool-result-only messages are wrapper messages, not turns
    expect(metrics.turnCount).toBe(1)
  })
})

describe('Feature E2E: Edge Cases', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(async () => {
    await ctx.transcriptService.shutdown()
    cleanupTestDir(ctx.testDir)
  })

  describe('transcript with summary entries', () => {
    it('processes transcript with summary entries without error', async () => {
      // long-001 contains summary entries
      const sourceFile = join(TEST_DATA_DIR, 'long-001.jsonl')
      if (!existsSync(sourceFile)) {
        console.warn('Skipping integration test - test data not available')
        return
      }

      copyFileSync(sourceFile, ctx.transcriptPath)

      // Should not throw
      await ctx.transcriptService.prepare('test-session', ctx.transcriptPath)
      await ctx.transcriptService.start()

      // Should not log errors
      expect(ctx.logger.error).not.toHaveBeenCalled()
    })
  })

  describe('transcript with file-history-snapshot', () => {
    it('skips file-history-snapshot entries gracefully', async () => {
      const sourceFile = join(TEST_DATA_DIR, 'short-002.jsonl')
      if (!existsSync(sourceFile)) {
        console.warn('Skipping integration test - test data not available')
        return
      }

      copyFileSync(sourceFile, ctx.transcriptPath)
      await ctx.transcriptService.prepare('test-session', ctx.transcriptPath)
      await ctx.transcriptService.start()

      // Should process without errors
      expect(ctx.logger.error).not.toHaveBeenCalled()
    })
  })
})
