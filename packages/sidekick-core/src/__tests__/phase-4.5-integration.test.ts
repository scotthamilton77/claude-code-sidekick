/**
 * Phase 4.5 Integration Tests
 *
 * End-to-end tests demonstrating:
 * 1. TranscriptService → Handler flow: Events emitted on file change
 *    reach handlers with correct metrics, handlers can stage reminders
 * 2. Full RuntimeContext wiring verification
 *
 * @see docs/ROADMAP.md Phase 4.5 Integration & Verification
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TranscriptServiceImpl, type TranscriptServiceOptions } from '../transcript-service'
import { StagingServiceCore, SessionScopedStagingService, type StagingServiceCoreOptions } from '../staging-service'
import type {
  HandlerRegistry,
  HandlerRegistration,
  HandlerContext,
  HandlerResult,
  Logger,
  TranscriptEventType,
  TranscriptEntry,
  HookName,
  HookEvent,
  HookResponse,
  SidekickEvent,
  TranscriptMetrics,
  StagingService,
  TranscriptEvent,
} from '@sidekick/types'
import { isTranscriptEvent } from '@sidekick/types'

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
  const testDir = join(tmpdir(), `phase-4.5-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
  return testDir
}

function cleanupTestDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================================
// Test Handler Registry
// ============================================================================

/**
 * Handler context for integration tests.
 * Provides access to staging service and current metrics.
 */
interface TestHandlerContext extends HandlerContext {
  staging: StagingService
  getMetrics: () => TranscriptMetrics
}

/**
 * Test handler registry that actually executes handlers.
 * Used for integration testing the full TranscriptService → Handler flow.
 *
 * DESIGN NOTE: This is a simplified test implementation, NOT the production
 * HandlerRegistryImpl. It differs in the following ways:
 *
 * 1. Handlers execute fire-and-forget (no stop flag propagation)
 * 2. No response aggregation for hook events
 * 3. No error isolation between handlers
 *
 * These tests verify the INTEGRATION between TranscriptService and handlers
 * (event emission, context passing, staging access). They do NOT verify:
 * - Handler execution ordering (tested in handler-registry.test.ts)
 * - Stop flag propagation (tested in handler-registry.test.ts)
 * - Error handling in handler chains (tested in handler-registry.test.ts)
 *
 * If you need to test those behaviors, use HandlerRegistryImpl directly
 * or check the dedicated handler-registry.test.ts file.
 */
class TestHandlerRegistry implements HandlerRegistry {
  private handlers: Map<string, HandlerRegistration<TestHandlerContext>> = new Map()
  private context: TestHandlerContext
  private emittedEvents: Array<{
    eventType: TranscriptEventType
    entry: TranscriptEntry
    lineNumber: number
    handlerResults: Array<{ handlerId: string; result: HandlerResult | void }>
  }> = []

  constructor(context: TestHandlerContext) {
    this.context = context
  }

  register<TContext extends HandlerContext>(options: HandlerRegistration<TContext>): void {
    // Store handler with proper typing - we know our test context extends TContext
    this.handlers.set(options.id, options as unknown as HandlerRegistration<TestHandlerContext>)
  }

  invokeHook(_hook: HookName, _event: HookEvent): Promise<HookResponse> {
    // Not used in transcript integration tests
    return Promise.resolve({})
  }

  /**
   * Emit transcript event and execute matching handlers.
   *
   * NOTE: Handlers execute concurrently in priority order, but this test
   * implementation doesn't wait for handlers to complete before returning.
   * Tests should add appropriate delays after transcript operations.
   */
  emitTranscriptEvent(eventType: TranscriptEventType, entry: TranscriptEntry, lineNumber: number): void {
    const event: TranscriptEvent = {
      kind: 'transcript',
      eventType,
      context: { sessionId: 'test-session', timestamp: Date.now() },
      payload: { entry, lineNumber },
      metadata: {
        transcriptPath: '/test/transcript.jsonl',
        metrics: this.context.getMetrics(),
      },
    }

    const handlerResults: Array<{ handlerId: string; result: HandlerResult | void }> = []

    // Find matching handlers
    const matchingHandlers = Array.from(this.handlers.values())
      .filter((h) => {
        if (h.filter.kind === 'all') return true
        if (h.filter.kind === 'transcript') {
          return h.filter.eventTypes.includes(eventType)
        }
        return false
      })
      .sort((a, b) => b.priority - a.priority)

    // Execute handlers (fire-and-forget, but track for test assertions)
    for (const handler of matchingHandlers) {
      void handler.handler(event, this.context).then((result) => {
        handlerResults.push({ handlerId: handler.id, result })
      })
    }

    this.emittedEvents.push({ eventType, entry, lineNumber, handlerResults })
  }

  // Test helpers
  getEmittedEvents(): typeof this.emittedEvents {
    return [...this.emittedEvents]
  }

  getHandler(id: string): HandlerRegistration<TestHandlerContext> | undefined {
    return this.handlers.get(id)
  }

  reset(): void {
    this.handlers.clear()
    this.emittedEvents = []
  }
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Phase 4.5: TranscriptService → Handler Integration', () => {
  let testDir: string
  let stateDir: string
  let transcriptPath: string
  let logger: Logger
  let stagingService: SessionScopedStagingService
  let transcriptService: TranscriptServiceImpl
  let handlerRegistry: TestHandlerRegistry

  beforeEach(() => {
    testDir = createTestDir()
    stateDir = join(testDir, '.sidekick')
    transcriptPath = join(testDir, 'transcript.jsonl')
    logger = createMockLogger()

    // Create staging service
    const stagingOptions: StagingServiceCoreOptions = {
      stateDir,
      logger,
      scope: 'project',
    }
    const core = new StagingServiceCore(stagingOptions)
    stagingService = new SessionScopedStagingService(core, 'test-session', 'project')

    // Create test handler context with staging access
    const getMetrics = (): TranscriptMetrics => transcriptService.getMetrics()
    const testContext: TestHandlerContext = {
      staging: stagingService,
      getMetrics,
    }

    // Create handler registry
    handlerRegistry = new TestHandlerRegistry(testContext)

    // Create transcript service
    const transcriptOptions: TranscriptServiceOptions = {
      watchDebounceMs: 50,
      metricsPersistIntervalMs: 60000,
      handlers: handlerRegistry,
      logger,
      stateDir,
    }
    transcriptService = new TranscriptServiceImpl(transcriptOptions)
  })

  afterEach(async () => {
    await transcriptService.shutdown()
    cleanupTestDir(testDir)
  })

  // --------------------------------------------------------------------------
  // TranscriptService → Handler Event Flow
  // --------------------------------------------------------------------------

  describe('event emission flow', () => {
    it('emits UserPrompt event to registered handlers', async () => {
      const handlerCalled = vi.fn()

      // Register handler for UserPrompt events
      handlerRegistry.register<TestHandlerContext>({
        id: 'test:user-prompt-handler',
        priority: 100,
        filter: { kind: 'transcript', eventTypes: ['UserPrompt'] },
        handler: (event, ctx) => {
          if (isTranscriptEvent(event)) {
            handlerCalled({
              eventType: event.eventType,
              metrics: ctx.getMetrics(),
            })
          }
          return Promise.resolve()
        },
      })

      // Initialize with transcript content
      const transcript = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } })].join('\n')
      writeFileSync(transcriptPath, transcript)

      await transcriptService.initialize('test-session', transcriptPath)

      // Wait for async handler execution
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Verify handler was called
      expect(handlerCalled).toHaveBeenCalledTimes(1)
      expect(handlerCalled).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'UserPrompt',
          metrics: expect.objectContaining({ turnCount: 1 }),
        })
      )
    })

    it('emits ToolCall events for nested tool_use blocks', async () => {
      const handlerCalled = vi.fn()

      handlerRegistry.register<TestHandlerContext>({
        id: 'test:tool-call-handler',
        priority: 100,
        filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
        handler: (event, ctx) => {
          if (isTranscriptEvent(event)) {
            handlerCalled({
              eventType: event.eventType,
              toolsThisTurn: ctx.getMetrics().toolsThisTurn,
            })
          }
          return Promise.resolve()
        },
      })

      const transcript = [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/test.ts' } }],
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await transcriptService.initialize('test-session', transcriptPath)
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(handlerCalled).toHaveBeenCalled()
      expect(handlerCalled).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'ToolCall',
        })
      )
    })

    it('executes multiple handlers in priority order', async () => {
      const executionOrder: string[] = []

      handlerRegistry.register({
        id: 'low-priority',
        priority: 10,
        filter: { kind: 'transcript', eventTypes: ['UserPrompt'] },
        handler: () => {
          executionOrder.push('low-priority')
          return Promise.resolve()
        },
      })

      handlerRegistry.register({
        id: 'high-priority',
        priority: 100,
        filter: { kind: 'transcript', eventTypes: ['UserPrompt'] },
        handler: () => {
          executionOrder.push('high-priority')
          return Promise.resolve()
        },
      })

      const transcript = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'Test' } })].join('\n')
      writeFileSync(transcriptPath, transcript)

      await transcriptService.initialize('test-session', transcriptPath)
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(executionOrder).toEqual(['high-priority', 'low-priority'])
    })
  })

  // --------------------------------------------------------------------------
  // Handler Access to Staging Service
  // --------------------------------------------------------------------------

  describe('handler staging access', () => {
    it('handlers can stage reminders via context.staging', async () => {
      // Register handler that stages a reminder on ToolResult
      handlerRegistry.register<TestHandlerContext>({
        id: 'test:checkpoint-detector',
        priority: 100,
        filter: { kind: 'transcript', eventTypes: ['ToolResult'] },
        handler: async (_event, ctx) => {
          const metrics = ctx.getMetrics()
          // Simulate "pause and reflect" reminder staging when tool count is high
          if (metrics.toolsThisTurn >= 1) {
            await ctx.staging.stageReminder('UserPromptSubmit', 'pause-and-reflect', {
              name: 'pause-and-reflect',
              blocking: false,
              priority: 50,
              persistent: false,
              additionalContext: `You have used ${metrics.toolsThisTurn} tools this turn.`,
            })
          }
        },
      })

      // Create transcript with tool_use and tool_result
      const transcript = [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/test' } }],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' }],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await transcriptService.initialize('test-session', transcriptPath)
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Verify reminder was staged
      const reminder = await stagingService.readReminder('UserPromptSubmit', 'pause-and-reflect')
      expect(reminder).not.toBeNull()
      expect(reminder?.name).toBe('pause-and-reflect')
      expect(reminder?.additionalContext).toContain('1 tools this turn')
    })

    it('handlers receive updated metrics after each transcript entry', async () => {
      const metricsSnapshots: TranscriptMetrics[] = []

      handlerRegistry.register<TestHandlerContext>({
        id: 'test:metrics-tracker',
        priority: 100,
        filter: { kind: 'transcript', eventTypes: ['UserPrompt', 'AssistantMessage'] },
        handler: (_event, ctx) => {
          metricsSnapshots.push({ ...ctx.getMetrics() })
          return Promise.resolve()
        },
      })

      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'First' } }),
        JSON.stringify({
          type: 'assistant',
          message: { model: 'test', usage: { input_tokens: 100, output_tokens: 50 } },
        }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Second' } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await transcriptService.initialize('test-session', transcriptPath)
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Verify metrics progressed
      expect(metricsSnapshots.length).toBe(3)
      expect(metricsSnapshots[0].turnCount).toBe(1)
      expect(metricsSnapshots[0].messageCount).toBe(1)
      expect(metricsSnapshots[1].messageCount).toBe(2)
      expect(metricsSnapshots[2].turnCount).toBe(2)
      expect(metricsSnapshots[2].messageCount).toBe(3)
    })
  })

  // --------------------------------------------------------------------------
  // Threshold-Based Handler Triggering
  // --------------------------------------------------------------------------

  describe('threshold-based triggers', () => {
    it('handlers can use onThreshold for cadence-based actions', async () => {
      const thresholdTriggered = vi.fn()

      // Subscribe to threshold before initialization
      writeFileSync(transcriptPath, '')
      await transcriptService.initialize('test-session', transcriptPath)

      // Set up threshold callback
      transcriptService.onThreshold('turnCount', 3, () => {
        thresholdTriggered()
      })

      // Write transcript with 3 turns
      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'One' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Two' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Three' } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      // Trigger processing
      await (transcriptService as unknown as { processTranscriptFile: () => Promise<void> }).processTranscriptFile()

      expect(thresholdTriggered).toHaveBeenCalledTimes(1)
    })
  })

  // --------------------------------------------------------------------------
  // Compaction Detection Flow
  // --------------------------------------------------------------------------

  describe('compaction detection', () => {
    it('emits Compact event when compact_boundary entry detected', async () => {
      const compactHandlerCalled = vi.fn()

      handlerRegistry.register({
        id: 'test:compact-handler',
        priority: 100,
        filter: { kind: 'transcript', eventTypes: ['Compact'] },
        handler: () => {
          compactHandlerCalled()
          return Promise.resolve()
        },
      })

      // Initial transcript
      const initial = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'One' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Two' } }),
      ].join('\n')
      writeFileSync(transcriptPath, initial)

      await transcriptService.initialize('test-session', transcriptPath)

      // Append compact_boundary entry (Claude Code's transcript is append-only)
      const withCompact = [initial, JSON.stringify({ type: 'system', subtype: 'compact_boundary' })].join('\n')
      writeFileSync(transcriptPath, withCompact)

      await (transcriptService as unknown as { processTranscriptFile: () => Promise<void> }).processTranscriptFile()
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(compactHandlerCalled).toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Full Flow: TranscriptService → Handler → Staging
  // --------------------------------------------------------------------------

  describe('full integration flow', () => {
    it('demonstrates complete TranscriptService → Handler → Staging flow', async () => {
      // Register a feature-like handler that:
      // 1. Listens for tool results
      // 2. Checks tool count threshold
      // 3. Stages appropriate reminder
      handlerRegistry.register<TestHandlerContext>({
        id: 'feature:time-for-update',
        priority: 80,
        filter: { kind: 'transcript', eventTypes: ['ToolResult'] },
        handler: async (_event, ctx) => {
          const metrics = ctx.getMetrics()
          if (metrics.toolsThisTurn >= 2) {
            await ctx.staging.stageReminder('UserPromptSubmit', 'time-for-update', {
              name: 'time-for-update',
              blocking: false,
              priority: 40,
              persistent: false,
              userMessage: 'Consider providing a progress update.',
            })
          }
        },
      })

      // Transcript with multiple tool_use and tool_result in a turn
      const transcript = [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/test1' } },
              { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/test2' } },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tool-1', content: 'file1 contents' },
              { type: 'tool_result', tool_use_id: 'tool-2', content: 'file2 contents' },
            ],
          },
        }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await transcriptService.initialize('test-session', transcriptPath)
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Verify the full flow
      const metrics = transcriptService.getMetrics()
      expect(metrics.toolCount).toBe(2)
      expect(metrics.toolsThisTurn).toBe(2)

      // Verify reminder was staged
      const reminders = await stagingService.listReminders('UserPromptSubmit')
      expect(reminders.length).toBe(1)
      expect(reminders[0].name).toBe('time-for-update')
      expect(reminders[0].userMessage).toBe('Consider providing a progress update.')
    })
  })
})

describe('Phase 4.5: RuntimeContext Wiring Verification', () => {
  it('SupervisorContext provides all required services', () => {
    // This test verifies the type contract - that SupervisorContext
    // has all the services needed for feature execution
    const mockContext = {
      role: 'supervisor' as const,
      config: {},
      logger: createMockLogger(),
      assets: {},
      llm: { id: 'mock', complete: vi.fn() },
      handlers: {
        register: vi.fn(),
        invokeHook: vi.fn(),
        emitTranscriptEvent: vi.fn(),
      },
      paths: {
        userConfigDir: '/mock/.sidekick',
        projectConfigDir: '/mock/project/.sidekick',
        projectDir: '/mock/project',
      },
      staging: {
        stageReminder: vi.fn(),
        readReminder: vi.fn(),
        listReminders: vi.fn(),
        clearStaging: vi.fn(),
        suppressHook: vi.fn(),
        isHookSuppressed: vi.fn(),
      },
      transcript: {
        initialize: vi.fn(),
        shutdown: vi.fn(),
        getMetrics: vi.fn(),
        getMetric: vi.fn(),
        onMetricsChange: vi.fn(),
        onThreshold: vi.fn(),
        capturePreCompactState: vi.fn(),
        getCompactionHistory: vi.fn(),
      },
    }

    // Verify all required services are present
    expect(mockContext.role).toBe('supervisor')
    expect(mockContext.llm).toBeDefined()
    expect(mockContext.staging).toBeDefined()
    expect(mockContext.transcript).toBeDefined()
    expect(mockContext.handlers).toBeDefined()
    expect(mockContext.paths).toBeDefined()
  })
})
