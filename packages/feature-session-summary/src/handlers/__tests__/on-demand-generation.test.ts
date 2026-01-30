/**
 * Tests for on-demand persona message generation
 * @see docs/design/PERSONA-PROFILES-DESIGN.md
 *
 * NOTE: These tests use real persona files from assets/sidekick/personas/
 * because the production code has hard dependencies on getDefaultPersonasDir()
 * and createPersonaLoader() that hit the filesystem.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createMockDaemonContext,
  MockLogger,
  MockLLMService,
  MockAssetResolver,
  MockStateService,
  MockTranscriptService,
  MockProfileProviderFactory,
} from '@sidekick/testing-fixtures'
import type { DaemonContext, SessionSummaryState, SessionPersonaState, LLMProvider } from '@sidekick/types'
import {
  setSessionPersona,
  generateSnarkyMessageOnDemand,
  generateResumeMessageOnDemand,
} from '../on-demand-generation.js'

// ============================================================================
// Test Helpers
// ============================================================================

function createTestContext(overrides?: {
  logger?: MockLogger
  llm?: MockLLMService
  assets?: MockAssetResolver
  stateService?: MockStateService
  transcript?: MockTranscriptService
}): DaemonContext {
  const llm = overrides?.llm ?? new MockLLMService()
  const stateService = overrides?.stateService ?? new MockStateService()
  const transcript = overrides?.transcript ?? new MockTranscriptService()
  const assets = overrides?.assets ?? new MockAssetResolver()
  const logger = overrides?.logger ?? new MockLogger()

  return createMockDaemonContext({
    logger,
    llm,
    profileFactory: new MockProfileProviderFactory(llm),
    stateService,
    transcript,
    assets,
  })
}

function createFailingLLMProvider(errorMessage = 'API rate limit exceeded'): LLMProvider {
  return {
    id: 'failing-llm',
    complete: () => Promise.reject(new Error(errorMessage)),
  }
}

function createContextWithFailingLLM(
  stateService: MockStateService,
  assets: MockAssetResolver,
  transcript: MockTranscriptService,
  logger?: MockLogger
): DaemonContext {
  const failingLlm = createFailingLLMProvider()

  return createMockDaemonContext({
    stateService,
    assets,
    transcript,
    logger,
    profileFactory: new MockProfileProviderFactory(failingLlm),
  })
}

function createValidSummary(sessionId: string, overrides?: Partial<SessionSummaryState>): SessionSummaryState {
  return {
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    session_title: 'Test Session Title',
    session_title_confidence: 0.9,
    session_title_key_phrases: ['testing', 'development'],
    latest_intent: 'Writing unit tests',
    latest_intent_confidence: 0.85,
    ...overrides,
  }
}

function setupSessionSummaryState(
  stateService: MockStateService,
  sessionId: string,
  summary: SessionSummaryState
): void {
  const path = stateService.sessionStatePath(sessionId, 'session-summary.json')
  stateService.setStored(path, summary)
}

function setupSessionPersonaState(stateService: MockStateService, sessionId: string, personaId: string): void {
  const path = stateService.sessionStatePath(sessionId, 'session-persona.json')
  const state: SessionPersonaState = {
    persona_id: personaId,
    selected_from: [personaId],
    timestamp: new Date().toISOString(),
  }
  stateService.setStored(path, state)
}

// ============================================================================
// setSessionPersona Tests
// ============================================================================

describe('setSessionPersona', () => {
  let ctx: DaemonContext
  let stateService: MockStateService
  const sessionId = 'test-session-123'

  beforeEach(() => {
    stateService = new MockStateService()
    ctx = createTestContext({ stateService })
  })

  describe('persona validation', () => {
    it('returns error when persona does not exist', async () => {
      const result = await setSessionPersona(ctx, sessionId, 'nonexistent-persona-xyz')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Persona "nonexistent-persona-xyz" not found')
      expect(result.error).toContain('Available:')
    })

    it('succeeds for a valid persona ID', async () => {
      // 'disabled' is a real persona in assets/sidekick/personas/
      const result = await setSessionPersona(ctx, sessionId, 'disabled')

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('succeeds for skippy persona', async () => {
      const result = await setSessionPersona(ctx, sessionId, 'skippy')

      expect(result.success).toBe(true)
    })
  })

  describe('state management', () => {
    it('writes persona state to session state path', async () => {
      await setSessionPersona(ctx, sessionId, 'disabled')

      const path = stateService.sessionStatePath(sessionId, 'session-persona.json')
      expect(stateService.has(path)).toBe(true)

      const stored = stateService.getStored(path) as SessionPersonaState
      expect(stored.persona_id).toBe('disabled')
      expect(stored.timestamp).toBeDefined()
      expect(Array.isArray(stored.selected_from)).toBe(true)
    })

    it('returns previous persona ID when overwriting', async () => {
      // First set
      await setSessionPersona(ctx, sessionId, 'disabled')

      // Second set
      const result = await setSessionPersona(ctx, sessionId, 'skippy')

      expect(result.success).toBe(true)
      expect(result.previousPersonaId).toBe('disabled')
    })

    it('returns undefined previousPersonaId for first selection', async () => {
      const result = await setSessionPersona(ctx, sessionId, 'disabled')

      expect(result.success).toBe(true)
      expect(result.previousPersonaId).toBeUndefined()
    })
  })

  describe('logging', () => {
    it('logs info on successful persona set', async () => {
      const logger = new MockLogger()
      ctx = createTestContext({ stateService, logger })

      await setSessionPersona(ctx, sessionId, 'disabled')

      expect(logger.recordedLogs.some((log) => log.level === 'info' && log.msg === 'Session persona set')).toBe(true)
    })
  })
})

// ============================================================================
// generateSnarkyMessageOnDemand Tests
// ============================================================================

describe('generateSnarkyMessageOnDemand', () => {
  let ctx: DaemonContext
  let stateService: MockStateService
  let llm: MockLLMService
  let assets: MockAssetResolver
  let transcript: MockTranscriptService
  const sessionId = 'test-session-123'

  beforeEach(() => {
    stateService = new MockStateService()
    llm = new MockLLMService()
    assets = new MockAssetResolver()
    transcript = new MockTranscriptService()
    ctx = createTestContext({ stateService, llm, assets, transcript })
  })

  describe('prerequisite validation', () => {
    it('returns error when no session summary exists', async () => {
      const result = await generateSnarkyMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('No session summary found')
    })

    it('returns error when prompt template is not found', async () => {
      setupSessionSummaryState(stateService, sessionId, createValidSummary(sessionId))
      // Don't register the prompt template in assets

      const result = await generateSnarkyMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Snarky prompt template not found')
    })
  })

  describe('disabled persona handling', () => {
    it('skips generation when persona is disabled', async () => {
      setupSessionSummaryState(stateService, sessionId, createValidSummary(sessionId))
      setupSessionPersonaState(stateService, sessionId, 'disabled')

      const result = await generateSnarkyMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Persona is "disabled"')
      expect(result.error).toContain('snarky messages are skipped')
      expect(llm.recordedRequests).toHaveLength(0)
    })
  })

  describe('successful generation', () => {
    beforeEach(() => {
      setupSessionSummaryState(stateService, sessionId, createValidSummary(sessionId))
      assets.register('prompts/snarky-message.prompt.txt', 'Generate a snarky comment about: {{session_title}}')
      transcript.setMetrics({ turnCount: 5, toolCount: 10 })
    })

    it('calls LLM with interpolated prompt', async () => {
      llm.queueResponse('A witty observation about your code')

      const result = await generateSnarkyMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(true)
      expect(llm.recordedRequests).toHaveLength(1)
      expect(llm.recordedRequests[0].messages[0].content).toContain('Test Session Title')
    })

    it('writes snarky message state on success', async () => {
      llm.queueResponse('Your code is almost as messy as my circuits')

      await generateSnarkyMessageOnDemand(ctx, sessionId)

      const path = stateService.sessionStatePath(sessionId, 'snarky-message.json')
      expect(stateService.has(path)).toBe(true)

      const stored = stateService.getStored(path) as { message: string; timestamp: string }
      expect(stored.message).toBe('Your code is almost as messy as my circuits')
      expect(stored.timestamp).toBeDefined()
    })

    it('strips surrounding double quotes from LLM response', async () => {
      llm.queueResponse('"A quoted snarky message"')

      await generateSnarkyMessageOnDemand(ctx, sessionId)

      const path = stateService.sessionStatePath(sessionId, 'snarky-message.json')
      const stored = stateService.getStored(path) as { message: string }
      expect(stored.message).toBe('A quoted snarky message')
    })

    it('strips surrounding single quotes from LLM response', async () => {
      llm.queueResponse("'Single quoted message'")

      await generateSnarkyMessageOnDemand(ctx, sessionId)

      const path = stateService.sessionStatePath(sessionId, 'snarky-message.json')
      const stored = stateService.getStored(path) as { message: string }
      expect(stored.message).toBe('Single quoted message')
    })
  })

  describe('LLM error handling', () => {
    beforeEach(() => {
      setupSessionSummaryState(stateService, sessionId, createValidSummary(sessionId))
      assets.register('prompts/snarky-message.prompt.txt', 'Generate snarky message')
    })

    it('returns error when LLM call fails', async () => {
      ctx = createContextWithFailingLLM(stateService, assets, transcript)

      const result = await generateSnarkyMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('LLM call failed')
      expect(result.error).toContain('API rate limit exceeded')
    })

    it('handles non-Error thrown values', async () => {
      const stringThrowingLlm: LLMProvider = {
        id: 'string-throwing-llm',
        complete: () => Promise.reject(new Error('string error value')),
      }

      ctx = createMockDaemonContext({
        stateService,
        assets,
        transcript,
        profileFactory: new MockProfileProviderFactory(stringThrowingLlm),
      })

      const result = await generateSnarkyMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('string error value')
    })
  })

  describe('logging', () => {
    beforeEach(() => {
      setupSessionSummaryState(stateService, sessionId, createValidSummary(sessionId))
      assets.register('prompts/snarky-message.prompt.txt', 'Generate snarky message')
    })

    it('logs info on successful generation', async () => {
      const logger = new MockLogger()
      llm.queueResponse('Snarky comment')
      ctx = createTestContext({ stateService, llm, assets, transcript, logger })

      await generateSnarkyMessageOnDemand(ctx, sessionId)

      expect(logger.recordedLogs.some((log) => log.msg === 'Generated snarky message on-demand')).toBe(true)
    })

    it('logs error on LLM failure', async () => {
      const logger = new MockLogger()
      ctx = createContextWithFailingLLM(stateService, assets, transcript, logger)

      await generateSnarkyMessageOnDemand(ctx, sessionId)

      expect(logger.recordedLogs.some((log) => log.level === 'error')).toBe(true)
    })
  })
})

// ============================================================================
// generateResumeMessageOnDemand Tests
// ============================================================================

describe('generateResumeMessageOnDemand', () => {
  let ctx: DaemonContext
  let stateService: MockStateService
  let llm: MockLLMService
  let assets: MockAssetResolver
  let transcript: MockTranscriptService
  const sessionId = 'test-session-123'

  beforeEach(() => {
    stateService = new MockStateService()
    llm = new MockLLMService()
    assets = new MockAssetResolver()
    transcript = new MockTranscriptService()
    transcript.setMockExcerptContent('Recent transcript content...')
    ctx = createTestContext({ stateService, llm, assets, transcript })
  })

  describe('prerequisite validation', () => {
    it('returns error when no session summary exists', async () => {
      const result = await generateResumeMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('No session summary found')
    })

    it('returns error when title confidence is too low', async () => {
      setupSessionSummaryState(
        stateService,
        sessionId,
        createValidSummary(sessionId, {
          session_title_confidence: 0.5, // Below RESUME_MIN_CONFIDENCE (0.7)
          latest_intent_confidence: 0.9,
        })
      )

      const result = await generateResumeMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Confidence too low')
      expect(result.error).toContain('Title: 0.5')
    })

    it('returns error when intent confidence is too low', async () => {
      setupSessionSummaryState(
        stateService,
        sessionId,
        createValidSummary(sessionId, {
          session_title_confidence: 0.9,
          latest_intent_confidence: 0.5, // Below RESUME_MIN_CONFIDENCE (0.7)
        })
      )

      const result = await generateResumeMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Confidence too low')
      expect(result.error).toContain('Intent: 0.5')
    })

    it('returns error when prompt template is not found', async () => {
      setupSessionSummaryState(stateService, sessionId, createValidSummary(sessionId))
      // Don't register the prompt template

      const result = await generateResumeMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Resume prompt template not found')
    })
  })

  describe('disabled persona handling', () => {
    it('generates deterministic output for disabled persona', async () => {
      setupSessionSummaryState(stateService, sessionId, createValidSummary(sessionId))
      setupSessionPersonaState(stateService, sessionId, 'disabled')

      const result = await generateResumeMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(true)
      // LLM should NOT be called for disabled persona
      expect(llm.recordedRequests).toHaveLength(0)

      // Check the deterministic output was written
      const path = stateService.sessionStatePath(sessionId, 'resume-message.json')
      expect(stateService.has(path)).toBe(true)

      const stored = stateService.getStored(path) as {
        session_title: string
        snarky_comment: string
        last_task_id: null
      }
      expect(stored.session_title).toBe('Test Session Title')
      expect(stored.snarky_comment).toBe('Writing unit tests')
      expect(stored.last_task_id).toBeNull()
    })
  })

  describe('successful generation', () => {
    beforeEach(() => {
      setupSessionSummaryState(stateService, sessionId, createValidSummary(sessionId))
      assets.register('prompts/resume-message.prompt.txt', 'Welcome back to: {{sessionTitle}}')
    })

    it('calls LLM with interpolated prompt', async () => {
      llm.queueResponse('Welcome back, developer!')

      const result = await generateResumeMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(true)
      expect(llm.recordedRequests).toHaveLength(1)
      expect(llm.recordedRequests[0].messages[0].content).toContain('Test Session Title')
    })

    it('writes resume message state on success', async () => {
      llm.queueResponse('Back again? Your code missed you.')

      await generateResumeMessageOnDemand(ctx, sessionId)

      const path = stateService.sessionStatePath(sessionId, 'resume-message.json')
      expect(stateService.has(path)).toBe(true)

      const stored = stateService.getStored(path) as {
        session_title: string
        snarky_comment: string
      }
      expect(stored.session_title).toBe('Test Session Title')
      expect(stored.snarky_comment).toBe('Back again? Your code missed you.')
    })

    it('strips surrounding quotes from LLM response', async () => {
      llm.queueResponse('"Welcome back to testing land"')

      await generateResumeMessageOnDemand(ctx, sessionId)

      const path = stateService.sessionStatePath(sessionId, 'resume-message.json')
      const stored = stateService.getStored(path) as { snarky_comment: string }
      expect(stored.snarky_comment).toBe('Welcome back to testing land')
    })

    it('includes transcript excerpt in prompt', async () => {
      assets.register('prompts/resume-message.prompt.txt', 'Welcome back! Transcript: {{transcript}}')
      transcript.setMockExcerptContent('User was refactoring the authentication module')
      llm.queueResponse('Resume message')

      await generateResumeMessageOnDemand(ctx, sessionId)

      expect(llm.recordedRequests[0].messages[0].content).toContain('User was refactoring the authentication module')
    })

    it('handles missing key phrases gracefully', async () => {
      setupSessionSummaryState(
        stateService,
        sessionId,
        createValidSummary(sessionId, { session_title_key_phrases: undefined })
      )
      assets.register('prompts/resume-message.prompt.txt', 'Welcome back to: {{sessionTitle}}')
      llm.queueResponse('Resume message')

      const result = await generateResumeMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(true)
    })
  })

  describe('LLM error handling', () => {
    beforeEach(() => {
      setupSessionSummaryState(stateService, sessionId, createValidSummary(sessionId))
      assets.register('prompts/resume-message.prompt.txt', 'Resume prompt')
    })

    it('returns error when LLM call fails', async () => {
      ctx = createContextWithFailingLLM(stateService, assets, transcript)

      const result = await generateResumeMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('LLM call failed')
      expect(result.error).toContain('API rate limit exceeded')
    })

    it('handles non-Error thrown values', async () => {
      const stringThrowingLlm: LLMProvider = {
        id: 'string-throwing-llm',
        complete: () => Promise.reject(new Error('resume string error')),
      }

      ctx = createMockDaemonContext({
        stateService,
        assets,
        transcript,
        profileFactory: new MockProfileProviderFactory(stringThrowingLlm),
      })

      const result = await generateResumeMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('resume string error')
    })
  })

  describe('logging', () => {
    beforeEach(() => {
      setupSessionSummaryState(stateService, sessionId, createValidSummary(sessionId))
      assets.register('prompts/resume-message.prompt.txt', 'Resume prompt')
    })

    it('logs info on successful generation', async () => {
      const logger = new MockLogger()
      llm.queueResponse('Resume message')
      ctx = createTestContext({ stateService, llm, assets, transcript, logger })

      await generateResumeMessageOnDemand(ctx, sessionId)

      expect(logger.recordedLogs.some((log) => log.msg === 'Generated resume message on-demand')).toBe(true)
    })

    it('logs info for deterministic output with disabled persona', async () => {
      const logger = new MockLogger()
      setupSessionPersonaState(stateService, sessionId, 'disabled')
      ctx = createTestContext({ stateService, llm, assets, transcript, logger })

      await generateResumeMessageOnDemand(ctx, sessionId)

      expect(
        logger.recordedLogs.some((log) => log.msg === 'Generated deterministic resume message (disabled persona)')
      ).toBe(true)
    })

    it('logs error on LLM failure', async () => {
      const logger = new MockLogger()
      ctx = createContextWithFailingLLM(stateService, assets, transcript, logger)

      await generateResumeMessageOnDemand(ctx, sessionId)

      expect(logger.recordedLogs.some((log) => log.level === 'error')).toBe(true)
    })
  })
})

// ============================================================================
// Integration-like Tests (using real persona files)
// ============================================================================

describe('on-demand-generation integration', () => {
  let ctx: DaemonContext
  let stateService: MockStateService
  let llm: MockLLMService
  let assets: MockAssetResolver
  let transcript: MockTranscriptService
  const sessionId = 'integration-test-session'

  beforeEach(() => {
    stateService = new MockStateService()
    llm = new MockLLMService()
    assets = new MockAssetResolver()
    transcript = new MockTranscriptService()
    ctx = createTestContext({ stateService, llm, assets, transcript })
  })

  describe('setSessionPersona validates against real personas', () => {
    it('allows setting a real persona from assets', async () => {
      // These are real persona IDs from assets/sidekick/personas/
      const realPersonaIds = ['disabled', 'skippy', 'bones', 'scotty', 'yoda']

      for (const personaId of realPersonaIds) {
        const result = await setSessionPersona(ctx, sessionId, personaId)
        expect(result.success).toBe(true)
      }
    })

    it('rejects non-existent persona IDs', async () => {
      const fakePersonaIds = ['fake-persona', 'not-real', 'made-up-character']

      for (const personaId of fakePersonaIds) {
        const result = await setSessionPersona(ctx, sessionId, personaId)
        expect(result.success).toBe(false)
      }
    })
  })

  describe('full generation flow', () => {
    it('setSessionPersona followed by generateSnarkyMessageOnDemand', async () => {
      // Set up state and assets
      setupSessionSummaryState(stateService, sessionId, createValidSummary(sessionId))
      assets.register('prompts/snarky-message.prompt.txt', 'Be snarky about {{session_title}}')

      // Set a persona (disabled will skip LLM, so use any other)
      await setSessionPersona(ctx, sessionId, 'skippy')

      // Generate snarky message
      llm.queueResponse('Time to make the donuts... I mean, fix the bugs.')
      const result = await generateSnarkyMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(true)
    })

    it('setSessionPersona followed by generateResumeMessageOnDemand', async () => {
      setupSessionSummaryState(stateService, sessionId, createValidSummary(sessionId))
      assets.register('prompts/resume-message.prompt.txt', 'Welcome back to {{sessionTitle}}')

      await setSessionPersona(ctx, sessionId, 'yoda')

      llm.queueResponse('Return you have. Debug you must.')
      const result = await generateResumeMessageOnDemand(ctx, sessionId)

      expect(result.success).toBe(true)
    })
  })
})
