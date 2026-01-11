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
  let tempDir: string

  beforeEach(async () => {
    logger = new MockLogger()
    handlers = new MockHandlerRegistry()
    llm = new MockLLMServiceWithErrors()
    assets = new MockAssetResolver()
    transcript = new MockTranscriptService()

    // Create temp directory for state files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-test-'))

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
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const statePath = path.join(stateDir, 'session-summary.json')
      await expect(fs.access(statePath)).rejects.toThrow()
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
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const statePath = path.join(stateDir, 'session-summary.json')
      const stateContent = JSON.parse(await fs.readFile(statePath, 'utf-8'))

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
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const statePath = path.join(stateDir, 'session-summary.json')
      const stateContent = JSON.parse(await fs.readFile(statePath, 'utf-8'))

      expect(stateContent.session_title).toBe('Analysis pending...')
    })
  })

  describe('Prompt Interpolation', () => {
    it('interpolates transcript, previousAnalysis, and previousConfidence into prompt', async () => {
      const sessionId = 'test-prompt-interpolation'
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Write existing summary to provide previousAnalysis
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: sessionId,
          session_title: 'Previous Task',
          session_title_confidence: 0.75,
          latest_intent: 'Previous goal',
          latest_intent_confidence: 0.8,
        })
      )

      // Pre-create resume file so resume generation doesn't trigger
      await fs.writeFile(
        path.join(stateDir, 'resume-message.json'),
        JSON.stringify({
          resume_last_goal_message: 'Resume',
          snarky_comment: 'Snarky',
          timestamp: new Date().toISOString(),
        })
      )

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
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Pre-create existing summary with SAME values (so no snarky message triggered)
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: sessionId,
          session_title: 'Bug Fixing Session',
          session_title_confidence: 0.85,
          latest_intent: 'Debugging authentication',
          latest_intent_confidence: 0.8,
        })
      )

      // Pre-create resume file so resume generation doesn't trigger
      await fs.writeFile(
        path.join(stateDir, 'resume-message.json'),
        JSON.stringify({
          resume_last_goal_message: 'Existing resume',
          snarky_comment: 'Existing snarky',
          timestamp: new Date().toISOString(),
        })
      )

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
      const statePath = path.join(stateDir, 'session-summary.json')
      const stateContent = JSON.parse(await fs.readFile(statePath, 'utf-8'))

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
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const statePath = path.join(stateDir, 'session-summary.json')
      const stateContent = JSON.parse(await fs.readFile(statePath, 'utf-8'))

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
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const statePath = path.join(stateDir, 'session-summary.json')
      const stateContent = JSON.parse(await fs.readFile(statePath, 'utf-8'))

      expect(stateContent.session_title).toBe('Refactoring')
    })
  })

  describe('Snarky Message Error Handling', () => {
    it('logs warning and continues when snarky prompt template is missing', async () => {
      const sessionId = 'test-session-no-snarky-prompt'
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Write existing summary to trigger title change
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: sessionId,
          session_title: 'Old Title',
          session_title_confidence: 0.8,
          latest_intent: 'Old intent',
          latest_intent_confidence: 0.8,
        })
      )

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
      const summaryPath = path.join(stateDir, 'session-summary.json')
      const summaryContent = JSON.parse(await fs.readFile(summaryPath, 'utf-8'))
      expect(summaryContent.session_title).toBe('New Title')

      // Verify snarky message file was not created
      const snarkyPath = path.join(stateDir, 'snarky-message.txt')
      await expect(fs.access(snarkyPath)).rejects.toThrow()
    })

    it('logs warning and continues when snarky LLM call fails', async () => {
      const sessionId = 'test-session-snarky-llm-error'
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Write existing summary to trigger title change
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: sessionId,
          session_title: 'Old Title',
          session_title_confidence: 0.8,
          latest_intent: 'Old intent',
          latest_intent_confidence: 0.8,
        })
      )

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
      const summaryPath = path.join(stateDir, 'session-summary.json')
      const summaryContent = JSON.parse(await fs.readFile(summaryPath, 'utf-8'))
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
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const summaryPath = path.join(stateDir, 'session-summary.json')
      const summaryContent = JSON.parse(await fs.readFile(summaryPath, 'utf-8'))
      expect(summaryContent.session_title).toBe('New Direction')
      expect(summaryContent.pivot_detected).toBe(true)

      // Verify resume file was not created
      const resumePath = path.join(stateDir, 'resume-message.json')
      await expect(fs.access(resumePath)).rejects.toThrow()
    })

    it('logs warning when resume message response is unparseable', async () => {
      const sessionId = 'test-session-resume-parse-error'

      // Register all prompts
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )
      assets.register(
        'prompts/resume-message.prompt.txt',
        'Generate resume for: {{sessionTitle}} ({{confidence}})\n{{latestIntent}}\n{{transcript}}'
      )

      // Queue responses: 1) summary with pivot, 2) invalid resume response
      llm.queueResponses([
        JSON.stringify({
          session_title: 'New Project',
          session_title_confidence: 0.85,
          latest_intent: 'Starting fresh',
          latest_intent_confidence: 0.85,
          pivot_detected: true,
        }),
        'This is not valid JSON for resume message!',
      ])

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify warning was logged
      const warnLogs = logger.recordedLogs.filter((log) => log.level === 'warn')
      expect(warnLogs.some((log) => log.msg === 'Failed to parse resume message response')).toBe(true)

      // Verify main summary was still updated
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const summaryPath = path.join(stateDir, 'session-summary.json')
      const summaryContent = JSON.parse(await fs.readFile(summaryPath, 'utf-8'))
      expect(summaryContent.session_title).toBe('New Project')

      // Verify resume file was not created due to parse failure
      const resumePath = path.join(stateDir, 'resume-message.json')
      await expect(fs.access(resumePath)).rejects.toThrow()
    })

    it('extracts resume message JSON from markdown code block', async () => {
      const sessionId = 'test-session-resume-markdown'

      // Register all prompts
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )
      assets.register(
        'prompts/resume-message.prompt.txt',
        'Generate resume for: {{sessionTitle}} ({{confidence}})\n{{latestIntent}}\n{{transcript}}'
      )

      const resumeResponse = {
        resume_message: 'Ready to continue the refactoring?',
        snarky_welcome: 'Back from lunch break?',
      }

      // Queue responses: 1) summary with pivot, 2) resume in markdown block
      llm.queueResponses([
        JSON.stringify({
          session_title: 'Refactoring Session',
          session_title_confidence: 0.9,
          latest_intent: 'Cleaning up legacy code',
          latest_intent_confidence: 0.88,
          pivot_detected: true,
        }),
        `Here's the resume message:\n\`\`\`json\n${JSON.stringify(resumeResponse, null, 2)}\n\`\`\``,
      ])

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify resume message was extracted and saved
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const resumePath = path.join(stateDir, 'resume-message.json')
      const resumeContent = JSON.parse(await fs.readFile(resumePath, 'utf-8'))

      expect(resumeContent.resume_last_goal_message).toBe('Ready to continue the refactoring?')
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
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const summaryPath = path.join(stateDir, 'session-summary.json')
      const summaryContent = JSON.parse(await fs.readFile(summaryPath, 'utf-8'))
      expect(summaryContent.session_title).toBe('New Feature')

      // Verify resume file was not created
      const resumePath = path.join(stateDir, 'resume-message.json')
      await expect(fs.access(resumePath)).rejects.toThrow()
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
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      const statePath = path.join(stateDir, 'session-summary.json')
      const stateContent = JSON.parse(await fs.readFile(statePath, 'utf-8'))

      expect(stateContent.session_title).toBe('Analysis pending...')
      expect(stateContent.session_title_confidence).toBe(0)
      expect(stateContent.latest_intent).toBe('Processing...')
      expect(stateContent.latest_intent_confidence).toBe(0)
    })

    it('preserves previous values when main LLM call fails with existing state', async () => {
      const sessionId = 'test-session-preserve-on-error'
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Write existing summary
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: sessionId,
          session_title: 'Previous Title',
          session_title_confidence: 0.8,
          latest_intent: 'Previous Intent',
          latest_intent_confidence: 0.75,
        })
      )

      // Register prompt template
      assets.register(
        'prompts/session-summary.prompt.txt',
        'Analyze this transcript: {{transcript}}\nPrevious: {{previousAnalysis}}'
      )

      // Queue error for main LLM call
      llm.queueError(new Error('Connection timeout'))

      await updateSessionSummary(createUserPromptEvent(sessionId), ctx)

      // Verify previous values were preserved as fallback
      const statePath = path.join(stateDir, 'session-summary.json')
      const stateContent = JSON.parse(await fs.readFile(statePath, 'utf-8'))

      expect(stateContent.session_title).toBe('Previous Title')
      expect(stateContent.session_title_confidence).toBe(0.8)
      expect(stateContent.latest_intent).toBe('Previous Intent')
      expect(stateContent.latest_intent_confidence).toBe(0.75)
    })
  })

  describe('Multiple Side-Effect Failures', () => {
    it('handles both snarky and resume failures gracefully', async () => {
      const sessionId = 'test-session-multiple-side-effects'
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Write existing summary to trigger title change
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: sessionId,
          session_title: 'Old Title',
          session_title_confidence: 0.8,
          latest_intent: 'Old intent',
          latest_intent_confidence: 0.8,
        })
      )

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
      const summaryPath = path.join(stateDir, 'session-summary.json')
      const summaryContent = JSON.parse(await fs.readFile(summaryPath, 'utf-8'))
      expect(summaryContent.session_title).toBe('New Title')
      expect(summaryContent.pivot_detected).toBe(true)

      // Verify no side-effect files were created
      const snarkyPath = path.join(stateDir, 'snarky-message.txt')
      const resumePath = path.join(stateDir, 'resume-message.json')
      await expect(fs.access(snarkyPath)).rejects.toThrow()
      await expect(fs.access(resumePath)).rejects.toThrow()
    })
  })
})
