/**
 * Tests for persona selection logic
 * @see docs/design/PERSONA-PROFILES-DESIGN.md - Selection Algorithm
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PersonaDefinition } from '@sidekick/types'
import {
  parsePersonaList,
  filterPersonas,
  selectRandomPersona,
  selectPersonaForSession,
  ensurePersonaForSession,
} from '../handlers/persona-selection'
import { createMockDaemonContext, MockLogger, MockStateService } from '@sidekick/testing-fixtures'
import type { SessionSummaryConfig } from '../types'
import { DEFAULT_SESSION_SUMMARY_CONFIG } from '../types'

// Mock the @sidekick/core module for persona loader
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...actual,
    getDefaultPersonasDir: vi.fn(() => '/mock/personas'),
    createPersonaLoader: vi.fn(),
  }
})

// Restore all mocks after each test to prevent state pollution
afterEach(() => {
  vi.restoreAllMocks()
})

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
// DEFAULT_SESSION_SUMMARY_CONFIG Tests
// ============================================================================

describe('DEFAULT_SESSION_SUMMARY_CONFIG', () => {
  it('has persistThroughClear defaulting to true', () => {
    expect(DEFAULT_SESSION_SUMMARY_CONFIG.personas?.persistThroughClear).toBe(true)
  })
})

// ============================================================================
// parsePersonaList Tests
// ============================================================================

describe('parsePersonaList', () => {
  it('returns empty array for empty string', () => {
    expect(parsePersonaList('')).toEqual([])
  })

  it('returns empty array for whitespace-only string', () => {
    expect(parsePersonaList('   ')).toEqual([])
    expect(parsePersonaList('\t\n')).toEqual([])
  })

  it('parses single persona ID', () => {
    expect(parsePersonaList('skippy')).toEqual(['skippy'])
  })

  it('parses multiple comma-separated IDs', () => {
    expect(parsePersonaList('skippy,bones,scotty')).toEqual(['skippy', 'bones', 'scotty'])
  })

  it('trims whitespace around IDs', () => {
    expect(parsePersonaList('  skippy  ,  bones  ,  scotty  ')).toEqual(['skippy', 'bones', 'scotty'])
  })

  it('filters out empty entries from trailing commas', () => {
    expect(parsePersonaList('skippy,bones,')).toEqual(['skippy', 'bones'])
    expect(parsePersonaList(',skippy,bones')).toEqual(['skippy', 'bones'])
    expect(parsePersonaList('skippy,,bones')).toEqual(['skippy', 'bones'])
  })

  it('handles mixed whitespace and commas', () => {
    expect(parsePersonaList(' , skippy , , bones , ')).toEqual(['skippy', 'bones'])
  })
})

// ============================================================================
// filterPersonas Tests
// ============================================================================

describe('filterPersonas', () => {
  let mockLogger: MockLogger

  beforeEach(() => {
    mockLogger = new MockLogger()
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
    const result = filterPersonas(personas, [], [], mockLogger)

    expect(result).toHaveLength(3)
    expect(result.map((p) => p.id)).toContain('skippy')
    expect(result.map((p) => p.id)).toContain('bones')
    expect(result.map((p) => p.id)).toContain('scotty')
    expect(mockLogger.getLogsByLevel('warn')).toHaveLength(0)
  })

  it('filters to only allowed personas', () => {
    const personas = createPersonasMap(['skippy', 'bones', 'scotty', 'sidekick'])
    const result = filterPersonas(personas, ['skippy', 'bones'], [], mockLogger)

    expect(result).toHaveLength(2)
    expect(result.map((p) => p.id)).toContain('skippy')
    expect(result.map((p) => p.id)).toContain('bones')
    expect(mockLogger.getLogsByLevel('warn')).toHaveLength(0)
  })

  it('logs warning for unknown persona IDs in allowList', () => {
    const personas = createPersonasMap(['skippy', 'bones'])
    const result = filterPersonas(personas, ['skippy', 'unknown', 'bones'], [], mockLogger)

    expect(result).toHaveLength(2)
    const warnLogs = mockLogger.getLogsByLevel('warn')
    expect(warnLogs).toHaveLength(1)
    expect(warnLogs[0].msg).toBe('Unknown persona in allowList, ignoring')
    expect(warnLogs[0].meta).toEqual({ personaId: 'unknown' })
  })

  it('returns empty array when all allowList entries are unknown', () => {
    const personas = createPersonasMap(['skippy', 'bones'])
    const result = filterPersonas(personas, ['unknown1', 'unknown2'], [], mockLogger)

    expect(result).toHaveLength(0)
    expect(mockLogger.getLogsByLevel('warn')).toHaveLength(2)
  })

  it('preserves order from allowList', () => {
    const personas = createPersonasMap(['skippy', 'bones', 'scotty'])
    const result = filterPersonas(personas, ['scotty', 'skippy'], [], mockLogger)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('scotty')
    expect(result[1].id).toBe('skippy')
  })

  // blockList tests

  it('excludes blocked personas when allowList is empty', () => {
    const personas = createPersonasMap(['skippy', 'bones', 'disabled'])
    const result = filterPersonas(personas, [], ['disabled'], mockLogger)

    expect(result).toHaveLength(2)
    expect(result.map((p) => p.id)).toContain('skippy')
    expect(result.map((p) => p.id)).toContain('bones')
    expect(result.map((p) => p.id)).not.toContain('disabled')
  })

  it('blockList overrides allowList', () => {
    const personas = createPersonasMap(['skippy', 'bones', 'scotty'])
    const result = filterPersonas(personas, ['skippy', 'bones'], ['bones'], mockLogger)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('skippy')
  })

  it('empty blockList has no effect', () => {
    const personas = createPersonasMap(['skippy', 'bones'])
    const result = filterPersonas(personas, [], [], mockLogger)

    expect(result).toHaveLength(2)
  })

  it('multiple blockList entries are excluded', () => {
    const personas = createPersonasMap(['skippy', 'bones', 'scotty', 'disabled'])
    const result = filterPersonas(personas, [], ['disabled', 'scotty'], mockLogger)

    expect(result).toHaveLength(2)
    expect(result.map((p) => p.id)).toContain('skippy')
    expect(result.map((p) => p.id)).toContain('bones')
  })

  it('logs warning for unknown blockList entries', () => {
    const personas = createPersonasMap(['skippy', 'bones'])
    const result = filterPersonas(personas, [], ['unknown-persona'], mockLogger)

    expect(result).toHaveLength(2)
    const warnLogs = mockLogger.getLogsByLevel('warn')
    expect(warnLogs).toHaveLength(1)
    expect(warnLogs[0].msg).toBe('Unknown persona in blockList, ignoring')
    expect(warnLogs[0].meta).toEqual({ personaId: 'unknown-persona' })
  })

  it('returns empty array when all personas are blocked', () => {
    const personas = createPersonasMap(['skippy', 'bones'])
    const result = filterPersonas(personas, [], ['skippy', 'bones'], mockLogger)

    expect(result).toHaveLength(0)
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

  // Weighted selection tests

  it('uses uniform distribution when no weights provided', () => {
    const personas = [createMockPersona('skippy'), createMockPersona('bones')]
    const selectedIds = new Set<string>()

    for (let i = 0; i < 100; i++) {
      const result = selectRandomPersona(personas)
      if (result) selectedIds.add(result.id)
    }

    expect(selectedIds.size).toBe(2)
  })

  it('excludes personas with weight 0', () => {
    const personas = [createMockPersona('skippy'), createMockPersona('bones'), createMockPersona('scotty')]
    const weights = { bones: 0 }

    const selectedIds = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const result = selectRandomPersona(personas, weights)
      if (result) selectedIds.add(result.id)
    }

    expect(selectedIds.has('bones')).toBe(false)
    expect(selectedIds.has('skippy')).toBe(true)
    expect(selectedIds.has('scotty')).toBe(true)
  })

  it('returns null when all personas have weight 0', () => {
    const personas = [createMockPersona('skippy'), createMockPersona('bones')]
    const weights = { skippy: 0, bones: 0 }

    const result = selectRandomPersona(personas, weights)
    expect(result).toBeNull()
  })

  it('defaults unspecified weights to 1', () => {
    const personas = [createMockPersona('skippy'), createMockPersona('bones')]
    // Only skippy has explicit weight; bones defaults to 1
    const weights = { skippy: 1 }

    const selectedIds = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const result = selectRandomPersona(personas, weights)
      if (result) selectedIds.add(result.id)
    }

    // Both should be selected since both effectively have weight 1
    expect(selectedIds.size).toBe(2)
  })

  it('heavily weighted persona is selected much more often', () => {
    const personas = [createMockPersona('skippy'), createMockPersona('bones')]
    const weights = { skippy: 100, bones: 1 }

    const counts: Record<string, number> = { skippy: 0, bones: 0 }
    const iterations = 1000
    for (let i = 0; i < iterations; i++) {
      const result = selectRandomPersona(personas, weights)
      if (result) counts[result.id]++
    }

    // skippy should get ~99% of selections (100/101)
    expect(counts.skippy).toBeGreaterThan(iterations * 0.9)
    expect(counts.bones).toBeGreaterThan(0) // bones should still appear occasionally
  })

  it.each([
    { label: 'negative', weight: -5 },
    { label: 'NaN', weight: NaN },
    { label: 'Infinity', weight: Infinity },
    { label: '-Infinity', weight: -Infinity },
    { label: 'non-numeric string', weight: 'not-a-number' },
  ])('excludes persona with $label weight', ({ weight }) => {
    const personas = [createMockPersona('skippy'), createMockPersona('bones')]
    const weights = { skippy: weight, bones: 1 }

    const selectedIds = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const result = selectRandomPersona(personas, weights)
      if (result) selectedIds.add(result.id)
    }

    expect(selectedIds).toEqual(new Set(['bones']))
  })

  it('coerces numeric string weights correctly', () => {
    const personas = [createMockPersona('skippy'), createMockPersona('bones')]
    // YAML might parse "5" as a string
    const weights = { skippy: '5', bones: 0 }

    const selectedIds = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const result = selectRandomPersona(personas, weights)
      if (result) selectedIds.add(result.id)
    }

    // "5" → Number("5") → 5 → valid weight
    expect(selectedIds).toEqual(new Set(['skippy']))
  })

  it('treats empty weights object same as no weights', () => {
    const personas = [createMockPersona('skippy'), createMockPersona('bones')]
    const selectedIds = new Set<string>()

    for (let i = 0; i < 100; i++) {
      const result = selectRandomPersona(personas, {})
      if (result) selectedIds.add(result.id)
    }

    expect(selectedIds.size).toBe(2)
  })
})

// ============================================================================
// selectPersonaForSession Tests (Integration)
// ============================================================================

describe('selectPersonaForSession', () => {
  let mockLogger: MockLogger
  let mockStateService: MockStateService
  let mockCreatePersonaLoader: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockLogger = new MockLogger()
    mockStateService = new MockStateService()

    // Get the mocked function
    const coreMod = await import('@sidekick/core')
    mockCreatePersonaLoader = coreMod.createPersonaLoader as ReturnType<typeof vi.fn>
  })

  function setupMockLoader(personas: Map<string, PersonaDefinition>): void {
    mockCreatePersonaLoader.mockReturnValue({
      discover: () => personas,
      load: vi.fn(),
      loadFile: vi.fn(),
      resolver: {},
      cascadeLayers: [],
    })
  }

  it('returns null and logs warning when no personas are discovered', async () => {
    setupMockLoader(new Map())
    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })

    const result = await selectPersonaForSession('test-session', DEFAULT_SESSION_SUMMARY_CONFIG, ctx)

    expect(result).toBeNull()
    expect(mockLogger.wasLoggedAtLevel('No personas found, skipping persona selection', 'warn')).toBe(true)
  })

  it('returns null when allowList filters out all personas', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
    const config = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: { allowList: 'unknown', blockList: '', resumeFreshnessHours: 4 },
    }

    const result = await selectPersonaForSession('test-session', config, ctx)

    expect(result).toBeNull()
    expect(mockLogger.wasLoggedAtLevel('No eligible personas after filtering', 'warn')).toBe(true)
  })

  it('selects and persists a persona when available', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy', 'Skippy'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })

    const result = await selectPersonaForSession('test-session', DEFAULT_SESSION_SUMMARY_CONFIG, ctx)

    expect(result).toBe('skippy')
    expect(mockLogger.wasLoggedAtLevel('Selected persona for session', 'info')).toBe(true)
    const infoLogs = mockLogger.getLogsByLevel('info')
    const selectionLog = infoLogs.find((log) => log.msg === 'Selected persona for session')
    expect(selectionLog?.meta).toMatchObject({ sessionId: 'test-session', personaId: 'skippy' })
  })

  it('persists persona state with correct structure', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('bones', createMockPersona('bones', 'Bones'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })

    await selectPersonaForSession('test-session', DEFAULT_SESSION_SUMMARY_CONFIG, ctx)

    // Check state was written
    const paths = mockStateService.getPaths()
    expect(paths.length).toBe(1)
    expect(paths[0]).toContain('session-persona.json')

    const stored = mockStateService.getStored(paths[0]) as { persona_id: string; selected_from: string[] }
    expect(stored.persona_id).toBe('bones')
    expect(stored.selected_from).toContain('bones')
  })

  it('filters personas by allowList config', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    personas.set('bones', createMockPersona('bones'))
    personas.set('scotty', createMockPersona('scotty'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
    const config = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: { allowList: 'bones', blockList: '', resumeFreshnessHours: 4 },
    }

    const result = await selectPersonaForSession('test-session', config, ctx)

    // Only bones should be selected since it's the only one in allowList
    expect(result).toBe('bones')
  })

  it('merges persona config with defaults', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
    // Config with partial personas config - should merge with defaults
    const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, personas: { allowList: '', blockList: '' } }

    const result = await selectPersonaForSession('test-session', config as typeof DEFAULT_SESSION_SUMMARY_CONFIG, ctx)

    expect(result).toBe('skippy')
  })

  it('uses projectDir from context paths', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    setupMockLoader(personas)

    const customPaths = {
      projectDir: '/custom/project',
      userConfigDir: '/home/.sidekick',
      projectConfigDir: '/custom/project/.sidekick',
    }
    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService, paths: customPaths })

    await selectPersonaForSession('test-session', DEFAULT_SESSION_SUMMARY_CONFIG, ctx)

    expect(mockCreatePersonaLoader).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: '/custom/project' }))
  })

  it('blockList excludes persona from selection', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    personas.set('disabled', createMockPersona('disabled'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
    const config = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: { allowList: '', blockList: 'disabled', resumeFreshnessHours: 4 },
    }

    const result = await selectPersonaForSession('test-session', config, ctx)

    // Only skippy should be selected since disabled is blocked
    expect(result).toBe('skippy')
  })

  it('blockList overrides allowList in config', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    personas.set('bones', createMockPersona('bones'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
    const config = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: { allowList: 'skippy,bones', blockList: 'bones', resumeFreshnessHours: 4 },
    }

    const result = await selectPersonaForSession('test-session', config, ctx)

    expect(result).toBe('skippy')
  })

  it('passes persona weights from config to selection', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    personas.set('bones', createMockPersona('bones'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
    const config = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: {
        allowList: '',
        blockList: '',
        resumeFreshnessHours: 4,
        weights: { skippy: 100, bones: 0 },
      },
    }

    // With bones at weight 0, only skippy should ever be selected
    const results = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const result = await selectPersonaForSession(`session-${i}`, config, ctx)
      if (result) results.add(result)
    }

    expect(results.has('skippy')).toBe(true)
    expect(results.has('bones')).toBe(false)
  })

  it('returns null when all eligible personas have weight 0', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    personas.set('bones', createMockPersona('bones'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
    const config = {
      ...DEFAULT_SESSION_SUMMARY_CONFIG,
      personas: {
        allowList: '',
        blockList: '',
        resumeFreshnessHours: 4,
        weights: { skippy: 0, bones: 0 },
      },
    }

    const result = await selectPersonaForSession('test-session', config, ctx)

    expect(result).toBeNull()
    expect(mockLogger.wasLoggedAtLevel('No eligible personas after applying weights', 'warn')).toBe(true)
  })

  describe('pinned persona', () => {
    it('uses pinned persona when it exists in discovered personas', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      personas.set('bones', createMockPersona('bones'))
      personas.set('scotty', createMockPersona('scotty'))
      setupMockLoader(personas)

      const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
      const config = {
        ...DEFAULT_SESSION_SUMMARY_CONFIG,
        personas: { pinnedPersona: 'bones', allowList: '', blockList: '', resumeFreshnessHours: 4 },
      }

      // Run multiple times to verify it never selects randomly
      for (let i = 0; i < 10; i++) {
        const result = await selectPersonaForSession(`session-${i}`, config, ctx)
        expect(result).toBe('bones')
      }

      expect(mockLogger.wasLoggedAtLevel('Using pinned persona for session', 'info')).toBe(true)
    })

    it('falls back to random when pinned persona is not found', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      setupMockLoader(personas)

      const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
      const config = {
        ...DEFAULT_SESSION_SUMMARY_CONFIG,
        personas: { pinnedPersona: 'nonexistent', allowList: '', blockList: '', resumeFreshnessHours: 4 },
      }

      const result = await selectPersonaForSession('test-session', config, ctx)

      // Should fall back to random (only skippy available)
      expect(result).toBe('skippy')
      expect(mockLogger.wasLoggedAtLevel('Pinned persona not found, falling back to random selection', 'warn')).toBe(
        true
      )
    })

    it('uses random selection when pinnedPersona is empty string', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      personas.set('bones', createMockPersona('bones'))
      setupMockLoader(personas)

      const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
      const config = {
        ...DEFAULT_SESSION_SUMMARY_CONFIG,
        personas: { pinnedPersona: '', allowList: '', blockList: '', resumeFreshnessHours: 4 },
      }

      // Should work like normal random selection
      const results = new Set<string>()
      for (let i = 0; i < 50; i++) {
        const result = await selectPersonaForSession(`session-${i}`, config, ctx)
        if (result) results.add(result)
      }

      expect(results.size).toBe(2) // Both should be selected eventually
    })

    it('pinned persona bypasses allowList and blockList', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      personas.set('bones', createMockPersona('bones'))
      setupMockLoader(personas)

      const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })
      const config = {
        ...DEFAULT_SESSION_SUMMARY_CONFIG,
        personas: {
          pinnedPersona: 'bones',
          allowList: 'skippy', // bones NOT in allowList
          blockList: 'bones', // bones IS in blockList
          resumeFreshnessHours: 4,
        },
      }

      const result = await selectPersonaForSession('test-session', config, ctx)

      // Pin overrides allowList/blockList
      expect(result).toBe('bones')
    })
  })

  describe('persona persistence through clear', () => {
    let mockLogger: MockLogger
    let mockStateService: MockStateService
    let mockCreatePersonaLoader: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      vi.clearAllMocks()
      mockLogger = new MockLogger()
      mockStateService = new MockStateService()
      const coreMod = await import('@sidekick/core')
      mockCreatePersonaLoader = coreMod.createPersonaLoader as ReturnType<typeof vi.fn>
    })

    function setupMockLoader(personas: Map<string, PersonaDefinition>): void {
      mockCreatePersonaLoader.mockReturnValue({
        discover: () => personas,
        load: vi.fn(),
        loadFile: vi.fn(),
        resolver: {},
        cascadeLayers: [],
      })
    }

    /** Build a config with persona overrides, properly typed */
    function configWith(
      personaOverrides: Partial<NonNullable<SessionSummaryConfig['personas']>>
    ): SessionSummaryConfig {
      return {
        ...DEFAULT_SESSION_SUMMARY_CONFIG,
        personas: { ...DEFAULT_SESSION_SUMMARY_CONFIG.personas, ...personaOverrides },
      } as SessionSummaryConfig
    }

    it('preserves persona on clear when persistThroughClear is true and cache has valid entry', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      personas.set('bones', createMockPersona('bones'))
      setupMockLoader(personas)

      const ctx = createMockDaemonContext({
        logger: mockLogger,
        stateService: mockStateService,
        personaClearCache: { consume: () => 'bones' },
      })

      const config = configWith({ persistThroughClear: true })

      const result = await selectPersonaForSession('new-session', config, ctx, { startType: 'clear' })

      expect(result).toBe('bones')
      expect(mockLogger.wasLoggedAtLevel('Preserved persona through clear', 'info')).toBe(true)
    })

    it('re-selects randomly when persistThroughClear is false', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      setupMockLoader(personas)

      const consumeMock = vi.fn(() => 'skippy')
      const ctx = createMockDaemonContext({
        logger: mockLogger,
        stateService: mockStateService,
        personaClearCache: { consume: consumeMock },
      })

      const config = configWith({ persistThroughClear: false })

      await selectPersonaForSession('new-session', config, ctx, { startType: 'clear' })

      // consume should NOT have been called since persist is disabled
      expect(consumeMock).not.toHaveBeenCalled()
    })

    it('falls through to normal selection when cache returns null', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      setupMockLoader(personas)

      const ctx = createMockDaemonContext({
        logger: mockLogger,
        stateService: mockStateService,
        personaClearCache: { consume: () => null },
      })

      const config = configWith({ persistThroughClear: true })

      const result = await selectPersonaForSession('new-session', config, ctx, { startType: 'clear' })

      expect(result).toBe('skippy') // falls through to random (only one available)
    })

    it('falls through when cached persona ID not found in discovered personas', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      setupMockLoader(personas)

      const ctx = createMockDaemonContext({
        logger: mockLogger,
        stateService: mockStateService,
        personaClearCache: { consume: () => 'deleted-persona' },
      })

      const config = configWith({ persistThroughClear: true })

      const result = await selectPersonaForSession('new-session', config, ctx, { startType: 'clear' })

      expect(result).toBe('skippy')
      expect(
        mockLogger.wasLoggedAtLevel(
          'Cached persona from clear not found in available personas, falling back to selection',
          'warn'
        )
      ).toBe(true)
    })

    it('does not use cache on startup (only on clear)', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      setupMockLoader(personas)

      const consumeMock = vi.fn(() => 'skippy')
      const ctx = createMockDaemonContext({
        logger: mockLogger,
        stateService: mockStateService,
        personaClearCache: { consume: consumeMock },
      })

      await selectPersonaForSession('new-session', DEFAULT_SESSION_SUMMARY_CONFIG, ctx, { startType: 'startup' })

      expect(consumeMock).not.toHaveBeenCalled()
    })

    it('pinnedPersona takes precedence over clear cache', async () => {
      const personas = new Map<string, PersonaDefinition>()
      personas.set('skippy', createMockPersona('skippy'))
      personas.set('bones', createMockPersona('bones'))
      setupMockLoader(personas)

      const consumeMock = vi.fn(() => 'bones')
      const ctx = createMockDaemonContext({
        logger: mockLogger,
        stateService: mockStateService,
        personaClearCache: { consume: consumeMock },
      })

      const config = configWith({ pinnedPersona: 'skippy', persistThroughClear: true })

      const result = await selectPersonaForSession('new-session', config, ctx, { startType: 'clear' })

      expect(result).toBe('skippy') // pinned wins
      expect(consumeMock).not.toHaveBeenCalled() // cache never consulted
    })
  })
})

// ============================================================================
// ensurePersonaForSession Tests (sidekick-p4h)
// ============================================================================

describe('ensurePersonaForSession', () => {
  let mockLogger: MockLogger
  let mockStateService: MockStateService
  let mockCreatePersonaLoader: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockLogger = new MockLogger()
    mockStateService = new MockStateService()

    const coreMod = await import('@sidekick/core')
    mockCreatePersonaLoader = coreMod.createPersonaLoader as ReturnType<typeof vi.fn>
  })

  function setupMockLoader(personas: Map<string, PersonaDefinition>): void {
    mockCreatePersonaLoader.mockReturnValue({
      discover: () => personas,
      load: vi.fn(),
      loadFile: vi.fn(),
      resolver: {},
      cascadeLayers: [],
    })
  }

  it('re-selects persona when persona state is missing', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy', 'Skippy'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })

    // No persona state exists — should trigger re-selection
    await ensurePersonaForSession('test-session', ctx)

    // Verify persona was selected and persisted
    const paths = mockStateService.getPaths()
    const personaPath = paths.find((p) => p.includes('session-persona.json'))
    expect(personaPath).toBeDefined()

    const stored = mockStateService.getStored(personaPath!) as { persona_id: string }
    expect(stored.persona_id).toBe('skippy')

    // Verify recovery was logged
    expect(mockLogger.wasLoggedAtLevel('Persona state missing for active session, re-selecting', 'info')).toBe(true)
  })

  it('does not re-select when persona state already exists', async () => {
    const personas = new Map<string, PersonaDefinition>()
    personas.set('skippy', createMockPersona('skippy'))
    personas.set('bones', createMockPersona('bones'))
    setupMockLoader(personas)

    const ctx = createMockDaemonContext({ logger: mockLogger, stateService: mockStateService })

    // Pre-populate persona state
    await selectPersonaForSession('test-session', DEFAULT_SESSION_SUMMARY_CONFIG, ctx)
    const pathsBefore = mockStateService.getPaths()
    const personaPath = pathsBefore.find((p) => p.includes('session-persona.json'))!
    const storedBefore = mockStateService.getStored(personaPath) as { persona_id: string }

    // Clear call counts
    vi.clearAllMocks()
    setupMockLoader(personas)

    // Ensure should be a no-op
    await ensurePersonaForSession('test-session', ctx)

    // Persona state should be unchanged
    const storedAfter = mockStateService.getStored(personaPath) as { persona_id: string }
    expect(storedAfter.persona_id).toBe(storedBefore.persona_id)

    // No recovery log
    expect(mockLogger.wasLoggedAtLevel('Persona state missing for active session, re-selecting', 'info')).toBe(false)
  })
})
