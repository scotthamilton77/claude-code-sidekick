/**
 * Tests for the 6 analysis step functions extracted from performAnalysis.
 *
 * Each step is tested in isolation with mock dependencies.
 * These are pure unit tests — no file I/O, no real LLM calls.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createMockDaemonContext,
  MockLogger,
  MockLLMService,
  MockAssetResolver,
  MockStateService,
  MockTranscriptService,
  MockProfileProviderFactory,
} from '@sidekick/testing-fixtures'
import type { DaemonContext, SessionSummaryState, SummaryCountdownState, EventContext } from '@sidekick/types'
import {
  loadAnalysisInputs,
  callSummaryLLM,
  updateSummaryState,
  resetCountdown,
  orchestrateSideEffects,
  emitAnalysisEvents,
} from '../update-summary.js'
import type { AnalysisInputs, LLMResult, SessionSummaryResponse } from '../update-summary.js'
import { createSessionSummaryState, type SessionSummaryStateAccessors } from '../../state.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG } from '../../types.js'
import type { SessionSummaryConfig } from '../../types.js'

// ============================================================================
// Constants
// ============================================================================

const PROMPT_FILE = 'prompts/session-summary.prompt.txt'
const SCHEMA_FILE = 'schemas/session-summary.schema.json'
const SNARKY_PROMPT_FILE = 'prompts/snarky-message.prompt.txt'
const RESUME_PROMPT_FILE = 'prompts/resume-message.prompt.txt'
const SESSION_ID = 'test-session-123'

const PROMPT_TEMPLATE = 'Analyze: {{transcript}}\nPrevious: {{previousAnalysis}}'
const MOCK_SCHEMA = JSON.stringify({
  type: 'object',
  properties: { session_title: { type: 'string' } },
})

// ============================================================================
// Test Helpers
// ============================================================================

function createTestContext(overrides?: {
  logger?: MockLogger
  llm?: MockLLMService
  assets?: MockAssetResolver
  stateService?: MockStateService
  transcript?: MockTranscriptService
}): {
  ctx: DaemonContext
  logger: MockLogger
  llm: MockLLMService
  assets: MockAssetResolver
  stateService: MockStateService
  transcript: MockTranscriptService
} {
  const logger = overrides?.logger ?? new MockLogger()
  const llm = overrides?.llm ?? new MockLLMService()
  const assets = overrides?.assets ?? new MockAssetResolver()
  const stateService = overrides?.stateService ?? new MockStateService()
  const transcript = overrides?.transcript ?? new MockTranscriptService()

  const ctx = createMockDaemonContext({
    logger,
    llm,
    assets,
    stateService,
    transcript,
  })

  return { ctx, logger, llm, assets, stateService, transcript }
}

function createSummaryState(stateService: MockStateService): SessionSummaryStateAccessors {
  return createSessionSummaryState(stateService)
}

function createMockSummary(overrides?: Partial<SessionSummaryState>): SessionSummaryState {
  return {
    session_id: SESSION_ID,
    timestamp: new Date().toISOString(),
    session_title: 'Old Title',
    session_title_confidence: 0.8,
    latest_intent: 'Old intent',
    latest_intent_confidence: 0.8,
    pivot_detected: false,
    ...overrides,
  }
}

function createMockLLMResponse(overrides?: Partial<SessionSummaryResponse>): SessionSummaryResponse {
  return {
    session_title: 'New Title',
    session_title_confidence: 0.95,
    latest_intent: 'Building widgets',
    latest_intent_confidence: 0.9,
    pivot_detected: false,
    ...overrides,
  }
}

function createEventContext(sessionId = SESSION_ID): EventContext {
  return {
    sessionId,
    timestamp: Date.now(),
  }
}

// ============================================================================
// loadAnalysisInputs
// ============================================================================

describe('loadAnalysisInputs', () => {
  let ctx: DaemonContext
  let assets: MockAssetResolver
  let stateService: MockStateService
  let transcript: MockTranscriptService
  let summaryState: SessionSummaryStateAccessors

  beforeEach(() => {
    const setup = createTestContext()
    ctx = setup.ctx
    assets = setup.assets
    stateService = setup.stateService
    transcript = setup.transcript
    summaryState = createSummaryState(stateService)

    // Register required assets
    assets.register(PROMPT_FILE, PROMPT_TEMPLATE)
    assets.register(SCHEMA_FILE, MOCK_SCHEMA)
    transcript.setMockExcerptContent('User: Hello\nAssistant: Hi')
    transcript.setMetrics({ turnCount: 2, toolCount: 0, lastProcessedLine: 50 })
  })

  it('loads config, summary, excerpt, prompt, and schema', async () => {
    const countdown: SummaryCountdownState = { countdown: 5, bookmark_line: 0 }

    const result = await loadAnalysisInputs(ctx, summaryState, ctx.transcript, countdown, SESSION_ID)

    expect(result.config).toBeDefined()
    expect(result.config.excerptLines).toBe(DEFAULT_SESSION_SUMMARY_CONFIG.excerptLines)
    expect(result.currentSummary).toBeNull()
    expect(result.excerpt).toBe('User: Hello\nAssistant: Hi')
    expect(result.previousContext).toBe('No previous analysis')
    expect(result.previousConfidence).toBe(0)
    expect(result.prompt).toContain('Analyze:')
    expect(result.schema).toBeDefined()
    expect(result.schema!.name).toBe('session-summary')
  })

  it('passes countdown.bookmark_line to excerpt options', async () => {
    const countdown: SummaryCountdownState = { countdown: 3, bookmark_line: 42 }

    // Spy on getExcerpt to verify options
    const getExcerptSpy = vi.spyOn(ctx.transcript, 'getExcerpt')

    await loadAnalysisInputs(ctx, summaryState, ctx.transcript, countdown, SESSION_ID)

    expect(getExcerptSpy).toHaveBeenCalledWith(expect.objectContaining({ bookmarkLine: 42 }))
  })

  it('returns null prompt when prompt asset not found', async () => {
    assets.reset() // Clear all registered assets
    assets.register(SCHEMA_FILE, MOCK_SCHEMA) // Schema still available

    const countdown: SummaryCountdownState = { countdown: 0, bookmark_line: 0 }

    const result = await loadAnalysisInputs(ctx, summaryState, ctx.transcript, countdown, SESSION_ID)

    expect(result.prompt).toBeNull()
  })

  it('returns previous analysis JSON when existing summary exists', async () => {
    const existing = createMockSummary({ session_title: 'Existing Work', latest_intent: 'Doing stuff' })
    stateService.setStored(stateService.sessionStatePath(SESSION_ID, 'session-summary.json'), existing)

    const countdown: SummaryCountdownState = { countdown: 0, bookmark_line: 0 }

    const result = await loadAnalysisInputs(ctx, summaryState, ctx.transcript, countdown, SESSION_ID)

    expect(result.currentSummary).toBeDefined()
    expect(result.currentSummary!.session_title).toBe('Existing Work')
    expect(result.previousContext).toContain('Existing Work')
    expect(result.previousContext).toContain('Doing stuff')
    expect(result.previousConfidence).toBe(0.8)
  })

  it('returns undefined schema when schema asset not found', async () => {
    assets.reset()
    assets.register(PROMPT_FILE, PROMPT_TEMPLATE)

    const countdown: SummaryCountdownState = { countdown: 0, bookmark_line: 0 }

    const result = await loadAnalysisInputs(ctx, summaryState, ctx.transcript, countdown, SESSION_ID)

    expect(result.schema).toBeUndefined()
  })
})

// ============================================================================
// callSummaryLLM
// ============================================================================

describe('callSummaryLLM', () => {
  let ctx: DaemonContext
  let llm: MockLLMService

  beforeEach(() => {
    const setup = createTestContext()
    ctx = setup.ctx
    llm = setup.llm
  })

  it('returns parsed response and token count on success', async () => {
    const response = createMockLLMResponse()
    llm.queueResponse(JSON.stringify(response))

    const result = await callSummaryLLM(
      ctx,
      'Test prompt',
      { name: 'session-summary', schema: {} },
      DEFAULT_SESSION_SUMMARY_CONFIG,
      SESSION_ID
    )

    expect(result.parsedResponse).not.toBeNull()
    expect(result.parsedResponse!.session_title).toBe('New Title')
    expect(result.tokenCount).toBeGreaterThan(0)
  })

  it('returns null parsedResponse when LLM returns unparseable content', async () => {
    llm.queueResponse('This is not JSON')

    const result = await callSummaryLLM(ctx, 'Test prompt', undefined, DEFAULT_SESSION_SUMMARY_CONFIG, SESSION_ID)

    expect(result.parsedResponse).toBeNull()
    expect(result.tokenCount).toBeGreaterThan(0)
  })

  it('returns null parsedResponse and zero tokens when LLM throws', async () => {
    // Create a provider that throws
    const failingLLM = new MockLLMService()
    const failingFactory = new MockProfileProviderFactory(failingLLM)
    const setup = createTestContext({ llm: failingLLM })
    const failCtx = createMockDaemonContext({
      ...setup,
      logger: setup.logger,
      llm: failingLLM,
      profileFactory: failingFactory,
    })
    // Override complete to throw
    vi.spyOn(failingLLM, 'complete').mockRejectedValueOnce(new Error('API timeout'))

    const result = await callSummaryLLM(failCtx, 'Test prompt', undefined, DEFAULT_SESSION_SUMMARY_CONFIG, SESSION_ID)

    expect(result.parsedResponse).toBeNull()
    expect(result.tokenCount).toBe(0)
  })
})

// ============================================================================
// updateSummaryState
// ============================================================================

describe('updateSummaryState', () => {
  let stateService: MockStateService
  let summaryState: SessionSummaryStateAccessors

  beforeEach(() => {
    stateService = new MockStateService()
    summaryState = createSummaryState(stateService)
  })

  it('merges LLM response fields into existing summary', async () => {
    const existing = createMockSummary()
    const llmResponse = createMockLLMResponse({ session_title: 'Refactored Auth' })
    const startTime = Date.now() - 100

    const result = await updateSummaryState(summaryState, llmResponse, existing, SESSION_ID, 42, startTime)

    expect(result.session_title).toBe('Refactored Auth')
    expect(result.session_title_confidence).toBe(0.95)
    expect(result.latest_intent).toBe('Building widgets')
    expect(result.previous_title).toBe('Old Title')
    expect(result.previous_intent).toBe('Old intent')
    expect(result.pivot_detected).toBe(false)
  })

  it('uses fallback values when LLM response is null', async () => {
    const existing = createMockSummary({ session_title: 'Kept Title', latest_intent: 'Kept Intent' })
    const startTime = Date.now()

    const result = await updateSummaryState(summaryState, null, existing, SESSION_ID, 0, startTime)

    expect(result.session_title).toBe('Kept Title')
    expect(result.latest_intent).toBe('Kept Intent')
    expect(result.pivot_detected).toBe(false)
  })

  it('uses defaults when no existing summary and LLM fails', async () => {
    const startTime = Date.now()

    const result = await updateSummaryState(summaryState, null, null, SESSION_ID, 0, startTime)

    expect(result.session_title).toBe('Analysis pending...')
    expect(result.latest_intent).toBe('Processing...')
  })

  it('records stats with token count and processing time', async () => {
    const startTime = Date.now() - 250
    const llmResponse = createMockLLMResponse()

    const result = await updateSummaryState(summaryState, llmResponse, null, SESSION_ID, 150, startTime)

    expect(result.stats?.total_tokens).toBe(150)
    expect(result.stats?.processing_time_ms).toBeGreaterThanOrEqual(250)
  })

  it('persists via write()', async () => {
    const llmResponse = createMockLLMResponse()

    await updateSummaryState(summaryState, llmResponse, null, SESSION_ID, 10, Date.now())

    const stored = stateService.getStored(stateService.sessionStatePath(SESSION_ID, 'session-summary.json'))
    expect(stored).toBeDefined()
    expect((stored as SessionSummaryState).session_title).toBe('New Title')
  })
})

// ============================================================================
// resetCountdown
// ============================================================================

describe('resetCountdown', () => {
  let stateService: MockStateService
  let summaryState: SessionSummaryStateAccessors
  const config = DEFAULT_SESSION_SUMMARY_CONFIG

  beforeEach(() => {
    stateService = new MockStateService()
    summaryState = createSummaryState(stateService)
  })

  it('sets high confidence: bookmark = lineNumber, countdown = highConfidence', async () => {
    // avgConfidence = (0.95 + 0.9) / 2 = 0.925 > 0.8
    const summary = createMockSummary({
      session_title_confidence: 0.95,
      latest_intent_confidence: 0.9,
    })
    const countdown: SummaryCountdownState = { countdown: 5, bookmark_line: 10 }

    await resetCountdown(summaryState, config, summary, 100, countdown, SESSION_ID)

    const stored = stateService.getStored(
      stateService.sessionStatePath(SESSION_ID, 'summary-countdown.json')
    ) as SummaryCountdownState
    expect(stored.countdown).toBe(config.countdown.highConfidence)
    // avgConfidence 0.925 > confidenceThreshold 0.8 → bookmark = lineNumber
    expect(stored.bookmark_line).toBe(100)
  })

  it('sets low confidence: bookmark = 0, countdown = lowConfidence', async () => {
    // avgConfidence = (0.3 + 0.4) / 2 = 0.35 < 0.6
    const summary = createMockSummary({
      session_title_confidence: 0.3,
      latest_intent_confidence: 0.4,
    })
    const countdown: SummaryCountdownState = { countdown: 5, bookmark_line: 50 }

    await resetCountdown(summaryState, config, summary, 100, countdown, SESSION_ID)

    const stored = stateService.getStored(
      stateService.sessionStatePath(SESSION_ID, 'summary-countdown.json')
    ) as SummaryCountdownState
    expect(stored.countdown).toBe(config.countdown.lowConfidence)
    // avgConfidence 0.35 < resetThreshold 0.7 → bookmark = 0
    expect(stored.bookmark_line).toBe(0)
  })

  it('preserves bookmark_line at medium confidence', async () => {
    // avgConfidence = (0.75 + 0.75) / 2 = 0.75
    // 0.75 is between resetThreshold (0.7) and confidenceThreshold (0.8) → preserve
    const summary = createMockSummary({
      session_title_confidence: 0.75,
      latest_intent_confidence: 0.75,
    })
    const countdown: SummaryCountdownState = { countdown: 5, bookmark_line: 42 }

    await resetCountdown(summaryState, config, summary, 100, countdown, SESSION_ID)

    const stored = stateService.getStored(
      stateService.sessionStatePath(SESSION_ID, 'summary-countdown.json')
    ) as SummaryCountdownState
    // avgConfidence 0.75 > 0.6 → mediumConfidence countdown
    expect(stored.countdown).toBe(config.countdown.mediumConfidence)
    // avgConfidence 0.75, between 0.7 and 0.8 → preserve existing bookmark
    expect(stored.bookmark_line).toBe(42)
  })
})

// ============================================================================
// orchestrateSideEffects
// ============================================================================

describe('orchestrateSideEffects', () => {
  let ctx: DaemonContext
  let llm: MockLLMService
  let assets: MockAssetResolver
  let stateService: MockStateService
  let transcript: MockTranscriptService
  let summaryState: SessionSummaryStateAccessors

  beforeEach(() => {
    const setup = createTestContext()
    ctx = setup.ctx
    llm = setup.llm
    assets = setup.assets
    stateService = setup.stateService
    transcript = setup.transcript
    summaryState = createSummaryState(stateService)

    // Register required prompt templates for side effects
    assets.register(SNARKY_PROMPT_FILE, 'Snark: {{session_title}}')
    assets.register(RESUME_PROMPT_FILE, 'Resume: {{sessionTitle}}')
    transcript.setMetrics({ turnCount: 5, toolCount: 10, lastProcessedLine: 100 })
    transcript.setMockExcerptContent('mock transcript excerpt')
  })

  it('generates snarky message on initial analysis (no currentSummary)', async () => {
    const updated = createMockSummary({ session_title_confidence: 0.9, latest_intent_confidence: 0.9 })
    llm.queueResponses(['Snarky comment', 'Resume message'])

    await orchestrateSideEffects(
      ctx,
      createEventContext(),
      SESSION_ID,
      summaryState,
      DEFAULT_SESSION_SUMMARY_CONFIG,
      null, // no current summary → initial analysis
      updated
    )

    // Snarky message was generated (LLM was called)
    expect(llm.recordedRequests.length).toBeGreaterThanOrEqual(1)
  })

  it('generates resume message when no resume exists yet', async () => {
    const current = createMockSummary()
    const updated = createMockSummary({ pivot_detected: false })
    llm.queueResponses(['Resume message'])

    // No resume file exists → should trigger resume generation
    await orchestrateSideEffects(
      ctx,
      createEventContext(),
      SESSION_ID,
      summaryState,
      { ...DEFAULT_SESSION_SUMMARY_CONFIG, snarkyMessages: false }, // disable snarky
      current,
      updated
    )

    expect(llm.recordedRequests.length).toBeGreaterThanOrEqual(1)
  })

  it('skips snarky message when snarkyMessages config is false', async () => {
    const updated = createMockSummary()
    llm.queueResponses(['Resume message'])

    const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, snarkyMessages: false }

    await orchestrateSideEffects(
      ctx,
      createEventContext(),
      SESSION_ID,
      summaryState,
      config,
      null, // initial analysis would normally trigger snarky
      updated
    )

    // Only resume message should have been called (not snarky)
    const requests = llm.recordedRequests
    // The resume prompt contains "Resume:" and the snarky prompt contains "Snark:"
    const hasSnark = requests.some((r) => r.messages[0].content.includes('Snark:'))
    expect(hasSnark).toBe(false)
  })
})

// ============================================================================
// emitAnalysisEvents
// ============================================================================

describe('emitAnalysisEvents', () => {
  let logger: MockLogger

  beforeEach(() => {
    logger = new MockLogger()
  })

  it('emits title-changed when title differs', () => {
    const current = createMockSummary({ session_title: 'Old Title' })
    const updated = createMockSummary({ session_title: 'New Title' })

    emitAnalysisEvents(logger, createEventContext(), current, updated)

    const titleEvents = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'session-title:changed')
    expect(titleEvents).toHaveLength(1)
    expect(titleEvents[0].meta?.previousValue).toBe('Old Title')
    expect(titleEvents[0].meta?.newValue).toBe('New Title')
  })

  it('emits intent-changed when intent differs', () => {
    const current = createMockSummary({ latest_intent: 'Old intent' })
    const updated = createMockSummary({ latest_intent: 'New intent' })

    emitAnalysisEvents(logger, createEventContext(), current, updated)

    const intentEvents = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'intent:changed')
    expect(intentEvents).toHaveLength(1)
    expect(intentEvents[0].meta?.previousValue).toBe('Old intent')
    expect(intentEvents[0].meta?.newValue).toBe('New intent')
  })

  it('does not emit change events when unchanged', () => {
    const current = createMockSummary()
    const updated = createMockSummary() // Same title and intent

    emitAnalysisEvents(logger, createEventContext(), current, updated)

    const changeEvents = logger
      .getLogsByLevel('info')
      .filter((log) => log.meta?.type === 'session-title:changed' || log.meta?.type === 'intent:changed')
    expect(changeEvents).toHaveLength(0)
  })

  it('does not emit change events when no previous summary exists', () => {
    const updated = createMockSummary({ session_title: 'First Title', latest_intent: 'First intent' })

    emitAnalysisEvents(logger, createEventContext(), null, updated)

    const changeEvents = logger
      .getLogsByLevel('info')
      .filter((log) => log.meta?.type === 'session-title:changed' || log.meta?.type === 'intent:changed')
    expect(changeEvents).toHaveLength(0)
  })

  it('always emits summary-finish', () => {
    const current = createMockSummary()
    const updated = createMockSummary()

    emitAnalysisEvents(logger, createEventContext(), current, updated)

    const finishEvents = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'session-summary:finish')
    expect(finishEvents).toHaveLength(1)
    expect(finishEvents[0].meta?.session_title).toBe(updated.session_title)
  })

  it('emits both title-changed and intent-changed when both differ', () => {
    const current = createMockSummary({ session_title: 'Old Title', latest_intent: 'Old intent' })
    const updated = createMockSummary({ session_title: 'New Title', latest_intent: 'New intent' })

    emitAnalysisEvents(logger, createEventContext(), current, updated)

    const infoLogs = logger.getLogsByLevel('info')
    const titleChanged = infoLogs.filter((log) => log.meta?.type === 'session-title:changed')
    const intentChanged = infoLogs.filter((log) => log.meta?.type === 'intent:changed')
    const finish = infoLogs.filter((log) => log.meta?.type === 'session-summary:finish')

    expect(titleChanged).toHaveLength(1)
    expect(intentChanged).toHaveLength(1)
    expect(finish).toHaveLength(1)

    // Finish must be last
    const finishIdx = infoLogs.indexOf(finish[0])
    const titleIdx = infoLogs.indexOf(titleChanged[0])
    const intentIdx = infoLogs.indexOf(intentChanged[0])
    expect(titleIdx).toBeLessThan(finishIdx)
    expect(intentIdx).toBeLessThan(finishIdx)
  })
})
