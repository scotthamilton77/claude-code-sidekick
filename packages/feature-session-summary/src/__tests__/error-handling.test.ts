/**
 * Error Handling Tests for Session Summary Handler
 *
 * Tests error paths and edge cases:
 * - Missing prompt templates
 * - LLM response parse failures
 * - JSON extraction from markdown code blocks
 * - Side-effect failures (snarky message, resume message)
 * - LLM API errors
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
import type { DaemonContext, LLMRequest, LLMResponse } from '@sidekick/types'
import { updateSessionSummary } from '../handlers/update-summary'
import type { TranscriptEvent } from '@sidekick/core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/**
 * Extended MockLLMService with error simulation support.
 * Uses a combined queue where each item can be either a response string or an Error.
 */
class MockLLMServiceWithErrors extends MockLLMService {
  private combinedQueue: Array<string | Error> = []

  /**
   * Queue a response or error. Items are consumed in FIFO order.
   */
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

    // If next is an error, throw it
    if (next instanceof Error) {
      throw next
    }

    // If next is a string, return it as a response
    if (typeof next === 'string') {
      // Use parent class's private estimateTokens via a complete() call structure
      const inputTokens = Math.ceil(request.messages.reduce((sum, msg) => sum + msg.content.length, 0) / 4)
      const outputTokens = Math.ceil(next.length / 4)

      return {
        content: next,
        model: request.model ?? 'mock-model',
        usage: {
          inputTokens,
          outputTokens,
        },
        rawResponse: {
          status: 200,
          body: JSON.stringify({ content: next }),
        },
      }
    }

    // Fallback to default response
    return super.complete(request)
  }
}

describe('Session Summary Error Handling', () => {
  let ctx: DaemonContext
  let logger: MockLogger
  let handlers: MockHandlerRegistry
  let llm: MockLLMServiceWithErrors
  let assets: MockAssetResolver
  let transcript: MockTranscriptService
  let stateService: MockStateService
  let tempDir: string

  beforeEach(async () => {
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()
    llm = new MockLLMServiceWithErrors()
    assets = new MockAssetResolver()
    transcript = new MockTranscriptService()

    // Create temp directory for plain text files (snarky-message.txt)
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

  describe('Missing Prompt Template', () => {
    it('logs error and returns early when main prompt template is missing', async () => {
      const sessionId = 'test-session-missing-prompt'

      // Don't register the main prompt template
      // (assets.resolve() will return null)

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify error was logged
      const errorLogs = logger.recordedLogs.filter((log) => log.level === 'error')
      expect(errorLogs).toHaveLength(1)
      expect(errorLogs[0].msg).toBe('Failed to load session summary prompt template')
      expect(errorLogs[0].meta?.path).toBe('prompts/session-summary.prompt.txt')

      // Verify no LLM call was made
      expect(llm.recordedRequests).toHaveLength(0)

      // Verify no state file was written
      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      expect(stateService.has(statePath)).toBe(false)
    })
  })

  describe('LLM Response Parse Failures', () => {
    it('logs warning and uses fallback values when LLM returns unparseable JSON', async () => {
      const sessionId = 'test-session-invalid-json'

      // Register prompt template
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )

      // Queue invalid JSON response
      llm.queueResponse('This is not valid JSON at all!')

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify warning was logged
      const warnLogs = logger.recordedLogs.filter((log) => log.level === 'warn')
      expect(warnLogs.some((log) => log.msg === 'Failed to parse LLM response')).toBe(true)

      // Verify fallback values were used in state file
      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      const stateContent = stateService.getStored(statePath) as Record<string, unknown>

      expect(stateContent.session_title).toBe('Analysis pending...')
      expect(stateContent.session_title_confidence).toBe(0)
      expect(stateContent.latest_intent).toBe('Processing...')
      expect(stateContent.latest_intent_confidence).toBe(0)
    })

    it('logs warning when LLM returns JSON with invalid schema', async () => {
      const sessionId = 'test-session-invalid-schema'

      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )

      // Queue JSON with missing required fields
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Valid Title',
          // Missing required fields: session_title_confidence, latest_intent, etc.
        })
      )

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify warning was logged
      const warnLogs = logger.recordedLogs.filter((log) => log.level === 'warn')
      expect(warnLogs.some((log) => log.msg === 'Failed to parse LLM response')).toBe(true)

      // Verify fallback values were used
      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      const stateContent = stateService.getStored(statePath) as Record<string, unknown>

      expect(stateContent.session_title).toBe('Analysis pending...')
    })
  })

  describe('Prompt Interpolation', () => {
    it('interpolates transcript, previousAnalysis, and previousConfidence into prompt', async () => {
      const sessionId = 'test-prompt-interpolation'

      // Write existing summary to provide previousAnalysis
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      stateService.setStored(summaryPath, {
        session_id: sessionId,
        session_title: 'Previous Task',
        session_title_confidence: 0.75,
        latest_intent: 'Previous goal',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // Pre-create resume file so resume generation doesn't trigger
      const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
      stateService.setStored(resumePath, {
        last_task_id: null,
        session_title: 'Previous Task',
        snarky_comment: 'Snarky',
        timestamp: new Date().toISOString(),
      })

      // Use a prompt template with all three variables
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Transcript: {{transcript}}\nConfidence: {{previousConfidence}}\nPrevious: {{previousAnalysis}}'
      )

      // Set specific transcript content
      transcript.setMockExcerptContent('User: Test message\nAssistant: Test response')

      // Queue response (same values, no side effects)
      llm.queueResponse(
        JSON.stringify({
          session_title: 'Previous Task',
          session_title_confidence: 0.75,
          latest_intent: 'Previous goal',
          latest_intent_confidence: 0.8,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify the prompt was interpolated correctly
      expect(llm.recordedRequests).toHaveLength(1)
      const promptContent = llm.recordedRequests[0].messages[0].content

      // Check transcript interpolation
      expect(promptContent).toContain('Transcript: User: Test message')

      // Check previousConfidence interpolation
      expect(promptContent).toContain('Confidence: 0.75')

      // Check previousAnalysis interpolation (contains the JSON object)
      expect(promptContent).toContain('"session_title": "Previous Task"')
    })
  })

  describe('JSON Extraction from Markdown Code Blocks', () => {
    it('extracts and parses JSON from ```json code block', async () => {
      const sessionId = 'test-session-markdown-json'

      // Pre-create existing summary with SAME values (so no snarky message triggered)
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      stateService.setStored(summaryPath, {
        session_id: sessionId,
        session_title: 'Bug Fixing Session',
        session_title_confidence: 0.85,
        latest_intent: 'Debugging authentication',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // Pre-create resume file so resume generation doesn't trigger
      const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
      stateService.setStored(resumePath, {
        last_task_id: null,
        session_title: 'Bug Fixing Session',
        snarky_comment: 'Existing snarky',
        timestamp: new Date().toISOString(),
      })

      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )

      // Queue response wrapped in markdown code block (same values as existing, no snarky triggered)
      const validResponse = {
        session_title: 'Bug Fixing Session',
        session_title_confidence: 0.85,
        latest_intent: 'Debugging authentication',
        latest_intent_confidence: 0.8,
        pivot_detected: false,
      }

      llm.queueResponse(`Here's my analysis:\n\`\`\`json\n${JSON.stringify(validResponse, null, 2)}\n\`\`\``)

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify no warnings were logged
      const warnLogs = logger.recordedLogs.filter((log) => log.level === 'warn')
      expect(warnLogs).toHaveLength(0)

      // Verify correct values were extracted and saved
      const stateContent = stateService.getStored(summaryPath) as Record<string, unknown>

      expect(stateContent.session_title).toBe('Bug Fixing Session')
      expect(stateContent.session_title_confidence).toBe(0.85)
      expect(stateContent.latest_intent).toBe('Debugging authentication')
      expect(stateContent.latest_intent_confidence).toBe(0.8)
    })

    it('extracts and parses JSON from ``` code block without language specifier', async () => {
      const sessionId = 'test-session-markdown-no-lang'

      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )

      const validResponse = {
        session_title: 'Code Review',
        session_title_confidence: 0.9,
        latest_intent: 'Reviewing pull request',
        latest_intent_confidence: 0.85,
        pivot_detected: false,
      }

      llm.queueResponse(`\`\`\`\n${JSON.stringify(validResponse)}\n\`\`\``)

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify correct parsing
      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      const stateContent = stateService.getStored(statePath) as Record<string, unknown>

      expect(stateContent.session_title).toBe('Code Review')
      expect(stateContent.session_title_confidence).toBe(0.9)
    })

    it('handles JSON with extra whitespace in code block', async () => {
      const sessionId = 'test-session-whitespace'

      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )

      const validResponse = {
        session_title: 'Refactoring',
        session_title_confidence: 0.88,
        latest_intent: 'Cleaning up code',
        latest_intent_confidence: 0.82,
        pivot_detected: false,
      }

      llm.queueResponse(`\`\`\`json\n\n\n${JSON.stringify(validResponse, null, 2)}\n\n\n\`\`\``)

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify correct parsing despite extra whitespace
      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      const stateContent = stateService.getStored(statePath) as Record<string, unknown>

      expect(stateContent.session_title).toBe('Refactoring')
    })
  })

  describe('Snarky Message Error Handling', () => {
    it('logs warning and continues when snarky prompt template is missing', async () => {
      const sessionId = 'test-session-no-snarky-prompt'

      // Write existing summary to trigger title change
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      stateService.setStored(summaryPath, {
        session_id: sessionId,
        session_title: 'Old Title',
        session_title_confidence: 0.8,
        latest_intent: 'Old intent',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // Register main prompt but NOT snarky prompt
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )

      // Queue response that will trigger snarky message generation (title changed)
      llm.queueResponse(
        JSON.stringify({
          session_title: 'New Title',
          session_title_confidence: 0.9,
          latest_intent: 'New intent',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        })
      )

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify warning was logged
      const warnLogs = logger.recordedLogs.filter((log) => log.level === 'warn')
      expect(warnLogs.some((log) => log.msg === 'Snarky message prompt not found')).toBe(true)

      // Verify main summary was still updated (flow continued)
      const summaryContent = stateService.getStored(summaryPath) as Record<string, unknown>
      expect(summaryContent.session_title).toBe('New Title')

      // Verify snarky message file was not created (plain text, uses fs)
      const snarkyPath = stateService.sessionStatePath(sessionId, 'snarky-message.txt')
      await expect(fs.access(snarkyPath)).rejects.toThrow()
    })

    it('logs warning and continues when snarky LLM call fails', async () => {
      const sessionId = 'test-session-snarky-llm-error'

      // Write existing summary to trigger title change
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      stateService.setStored(summaryPath, {
        session_id: sessionId,
        session_title: 'Old Title',
        session_title_confidence: 0.8,
        latest_intent: 'Old intent',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // Register all prompts
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )
      assets.register('prompts/snarky-message.prompt.txt', 'Generate snark for: {{session_title}}')

      // Queue successful summary response first, then queue error for second call (snarky)
      // Note: errors are checked first in complete(), so we queue the error AFTER the response
      llm.queueResponse(
        JSON.stringify({
          session_title: 'New Title',
          session_title_confidence: 0.9,
          latest_intent: 'New intent',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        })
      )
      // Queue error after the response so it applies to the 2nd LLM call
      llm.queueError(new Error('LLM API timeout'))

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify warning was logged about snarky failure
      const warnLogs = logger.recordedLogs.filter((log) => log.level === 'warn')
      expect(warnLogs.some((log) => log.msg === 'Failed to generate snarky message')).toBe(true)

      // Verify main summary was still updated
      const summaryContent = stateService.getStored(summaryPath) as Record<string, unknown>
      expect(summaryContent.session_title).toBe('New Title')
    })
  })

  describe('Resume Message Error Handling', () => {
    it('logs warning and continues when resume prompt template is missing', async () => {
      const sessionId = 'test-session-no-resume-prompt'

      // Register main prompt but NOT resume prompt
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )

      // Queue response with pivot detected and high confidence
      llm.queueResponse(
        JSON.stringify({
          session_title: 'New Direction',
          session_title_confidence: 0.85,
          latest_intent: 'Starting new feature',
          latest_intent_confidence: 0.85,
          pivot_detected: true,
        })
      )

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify warning was logged
      const warnLogs = logger.recordedLogs.filter((log) => log.level === 'warn')
      expect(warnLogs.some((log) => log.msg === 'Resume message prompt not found')).toBe(true)

      // Verify main summary was still updated
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      const summaryContent = stateService.getStored(summaryPath) as Record<string, unknown>
      expect(summaryContent.session_title).toBe('New Direction')
      expect(summaryContent.pivot_detected).toBe(true)

      // Verify resume file was not created
      const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
      expect(stateService.has(resumePath)).toBe(false)
    })

    it('accepts plain text resume message response', async () => {
      const sessionId = 'test-session-resume-plain-text'

      // Register all prompts
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )
      assets.register(
        'prompts/resume-message.prompt.txt',
        'Generate resume for: {{sessionTitle}} ({{confidence}})\n{{latestIntent}}\n{{transcript}}'
      )

      // Queue responses: 1) summary with pivot, 2) plain text resume response
      llm.queueResponses([
        JSON.stringify({
          session_title: 'New Project',
          session_title_confidence: 0.85,
          latest_intent: 'Starting fresh',
          latest_intent_confidence: 0.85,
          pivot_detected: true,
        }),
        'Ready to dive back in?', // Plain text is now valid (no longer requires JSON)
      ])

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify main summary was still updated
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      const summaryContent = stateService.getStored(summaryPath) as Record<string, unknown>
      expect(summaryContent.session_title).toBe('New Project')

      // Verify resume file was created with plain text as snarky_comment
      const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
      expect(stateService.has(resumePath)).toBe(true)
      const resumeContent = stateService.getStored(resumePath) as Record<string, unknown>
      expect(resumeContent.snarky_comment).toBe('Ready to dive back in?')
    })

    it('handles plain text resume message with surrounding quotes', async () => {
      const sessionId = 'test-session-resume-quotes'

      // Register all prompts
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )
      assets.register(
        'prompts/resume-message.prompt.txt',
        'Generate resume for: {{sessionTitle}} ({{confidence}})\n{{latestIntent}}\n{{transcript}}'
      )

      // Queue responses: 1) summary with pivot, 2) resume as quoted plain text
      llm.queueResponses([
        JSON.stringify({
          session_title: 'Refactoring Session',
          session_title_confidence: 0.9,
          latest_intent: 'Cleaning up legacy code',
          latest_intent_confidence: 0.88,
          pivot_detected: true,
        }),
        '"Back from lunch break?"', // Quoted plain text - quotes should be stripped
      ])

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify resume message was saved with quotes stripped
      const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
      const resumeContent = stateService.getStored(resumePath) as Record<string, unknown>

      expect(resumeContent.snarky_comment).toBe('Back from lunch break?')
    })

    it('logs warning and continues when resume LLM call throws', async () => {
      const sessionId = 'test-session-resume-llm-throws'

      // Register all prompts
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )
      assets.register(
        'prompts/resume-message.prompt.txt',
        'Generate resume for: {{sessionTitle}} ({{confidence}})\n{{latestIntent}}\n{{transcript}}'
      )

      // Queue successful summary first, then error for second call (resume)
      llm.queueResponse(
        JSON.stringify({
          session_title: 'New Feature',
          session_title_confidence: 0.85,
          latest_intent: 'Building authentication',
          latest_intent_confidence: 0.85,
          pivot_detected: true,
        })
      )
      // Queue error after response so it applies to the 2nd LLM call
      llm.queueError(new Error('Network timeout'))

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify warning was logged
      const warnLogs = logger.recordedLogs.filter((log) => log.level === 'warn')
      expect(warnLogs.some((log) => log.msg === 'Failed to generate resume message')).toBe(true)

      // Verify main summary was still updated
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      const summaryContent = stateService.getStored(summaryPath) as Record<string, unknown>
      expect(summaryContent.session_title).toBe('New Feature')

      // Verify resume file was not created
      const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
      expect(stateService.has(resumePath)).toBe(false)
    })
  })

  describe('Main LLM Call Error Handling', () => {
    it('logs error and uses fallback values when main LLM call throws', async () => {
      const sessionId = 'test-session-main-llm-error'

      // Register prompt template
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )

      // Queue error for main LLM call
      llm.queueError(new Error('API rate limit exceeded'))

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify error was logged
      const errorLogs = logger.recordedLogs.filter((log) => log.level === 'error')
      expect(errorLogs.some((log) => log.msg === 'LLM call failed')).toBe(true)

      // Verify fallback values were used and state was still written
      const statePath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      const stateContent = stateService.getStored(statePath) as Record<string, unknown>

      expect(stateContent.session_title).toBe('Analysis pending...')
      expect(stateContent.session_title_confidence).toBe(0)
      expect(stateContent.latest_intent).toBe('Processing...')
      expect(stateContent.latest_intent_confidence).toBe(0)
    })

    it('preserves previous values when main LLM call fails with existing state', async () => {
      const sessionId = 'test-session-preserve-on-error'

      // Write existing summary
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      stateService.setStored(summaryPath, {
        session_id: sessionId,
        session_title: 'Previous Title',
        session_title_confidence: 0.8,
        latest_intent: 'Previous Intent',
        latest_intent_confidence: 0.75,
        timestamp: new Date().toISOString(),
      })

      // Register prompt template
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )

      // Queue error for main LLM call
      llm.queueError(new Error('Connection timeout'))

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify previous values were preserved as fallback
      const stateContent = stateService.getStored(summaryPath) as Record<string, unknown>

      expect(stateContent.session_title).toBe('Previous Title')
      expect(stateContent.session_title_confidence).toBe(0.8)
      expect(stateContent.latest_intent).toBe('Previous Intent')
      expect(stateContent.latest_intent_confidence).toBe(0.75)
    })
  })

  describe('Multiple Side-Effect Failures', () => {
    it('handles both snarky and resume failures gracefully', async () => {
      const sessionId = 'test-session-multiple-side-effects'

      // Write existing summary to trigger title change
      const summaryPath = stateService.sessionStatePath(sessionId, 'session-summary.json')
      stateService.setStored(summaryPath, {
        session_id: sessionId,
        session_title: 'Old Title',
        session_title_confidence: 0.8,
        latest_intent: 'Old intent',
        latest_intent_confidence: 0.8,
        timestamp: new Date().toISOString(),
      })

      // Register all prompts
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )
      assets.register('prompts/snarky-message.prompt.txt', 'Generate snark for: {{session_title}}')
      assets.register('prompts/resume-message.prompt.txt', 'Generate resume for: {{sessionTitle}}')

      // Queue: 1) summary with pivot and title change (triggers both side-effects)
      // Then queue errors for calls 2 and 3
      llm.queueResponse(
        JSON.stringify({
          session_title: 'New Title',
          session_title_confidence: 0.9,
          latest_intent: 'New intent',
          latest_intent_confidence: 0.9,
          pivot_detected: true,
        })
      )
      // Both side-effects will run in parallel, both should fail
      llm.queueError(new Error('Snarky LLM failed'))
      llm.queueError(new Error('Resume LLM failed'))

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify both warnings were logged
      const warnLogs = logger.recordedLogs.filter((log) => log.level === 'warn')
      expect(warnLogs.some((log) => log.msg === 'Failed to generate snarky message')).toBe(true)
      expect(warnLogs.some((log) => log.msg === 'Failed to generate resume message')).toBe(true)

      // Verify main summary was still updated correctly
      const summaryContent = stateService.getStored(summaryPath) as Record<string, unknown>
      expect(summaryContent.session_title).toBe('New Title')
      expect(summaryContent.pivot_detected).toBe(true)

      // Verify no side-effect files were created
      const snarkyPath = stateService.sessionStatePath(sessionId, 'snarky-message.txt')
      const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
      await expect(fs.access(snarkyPath)).rejects.toThrow()
      expect(stateService.has(resumePath)).toBe(false)
    })
  })
})
