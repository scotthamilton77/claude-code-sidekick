/**
 * Tests for persona selection logic
 * @see docs/design/PERSONA-PROFILES-DESIGN.md - Selection Algorithm
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PersonaDefinition } from '@sidekick/types'
import {
  parseAllowList,
  filterPersonasByAllowList,
  selectRandomPersona,
} from '../handlers/persona-selection'

// ============================================================================
// Test Data
// ============================================================================

function createMockPersona(id: string, displayName?: string): PersonaDefinition {
  return {
    id,
    display_name: displayName ?? id.charAt(0).toUpperCase() + id.slice(1),
    theme: `Theme for ${id}`,
    personality_traits: ['trait1', 'trait2'],
    tone_traits: ['tone1', 'tone2'],
  }
}

// ============================================================================
// parseAllowList Tests
// ============================================================================

describe('parseAllowList', () => {
  it('returns empty array for empty string', () => {
    expect(parseAllowList('')).toEqual([])
  })

  it('returns empty array for whitespace-only string', () => {
    expect(parseAllowList('   ')).toEqual([])
    expect(parseAllowList('\t\n')).toEqual([])
  })

  it('parses single persona ID', () => {
    expect(parseAllowList('skippy')).toEqual(['skippy'])
  })

  it('parses multiple comma-separated IDs', () => {
    expect(parseAllowList('skippy,bones,scotty')).toEqual(['skippy', 'bones', 'scotty'])
  })

  it('trims whitespace around IDs', () => {
    expect(parseAllowList('  skippy  ,  bones  ,  scotty  ')).toEqual(['skippy', 'bones', 'scotty'])
  })

  it('filters out empty entries from trailing commas', () => {
    expect(parseAllowList('skippy,bones,')).toEqual(['skippy', 'bones'])
    expect(parseAllowList(',skippy,bones')).toEqual(['skippy', 'bones'])
    expect(parseAllowList('skippy,,bones')).toEqual(['skippy', 'bones'])
  })

  it('handles mixed whitespace and commas', () => {
    expect(parseAllowList(' , skippy , , bones , ')).toEqual(['skippy', 'bones'])
  })
})

// ============================================================================
// filterPersonasByAllowList Tests
// ============================================================================

describe('filterPersonasByAllowList', () => {
  let mockLogger: { warn: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockLogger = { warn: vi.fn() }
  })

  function createPersonasMap(ids: string[]): Map<string, PersonaDefinition> {
    const map = new Map<string, PersonaDefinition>()
    for (const id of ids) {
      map.set(id, createMockPersona(id))
    }
    return map
  }

  it('returns all personas when allowList is empty', () => {
    const personas = createPersonasMap(['skippy', 'bones', 'scotty'])
    const result = filterPersonasByAllowList(personas, [], mockLogger)

    expect(result).toHaveLength(3)
    expect(result.map((p) => p.id)).toContain('skippy')
    expect(result.map((p) => p.id)).toContain('bones')
    expect(result.map((p) => p.id)).toContain('scotty')
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('filters to only allowed personas', () => {
    const personas = createPersonasMap(['skippy', 'bones', 'scotty', 'sidekick'])
    const result = filterPersonasByAllowList(personas, ['skippy', 'bones'], mockLogger)

    expect(result).toHaveLength(2)
    expect(result.map((p) => p.id)).toContain('skippy')
    expect(result.map((p) => p.id)).toContain('bones')
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('logs warning for unknown persona IDs in allowList', () => {
    const personas = createPersonasMap(['skippy', 'bones'])
    const result = filterPersonasByAllowList(personas, ['skippy', 'unknown', 'bones'], mockLogger)

    expect(result).toHaveLength(2)
    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn).toHaveBeenCalledWith('Unknown persona in allowList, ignoring', { personaId: 'unknown' })
  })

  it('returns empty array when all allowList entries are unknown', () => {
    const personas = createPersonasMap(['skippy', 'bones'])
    const result = filterPersonasByAllowList(personas, ['unknown1', 'unknown2'], mockLogger)

    expect(result).toHaveLength(0)
    expect(mockLogger.warn).toHaveBeenCalledTimes(2)
  })

  it('preserves order from allowList', () => {
    const personas = createPersonasMap(['skippy', 'bones', 'scotty'])
    const result = filterPersonasByAllowList(personas, ['scotty', 'skippy'], mockLogger)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('scotty')
    expect(result[1].id).toBe('skippy')
  })
})

// ============================================================================
// selectRandomPersona Tests
// ============================================================================

describe('selectRandomPersona', () => {
  it('returns null for empty array', () => {
    expect(selectRandomPersona([])).toBeNull()
  })

  it('returns the only persona for single-element array', () => {
    const persona = createMockPersona('skippy')
    expect(selectRandomPersona([persona])).toBe(persona)
  })

  it('returns a persona from the array', () => {
    const personas = [createMockPersona('skippy'), createMockPersona('bones'), createMockPersona('scotty')]

    const result = selectRandomPersona(personas)

    expect(result).not.toBeNull()
    expect(personas).toContain(result)
  })

  it('eventually selects all personas over many iterations (distribution test)', () => {
    const personas = [createMockPersona('skippy'), createMockPersona('bones'), createMockPersona('scotty')]

    const selectedIds = new Set<string>()

    // Run many times to ensure randomness covers all options
    for (let i = 0; i < 100; i++) {
      const result = selectRandomPersona(personas)
      if (result) {
        selectedIds.add(result.id)
      }
    }

    // All personas should have been selected at least once
    expect(selectedIds.size).toBe(3)
    expect(selectedIds.has('skippy')).toBe(true)
    expect(selectedIds.has('bones')).toBe(true)
    expect(selectedIds.has('scotty')).toBe(true)
  })
})
