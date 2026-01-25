/**
 * Tests for persona selection logic
 * @see docs/design/PERSONA-PROFILES-DESIGN.md - Selection Algorithm
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PersonaDefinition } from '@sidekick/types'
import {
  parseAllowList,
  filterPersonasByAllowList,
  selectRandomPersona,
  selectPersonaForSession,
} from '../handlers/persona-selection'
import { createMockDaemonContext, MockLogger, MockStateService } from '@sidekick/testing-fixtures'
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
    const result = filterPersonasByAllowList(personas, [], mockLogger)

    expect(result).toHaveLength(3)
    expect(result.map((p) => p.id)).toContain('skippy')
    expect(result.map((p) => p.id)).toContain('bones')
    expect(result.map((p) => p.id)).toContain('scotty')
    expect(mockLogger.getLogsByLevel('warn')).toHaveLength(0)
  })

  it('filters to only allowed personas', () => {
    const personas = createPersonasMap(['skippy', 'bones', 'scotty', 'sidekick'])
    const result = filterPersonasByAllowList(personas, ['skippy', 'bones'], mockLogger)

    expect(result).toHaveLength(2)
    expect(result.map((p) => p.id)).toContain('skippy')
    expect(result.map((p) => p.id)).toContain('bones')
    expect(mockLogger.getLogsByLevel('warn')).toHaveLength(0)
  })

  it('logs warning for unknown persona IDs in allowList', () => {
    const personas = createPersonasMap(['skippy', 'bones'])
    const result = filterPersonasByAllowList(personas, ['skippy', 'unknown', 'bones'], mockLogger)

    expect(result).toHaveLength(2)
    const warnLogs = mockLogger.getLogsByLevel('warn')
    expect(warnLogs).toHaveLength(1)
    expect(warnLogs[0].msg).toBe('Unknown persona in allowList, ignoring')
    expect(warnLogs[0].meta).toEqual({ personaId: 'unknown' })
  })

  it('returns empty array when all allowList entries are unknown', () => {
    const personas = createPersonasMap(['skippy', 'bones'])
    const result = filterPersonasByAllowList(personas, ['unknown1', 'unknown2'], mockLogger)

    expect(result).toHaveLength(0)
    expect(mockLogger.getLogsByLevel('warn')).toHaveLength(2)
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
    const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, personas: { allowList: 'unknown', resumeFreshnessHours: 4 } }

    const result = await selectPersonaForSession('test-session', config, ctx)

    expect(result).toBeNull()
    expect(mockLogger.wasLoggedAtLevel('No eligible personas after allowList filtering', 'warn')).toBe(true)
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
    const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, personas: { allowList: 'bones', resumeFreshnessHours: 4 } }

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
    const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, personas: { allowList: '' } }

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
})
