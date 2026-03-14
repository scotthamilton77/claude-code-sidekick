/**
 * Transcript Event Emission Tests
 *
 * Verifies that transcript:emitted events are logged via logEvent()
 * when TranscriptService.emitEvent() processes transcript entries.
 *
 * logEvent() calls logger.info() with { type, source, ...payload },
 * so we verify by checking logger.info mock calls for the expected type.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TranscriptServiceImpl, type TranscriptServiceOptions } from '../transcript-service'
import type { HandlerRegistry, Logger } from '@sidekick/types'
import { MockStateService } from '@sidekick/testing-fixtures'

// ============================================================================
// Test Helpers
// ============================================================================

function createMockLogger(): Logger {
  return {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn(() => createMockLogger()),
    flush: vi.fn(() => Promise.resolve()),
  }
}

function createMockHandlerRegistry(): HandlerRegistry {
  return {
    register: vi.fn(),
    invokeHook: vi.fn(() => Promise.resolve({})),
    emitTranscriptEvent: vi.fn(() => Promise.resolve()),
  }
}

interface TranscriptServiceTestInternals {
  processTranscriptFile: () => Promise<void>
}

function createTestDir(): string {
  const testDir = join(tmpdir(), `transcript-event-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
  return testDir
}

function cleanupTestDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Extract logEvent calls from logger.info mock by filtering for metadata
 * with a specific `type` field. logEvent() calls logger.info(msg, { type, source, ...payload }).
 */
function findLogEventCalls(logger: Logger, eventType: string): Array<{ msg: string; meta: Record<string, unknown> }> {
  const infoFn = logger.info as ReturnType<typeof vi.fn>
  return infoFn.mock.calls
    .filter((call: unknown[]) => {
      const meta = call[1] as Record<string, unknown> | undefined
      return meta?.type === eventType
    })
    .map((call: unknown[]) => ({
      msg: call[0] as string,
      meta: call[1] as Record<string, unknown>,
    }))
}

// ============================================================================
// Tests
// ============================================================================

describe('transcript:emitted event emission', () => {
  let testDir: string
  let stateDir: string
  let transcriptPath: string
  let logger: Logger
  let handlers: HandlerRegistry
  let mockStateService: MockStateService
  let service: TranscriptServiceImpl

  beforeEach(() => {
    testDir = createTestDir()
    stateDir = join(testDir, '.sidekick')
    transcriptPath = join(testDir, 'transcript.jsonl')
    logger = createMockLogger()
    handlers = createMockHandlerRegistry()
    mockStateService = new MockStateService(testDir)

    const options: TranscriptServiceOptions = {
      watchDebounceMs: 50,
      metricsPersistIntervalMs: 60000,
      handlers,
      logger,
      stateDir,
      stateService: mockStateService,
    }

    service = new TranscriptServiceImpl(options)
  })

  afterEach(async () => {
    await service.shutdown()
    cleanupTestDir(testDir)
  })

  it('should emit transcript:emitted event when processing a user prompt', async () => {
    const entry = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Hello world' },
    })
    writeFileSync(transcriptPath, entry + '\n')

    await service.prepare('test-session', transcriptPath)
    await service.start()

    const internals = service as unknown as TranscriptServiceTestInternals
    await internals.processTranscriptFile()

    const emittedCalls = findLogEventCalls(logger, 'transcript:emitted')

    // Should have at least one transcript:emitted for UserPrompt
    expect(emittedCalls.length).toBeGreaterThanOrEqual(1)

    // Find the UserPrompt emission
    const userPromptCall = emittedCalls.find((call) => call.meta.eventType === 'UserPrompt')
    expect(userPromptCall).toBeDefined()
    expect(userPromptCall!.meta.source).toBe('transcript')
    expect(userPromptCall!.meta.lineNumber).toBe(1)
  })

  it('should emit transcript:emitted for BulkProcessingComplete', async () => {
    const entry = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Hello world' },
    })
    writeFileSync(transcriptPath, entry + '\n')

    await service.prepare('test-session', transcriptPath)
    await service.start()

    const internals = service as unknown as TranscriptServiceTestInternals
    await internals.processTranscriptFile()

    const bulkCalls = findLogEventCalls(logger, 'transcript:emitted').filter(
      (call) => call.meta.eventType === 'BulkProcessingComplete'
    )

    expect(bulkCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('should include transcriptPath in the logged metadata', async () => {
    const entry = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'test' },
    })
    writeFileSync(transcriptPath, entry + '\n')

    await service.prepare('test-session', transcriptPath)
    await service.start()

    const internals = service as unknown as TranscriptServiceTestInternals
    await internals.processTranscriptFile()

    const emittedCalls = findLogEventCalls(logger, 'transcript:emitted')
    expect(emittedCalls.length).toBeGreaterThanOrEqual(1)

    // All transcript:emitted events should include the transcriptPath
    const userPromptCall = emittedCalls.find((call) => call.meta.eventType === 'UserPrompt')
    expect(userPromptCall).toBeDefined()
    expect(userPromptCall!.meta.transcriptPath).toBe(transcriptPath)
  })
})
