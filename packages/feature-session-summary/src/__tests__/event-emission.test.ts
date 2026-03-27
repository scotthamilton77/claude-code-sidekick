/**
 * Tests for handler-level event emission in update-summary.ts
 *
 * Verifies that updateSessionSummary() emits discrete session-summary:start,
 * session-summary:finish, session-title:changed, and intent:changed events
 * with correct type discriminators and payload fields when LLM analysis completes.
 *
 * @see docs/plans/2026-03-11-align-event-naming-plan.md Task 0E, Task 8
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

  it('emits session-summary:start and session-summary:finish events after LLM analysis', async () => {
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

    // Find the start event
    const startLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'session-summary:start')
    expect(startLogs).toHaveLength(1)
    expect(startLogs[0].meta?.source).toBe('daemon')
    expect(startLogs[0].meta?.reason).toBe('user_prompt_forced')

    // Find the finish event
    const finishLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'session-summary:finish')
    expect(finishLogs).toHaveLength(1)

    const finishMeta = finishLogs[0].meta as Record<string, unknown>
    expect(finishMeta.source).toBe('daemon')
    expect(finishMeta.session_title).toBe('Bug Fix Session')
    expect(finishMeta.session_title_confidence).toBe(0.9)
    expect(finishMeta.latest_intent).toBe('Fixing authentication bug')
    expect(finishMeta.latest_intent_confidence).toBe(0.85)
    expect(finishMeta.pivot_detected).toBe(false)
    expect(finishMeta.processing_time_ms).toBeGreaterThanOrEqual(0)
  })

  it('emits session-title:changed and intent:changed events when summary changes', async () => {
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

    // Verify title-changed event
    const titleLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'session-title:changed')
    expect(titleLogs).toHaveLength(1)
    const titleMeta = titleLogs[0].meta as Record<string, unknown>
    expect(titleMeta.previousValue).toBe('Old Title')
    expect(titleMeta.newValue).toBe('New Title')
    expect(titleMeta.confidence).toBe(0.95)

    // Verify intent-changed event
    const intentLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'intent:changed')
    expect(intentLogs).toHaveLength(1)
    const intentMeta = intentLogs[0].meta as Record<string, unknown>
    expect(intentMeta.previousValue).toBe('Old intent')
    expect(intentMeta.newValue).toBe('New intent')
    expect(intentMeta.confidence).toBe(0.9)
  })

  it('does not emit title/intent-changed events when values are unchanged', async () => {
    const sessionId = 'test-event-emission-unchanged'

    // Pre-create existing summary with same values the LLM will return
    stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
      session_id: sessionId,
      session_title: 'Same Title',
      session_title_confidence: 0.8,
      latest_intent: 'Same intent',
      latest_intent_confidence: 0.8,
      timestamp: new Date().toISOString(),
    })

    llm.queueResponses([
      JSON.stringify({
        session_title: 'Same Title',
        session_title_confidence: 0.95,
        latest_intent: 'Same intent',
        latest_intent_confidence: 0.9,
        pivot_detected: false,
      }),
    ])

    await updateSessionSummary(createUserPromptEvent(sessionId), ctx)
    await flushPromises()

    // Should still emit start and finish
    const startLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'session-summary:start')
    expect(startLogs).toHaveLength(1)
    const finishLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'session-summary:finish')
    expect(finishLogs).toHaveLength(1)

    // Should NOT emit title or intent changed
    const titleLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'session-title:changed')
    expect(titleLogs).toHaveLength(0)
    const intentLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'intent:changed')
    expect(intentLogs).toHaveLength(0)
  })

  it('emits decision:recorded event with decision=calling on UserPrompt', async () => {
    const sessionId = 'test-decision-calling'

    llm.queueResponses([
      JSON.stringify({
        session_title: 'Decision Test',
        session_title_confidence: 0.9,
        latest_intent: 'Testing decisions',
        latest_intent_confidence: 0.85,
        pivot_detected: false,
      }),
      'Snark!',
      'Welcome!',
    ])

    await updateSessionSummary(createUserPromptEvent(sessionId), ctx)
    await flushPromises()

    const decisionLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'decision:recorded')
    expect(decisionLogs).toHaveLength(1)
    expect(decisionLogs[0].meta?.decision).toBe('calling')
    expect(decisionLogs[0].meta?.reason).toBe('UserPrompt event forces immediate analysis')
    expect(decisionLogs[0].meta?.subsystem).toBe('session-summary')
    expect(decisionLogs[0].meta?.source).toBe('daemon')
  })

  it('emits decision:recorded event with decision=skipped on countdown active', async () => {
    const sessionId = 'test-decision-skipped'

    // Pre-set countdown state so ToolResult is skipped
    stateService.setStored(stateService.sessionStatePath(sessionId, 'summary-countdown.json'), {
      countdown: 5,
      bookmark_line: 0,
    })

    const toolResultEvent: TranscriptEvent = {
      kind: 'transcript',
      eventType: 'ToolResult',
      context: {
        sessionId,
        timestamp: Date.now(),
      },
      payload: {
        lineNumber: 50,
        entry: {},
        toolName: 'Read',
      },
      metadata: {},
    } as TranscriptEvent

    await updateSessionSummary(toolResultEvent, ctx)

    const decisionLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'decision:recorded')
    expect(decisionLogs).toHaveLength(1)
    expect(decisionLogs[0].meta?.decision).toBe('skipped')
    expect(decisionLogs[0].meta?.reason).toContain('countdown not reached')
    expect(decisionLogs[0].meta?.subsystem).toBe('session-summary')
  })

  it('does not emit title/intent-changed events on first analysis (no previous summary)', async () => {
    const sessionId = 'test-event-emission-first'

    llm.queueResponses([
      JSON.stringify({
        session_title: 'New Session',
        session_title_confidence: 0.9,
        latest_intent: 'Starting fresh',
        latest_intent_confidence: 0.85,
        pivot_detected: false,
      }),
      'Fresh start!',
      'Welcome!',
    ])

    await updateSessionSummary(createUserPromptEvent(sessionId), ctx)
    await flushPromises()

    // Should emit start and finish
    const startLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'session-summary:start')
    expect(startLogs).toHaveLength(1)
    const finishLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'session-summary:finish')
    expect(finishLogs).toHaveLength(1)

    // Should NOT emit title or intent changed (no previous to diff against)
    const titleLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'session-title:changed')
    expect(titleLogs).toHaveLength(0)
    const intentLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'intent:changed')
    expect(intentLogs).toHaveLength(0)
  })

  it('emits snarky-message:start and snarky-message:finish events during snarky generation', async () => {
    const sessionId = 'test-snarky-events'

    // Queue LLM responses: 1) summary, 2) snarky message, 3) resume message (no resume exists)
    llm.queueResponses([
      JSON.stringify({
        session_title: 'Snarky Test Session',
        session_title_confidence: 0.9,
        latest_intent: 'Testing snarky events',
        latest_intent_confidence: 0.85,
        pivot_detected: false,
      }),
      'Oh look, another test session. How original.',
      'Welcome back to testing.',
    ])

    await updateSessionSummary(createUserPromptEvent(sessionId), ctx)
    await flushPromises()

    // Find the snarky-message:start event
    const startLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'snarky-message:start')
    expect(startLogs).toHaveLength(1)
    expect(startLogs[0].meta?.source).toBe('daemon')
    expect(startLogs[0].meta?.sessionId).toBe(sessionId)

    // Find the snarky-message:finish event
    const finishLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'snarky-message:finish')
    expect(finishLogs).toHaveLength(1)
    expect(finishLogs[0].meta?.source).toBe('daemon')
    expect(finishLogs[0].meta?.generatedMessage).toBe('Oh look, another test session. How original.')
  })

  it('emits snarky-message:start before snarky-message:finish in correct order', async () => {
    const sessionId = 'test-snarky-ordering'

    // Pre-create existing summary so title change triggers snarky generation
    stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
      session_id: sessionId,
      session_title: 'Previous Title',
      session_title_confidence: 0.8,
      latest_intent: 'Previous intent',
      latest_intent_confidence: 0.8,
      timestamp: new Date().toISOString(),
    })

    // Queue LLM responses: 1) summary with changed title, 2) snarky, 3) resume (pivot detected)
    llm.queueResponses([
      JSON.stringify({
        session_title: 'Changed Title',
        session_title_confidence: 0.95,
        latest_intent: 'Changed intent',
        latest_intent_confidence: 0.9,
        pivot_detected: true,
      }),
      'Title changed! How unpredictable.',
      'Welcome back.',
    ])

    await updateSessionSummary(createUserPromptEvent(sessionId), ctx)
    await flushPromises()

    // Collect all info logs with event types to verify ordering
    const eventLogs = logger
      .getLogsByLevel('info')
      .filter((log) => typeof log.meta?.type === 'string' && log.meta.type.startsWith('snarky-message:'))
      .map((log) => log.meta?.type as string)

    expect(eventLogs).toEqual(['snarky-message:start', 'snarky-message:finish'])
  })
})
