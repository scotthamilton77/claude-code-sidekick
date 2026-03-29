/**
 * Tests for generateSnarkyCore — shared pipeline for snarky message generation.
 *
 * Covers: success, persona disabled, prompt not found, LLM error,
 * invalid profile, and null persona paths.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
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
import type { DaemonContext, SessionSummaryState, SnarkyMessageState, LLMProvider } from '@sidekick/types'
import { generateSnarkyCore } from '../message-generation-core.js'
import type { SnarkyCoreParams, SnarkyResult } from '../message-generation-core.js'
import type { SessionSummaryStateAccessors } from '../../state.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG } from '../../types.js'
import type { SessionSummaryConfig } from '../../types.js'

// ============================================================================
// Constants matching the implementation
// ============================================================================

const SNARKY_PROMPT_FILE = 'prompts/snarky-message.prompt.txt'
const PROMPT_TEMPLATE = 'Generate a snarky message about {{session_title}} — {{latest_intent}}'

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

function createValidSummary(sessionId: string): SessionSummaryState {
  return {
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    session_title: 'Refactoring the Widget Factory',
    session_title_confidence: 0.9,
    session_title_key_phrases: ['widget', 'factory', 'refactoring'],
    latest_intent: 'Extract shared pipeline logic',
    latest_intent_confidence: 0.85,
  }
}

/**
 * Create a mock SessionSummaryStateAccessors with snarkyMessage.write as a vi.fn().
 * The persona read returns null by default (no persona selected).
 */
function createMockSummaryState(overrides?: { personaId?: string | null }): SessionSummaryStateAccessors {
  const personaId = overrides?.personaId ?? null

  return {
    sessionSummary: {
      read: vi.fn().mockResolvedValue({ data: null }),
      write: vi.fn().mockResolvedValue(undefined),
    },
    summaryCountdown: {
      read: vi.fn().mockResolvedValue({ data: { countdown: 0, bookmark_line: 0 } }),
      write: vi.fn().mockResolvedValue(undefined),
    },
    resumeMessage: {
      read: vi.fn().mockResolvedValue({ data: null }),
      write: vi.fn().mockResolvedValue(undefined),
    },
    snarkyMessage: {
      read: vi.fn().mockResolvedValue({ data: { message: '', timestamp: '' } }),
      write: vi.fn().mockResolvedValue(undefined),
    },
    sessionPersona: {
      read: vi.fn().mockResolvedValue({
        data: personaId
          ? { persona_id: personaId, selected_from: [personaId], timestamp: new Date().toISOString() }
          : null,
      }),
      write: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as SessionSummaryStateAccessors
}

function createCoreParams(overrides?: Partial<SnarkyCoreParams>): SnarkyCoreParams {
  const assets = new MockAssetResolver()
  assets.register(SNARKY_PROMPT_FILE, PROMPT_TEMPLATE)

  const ctx = createTestContext({ assets })
  const sessionId = 'test-session-42'

  return {
    ctx,
    sessionId,
    summaryState: createMockSummaryState(),
    summary: createValidSummary(sessionId),
    config: { ...DEFAULT_SESSION_SUMMARY_CONFIG },
    logger: ctx.logger,
    ...overrides,
  }
}

// ============================================================================
// generateSnarkyCore Tests
// ============================================================================

describe('generateSnarkyCore', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // Success path
  // --------------------------------------------------------------------------

  describe('success path', () => {
    it('returns success with snarky state when LLM responds', async () => {
      const llm = new MockLLMService()
      llm.queueResponse('Oh great, another refactoring spree.')
      const assets = new MockAssetResolver()
      assets.register(SNARKY_PROMPT_FILE, PROMPT_TEMPLATE)
      const ctx = createTestContext({ llm, assets })
      const summaryState = createMockSummaryState()

      const params = createCoreParams({ ctx, summaryState })

      const result = await generateSnarkyCore(params)

      expect(result.status).toBe('success')
      expect((result as Extract<SnarkyResult, { status: 'success' }>).state.message).toBe(
        'Oh great, another refactoring spree.'
      )
      expect((result as Extract<SnarkyResult, { status: 'success' }>).state.timestamp).toBeTruthy()
    })

    it('writes snarky state via summaryState.snarkyMessage.write', async () => {
      const llm = new MockLLMService()
      llm.queueResponse('Witty remark here')
      const assets = new MockAssetResolver()
      assets.register(SNARKY_PROMPT_FILE, PROMPT_TEMPLATE)
      const ctx = createTestContext({ llm, assets })
      const summaryState = createMockSummaryState()

      const params = createCoreParams({ ctx, summaryState })
      await generateSnarkyCore(params)

      const writeFn = summaryState.snarkyMessage.write as ReturnType<typeof vi.fn>
      expect(writeFn).toHaveBeenCalledOnce()
      expect(writeFn).toHaveBeenCalledWith(
        params.sessionId,
        expect.objectContaining({
          message: 'Witty remark here',
          timestamp: expect.any(String),
        })
      )
    })

    it('emits snarkyMessageStart and snarkyMessageFinish events', async () => {
      const logger = new MockLogger()
      const llm = new MockLLMService()
      llm.queueResponse('Nice one')
      const assets = new MockAssetResolver()
      assets.register(SNARKY_PROMPT_FILE, PROMPT_TEMPLATE)
      const ctx = createTestContext({ llm, assets, logger })
      const summaryState = createMockSummaryState()

      const params = createCoreParams({ ctx, summaryState, logger })
      await generateSnarkyCore(params)

      // logEvent logs at 'info' level with structured event data
      const eventLogs = logger.recordedLogs.filter(
        (log) => log.meta?.type === 'snarky-message:start' || log.meta?.type === 'snarky-message:finish'
      )
      expect(eventLogs).toHaveLength(2)
    })

    it('strips surrounding quotes from LLM response', async () => {
      const llm = new MockLLMService()
      llm.queueResponse('"Quoted response"')
      const assets = new MockAssetResolver()
      assets.register(SNARKY_PROMPT_FILE, PROMPT_TEMPLATE)
      const ctx = createTestContext({ llm, assets })
      const summaryState = createMockSummaryState()

      const params = createCoreParams({ ctx, summaryState })
      const result = await generateSnarkyCore(params)

      expect(result.status).toBe('success')
      expect((result as Extract<SnarkyResult, { status: 'success' }>).state.message).toBe('Quoted response')
    })
  })

  // --------------------------------------------------------------------------
  // Skipped: persona disabled
  // --------------------------------------------------------------------------

  describe('skipped: persona disabled', () => {
    it('returns skipped with persona_disabled reason', async () => {
      const summaryState = createMockSummaryState({ personaId: 'disabled' })
      const params = createCoreParams({ summaryState })

      const result = await generateSnarkyCore(params)

      expect(result.status).toBe('skipped')
      expect((result as Extract<SnarkyResult, { status: 'skipped' }>).reason).toBe('persona_disabled')
    })

    it('does not call LLM when persona is disabled', async () => {
      const llm = new MockLLMService()
      const assets = new MockAssetResolver()
      assets.register(SNARKY_PROMPT_FILE, PROMPT_TEMPLATE)
      const ctx = createTestContext({ llm, assets })
      const summaryState = createMockSummaryState({ personaId: 'disabled' })

      const params = createCoreParams({ ctx, summaryState })
      await generateSnarkyCore(params)

      expect(llm.recordedRequests).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // Skipped: prompt not found
  // --------------------------------------------------------------------------

  describe('skipped: prompt not found', () => {
    it('returns skipped with prompt_not_found reason when asset is missing', async () => {
      // Don't register the prompt template — assets.resolve will return null
      const assets = new MockAssetResolver()
      const ctx = createTestContext({ assets })
      const summaryState = createMockSummaryState()

      const params = createCoreParams({ ctx, summaryState })
      const result = await generateSnarkyCore(params)

      expect(result.status).toBe('skipped')
      expect((result as Extract<SnarkyResult, { status: 'skipped' }>).reason).toBe('prompt_not_found')
    })
  })

  // --------------------------------------------------------------------------
  // Error: LLM throws
  // --------------------------------------------------------------------------

  describe('error: LLM throws', () => {
    it('returns error result when LLM call fails', async () => {
      const failingLlm: LLMProvider = {
        id: 'failing-llm',
        complete: () => Promise.reject(new Error('API rate limit exceeded')),
      }
      const assets = new MockAssetResolver()
      assets.register(SNARKY_PROMPT_FILE, PROMPT_TEMPLATE)
      const ctx = createTestContext({ assets })
      // Override profileFactory to return the failing provider
      const ctxWithFailingLlm = {
        ...ctx,
        profileFactory: {
          createForProfile: () => failingLlm,
          createDefault: () => failingLlm,
        },
      } as DaemonContext
      const summaryState = createMockSummaryState()

      const params = createCoreParams({ ctx: ctxWithFailingLlm, summaryState })
      const result = await generateSnarkyCore(params)

      expect(result.status).toBe('error')
      expect((result as Extract<SnarkyResult, { status: 'error' }>).error.message).toBe('API rate limit exceeded')
    })

    it('does not write snarky state when LLM fails', async () => {
      const failingLlm: LLMProvider = {
        id: 'failing-llm',
        complete: () => Promise.reject(new Error('Network failure')),
      }
      const assets = new MockAssetResolver()
      assets.register(SNARKY_PROMPT_FILE, PROMPT_TEMPLATE)
      const ctx = createTestContext({ assets })
      const ctxWithFailingLlm = {
        ...ctx,
        profileFactory: {
          createForProfile: () => failingLlm,
          createDefault: () => failingLlm,
        },
      } as DaemonContext
      const summaryState = createMockSummaryState()

      const params = createCoreParams({ ctx: ctxWithFailingLlm, summaryState })
      await generateSnarkyCore(params)

      const writeFn = summaryState.snarkyMessage.write as ReturnType<typeof vi.fn>
      expect(writeFn).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Error: invalid profile (getEffectiveProfile returns errorMessage)
  // --------------------------------------------------------------------------

  describe('error: invalid profile', () => {
    it('returns error when getEffectiveProfile yields errorMessage', async () => {
      const assets = new MockAssetResolver()
      assets.register(SNARKY_PROMPT_FILE, PROMPT_TEMPLATE)
      const ctx = createTestContext({ assets })
      const summaryState = createMockSummaryState()

      // Set up config with a defaultLlmProfile that doesn't exist in available profiles
      // This triggers the "errorMessage" path in getEffectiveProfile
      const config: SessionSummaryConfig = {
        ...DEFAULT_SESSION_SUMMARY_CONFIG,
        personas: {
          ...DEFAULT_SESSION_SUMMARY_CONFIG.personas!,
          defaultLlmProfile: 'nonexistent-profile',
        },
      }

      // We also need to set a persona so resolvePersonaLlmProfile picks up defaultLlmProfile.
      // With a null persona, the personaId is '' and resolvePersonaLlmProfile will
      // check per-persona override (empty personaId → no match), then persona YAML (null → skip),
      // then defaultLlmProfile → 'nonexistent-profile'.
      // Since ctx.config.llm.profiles won't contain 'nonexistent-profile',
      // validatePersonaLlmProfile should error.

      const params = createCoreParams({ ctx, summaryState, config })
      const result = await generateSnarkyCore(params)

      expect(result.status).toBe('error')
      const errorResult = result as Extract<SnarkyResult, { status: 'error' }>
      expect(errorResult.error.message).toContain('nonexistent-profile')
    })
  })

  // --------------------------------------------------------------------------
  // Null persona proceeds (not a skip)
  // --------------------------------------------------------------------------

  describe('null persona proceeds', () => {
    it('generates snarky message when persona is null (no persona selected)', async () => {
      const llm = new MockLLMService()
      llm.queueResponse('No persona, no problem.')
      const assets = new MockAssetResolver()
      assets.register(SNARKY_PROMPT_FILE, PROMPT_TEMPLATE)
      const ctx = createTestContext({ llm, assets })
      // Default summaryState has null persona
      const summaryState = createMockSummaryState({ personaId: null })

      const params = createCoreParams({ ctx, summaryState })
      const result = await generateSnarkyCore(params)

      expect(result.status).toBe('success')
      expect((result as Extract<SnarkyResult, { status: 'success' }>).state.message).toBe('No persona, no problem.')
    })

    it('calls LLM even without a persona', async () => {
      const llm = new MockLLMService()
      const assets = new MockAssetResolver()
      assets.register(SNARKY_PROMPT_FILE, PROMPT_TEMPLATE)
      const ctx = createTestContext({ llm, assets })
      const summaryState = createMockSummaryState({ personaId: null })

      const params = createCoreParams({ ctx, summaryState })
      await generateSnarkyCore(params)

      expect(llm.recordedRequests).toHaveLength(1)
    })
  })
})
