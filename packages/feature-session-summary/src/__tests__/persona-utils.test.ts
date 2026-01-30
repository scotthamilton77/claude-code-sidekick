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

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import type { PersonaDefinition, SessionPersonaState, Logger } from '@sidekick/types'
import { buildPersonaContext, stripSurroundingQuotes, loadSessionPersona } from '../handlers/persona-utils'
import type { SessionSummaryStateAccessors } from '../state'

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
