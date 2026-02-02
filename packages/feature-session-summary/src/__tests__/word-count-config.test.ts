/**
 * Tests for configurable word count limits in prompt interpolation.
 *
 * Verifies that maxTitleWords, maxIntentWords, maxSnarkyWords, and maxResumeWords
 * are correctly interpolated into prompts.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { interpolateTemplate } from '../handlers/update-summary.js'
import {
  createMockDaemonContext,
  MockLLMService,
  MockAssetResolver,
  MockStateService,
  MockTranscriptService,
  MockProfileProviderFactory,
} from '@sidekick/testing-fixtures'
import type { DaemonContext, SessionSummaryState } from '@sidekick/types'
import { generateSnarkyMessageOnDemand, generateResumeMessageOnDemand } from '../handlers/on-demand-generation.js'

// ============================================================================
// interpolateTemplate Tests for Word Count Tokens
// ============================================================================

describe('Word Count Config Interpolation', () => {
  describe('interpolateTemplate with word count tokens', () => {
    it('interpolates maxSnarkyWords token', () => {
      const template = 'Stay under {{maxSnarkyWords}} words'
      const result = interpolateTemplate(template, { maxSnarkyWords: 15 })
      expect(result).toBe('Stay under 15 words')
    })

    it('interpolates maxResumeWords token', () => {
      const template = 'Stay under {{maxResumeWords}} words'
      const result = interpolateTemplate(template, { maxResumeWords: 10 })
      expect(result).toBe('Stay under 10 words')
    })

    it('interpolates maxTitleWords token', () => {
      const template = 'Max {{maxTitleWords}} words for title'
      const result = interpolateTemplate(template, { maxTitleWords: 8 })
      expect(result).toBe('Max 8 words for title')
    })

    it('interpolates maxIntentWords token', () => {
      const template = 'Max {{maxIntentWords}} words for intent'
      const result = interpolateTemplate(template, { maxIntentWords: 12 })
      expect(result).toBe('Max 12 words for intent')
    })

    it('interpolates multiple word count tokens in same template', () => {
      const template = `
        Title: max {{maxTitleWords}} words
        Intent: max {{maxIntentWords}} words
      `
      const result = interpolateTemplate(template, {
        maxTitleWords: 8,
        maxIntentWords: 15,
      })
      expect(result).toContain('Title: max 8 words')
      expect(result).toContain('Intent: max 15 words')
    })

    it('handles custom word count values', () => {
      const template = 'Stay under {{maxSnarkyWords}} words'
      // Test with non-default value
      const result = interpolateTemplate(template, { maxSnarkyWords: 20 })
      expect(result).toBe('Stay under 20 words')
    })

    it('interpolates word counts alongside other tokens', () => {
      const template = `
        {{#if persona}}
        Name: {{persona_name}}
        {{/if}}
        Stay under {{maxSnarkyWords}} words.
        Session: {{session_title}}
      `
      const result = interpolateTemplate(template, {
        persona: true,
        persona_name: 'Skippy',
        maxSnarkyWords: 15,
        session_title: 'Debug Authentication',
      })
      expect(result).toContain('Name: Skippy')
      expect(result).toContain('Stay under 15 words')
      expect(result).toContain('Session: Debug Authentication')
    })
  })
})

// ============================================================================
// Integration Tests: Word Count Config in On-Demand Generation
// ============================================================================

describe('Word Count Config in On-Demand Generation', () => {
  let ctx: DaemonContext
  let stateService: MockStateService
  let llm: MockLLMService
  let assets: MockAssetResolver
  let transcript: MockTranscriptService
  const sessionId = 'test-session-word-count'

  function createValidSummary(sessionId: string): SessionSummaryState {
    return {
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      session_title: 'Test Session Title',
      session_title_confidence: 0.9,
      session_title_key_phrases: ['testing'],
      latest_intent: 'Writing tests',
      latest_intent_confidence: 0.85,
    }
  }

  function setupSessionSummary(sessionId: string, summary: SessionSummaryState): void {
    const path = stateService.sessionStatePath(sessionId, 'session-summary.json')
    stateService.setStored(path, summary)
  }

  beforeEach(() => {
    stateService = new MockStateService()
    llm = new MockLLMService()
    assets = new MockAssetResolver()
    transcript = new MockTranscriptService()
    transcript.setMockExcerptContent('Recent activity...')
    ctx = createMockDaemonContext({
      stateService,
      llm,
      profileFactory: new MockProfileProviderFactory(llm),
      assets,
      transcript,
    })
  })

  describe('Snarky message generation', () => {
    it('includes maxSnarkyWords in interpolated prompt', async () => {
      setupSessionSummary(sessionId, createValidSummary(sessionId))
      // Template includes the {{maxSnarkyWords}} token
      assets.register(
        'prompts/snarky-message.prompt.txt',
        'Generate snarky comment. Stay under {{maxSnarkyWords}} words. Context: {{session_title}}'
      )
      transcript.setMetrics({ turnCount: 5, toolCount: 10 })
      llm.queueResponse('Snarky response')

      await generateSnarkyMessageOnDemand(ctx, sessionId)

      expect(llm.recordedRequests).toHaveLength(1)
      const prompt = llm.recordedRequests[0].messages[0].content
      // Verify token was replaced with a number (config value)
      expect(prompt).toMatch(/Stay under \d+ words/)
      expect(prompt).not.toContain('{{maxSnarkyWords}}')
      expect(prompt).toContain('Test Session Title')
    })
  })

  describe('Resume message generation', () => {
    it('includes maxResumeWords in interpolated prompt', async () => {
      setupSessionSummary(sessionId, createValidSummary(sessionId))
      // Template includes the {{maxResumeWords}} token
      assets.register(
        'prompts/resume-message.prompt.txt',
        'Welcome back message. Stay under {{maxResumeWords}} words. Session: {{sessionTitle}}'
      )
      llm.queueResponse('Welcome back!')

      await generateResumeMessageOnDemand(ctx, sessionId)

      expect(llm.recordedRequests).toHaveLength(1)
      const prompt = llm.recordedRequests[0].messages[0].content
      // Verify token was replaced with a number (config value)
      expect(prompt).toMatch(/Stay under \d+ words/)
      expect(prompt).not.toContain('{{maxResumeWords}}')
      expect(prompt).toContain('Test Session Title')
    })
  })
})
