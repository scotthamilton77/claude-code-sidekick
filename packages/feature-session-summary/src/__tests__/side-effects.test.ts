/**
 * Tests for Session Summary side-effects (snarky message & resume message generation)
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.2.4
 * @see docs/design/FEATURE-RESUME.md
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

describe('Session Summary Side-Effects', () => {
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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-test-'))

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

  describe('Snarky Message Generation', () => {
    it('generates snarky message when title changes', async () => {
      const sessionId = 'test-session-1'
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Write existing summary with different title
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

      // Check snarky message was generated
      const snarkyPath = path.join(stateDir, 'snarky-message.txt')
      const snarkyContent = await fs.readFile(snarkyPath, 'utf-8')
      expect(snarkyContent).toBe('Still wrestling with bugs, I see.')
    })

    it('strips surrounding double quotes from snarky message', async () => {
      const sessionId = 'test-session-quotes-double'
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

      const snarkyPath = path.join(stateDir, 'snarky-message.txt')
      const snarkyContent = await fs.readFile(snarkyPath, 'utf-8')
      expect(snarkyContent).toBe('Bugs beware, the fixer is here!')
    })

    it('strips surrounding single quotes from snarky message', async () => {
      const sessionId = 'test-session-quotes-single'
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

      const snarkyPath = path.join(stateDir, 'snarky-message.txt')
      const snarkyContent = await fs.readFile(snarkyPath, 'utf-8')
      expect(snarkyContent).toBe('Another day, another bug.')
    })

    it('preserves internal quotes in snarky message', async () => {
      const sessionId = 'test-session-quotes-internal'
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

      const snarkyPath = path.join(stateDir, 'snarky-message.txt')
      const snarkyContent = await fs.readFile(snarkyPath, 'utf-8')
      expect(snarkyContent).toBe('Bugs say "hello" to you.')
    })

    it('generates snarky message when intent changes', async () => {
      const sessionId = 'test-session-2'
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Write existing summary with same title but different intent
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: sessionId,
          session_title: 'Bug Fixing',
          session_title_confidence: 0.8,
          latest_intent: 'Investigating error',
          latest_intent_confidence: 0.8,
        })
      )

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

      const snarkyPath = path.join(stateDir, 'snarky-message.txt')
      const snarkyContent = await fs.readFile(snarkyPath, 'utf-8')
      expect(snarkyContent).toBe('Testing now? Ambitious.')
    })

    it('does not generate snarky message when nothing changes', async () => {
      const sessionId = 'test-session-3'
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Write existing summary
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: sessionId,
          session_title: 'Same Title',
          session_title_confidence: 0.8,
          latest_intent: 'Same intent',
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
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Pre-create existing summary (so this isn't initial analysis - avoids snarky side-effect)
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: sessionId,
          session_title: 'Old Project',
          session_title_confidence: 0.8,
          latest_intent: 'Old intent',
          latest_intent_confidence: 0.8,
        })
      )

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
      const resumePath = path.join(stateDir, 'resume-message.json')
      const resumeContent = JSON.parse(await fs.readFile(resumePath, 'utf-8'))
      expect(resumeContent.resume_last_goal_message).toBe('Shall we resume refactoring?')
      expect(resumeContent.snarky_comment).toBe('Back from the void, ready to refactor?')
    })

    it('generates resume message when no resume exists (even without pivot)', async () => {
      const sessionId = 'test-session-5'
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Pre-create existing summary with SAME values (so no snarky message triggered)
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: sessionId,
          session_title: 'Continuing work',
          session_title_confidence: 0.8,
          latest_intent: 'Same task',
          latest_intent_confidence: 0.8,
        })
      )

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
      const resumePath = path.join(stateDir, 'resume-message.json')
      const resumeContent = JSON.parse(await fs.readFile(resumePath, 'utf-8'))
      expect(resumeContent.resume_last_goal_message).toBe('Ready to continue?')
    })

    it('does not regenerate resume message when resume exists and no pivot', async () => {
      const sessionId = 'test-session-5b'
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Pre-create existing summary with SAME values (so no snarky message triggered)
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: sessionId,
          session_title: 'Continuing work',
          session_title_confidence: 0.8,
          latest_intent: 'Same task',
          latest_intent_confidence: 0.8,
        })
      )

      // Pre-create resume file
      await fs.writeFile(
        path.join(stateDir, 'resume-message.json'),
        JSON.stringify({
          resume_last_goal_message: 'Original resume',
          snarky_comment: 'Original snarky',
          timestamp: new Date().toISOString(),
        })
      )

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
      const resumePath = path.join(stateDir, 'resume-message.json')
      const resumeContent = JSON.parse(await fs.readFile(resumePath, 'utf-8'))
      expect(resumeContent.resume_last_goal_message).toBe('Original resume')
    })

    it('does not generate resume message when confidence is below threshold', async () => {
      const sessionId = 'test-session-6'
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Pre-create existing summary with SAME values (so no snarky message triggered)
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: sessionId,
          session_title: 'New Direction',
          session_title_confidence: 0.5,
          latest_intent: 'Exploring options',
          latest_intent_confidence: 0.5,
        })
      )

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
    it('continues main flow when snarky message fails', async () => {
      const sessionId = 'test-session-7'
      const stateDir = path.join(tempDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      // Write existing summary
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

      // First response succeeds, second (snarky) fails by returning invalid content
      llm.queueResponses([
        JSON.stringify({
          session_title: 'New Title',
          session_title_confidence: 0.9,
          latest_intent: 'New intent',
          latest_intent_confidence: 0.9,
          pivot_detected: false,
        }),
        '', // Empty response - will still be written but that's ok
      ])

      // Should not throw
      await expect(updateSessionSummary(createUserPromptEvent(sessionId), ctx)).resolves.not.toThrow()

      // Summary should still be updated
      const summaryPath = path.join(stateDir, 'session-summary.json')
      const summary = JSON.parse(await fs.readFile(summaryPath, 'utf-8'))
      expect(summary.session_title).toBe('New Title')
    })
  })
})
