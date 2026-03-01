/**
 * Persona Utils Unit Tests
 *
 * Tests for persona-utils.ts utility functions.
 * Focuses on coverage for:
 * - formatExamples (via buildPersonaContext with snarky_examples)
 * - buildPersonaContext (various persona configurations)
 * - stripSurroundingQuotes (edge cases)
 * - loadSessionPersona (integration with state and persona loader)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import type { PersonaDefinition, SessionPersonaState, Logger } from '@sidekick/types'
import {
  buildPersonaContext,
  buildUserProfileContext,
  stripSurroundingQuotes,
  loadSessionPersona,
  resolvePersonaLlmProfile,
  validatePersonaLlmProfile,
  getEffectiveProfile,
  mergePersonaConfig,
  _resetProfileWarningState,
} from '../handlers/persona-utils'
import type { UserProfile } from '@sidekick/types'
import type { PersonaProfileConfig } from '../handlers/persona-utils'
import type { SessionSummaryStateAccessors } from '../state'
import { DEFAULT_SESSION_SUMMARY_CONFIG } from '../types'
import type { SessionSummaryConfig } from '../types'

// ============================================================================
// Test Helpers
// ============================================================================

function createMockLogger(): Logger {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: function () {
      return this
    },
    flush: async () => {},
  }
}

function createPersonaWithExamples(overrides: Partial<PersonaDefinition> = {}): PersonaDefinition {
  return {
    id: 'test-persona',
    display_name: 'Test Persona',
    theme: 'Testing theme',
    personality_traits: ['sarcastic', 'witty'],
    tone_traits: ['playful', 'concise'],
    ...overrides,
  }
}

// ============================================================================
// buildPersonaContext Tests (covers formatExamples via snarky_examples)
// ============================================================================

describe('buildPersonaContext', () => {
  describe('with snarky_examples (covers formatExamples success path)', () => {
    it('formats snarky_examples as bulleted list', () => {
      const persona = createPersonaWithExamples({
        snarky_examples: ['Oh, another brilliant idea.', 'Sure, that will work.'],
      })

      const context = buildPersonaContext(persona)

      expect(context.persona_snarky_examples).toBe('- "Oh, another brilliant idea."\n- "Sure, that will work."')
    })

    it('formats snarky_welcome_examples as bulleted list', () => {
      const persona = createPersonaWithExamples({
        snarky_welcome_examples: ['Back already?', 'Miss me?'],
      })

      const context = buildPersonaContext(persona)

      expect(context.persona_snarky_welcome_examples).toBe('- "Back already?"\n- "Miss me?"')
    })

    it('handles single example in array', () => {
      const persona = createPersonaWithExamples({
        snarky_examples: ['Only one example here.'],
      })

      const context = buildPersonaContext(persona)

      expect(context.persona_snarky_examples).toBe('- "Only one example here."')
    })

    it('returns empty string for empty examples array', () => {
      const persona = createPersonaWithExamples({
        snarky_examples: [],
      })

      const context = buildPersonaContext(persona)

      expect(context.persona_snarky_examples).toBe('')
    })

    it('returns empty string when examples undefined', () => {
      const persona = createPersonaWithExamples()
      // No snarky_examples defined

      const context = buildPersonaContext(persona)

      expect(context.persona_snarky_examples).toBe('')
      expect(context.persona_snarky_welcome_examples).toBe('')
    })
  })

  describe('with situation override', () => {
    it('uses custom situation when provided', () => {
      const persona = createPersonaWithExamples({
        situation: 'You are a cantankerous AI assistant.',
      })

      const context = buildPersonaContext(persona)

      expect(context.persona_situation).toBe('You are a cantankerous AI assistant.')
    })

    it('uses default situation when not provided', () => {
      const persona = createPersonaWithExamples()

      const context = buildPersonaContext(persona)

      expect(context.persona_situation).toBe('You are watching over the shoulder of a software developer as they work.')
    })
  })
})

// ============================================================================
// stripSurroundingQuotes Tests
// ============================================================================

describe('stripSurroundingQuotes', () => {
  it('strips double quotes', () => {
    expect(stripSurroundingQuotes('"hello world"')).toBe('hello world')
  })

  it('strips single quotes', () => {
    expect(stripSurroundingQuotes("'hello world'")).toBe('hello world')
  })

  it('does not strip mismatched quotes', () => {
    expect(stripSurroundingQuotes('"hello world\'')).toBe('"hello world\'')
    expect(stripSurroundingQuotes('\'hello world"')).toBe('\'hello world"')
  })

  it('does not strip quotes in middle', () => {
    expect(stripSurroundingQuotes('hello "world"')).toBe('hello "world"')
  })

  it('returns empty string unchanged', () => {
    expect(stripSurroundingQuotes('')).toBe('')
  })

  it('returns single character unchanged', () => {
    expect(stripSurroundingQuotes('"')).toBe('"')
    expect(stripSurroundingQuotes('a')).toBe('a')
  })

  it('strips nested quotes correctly (only outermost)', () => {
    expect(stripSurroundingQuotes('"\'nested\'"')).toBe("'nested'")
  })
})

// ============================================================================
// loadSessionPersona Tests
// ============================================================================

describe('loadSessionPersona', () => {
  const sessionDir = join('/tmp', 'persona-utils-test-sessions')

  it('returns null when no persona is selected', async () => {
    const logger = createMockLogger()

    // Fake state accessors that return no data
    const fakeState: SessionSummaryStateAccessors = {
      sessionPersona: {
        read: () => Promise.resolve({ data: null }),
      },
    } as unknown as SessionSummaryStateAccessors

    const ctx = {
      logger,
      paths: { projectDir: '/tmp' },
      stateService: {},
    } as any

    const result = await loadSessionPersona(ctx, 'test-session', fakeState)

    expect(result).toBeNull()
  })

  it('returns persona when persona is selected and found in default assets', async () => {
    const logger = createMockLogger()

    // Fake state accessors that return persona data for a bundled persona
    const personaState: SessionPersonaState = {
      persona_id: 'skippy',
      selected_from: ['skippy'],
      timestamp: new Date().toISOString(),
    }

    const fakeState: SessionSummaryStateAccessors = {
      sessionPersona: {
        read: () => Promise.resolve({ data: personaState }),
      },
    } as unknown as SessionSummaryStateAccessors

    const ctx = {
      logger,
      paths: { projectDir: '/tmp' },
      stateService: {},
    } as any

    // This test relies on 'skippy' existing in the bundled assets directory.
    // The bundled assets are part of the package, so this is a valid test.
    const result = await loadSessionPersona(ctx, 'test-session', fakeState)

    // Verify the persona was loaded with expected properties
    expect(result).not.toBeNull()
    expect(result?.id).toBe('skippy')
    expect(result?.display_name).toBe('Skippy')
  })

  it('returns null when persona ID is not found in loader', async () => {
    const logger = createMockLogger()

    // Fake state with a non-existent persona ID
    const personaState: SessionPersonaState = {
      persona_id: 'nonexistent-persona-xyz-123',
      selected_from: ['nonexistent-persona-xyz-123'],
      timestamp: new Date().toISOString(),
    }

    const fakeState: SessionSummaryStateAccessors = {
      sessionPersona: {
        read: () => Promise.resolve({ data: personaState }),
      },
    } as unknown as SessionSummaryStateAccessors

    const ctx = {
      logger,
      paths: { projectDir: '/tmp' },
      stateService: {},
    } as any

    const result = await loadSessionPersona(ctx, 'test-session', fakeState)

    // Should return null because 'nonexistent-persona-xyz-123' won't be found
    expect(result).toBeNull()
  })

  it('creates state accessors from stateService when not provided', async () => {
    const logger = createMockLogger()

    // Create a fake state service that implements MinimalStateService
    const fakeStateService = {
      sessionStatePath: (sessionId: string, filename: string) => join(sessionDir, sessionId, filename),
      read: () => Promise.resolve({ data: null, source: 'default' as const }),
      write: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    }

    const ctx = {
      logger,
      paths: { projectDir: '/tmp' },
      stateService: fakeStateService,
    } as any

    // Call WITHOUT the third argument to trigger createSessionSummaryState
    const result = await loadSessionPersona(ctx, 'test-session')

    // Should return null because the fake stateService returns no data
    expect(result).toBeNull()
  })
})

// ============================================================================
// resolvePersonaLlmProfile Tests
// ============================================================================

describe('resolvePersonaLlmProfile', () => {
  const basePersona = createPersonaWithExamples()

  it('returns undefined when all sources are empty', () => {
    const config: PersonaProfileConfig = {}
    expect(resolvePersonaLlmProfile('test-persona', basePersona, config)).toBeUndefined()
  })

  it('returns defaultLlmProfile when only that is set', () => {
    const config: PersonaProfileConfig = { defaultLlmProfile: 'creative' }
    expect(resolvePersonaLlmProfile('test-persona', basePersona, config)).toBe('creative')
  })

  it('returns persona YAML llmProfile over defaultLlmProfile', () => {
    const persona = createPersonaWithExamples({ llmProfile: 'fast-lite' })
    const config: PersonaProfileConfig = { defaultLlmProfile: 'creative' }
    expect(resolvePersonaLlmProfile('test-persona', persona, config)).toBe('fast-lite')
  })

  it('returns config llmProfiles[id] over YAML llmProfile', () => {
    const persona = createPersonaWithExamples({ llmProfile: 'fast-lite' })
    const config: PersonaProfileConfig = {
      defaultLlmProfile: 'creative',
      llmProfiles: { 'test-persona': 'creative-long' },
    }
    expect(resolvePersonaLlmProfile('test-persona', persona, config)).toBe('creative-long')
  })

  it('treats empty string defaultLlmProfile as unset', () => {
    const config: PersonaProfileConfig = { defaultLlmProfile: '' }
    expect(resolvePersonaLlmProfile('test-persona', basePersona, config)).toBeUndefined()
  })

  it('returns defaultLlmProfile when persona is null', () => {
    const config: PersonaProfileConfig = { defaultLlmProfile: 'creative' }
    expect(resolvePersonaLlmProfile('unknown', null, config)).toBe('creative')
  })

  it('returns undefined when persona is null and no default set', () => {
    const config: PersonaProfileConfig = {}
    expect(resolvePersonaLlmProfile('unknown', null, config)).toBeUndefined()
  })

  it('treats empty string in llmProfiles[id] as unset, falls through to YAML', () => {
    const persona = createPersonaWithExamples({ llmProfile: 'fast-lite' })
    const config: PersonaProfileConfig = {
      llmProfiles: { 'test-persona': '' },
    }
    // Empty string is falsy, so falls through to YAML llmProfile
    expect(resolvePersonaLlmProfile('test-persona', persona, config)).toBe('fast-lite')
  })
})

// ============================================================================
// validatePersonaLlmProfile Tests
// ============================================================================

describe('validatePersonaLlmProfile', () => {
  const availableProfiles = {
    'fast-lite': { provider: 'openrouter', model: 'test' },
    creative: { provider: 'openrouter', model: 'test' },
    'creative-long': { provider: 'openrouter', model: 'test' },
  }

  beforeEach(() => {
    _resetProfileWarningState()
  })

  it('returns profileId for a valid profile', () => {
    const mockLogger = createMockLogger()
    const result = validatePersonaLlmProfile('creative', 'avasarala', 'creative', availableProfiles, false, mockLogger)
    expect(result).toEqual({ profileId: 'creative' })
  })

  it('warns once and returns feature fallback for invalid non-default profile', () => {
    const warnings: unknown[][] = []
    const mockLogger = {
      ...createMockLogger(),
      warn: (msg: string, meta?: Record<string, unknown>) => {
        warnings.push([msg, meta])
      },
    }

    const result = validatePersonaLlmProfile(
      'nonexistent',
      'avasarala',
      'creative',
      availableProfiles,
      false,
      mockLogger
    )

    expect(result).toEqual({ profileId: 'creative' })
    expect(warnings).toHaveLength(1)
  })

  it('errors once and returns errorMessage for invalid defaultLlmProfile', () => {
    const errors: unknown[][] = []
    const mockLogger = {
      ...createMockLogger(),
      error: (msg: string, meta?: Record<string, unknown>) => {
        errors.push([msg, meta])
      },
    }

    const result = validatePersonaLlmProfile(
      'nonexistent',
      'avasarala',
      'creative',
      availableProfiles,
      true,
      mockLogger
    )

    expect(result).toEqual({ errorMessage: "Persona avasarala's profile nonexistent is not recognized" })
    expect(errors).toHaveLength(1)
  })

  it('deduplicates warn: second call with same invalid profile does not log again', () => {
    const warnings: unknown[][] = []
    const mockLogger = {
      ...createMockLogger(),
      warn: (msg: string, meta?: Record<string, unknown>) => {
        warnings.push([msg, meta])
      },
    }

    validatePersonaLlmProfile('nonexistent', 'avasarala', 'creative', availableProfiles, false, mockLogger)
    validatePersonaLlmProfile('nonexistent', 'skippy', 'creative', availableProfiles, false, mockLogger)

    expect(warnings).toHaveLength(1)
  })

  it('deduplicates error: second call with same invalid default does not log again', () => {
    const errors: unknown[][] = []
    const mockLogger = {
      ...createMockLogger(),
      error: (msg: string, meta?: Record<string, unknown>) => {
        errors.push([msg, meta])
      },
    }

    validatePersonaLlmProfile('nonexistent', 'avasarala', 'creative', availableProfiles, true, mockLogger)
    validatePersonaLlmProfile('nonexistent', 'skippy', 'creative', availableProfiles, true, mockLogger)

    expect(errors).toHaveLength(1)
  })

  it('warns for different invalid profiles separately', () => {
    const warnings: unknown[][] = []
    const mockLogger = {
      ...createMockLogger(),
      warn: (msg: string, meta?: Record<string, unknown>) => {
        warnings.push([msg, meta])
      },
    }

    validatePersonaLlmProfile('bad1', 'avasarala', 'creative', availableProfiles, false, mockLogger)
    validatePersonaLlmProfile('bad2', 'skippy', 'creative', availableProfiles, false, mockLogger)

    expect(warnings).toHaveLength(2)
  })
})

// ============================================================================
// mergePersonaConfig Tests
// ============================================================================

describe('mergePersonaConfig', () => {
  it('returns defaults when config has no personas', () => {
    const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG }
    delete config.personas

    const result = mergePersonaConfig(config)

    expect(result.defaultLlmProfile).toBe(DEFAULT_SESSION_SUMMARY_CONFIG.personas!.defaultLlmProfile)
  })

  it('merges user overrides over defaults', () => {
    const config: SessionSummaryConfig = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: {
        ...DEFAULT_SESSION_SUMMARY_CONFIG.personas!,
        defaultLlmProfile: 'custom-profile',
      },
    }

    const result = mergePersonaConfig(config)

    expect(result.defaultLlmProfile).toBe('custom-profile')
  })
})

// ============================================================================
// getEffectiveProfile Tests
// ============================================================================

describe('getEffectiveProfile', () => {
  const availableProfiles = {
    'fast-lite': { provider: 'openrouter', model: 'test' },
    creative: { provider: 'openrouter', model: 'test' },
    'creative-long': { provider: 'openrouter', model: 'test' },
  }

  beforeEach(() => {
    _resetProfileWarningState()
  })

  it('returns feature profile when persona is null and no config overrides', () => {
    const llmConfig = { profile: 'creative', fallbackProfile: 'cheap-fallback' }
    const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG }

    const result = getEffectiveProfile(null, llmConfig, config, availableProfiles, createMockLogger())

    expect(result).toEqual({ profileId: 'creative' })
  })

  it('returns persona YAML profile when valid and available', () => {
    const persona = createPersonaWithExamples({ llmProfile: 'fast-lite' })
    const llmConfig = { profile: 'creative' }
    const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG }

    const result = getEffectiveProfile(persona, llmConfig, config, availableProfiles, createMockLogger())

    expect(result).toEqual({ profileId: 'fast-lite' })
  })

  it('returns feature fallback when resolved profile is invalid (non-default source)', () => {
    const persona = createPersonaWithExamples({ llmProfile: 'nonexistent' })
    const llmConfig = { profile: 'creative' }
    const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG }

    const result = getEffectiveProfile(persona, llmConfig, config, availableProfiles, createMockLogger())

    expect(result).toEqual({ profileId: 'creative' })
  })

  it('returns errorMessage when invalid profile comes from defaultLlmProfile', () => {
    const llmConfig = { profile: 'creative' }
    const config: SessionSummaryConfig = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: {
        ...DEFAULT_SESSION_SUMMARY_CONFIG.personas!,
        defaultLlmProfile: 'nonexistent',
      },
    }

    const result = getEffectiveProfile(null, llmConfig, config, availableProfiles, createMockLogger())

    expect('errorMessage' in result).toBe(true)
  })

  it('returns per-persona config override when available and valid', () => {
    const persona = createPersonaWithExamples({ id: 'skippy', llmProfile: 'fast-lite' })
    const llmConfig = { profile: 'creative' }
    const config: SessionSummaryConfig = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: {
        ...DEFAULT_SESSION_SUMMARY_CONFIG.personas!,
        llmProfiles: { skippy: 'creative-long' },
      },
    }

    const result = getEffectiveProfile(persona, llmConfig, config, availableProfiles, createMockLogger())

    expect(result).toEqual({ profileId: 'creative-long' })
  })
})

// ============================================================================
// buildUserProfileContext Tests
// ============================================================================

describe('buildUserProfileContext', () => {
  it('returns populated context when profile is provided', () => {
    const profile: UserProfile = {
      name: 'Scott',
      role: 'Software Architect',
      interests: ['Sci-Fi', '80s sitcoms'],
    }
    const context = buildUserProfileContext(profile)
    expect(context).toEqual({
      user_name: 'Scott',
      user_role: 'Software Architect',
      user_interests: 'Sci-Fi, 80s sitcoms',
    })
  })

  it('returns empty strings when profile is null', () => {
    const context = buildUserProfileContext(null)
    expect(context).toEqual({
      user_name: '',
      user_role: '',
      user_interests: '',
    })
  })
})
