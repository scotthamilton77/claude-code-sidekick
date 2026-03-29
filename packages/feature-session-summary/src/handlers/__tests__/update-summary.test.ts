/**
 * Tests for event emission ordering in update-summary.ts
 *
 * Verifies that when analysis produces changed title AND intent,
 * the events are emitted in the correct order:
 *   1. session-title:changed (before finish)
 *   2. intent:changed (before finish)
 *   3. session-summary:finish (last)
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createMockDaemonContext,
  MockLogger,
  MockHandlerRegistry,
  MockLLMService,
  MockAssetResolver,
  MockTranscriptService,
  MockStateService,
} from '@sidekick/testing-fixtures'
import type { DaemonContext } from '@sidekick/types'
import { updateSessionSummary, resetAnalysisGuard } from '../update-summary.js'
import type { TranscriptEvent } from '@sidekick/core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/** Flush microtask queue so fire-and-forget promises settle */
const flushPromises = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('updateSessionSummary event ordering', () => {
  let ctx: DaemonContext
  let logger: MockLogger
  let handlers: MockHandlerRegistry
  let llm: MockLLMService
  let assets: MockAssetResolver
  let transcript: MockTranscriptService
  let stateService: MockStateService
  let tempDir: string

  beforeEach(async () => {
    resetAnalysisGuard()

    logger = new MockLogger()
    handlers = new MockHandlerRegistry()
    llm = new MockLLMService()
    assets = new MockAssetResolver()
    transcript = new MockTranscriptService()

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-update-summary-'))
    stateService = new MockStateService(tempDir)

    ctx = createMockDaemonContext({
      logger,
      handlers,
      llm,
      assets,
      transcript,
      stateService,
      paths: {
        projectDir: tempDir,
        userConfigDir: path.join(tempDir, '.sidekick'),
        projectConfigDir: path.join(tempDir, '.sidekick'),
      },
    })

    // Register required prompt templates
    assets.register(
      'prompts/session-summary.prompt.txt',
      'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
    )
    assets.register('prompts/snarky-message.prompt.txt', 'Generate snark for: {{session_title}} - {{latest_intent}}')
    assets.register(
      'prompts/resume-message.prompt.txt',
      'Generate resume for: {{sessionTitle}} ({{confidence}})\n{{latestIntent}}\n{{transcript}}'
    )

    // Set mock transcript content
    transcript.setMockExcerptContent('User: Refactoring auth module\nAssistant: On it.')
    transcript.setMetrics({ turnCount: 5, toolCount: 10, lastProcessedLine: 100 })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  function createUserPromptEvent(sessionId: string): TranscriptEvent {
    return {
      kind: 'transcript',
      eventType: 'UserPrompt',
      context: {
        sessionId,
        timestamp: Date.now(),
      },
      payload: {
        lineNumber: 100,
        content: 'Refactoring auth module',
      },
      metadata: {},
    } as TranscriptEvent
  }

  it('emits session-title:changed and intent:changed before session-summary:finish', async () => {
    const sessionId = 'test-ordering-title-intent-finish'

    // Pre-create existing summary with different title and intent
    stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
      session_id: sessionId,
      session_title: 'Old Title',
      session_title_confidence: 0.8,
      latest_intent: 'Old intent',
      latest_intent_confidence: 0.8,
      timestamp: new Date().toISOString(),
    })

    // Queue LLM responses: 1) summary with changed title+intent, 2) snarky, 3) resume (pivot)
    llm.queueResponses([
      JSON.stringify({
        session_title: 'New Title',
        session_title_confidence: 0.95,
        latest_intent: 'New intent',
        latest_intent_confidence: 0.9,
        pivot_detected: true,
      }),
      'Title AND intent changed? Ambitious.',
      'Welcome back to chaos.',
    ])

    await updateSessionSummary(createUserPromptEvent(sessionId), ctx)
    await flushPromises()

    // Collect all info-level events in emission order, filtering to the three types we care about
    const relevantTypes = new Set(['session-title:changed', 'intent:changed', 'session-summary:finish'])
    const orderedEventTypes = logger
      .getLogsByLevel('info')
      .filter((log) => typeof log.meta?.type === 'string' && relevantTypes.has(log.meta.type))
      .map((log) => log.meta?.type as string)

    // All three events must be present
    expect(orderedEventTypes).toContain('session-title:changed')
    expect(orderedEventTypes).toContain('intent:changed')
    expect(orderedEventTypes).toContain('session-summary:finish')

    // session-summary:finish must be last
    const finishIndex = orderedEventTypes.indexOf('session-summary:finish')
    const titleIndex = orderedEventTypes.indexOf('session-title:changed')
    const intentIndex = orderedEventTypes.indexOf('intent:changed')

    expect(titleIndex).toBeLessThan(finishIndex)
    expect(intentIndex).toBeLessThan(finishIndex)
  })

  it('coalesces concurrent analyses instead of dropping them', async () => {
    const sessionId = 'test-concurrency-coalesce'

    // Queue LLM responses for TWO analysis runs:
    // Run 1 (BulkProcessingComplete): summary + snarky + resume = 3 responses
    // Run 2 (coalesced rerun):        summary + snarky + resume = 3 responses
    llm.queueResponses([
      JSON.stringify({
        session_title: 'First Analysis',
        session_title_confidence: 0.85,
        latest_intent: 'Building widgets',
        latest_intent_confidence: 0.8,
        pivot_detected: false,
      }),
      'First run snark.',
      'First run resume.',
      JSON.stringify({
        session_title: 'Second Analysis',
        session_title_confidence: 0.9,
        latest_intent: 'Still building widgets',
        latest_intent_confidence: 0.85,
        pivot_detected: false,
      }),
      'Second run snark.',
      'Second run resume.',
    ])

    // Create BulkProcessingComplete event
    const bulkEvent: TranscriptEvent = {
      kind: 'transcript',
      eventType: 'BulkProcessingComplete',
      context: { sessionId, timestamp: Date.now() },
      payload: { lineNumber: 50 },
      metadata: {},
    } as TranscriptEvent

    // Fire BulkProcessingComplete — this starts analysis (fire-and-forget)
    // Then immediately fire UserPrompt — should be deferred, not dropped
    await updateSessionSummary(bulkEvent, ctx)
    await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

    // Wait for both the in-flight analysis and the coalesced rerun to settle
    await flushPromises()
    // Give extra time for the coalesced rerun (which chains off the first finally block)
    await flushPromises()
    await flushPromises()

    // Verify start/finish events are correctly paired
    const infoLogs = logger.getLogsByLevel('info')
    const startEvents = infoLogs.filter((log) => log.meta?.type === 'session-summary:start')
    const finishEvents = infoLogs.filter((log) => log.meta?.type === 'session-summary:finish')

    // Must have 2 starts and 2 finishes (original + coalesced rerun)
    expect(startEvents).toHaveLength(2)
    expect(finishEvents).toHaveLength(2)

    // Verify each start has a matching finish (start before finish)
    for (let i = 0; i < startEvents.length; i++) {
      const startIdx = infoLogs.indexOf(startEvents[i])
      const finishIdx = infoLogs.indexOf(finishEvents[i])
      expect(startIdx).toBeLessThan(finishIdx)
    }

    // Verify a deferred decision event was logged
    // logEvent() spreads payload fields into meta (no nested payload key)
    const decisionLogs = infoLogs.filter((log) => log.meta?.type === 'decision:recorded')
    const deferredDecision = decisionLogs.find((log) => log.meta?.decision === 'deferred')
    expect(deferredDecision).toBeDefined()
    expect(deferredDecision?.meta?.reason).toContain('will rerun after current analysis completes')
  })
})
