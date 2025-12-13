/**
 * Tests for Session Summary countdown logic (ToolCall event handling)
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.2.2
 *
 * Coverage:
 * - ToolCall decrements countdown when countdown > 0
 * - ToolCall triggers analysis when countdown = 0
 * - Countdown reset based on confidence tiers:
 *   - High confidence (avg > 0.8): countdown = 10000
 *   - Medium confidence (0.6 < avg ≤ 0.8): countdown = 20
 *   - Low confidence (avg ≤ 0.6): countdown = 5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createMockSupervisorContext,
  MockLogger,
  MockHandlerRegistry,
  MockLLMService,
  MockAssetResolver,
  MockTranscriptService,
} from '@sidekick/testing-fixtures'
import type { SupervisorContext } from '@sidekick/types'
import { updateSessionSummary } from '../handlers/update-summary'
import type { TranscriptEvent } from '@sidekick/core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { SummaryCountdownState } from '../types'

describe('Session Summary Countdown Logic', () => {
  let ctx: SupervisorContext
  let logger: MockLogger
  let handlers: MockHandlerRegistry
  let llm: MockLLMService
  let assets: MockAssetResolver
  let transcript: MockTranscriptService
  let tempDir: string

  beforeEach(async () => {
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()
    llm = new MockLLMService()
    assets = new MockAssetResolver()
    transcript = new MockTranscriptService()

    // Create temp directory for state files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-countdown-test-'))

    ctx = createMockSupervisorContext({
      logger,
      handlers,
      llm,
      assets,
      transcript,
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

    // Set mock transcript content
    transcript.setMockExcerptContent('User: Help me analyze data\nAssistant: Let me assist.')
    transcript.setMetrics({ turnCount: 8, toolCount: 15, lastProcessedLine: 150 })
  })

  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  /**
   * Helper to create ToolCall events
   */
  function createToolCallEvent(sessionId: string, lineNumber = 100): TranscriptEvent {
    return {
      kind: 'transcript',
      eventType: 'ToolCall',
      context: {
        sessionId,
        scope: 'project',
      },
      payload: {
        lineNumber,
        toolName: 'Read',
        content: 'Reading /path/to/file.ts',
      },
    } as TranscriptEvent
  }

  /**
   * Helper to read countdown state file
   */
  async function readCountdownState(sessionId: string): Promise<SummaryCountdownState> {
    const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
    const countdownPath = path.join(stateDir, 'summary-countdown.json')
    const content = await fs.readFile(countdownPath, 'utf-8')
    return JSON.parse(content) as SummaryCountdownState
  }

  /**
   * Helper to write countdown state file
   */
  async function writeCountdownState(sessionId: string, state: SummaryCountdownState): Promise<void> {
    const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
    await fs.mkdir(stateDir, { recursive: true })
    const countdownPath = path.join(stateDir, 'summary-countdown.json')
    await fs.writeFile(countdownPath, JSON.stringify(state, null, 2), 'utf-8')
  }

  describe('ToolCall Countdown Decrement', () => {
    it('decrements countdown when countdown > 0', async () => {
      const sessionId = 'test-countdown-1'

      // Pre-seed countdown state with countdown = 5
      await writeCountdownState(sessionId, { countdown: 5, bookmark_line: 0 })

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      // Countdown should be decremented to 4
      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(4)

      // LLM should NOT be called (countdown > 0)
      expect(llm.recordedRequests).toHaveLength(0)
    })

    it('decrements countdown from 3 to 2', async () => {
      const sessionId = 'test-countdown-2'

      await writeCountdownState(sessionId, { countdown: 3, bookmark_line: 50 })

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(2)
      expect(llm.recordedRequests).toHaveLength(0)
    })

    it('decrements countdown from 1 to 0', async () => {
      const sessionId = 'test-countdown-3'

      await writeCountdownState(sessionId, { countdown: 1, bookmark_line: 100 })

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(0)

      // Countdown is now 0 but LLM not called yet (will trigger on next ToolCall)
      expect(llm.recordedRequests).toHaveLength(0)
    })
  })

  describe('ToolCall Triggers Analysis at Zero', () => {
    it('triggers analysis when countdown = 0', async () => {
      const sessionId = 'test-zero-1'

      // Pre-seed countdown state with countdown = 0
      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Queue LLM response (high confidence)
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Data Analysis Session',
          session_title_confidence: 0.85,
          latest_intent: 'Analyzing dataset',
          latest_intent_confidence: 0.85,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId, 120), ctx)

      // LLM should be called
      expect(llm.recordedRequests).toHaveLength(1)

      // Summary file should be created
      const summaryPath = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state', 'session-summary.json')
      const summaryContent = await fs.readFile(summaryPath, 'utf-8')
      const summary = JSON.parse(summaryContent)
      expect(summary.session_title).toBe('Data Analysis Session')
      expect(summary.latest_intent).toBe('Analyzing dataset')
    })

    it('triggers analysis and resets countdown based on confidence', async () => {
      const sessionId = 'test-zero-2'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 50 })

      // Queue high confidence response
      llm.queueResponse(
        JSON.stringify({
          session_title: 'High Confidence Task',
          session_title_confidence: 0.9,
          latest_intent: 'Clear objective',
          latest_intent_confidence: 0.95,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      // LLM called
      expect(llm.recordedRequests).toHaveLength(1)

      // Countdown should be reset (verified in confidence tier tests below)
      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBeGreaterThan(0)
    })
  })

  describe('Countdown Reset - High Confidence', () => {
    it('resets countdown to 10000 when average confidence > 0.8', async () => {
      const sessionId = 'test-high-conf-1'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // High confidence: both > 0.8, average = 0.9
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Clear Task',
          session_title_confidence: 0.9,
          latest_intent: 'Well defined goal',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(10000) // High confidence threshold
    })

    it('resets countdown to 10000 when average confidence = 0.85', async () => {
      const sessionId = 'test-high-conf-2'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Average: (0.8 + 0.9) / 2 = 0.85 > 0.8
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Task A',
          session_title_confidence: 0.8,
          latest_intent: 'Goal B',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(10000)
    })

    it('resets countdown to 10000 at boundary (average = 0.81)', async () => {
      const sessionId = 'test-high-conf-3'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Average: (0.81 + 0.81) / 2 = 0.81 > 0.8
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Task C',
          session_title_confidence: 0.81,
          latest_intent: 'Goal D',
          latest_intent_confidence: 0.81,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(10000)
    })
  })

  describe('Countdown Reset - Medium Confidence', () => {
    it('resets countdown to 20 when average confidence = 0.7', async () => {
      const sessionId = 'test-med-conf-1'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Medium confidence: 0.6 < avg ≤ 0.8
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Moderate Task',
          session_title_confidence: 0.7,
          latest_intent: 'Somewhat clear goal',
          latest_intent_confidence: 0.7,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(20) // Medium confidence threshold
    })

    it('resets countdown to 20 at upper boundary (average = 0.8)', async () => {
      const sessionId = 'test-med-conf-2'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Average: exactly 0.8 (boundary between medium and high)
      // Implementation uses > 0.8, so 0.8 falls into medium
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Task E',
          session_title_confidence: 0.8,
          latest_intent: 'Goal F',
          latest_intent_confidence: 0.8,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(20)
    })

    it('resets countdown to 20 at lower boundary (average = 0.61)', async () => {
      const sessionId = 'test-med-conf-3'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Average: (0.61 + 0.61) / 2 = 0.61 > 0.6
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Task G',
          session_title_confidence: 0.61,
          latest_intent: 'Goal H',
          latest_intent_confidence: 0.61,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(20)
    })
  })

  describe('Countdown Reset - Low Confidence', () => {
    it('resets countdown to 5 when average confidence < 0.6', async () => {
      const sessionId = 'test-low-conf-1'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Low confidence: avg ≤ 0.6
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Unclear Task',
          session_title_confidence: 0.5,
          latest_intent: 'Uncertain goal',
          latest_intent_confidence: 0.5,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(5) // Low confidence threshold
    })

    it('resets countdown to 5 at boundary (average = 0.6)', async () => {
      const sessionId = 'test-low-conf-2'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Average: exactly 0.6 (boundary)
      // Implementation uses > 0.6 for medium, so 0.6 falls into low
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Task I',
          session_title_confidence: 0.6,
          latest_intent: 'Goal J',
          latest_intent_confidence: 0.6,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(5)
    })

    it('resets countdown to 5 for very low confidence (average = 0.3)', async () => {
      const sessionId = 'test-low-conf-3'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Very low confidence
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Unknown',
          session_title_confidence: 0.3,
          latest_intent: 'Unclear',
          latest_intent_confidence: 0.3,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(5)
    })

    it('resets countdown to 5 for zero confidence', async () => {
      const sessionId = 'test-low-conf-4'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Edge case: zero confidence
      llm.queueResponse(
        JSON.stringify({
          session_title: 'No idea',
          session_title_confidence: 0,
          latest_intent: 'Processing',
          latest_intent_confidence: 0,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(5)
    })
  })

  describe('Countdown State Initialization', () => {
    it('initializes countdown to 0 when no state file exists', async () => {
      const sessionId = 'test-init-1'

      // No pre-existing state file
      // Queue response for when analysis triggers
      llm.queueResponse(
        JSON.stringify({
          session_title: 'New Session',
          session_title_confidence: 0.8,
          latest_intent: 'Starting work',
          latest_intent_confidence: 0.8,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId), ctx)

      // With no state file, countdown starts at 0, triggers analysis immediately
      expect(llm.recordedRequests).toHaveLength(1)

      // After analysis, countdown should be reset based on confidence
      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(20) // Medium confidence (0.8 average)
    })
  })

  describe('Sequential ToolCall Countdown Flow', () => {
    it('processes multiple ToolCall events in sequence', async () => {
      const sessionId = 'test-sequence-1'

      // Start with countdown = 3
      await writeCountdownState(sessionId, { countdown: 3, bookmark_line: 0 })

      // Event 1: countdown 3 → 2
      await updateSessionSummary(createToolCallEvent(sessionId, 100), ctx)
      expect((await readCountdownState(sessionId)).countdown).toBe(2)
      expect(llm.recordedRequests).toHaveLength(0)

      // Event 2: countdown 2 → 1
      await updateSessionSummary(createToolCallEvent(sessionId, 105), ctx)
      expect((await readCountdownState(sessionId)).countdown).toBe(1)
      expect(llm.recordedRequests).toHaveLength(0)

      // Event 3: countdown 1 → 0
      await updateSessionSummary(createToolCallEvent(sessionId, 110), ctx)
      expect((await readCountdownState(sessionId)).countdown).toBe(0)
      expect(llm.recordedRequests).toHaveLength(0)

      // Event 4: countdown = 0 → triggers analysis, resets based on confidence
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Sequential Task',
          session_title_confidence: 0.9,
          latest_intent: 'Building feature',
          latest_intent_confidence: 0.85,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolCallEvent(sessionId, 115), ctx)
      expect(llm.recordedRequests).toHaveLength(1)

      // Countdown reset to 10000 (high confidence: (0.9 + 0.85) / 2 = 0.875 > 0.8)
      const finalState = await readCountdownState(sessionId)
      expect(finalState.countdown).toBe(10000)
    })
  })
})
