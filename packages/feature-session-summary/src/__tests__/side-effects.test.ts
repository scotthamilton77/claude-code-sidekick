/**
 * Tests for Session Summary side-effects (snarky message & resume message generation)
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.2.4
 * @see docs/design/FEATURE-RESUME.md
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
import type { LLMRequest, LLMResponse } from '@sidekick/types'

/**
 * Extended MockLLMService with error simulation support.
 * Uses a combined queue where each item can be either a response string or an Error.
 */
class MockLLMServiceWithErrors extends MockLLMService {
  private combinedQueue: Array<string | Error> = []

  queueResponse(content: string): void {
    this.combinedQueue.push(content)
  }

  queueError(error: Error): void {
    this.combinedQueue.push(error)
  }

  queueResponses(contents: string[]): void {
    this.combinedQueue.push(...contents)
  }

  override async complete(request: LLMRequest): Promise<LLMResponse> {
    this.recordedRequests.push(request)

    const next = this.combinedQueue.shift()

    if (next instanceof Error) {
      throw next
    }

    if (typeof next === 'string') {
      const inputTokens = Math.ceil(request.messages.reduce((sum, msg) => sum + msg.content.length, 0) / 4)
      const outputTokens = Math.ceil(next.length / 4)

      return {
        content: next,
        model: request.model ?? 'mock-model',
        usage: { inputTokens, outputTokens },
        rawResponse: { status: 200, body: JSON.stringify({ content: next }) },
      }
    }

    return super.complete(request)
  }
}
import type { DaemonContext } from '@sidekick/types'
import { updateSessionSummary } from '../handlers/update-summary'
import type { TranscriptEvent } from '@sidekick/core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

describe('Session Summary Side-Effects', () => {
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

    // Create temp directory for test isolation
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-test-'))

    // Use tempDir as projectRoot so sessionStatePath returns paths in tempDir
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
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  function createUserPromptEvent(sessionId: string): TranscriptEvent {
    return {
      kind: 'transcript',
      eventType: 'UserPrompt',
      context: {
        sessionId,
        scope: 'project',
      },
      payload: {
        lineNumber: 100,
        content: 'Help me fix a bug',
      },
    } as TranscriptEvent
  }

  function createBulkProcessingEvent(sessionId: string): TranscriptEvent {
    return {
      kind: 'transcript',
      eventType: 'UserPrompt',
      context: {
        sessionId,
        scope: 'project',
      },
      payload: {
        lineNumber: 50,
        content: 'Help me debug',
      },
      metadata: {
        isBulkProcessing: true,
      },
    } as TranscriptEvent
  }

  function createBulkProcessingCompleteEvent(sessionId: string): TranscriptEvent {
    return {
      kind: 'transcript',
      eventType: 'BulkProcessingComplete',
      context: {
        sessionId,
        scope: 'project',
      },
      payload: {
        lineNumber: 100,
      },
    } as TranscriptEvent
  }

  describe('Bulk Processing Behavior', () => {
    it('skips LLM analysis during bulk processing (isBulkProcessing: true)', async () => {
      const sessionId = 'test-bulk-skip'

      // No need to queue LLM response since it should be skipped
      await updateSessionSummary(createBulkProcessingEvent(sessionId), ctx)

      // LLM should NOT be called during bulk processing
      expect(llm.recordedRequests).toHaveLength(0)

      // No summary file should be created
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      expect(stateService.has(summaryPath)).toBe(false)
    })

    it('triggers analysis on BulkProcessingComplete event when turnCount > 0', async () => {
      const sessionId = 'test-bulk-complete'

      // Must have at least one user turn to trigger analysis
      transcript.setMetrics({ turnCount: 1 })

      // Queue LLM responses:
      // 1) summary analysis
      // 2) snarky message (initial analysis triggers snarky)
      // 3) resume message (no resume exists, so it generates one)
      llm.queueResponses([
        JSON.stringify({
          session_title: 'Full Session Analysis',
          session_title_confidence: 0.9,
          latest_intent: 'Debugging complete',
          latest_intent_confidence: 0.85,
          pivot_detected: false,
        }),
        'Snarky message here',
        JSON.stringify({
          resume_message: 'Ready to continue',
          snarky_welcome: 'Welcome back',
        }),
      ])

      await updateSessionSummary(createBulkProcessingCompleteEvent(sessionId), ctx)

      // LLM should be called (summary + side effects)
      expect(llm.recordedRequests.length).toBeGreaterThanOrEqual(1)

      // Summary should be created
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      const summary = stateService.getStored(summaryPath) as Record<string, unknown>
      expect(summary.session_title).toBe('Full Session Analysis')
    })

    it('skips LLM analysis on BulkProcessingComplete when turnCount is 0', async () => {
      const sessionId = 'test-bulk-no-turns'

      // No user turns yet (only system entries like summary/file-history-snapshot)
      transcript.setMetrics({ turnCount: 0 })

      await updateSessionSummary(createBulkProcessingCompleteEvent(sessionId), ctx)

      // LLM should NOT be called
      expect(llm.recordedRequests).toHaveLength(0)

      // No summary file should be created
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      expect(stateService.has(summaryPath)).toBe(false)
    })
  })

  describe('Snarky Message Generation', () => {
    it('generates snarky message when title changes', async () => {
      const sessionId = 'test-session-1'

      // Write existing summary with different title using stateService
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      stateService.setStored(summaryPath, {
        session_id: sessionId,
        session_title: 'Old Title',
        session_title_confidence: 0.8,
        latest_intent: 'Old intent',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // Queue LLM responses: 1) summary, 2) snarky message
      llm.queueResponses([
        JSON.stringify({
          session_title: 'New Title',
          session_title_confidence: 0.9,
          latest_intent: 'New intent',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        }),
        'Still wrestling with bugs, I see.',
      ])

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Check snarky message was generated (JSON via stateService)
      const snarkyPath = stateService.sessionStatePath(sessionId, 'snarky-message.json')
      const snarkyContent = stateService.getStored(snarkyPath) as { message: string; timestamp: string }
      expect(snarkyContent.message).toBe('Still wrestling with bugs, I see.')
    })

    it('strips surrounding double quotes from snarky message', async () => {
      const sessionId = 'test-session-quotes-double'

      // Write existing summary to trigger title change
      stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
        session_id: sessionId,
        session_title: 'Old Title',
        session_title_confidence: 0.8,
        latest_intent: 'Old intent',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // LLM returns response with surrounding double quotes
      llm.queueResponses([
        JSON.stringify({
          session_title: 'New Title',
          session_title_confidence: 0.9,
          latest_intent: 'Fixing bugs',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        }),
        '"Bugs beware, the fixer is here!"',
      ])

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      const snarkyPath = stateService.sessionStatePath(sessionId, 'snarky-message.json')
      const snarkyContent = stateService.getStored(snarkyPath) as { message: string; timestamp: string }
      expect(snarkyContent.message).toBe('Bugs beware, the fixer is here!')
    })

    it('strips surrounding single quotes from snarky message', async () => {
      const sessionId = 'test-session-quotes-single'

      // Write existing summary to trigger title change
      stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
        session_id: sessionId,
        session_title: 'Old Title',
        session_title_confidence: 0.8,
        latest_intent: 'Old intent',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // LLM returns response with surrounding single quotes
      llm.queueResponses([
        JSON.stringify({
          session_title: 'New Title',
          session_title_confidence: 0.9,
          latest_intent: 'Fixing bugs',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        }),
        "'Another day, another bug.'",
      ])

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      const snarkyPath = stateService.sessionStatePath(sessionId, 'snarky-message.json')
      const snarkyContent = stateService.getStored(snarkyPath) as { message: string; timestamp: string }
      expect(snarkyContent.message).toBe('Another day, another bug.')
    })

    it('preserves internal quotes in snarky message', async () => {
      const sessionId = 'test-session-quotes-internal'

      // Write existing summary to trigger title change
      stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
        session_id: sessionId,
        session_title: 'Old Title',
        session_title_confidence: 0.8,
        latest_intent: 'Old intent',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // LLM returns response with quotes inside but not wrapping
      llm.queueResponses([
        JSON.stringify({
          session_title: 'New Title',
          session_title_confidence: 0.9,
          latest_intent: 'Fixing bugs',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        }),
        'Bugs say "hello" to you.',
      ])

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      const snarkyPath = stateService.sessionStatePath(sessionId, 'snarky-message.json')
      const snarkyContent = stateService.getStored(snarkyPath) as { message: string; timestamp: string }
      expect(snarkyContent.message).toBe('Bugs say "hello" to you.')
    })

    it('generates snarky message when intent changes', async () => {
      const sessionId = 'test-session-2'

      // Write existing summary with same title but different intent
      stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
        session_id: sessionId,
        session_title: 'Bug Fixing',
        session_title_confidence: 0.8,
        latest_intent: 'Investigating error',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      llm.queueResponses([
        JSON.stringify({
          session_title: 'Bug Fixing',
          session_title_confidence: 0.9,
          latest_intent: 'Writing tests',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        }),
        'Testing now? Ambitious.',
      ])

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      const snarkyPath = stateService.sessionStatePath(sessionId, 'snarky-message.json')
      const snarkyContent = stateService.getStored(snarkyPath) as { message: string; timestamp: string }
      expect(snarkyContent.message).toBe('Testing now? Ambitious.')
    })

    it('does not generate snarky message when nothing changes', async () => {
      const sessionId = 'test-session-3'

      // Write existing summary
      stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
        session_id: sessionId,
        session_title: 'Same Title',
        session_title_confidence: 0.8,
        latest_intent: 'Same intent',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // Pre-create resume file so resume generation doesn't trigger
      stateService.setStored(stateService.sessionStatePath(sessionId, 'resume-message.json'), {
        last_task_id: null,
        session_title: 'Same Title',
        resume_last_goal_message: 'Existing resume',
        snarky_comment: 'Existing snarky',
        timestamp: new Date().toISOString(),
      })

      // LLM returns same title/intent
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Same Title',
          session_title_confidence: 0.9,
          latest_intent: 'Same intent',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Should only have 1 LLM call (summary), not 2 (summary + snarky)
      expect(llm.recordedRequests).toHaveLength(1)
    })
  })

  describe('Resume Message Generation', () => {
    it('generates resume message when pivot is detected', async () => {
      const sessionId = 'test-session-4'

      // Pre-create existing summary (so this isn't initial analysis - avoids snarky side-effect)
      stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
        session_id: sessionId,
        session_title: 'Old Project',
        session_title_confidence: 0.8,
        latest_intent: 'Old intent',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // Queue LLM responses: 1) summary with pivot, 2) snarky (title changed), 3) resume message
      llm.queueResponses([
        JSON.stringify({
          session_title: 'New Project',
          session_title_confidence: 0.85,
          session_title_key_phrases: ['refactoring', 'cleanup', 'reorganization'],
          latest_intent: 'Starting fresh',
          latest_intent_confidence: 0.85,
          pivot_detected: true,
        }),
        'Still working on that project, I see.',
        JSON.stringify({
          resume_message: 'Shall we resume refactoring?',
          snarky_welcome: 'Back from the void, ready to refactor?',
        }),
      ])

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // LLM should be called 3 times (1: summary, 2: snarky, 3: resume)
      expect(llm.recordedRequests).toHaveLength(3)

      // Check resume message was generated
      const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
      const resumeContent = stateService.getStored(resumePath) as Record<string, unknown>
      expect(resumeContent.resume_last_goal_message).toBe('Shall we resume refactoring?')
      expect(resumeContent.snarky_comment).toBe('Back from the void, ready to refactor?')
    })

    it('generates resume message when no resume exists (even without pivot)', async () => {
      const sessionId = 'test-session-5'

      // Pre-create existing summary with SAME values (so no snarky message triggered)
      stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
        session_id: sessionId,
        session_title: 'Continuing work',
        session_title_confidence: 0.8,
        latest_intent: 'Same task',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // Queue LLM responses: 1) summary without pivot (same values), 2) resume message
      llm.queueResponses([
        JSON.stringify({
          session_title: 'Continuing work',
          session_title_confidence: 0.9,
          latest_intent: 'Same task',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        }),
        JSON.stringify({
          resume_message: 'Ready to continue?',
          snarky_welcome: 'Back already?',
        }),
      ])

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Should have 2 LLM calls (summary + resume) since no resume exists, no snarky (same title/intent)
      expect(llm.recordedRequests).toHaveLength(2)

      // Resume file should exist
      const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
      const resumeContent = stateService.getStored(resumePath) as Record<string, unknown>
      expect(resumeContent.resume_last_goal_message).toBe('Ready to continue?')
    })

    it('does not regenerate resume message when resume exists and no pivot', async () => {
      const sessionId = 'test-session-5b'

      // Pre-create existing summary with SAME values (so no snarky message triggered)
      stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
        session_id: sessionId,
        session_title: 'Continuing work',
        session_title_confidence: 0.8,
        latest_intent: 'Same task',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // Pre-create resume file (include all required schema fields)
      stateService.setStored(stateService.sessionStatePath(sessionId, 'resume-message.json'), {
        last_task_id: null,
        session_title: 'Continuing work',
        resume_last_goal_message: 'Original resume',
        snarky_comment: 'Original snarky',
        timestamp: new Date().toISOString(),
      })

      llm.queueResponse(
        JSON.stringify({
          session_title: 'Continuing work',
          session_title_confidence: 0.9,
          latest_intent: 'Same task',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Should only have 1 LLM call (summary) - resume already exists, no snarky (same values)
      expect(llm.recordedRequests).toHaveLength(1)

      // Resume file should still have original content
      const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
      const resumeContent = stateService.getStored(resumePath) as Record<string, unknown>
      expect(resumeContent.resume_last_goal_message).toBe('Original resume')
    })

    it('does not generate resume message when confidence is below threshold', async () => {
      const sessionId = 'test-session-6'

      // Pre-create existing summary with SAME values (so no snarky message triggered)
      stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
        session_id: sessionId,
        session_title: 'New Direction',
        session_title_confidence: 0.5,
        latest_intent: 'Exploring options',
        latest_intent_confidence: 0.5,
        timestamp: new Date().toISOString(),
      })

      // Pivot detected but low confidence
      llm.queueResponse(
        JSON.stringify({
          session_title: 'New Direction',
          session_title_confidence: 0.5, // Below 0.7 threshold
          latest_intent: 'Exploring options',
          latest_intent_confidence: 0.5,
          pivot_detected: true,
        })
      )

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Should only have 1 LLM call (summary) - resume skipped due to low confidence, no snarky (same values)
      expect(llm.recordedRequests).toHaveLength(1)
    })
  })

  describe('Side-Effect Error Handling', () => {
    it('continues main flow when snarky message LLM call fails', async () => {
      const sessionId = 'test-session-7'

      // Write existing summary to trigger title change -> snarky message
      stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
        session_id: sessionId,
        session_title: 'Old Title',
        session_title_confidence: 0.8,
        latest_intent: 'Old intent',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // Use MockLLMServiceWithErrors to inject actual error for snarky LLM call
      const llmWithErrors = new MockLLMServiceWithErrors()
      const ctxWithErrors = createMockDaemonContext({
        logger,
        handlers,
        llm: llmWithErrors,
        assets,
        transcript,
        stateService,
        paths: {
          projectDir: tempDir,
          userConfigDir: path.join(tempDir, '.sidekick'),
          projectConfigDir: path.join(tempDir, '.sidekick'),
        },
      })

      // First response succeeds (summary), second fails with actual error (snarky)
      llmWithErrors.queueResponse(
        JSON.stringify({
          session_title: 'New Title',
          session_title_confidence: 0.9,
          latest_intent: 'New intent',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        })
      )
      llmWithErrors.queueError(new Error('LLM API timeout'))

      // Should not throw - main flow continues despite snarky failure
      await expect(updateSessionSummary(createUserPromptEvent(sessionId), ctxWithErrors)).resolves.not.toThrow()

      // Summary should still be updated
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      const summary = stateService.getStored(summaryPath) as Record<string, unknown>
      expect(summary.session_title).toBe('New Title')

      // Snarky file should NOT exist since LLM call failed
      const snarkyPath = stateService.sessionStatePath(sessionId, 'snarky-message.json')
      expect(stateService.has(snarkyPath)).toBe(false)
    })
  })
})
