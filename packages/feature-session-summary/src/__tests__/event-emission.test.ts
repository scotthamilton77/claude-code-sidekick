/**
 * Tests for handler-level event emission in update-summary.ts
 *
 * Verifies that updateSessionSummary() emits a SummaryUpdated logging event
 * with correct type discriminator and payload fields when LLM analysis completes.
 *
 * @see docs/plans/2026-03-11-align-event-naming-plan.md Task 0E
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
import { updateSessionSummary } from '../handlers/update-summary'
import type { TranscriptEvent } from '@sidekick/core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/** Flush microtask queue so fire-and-forget promises settle */
const flushPromises = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('Session Summary Event Emission', () => {
  let ctx: DaemonContext
  let logger: MockLogger
  let handlers: MockHandlerRegistry
  let llm: MockLLMService
  let assets: MockAssetResolver
  let transcript: MockTranscriptService
  let stateService: MockStateService
  let tempDir: string

  beforeEach(async () => {
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()
    llm = new MockLLMService()
    assets = new MockAssetResolver()
    transcript = new MockTranscriptService()

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-event-emission-'))
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
    transcript.setMockExcerptContent('User: Help me fix a bug\nAssistant: Sure, let me help.')
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
        content: 'Help me fix a bug',
      },
      metadata: {},
    } as TranscriptEvent
  }

  it('emits SummaryUpdated event with correct type and payload after LLM analysis', async () => {
    const sessionId = 'test-event-emission'

    // Queue LLM responses: 1) summary, 2) snarky (initial analysis), 3) resume (no resume exists)
    llm.queueResponses([
      JSON.stringify({
        session_title: 'Bug Fix Session',
        session_title_confidence: 0.9,
        latest_intent: 'Fixing authentication bug',
        latest_intent_confidence: 0.85,
        pivot_detected: false,
      }),
      'Debugging again? Classic.',
      'Welcome back to bug hunting.',
    ])

    await updateSessionSummary(createUserPromptEvent(sessionId), ctx)
    await flushPromises()

    // Find the SummaryUpdated event in logged info messages
    const summaryUpdatedLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'SummaryUpdated')

    expect(summaryUpdatedLogs).toHaveLength(1)

    const logEntry = summaryUpdatedLogs[0]

    // Verify type discriminator
    expect(logEntry.meta?.type).toBe('SummaryUpdated')

    // Verify source
    expect(logEntry.meta?.source).toBe('daemon')

    // Verify reason is used as the log message
    expect(logEntry.msg).toBe('user_prompt_forced')

    // Verify payload state fields
    const state = logEntry.meta?.state as Record<string, unknown>
    expect(state.session_title).toBe('Bug Fix Session')
    expect(state.session_title_confidence).toBe(0.9)
    expect(state.latest_intent).toBe('Fixing authentication bug')
    expect(state.latest_intent_confidence).toBe(0.85)

    // Verify payload metadata fields
    const metadata = logEntry.meta?.metadata as Record<string, unknown>
    expect(metadata.pivot_detected).toBe(false)
    expect(metadata.processing_time_ms).toBeGreaterThanOrEqual(0)

    // Verify reason in payload
    expect(logEntry.meta?.reason).toBe('user_prompt_forced')
  })

  it('emits SummaryUpdated event with old title/intent in metadata when summary changes', async () => {
    const sessionId = 'test-event-emission-changed'

    // Pre-create existing summary with different values
    stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
      session_id: sessionId,
      session_title: 'Old Title',
      session_title_confidence: 0.8,
      latest_intent: 'Old intent',
      latest_intent_confidence: 0.8,
      timestamp: new Date().toISOString(),
    })

    // Queue LLM responses: 1) summary with new values, 2) snarky (title changed)
    llm.queueResponses([
      JSON.stringify({
        session_title: 'New Title',
        session_title_confidence: 0.95,
        latest_intent: 'New intent',
        latest_intent_confidence: 0.9,
        pivot_detected: true,
      }),
      'Changed your mind again?',
      'Ready to pivot.',
    ])

    await updateSessionSummary(createUserPromptEvent(sessionId), ctx)
    await flushPromises()

    const summaryUpdatedLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'SummaryUpdated')
    expect(summaryUpdatedLogs).toHaveLength(1)

    const metadata = summaryUpdatedLogs[0].meta?.metadata as Record<string, unknown>
    expect(metadata.old_title).toBe('Old Title')
    expect(metadata.old_intent).toBe('Old intent')
    expect(metadata.pivot_detected).toBe(true)
  })
})
