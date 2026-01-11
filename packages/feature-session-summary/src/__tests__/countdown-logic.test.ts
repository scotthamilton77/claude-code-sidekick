/**
 * Tests for Session Summary countdown logic (ToolResult event handling)
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.2.2
 *
 * Coverage:
 * - ToolResult decrements countdown when countdown > 0
 * - ToolResult triggers analysis when countdown = 0
 * - Countdown reset based on confidence tiers:
 *   - High confidence (avg > 0.8): countdown = 10000
 *   - Medium confidence (0.6 < avg ≤ 0.8): countdown = 20
 *   - Low confidence (avg ≤ 0.6): countdown = 5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createMockDaemonContext,
  MockLogger,
  MockHandlerRegistry,
  MockLLMService,
  MockAssetResolver,
  MockTranscriptService,
} from '@sidekick/testing-fixtures'
import type { DaemonContext } from '@sidekick/types'
import { updateSessionSummary } from '../handlers/update-summary'
import type { TranscriptEvent } from '@sidekick/core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { SummaryCountdownState } from '../types'
import { DEFAULT_SESSION_SUMMARY_CONFIG } from '../types'

describe('Session Summary Countdown Logic', () => {
  let ctx: DaemonContext
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

    ctx = createMockDaemonContext({
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
   * Helper to create ToolResult events
   */
  function createToolResultEvent(sessionId: string, lineNumber = 100): TranscriptEvent {
    return {
      kind: 'transcript',
      eventType: 'ToolResult',
      context: {
        sessionId,
        scope: 'project',
        timestamp: Date.now(),
      },
      payload: {
        lineNumber,
        entry: { type: 'tool_result', tool_use_id: 'tool-use-123' },
        content: 'File content here...',
      },
      metadata: {
        transcriptPath: '/tmp/transcript.jsonl',
        metrics: {
          turnCount: 1,
          toolCount: 1,
          messageCount: 2,
          lastProcessedLine: lineNumber,
          toolsThisTurn: 1,
          tokenUsage: {},
          toolsPerTurn: { history: [1], average: 1 },
          lastUpdatedAt: Date.now(),
        },
      },
    } as unknown as TranscriptEvent
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

  describe('ToolResult Countdown Decrement', () => {
    it('decrements countdown when countdown > 0', async () => {
      const sessionId = 'test-countdown-1'

      // Pre-seed countdown state with countdown = 5
      await writeCountdownState(sessionId, { countdown: 5, bookmark_line: 0 })

      await updateSessionSummary(createToolResultEvent(sessionId), ctx)

      // Countdown should be decremented to 4
      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(4)

      // LLM should NOT be called (countdown > 0)
      expect(llm.recordedRequests).toHaveLength(0)
    })

    it('decrements countdown from 3 to 2', async () => {
      const sessionId = 'test-countdown-2'

      await writeCountdownState(sessionId, { countdown: 3, bookmark_line: 50 })

      await updateSessionSummary(createToolResultEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(2)
      expect(llm.recordedRequests).toHaveLength(0)
    })

    it('decrements countdown from 1 to 0', async () => {
      const sessionId = 'test-countdown-3'

      await writeCountdownState(sessionId, { countdown: 1, bookmark_line: 100 })

      await updateSessionSummary(createToolResultEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(0)

      // Countdown is now 0 but LLM not called yet (will trigger on next ToolCall)
      expect(llm.recordedRequests).toHaveLength(0)
    })
  })

  describe('ToolResult Triggers Analysis at Zero', () => {
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

      await updateSessionSummary(createToolResultEvent(sessionId, 120), ctx)

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

      await updateSessionSummary(createToolResultEvent(sessionId), ctx)

      // LLM called
      expect(llm.recordedRequests).toHaveLength(1)

      // Countdown should be reset (verified in confidence tier tests below)
      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBeGreaterThan(0)
    })
  })

  describe('Countdown Reset - High Confidence', () => {
    it('resets countdown to configured highConfidence value when average confidence > 0.8', async () => {
      const sessionId = 'test-high-conf-1'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // High confidence: average = 0.9 > 0.8
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Clear Task',
          session_title_confidence: 0.9,
          latest_intent: 'Well defined goal',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolResultEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(DEFAULT_SESSION_SUMMARY_CONFIG.countdown.highConfidence)
    })

    it('uses high confidence tier at boundary (average = 0.81 > 0.8)', async () => {
      const sessionId = 'test-high-conf-boundary'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      llm.queueResponse(
        JSON.stringify({
          session_title: 'Task C',
          session_title_confidence: 0.81,
          latest_intent: 'Goal D',
          latest_intent_confidence: 0.81,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolResultEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(DEFAULT_SESSION_SUMMARY_CONFIG.countdown.highConfidence)
    })
  })

  describe('Countdown Reset - Medium Confidence', () => {
    it('resets countdown to configured mediumConfidence value when 0.6 < average <= 0.8', async () => {
      const sessionId = 'test-med-conf-1'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Medium confidence: average = 0.7 (0.6 < 0.7 <= 0.8)
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Moderate Task',
          session_title_confidence: 0.7,
          latest_intent: 'Somewhat clear goal',
          latest_intent_confidence: 0.7,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolResultEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(DEFAULT_SESSION_SUMMARY_CONFIG.countdown.mediumConfidence)
    })

    it('uses medium confidence tier at upper boundary (average = 0.8, not > 0.8)', async () => {
      const sessionId = 'test-med-conf-upper'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Average: exactly 0.8 - implementation uses > 0.8 for high, so 0.8 is medium
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Task E',
          session_title_confidence: 0.8,
          latest_intent: 'Goal F',
          latest_intent_confidence: 0.8,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolResultEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(DEFAULT_SESSION_SUMMARY_CONFIG.countdown.mediumConfidence)
    })
  })

  describe('Countdown Reset - Low Confidence', () => {
    it('resets countdown to configured lowConfidence value when average <= 0.6', async () => {
      const sessionId = 'test-low-conf-1'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Low confidence: average = 0.5 <= 0.6
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Unclear Task',
          session_title_confidence: 0.5,
          latest_intent: 'Uncertain goal',
          latest_intent_confidence: 0.5,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolResultEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(DEFAULT_SESSION_SUMMARY_CONFIG.countdown.lowConfidence)
    })

    it('uses low confidence tier at boundary (average = 0.6, not > 0.6)', async () => {
      const sessionId = 'test-low-conf-boundary'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      // Average: exactly 0.6 - implementation uses > 0.6 for medium, so 0.6 is low
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Task I',
          session_title_confidence: 0.6,
          latest_intent: 'Goal J',
          latest_intent_confidence: 0.6,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolResultEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(DEFAULT_SESSION_SUMMARY_CONFIG.countdown.lowConfidence)
    })

    it('uses low confidence tier for zero confidence', async () => {
      const sessionId = 'test-low-conf-zero'

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 0 })

      llm.queueResponse(
        JSON.stringify({
          session_title: 'No idea',
          session_title_confidence: 0,
          latest_intent: 'Processing',
          latest_intent_confidence: 0,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolResultEvent(sessionId), ctx)

      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(DEFAULT_SESSION_SUMMARY_CONFIG.countdown.lowConfidence)
    })
  })

  describe('Countdown State Initialization', () => {
    it('initializes countdown to 0 when no state file exists, triggering immediate analysis', async () => {
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

      await updateSessionSummary(createToolResultEvent(sessionId), ctx)

      // With no state file, countdown starts at 0, triggers analysis immediately
      expect(llm.recordedRequests).toHaveLength(1)

      // After analysis, countdown should be reset to configured medium tier (0.8 avg)
      const state = await readCountdownState(sessionId)
      expect(state.countdown).toBe(DEFAULT_SESSION_SUMMARY_CONFIG.countdown.mediumConfidence)
    })
  })

  describe('Sequential ToolResult Countdown Flow', () => {
    it('processes multiple ToolResult events in sequence, resetting to configured tier after analysis', async () => {
      const sessionId = 'test-sequence-1'

      // Start with countdown = 3
      await writeCountdownState(sessionId, { countdown: 3, bookmark_line: 0 })

      // Event 1: countdown 3 → 2
      await updateSessionSummary(createToolResultEvent(sessionId, 100), ctx)
      expect((await readCountdownState(sessionId)).countdown).toBe(2)
      expect(llm.recordedRequests).toHaveLength(0)

      // Event 2: countdown 2 → 1
      await updateSessionSummary(createToolResultEvent(sessionId, 105), ctx)
      expect((await readCountdownState(sessionId)).countdown).toBe(1)
      expect(llm.recordedRequests).toHaveLength(0)

      // Event 3: countdown 1 → 0
      await updateSessionSummary(createToolResultEvent(sessionId, 110), ctx)
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

      await updateSessionSummary(createToolResultEvent(sessionId, 115), ctx)
      expect(llm.recordedRequests).toHaveLength(1)

      // Countdown reset to configured high confidence tier (0.9 + 0.85) / 2 = 0.875 > 0.8
      const finalState = await readCountdownState(sessionId)
      expect(finalState.countdown).toBe(DEFAULT_SESSION_SUMMARY_CONFIG.countdown.highConfidence)
    })
  })

  describe('Bookmark Line Management', () => {
    /**
     * Bookmark behavior (see docs/design/FEATURE-SESSION-SUMMARY.md §3.2.2):
     * - High confidence (avg > 0.8): set bookmark to current lineNumber
     * - Low confidence (avg < 0.7): reset bookmark to 0 (possible topic pivot)
     * - Medium confidence (0.7-0.8): preserve existing bookmark
     */

    it('sets bookmark to event lineNumber when confidence > 0.8 (high confidence)', async () => {
      const sessionId = 'test-bookmark-high'
      const eventLineNumber = 250

      // Start with existing bookmark at line 100
      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 100 })

      // Queue high confidence response (avg = 0.9)
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Clear Task',
          session_title_confidence: 0.92,
          latest_intent: 'Building feature',
          latest_intent_confidence: 0.88,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolResultEvent(sessionId, eventLineNumber), ctx)

      const state = await readCountdownState(sessionId)
      // High confidence: bookmark should be updated to event's lineNumber
      expect(state.bookmark_line).toBe(eventLineNumber)
    })

    it('resets bookmark to 0 when confidence < 0.7 (low confidence / pivot)', async () => {
      const sessionId = 'test-bookmark-low'

      // Start with existing bookmark at line 200
      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 200 })

      // Queue low confidence response (avg = 0.5 < 0.7)
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Unclear Direction',
          session_title_confidence: 0.4,
          latest_intent: 'Maybe debugging?',
          latest_intent_confidence: 0.6,
          pivot_detected: true,
        })
      )

      await updateSessionSummary(createToolResultEvent(sessionId, 300), ctx)

      const state = await readCountdownState(sessionId)
      // Low confidence: bookmark should be reset to 0
      expect(state.bookmark_line).toBe(0)
    })

    it('preserves existing bookmark when confidence is between 0.7 and 0.8 (medium confidence)', async () => {
      const sessionId = 'test-bookmark-medium'
      const existingBookmark = 150

      // Start with existing bookmark
      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: existingBookmark })

      // Queue medium confidence response (avg = 0.75, between 0.7 and 0.8)
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Working on Feature',
          session_title_confidence: 0.78,
          latest_intent: 'Adding tests',
          latest_intent_confidence: 0.72,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolResultEvent(sessionId, 400), ctx)

      const state = await readCountdownState(sessionId)
      // Medium confidence: bookmark should be preserved
      expect(state.bookmark_line).toBe(existingBookmark)
    })

    it('preserves bookmark at exactly 0.7 confidence (boundary - medium tier)', async () => {
      const sessionId = 'test-bookmark-boundary-low'
      const existingBookmark = 175

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: existingBookmark })

      // Queue response at exactly 0.7 average (boundary between low and medium)
      // 0.7 is NOT < 0.7, so it falls into "preserve" territory
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Boundary Test',
          session_title_confidence: 0.7,
          latest_intent: 'Testing boundaries',
          latest_intent_confidence: 0.7,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolResultEvent(sessionId, 500), ctx)

      const state = await readCountdownState(sessionId)
      // At exactly 0.7: not < 0.7, not > 0.8, so preserve
      expect(state.bookmark_line).toBe(existingBookmark)
    })

    it('sets bookmark at exactly 0.81 confidence (boundary - high tier)', async () => {
      const sessionId = 'test-bookmark-boundary-high'
      const eventLineNumber = 600

      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: 100 })

      // Queue response at just above 0.8 (0.81 average)
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Clear Direction',
          session_title_confidence: 0.82,
          latest_intent: 'Implementing feature',
          latest_intent_confidence: 0.8,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createToolResultEvent(sessionId, eventLineNumber), ctx)

      const state = await readCountdownState(sessionId)
      // At 0.81 (> 0.8): set bookmark to lineNumber
      expect(state.bookmark_line).toBe(eventLineNumber)
    })

    it('bookmark persists across multiple analyses when confidence stays medium', async () => {
      const sessionId = 'test-bookmark-persist'
      const initialBookmark = 50

      // Set initial high-confidence bookmark
      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: initialBookmark })

      // First analysis: medium confidence (0.75) - should preserve bookmark
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Feature Work',
          session_title_confidence: 0.75,
          latest_intent: 'Adding code',
          latest_intent_confidence: 0.75,
          pivot_detected: false,
        })
      )
      await updateSessionSummary(createToolResultEvent(sessionId, 200), ctx)

      let state = await readCountdownState(sessionId)
      expect(state.bookmark_line).toBe(initialBookmark)

      // Reset countdown for next analysis
      await writeCountdownState(sessionId, { countdown: 0, bookmark_line: state.bookmark_line })

      // Second analysis: still medium confidence - should still preserve
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Feature Work Continued',
          session_title_confidence: 0.72,
          latest_intent: 'More code',
          latest_intent_confidence: 0.78,
          pivot_detected: false,
        })
      )
      await updateSessionSummary(createToolResultEvent(sessionId, 300), ctx)

      state = await readCountdownState(sessionId)
      expect(state.bookmark_line).toBe(initialBookmark)
    })
  })
})
