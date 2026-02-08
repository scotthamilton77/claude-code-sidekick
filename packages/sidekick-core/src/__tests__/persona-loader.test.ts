import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createPersonaLoader, discoverPersonas, loadPersonaFile, type PersonaLoaderOptions } from '../persona-loader'
import type { Logger } from '@sidekick/types'

function createMockLogger(): Logger & { warn: ReturnType<typeof vi.fn> } {
  const mockFn = vi.fn()
  const logger: Logger = {
    trace: mockFn,
    debug: mockFn,
    info: mockFn,
    warn: vi.fn() as any,
    error: mockFn,
    fatal: mockFn,
    child: () => logger,
    flush: async () => {},
  }
  return logger as Logger & { warn: ReturnType<typeof vi.fn> }
}

describe('PersonaLoader', () => {
  const tempRoot = join(tmpdir(), 'sidekick-persona-tests')
  const defaultPersonasDir = join(tempRoot, 'assets', 'sidekick', 'personas')

  beforeEach(() => {
    mkdirSync(defaultPersonasDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  describe('loadPersonaFile', () => {
    test('loads valid persona YAML file', () => {
      const filePath = join(defaultPersonasDir, 'skippy.yaml')
      writeFileSync(
        filePath,
        `id: skippy
display_name: Skippy
theme: "Sci-fi snark with dry wit"
personality_traits:
  - sarcastic
  - impatient
  - clever
tone_traits:
  - snarky
  - playful
  - concise
statusline_empty_messages:
  - "Let's get this over with."
`
      )

      const persona = loadPersonaFile(filePath)

      expect(persona).not.toBeNull()
      expect(persona!.id).toBe('skippy')
      expect(persona!.display_name).toBe('Skippy')
      expect(persona!.theme).toBe('Sci-fi snark with dry wit')
      expect(persona!.personality_traits).toEqual(['sarcastic', 'impatient', 'clever'])
      expect(persona!.tone_traits).toEqual(['snarky', 'playful', 'concise'])
      expect(persona!.statusline_empty_messages).toEqual(["Let's get this over with."])
    })

    test('loads persona without optional statusline_empty_messages', () => {
      const filePath = join(defaultPersonasDir, 'sidekick.yaml')
      writeFileSync(
        filePath,
        `id: sidekick
display_name: Sidekick
theme: "Default helpful assistant"
personality_traits:
  - helpful
tone_traits:
  - friendly
`
      )

      const persona = loadPersonaFile(filePath)

      expect(persona).not.toBeNull()
      expect(persona!.id).toBe('sidekick')
      expect(persona!.statusline_empty_messages).toBeUndefined()
    })

    test('returns null for invalid schema (missing required field)', () => {
      const filePath = join(defaultPersonasDir, 'invalid.yaml')
      writeFileSync(
        filePath,
        `id: invalid
display_name: Invalid
# missing theme, personality_traits, tone_traits
`
      )

      const mockLogger = createMockLogger()
      const persona = loadPersonaFile(filePath, mockLogger)

      expect(persona).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid persona file'))
    })

    test('returns null for malformed YAML', () => {
      const filePath = join(defaultPersonasDir, 'malformed.yaml')
      writeFileSync(filePath, `invalid: yaml: [unclosed`)

      const mockLogger = createMockLogger()
      const persona = loadPersonaFile(filePath, mockLogger)

      expect(persona).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to load persona file'))
    })

    test('returns null for non-existent file', () => {
      const mockLogger = createMockLogger()
      const persona = loadPersonaFile('/nonexistent/path.yaml', mockLogger)

      expect(persona).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    test('warns when id does not match filename', () => {
      const filePath = join(defaultPersonasDir, 'filename.yaml')
      writeFileSync(
        filePath,
        `id: different_id
display_name: Test
theme: Test theme
personality_traits: []
tone_traits: []
`
      )

      const mockLogger = createMockLogger()
      const persona = loadPersonaFile(filePath, mockLogger)

      expect(persona).not.toBeNull()
      expect(persona!.id).toBe('different_id')
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('does not match filename'))
    })
  })

  describe('discoverPersonas', () => {
    test('returns empty map when no personas exist', () => {
      const options: PersonaLoaderOptions = {
        defaultPersonasDir,
        projectRoot: join(tempRoot, 'empty-project'),
        homeDir: join(tempRoot, 'empty-home'),
      }

      const personas = discoverPersonas(options)

      expect(personas.size).toBe(0)
    })

    test('loads personas from default directory', () => {
      writeFileSync(
        join(defaultPersonasDir, 'sidekick.yaml'),
        `id: sidekick
display_name: Sidekick
theme: Default assistant
personality_traits: [helpful]
tone_traits: [friendly]
`
      )

      const options: PersonaLoaderOptions = {
        defaultPersonasDir,
        homeDir: join(tempRoot, 'home'),
      }

      const personas = discoverPersonas(options)

      expect(personas.size).toBe(1)
      expect(personas.get('sidekick')).toBeDefined()
      expect(personas.get('sidekick')!.display_name).toBe('Sidekick')
    })

    test('user personas override default personas', () => {
      // Default persona
      writeFileSync(
        join(defaultPersonasDir, 'sidekick.yaml'),
        `id: sidekick
display_name: Default Sidekick
theme: Default
personality_traits: [helpful]
tone_traits: [friendly]
`
      )

      // User override
      const userPersonasDir = join(tempRoot, 'home', '.sidekick', 'personas')
      mkdirSync(userPersonasDir, { recursive: true })
      writeFileSync(
        join(userPersonasDir, 'sidekick.yaml'),
        `id: sidekick
display_name: User Sidekick
theme: User override
personality_traits: [custom]
tone_traits: [personalized]
`
      )

      const options: PersonaLoaderOptions = {
        defaultPersonasDir,
        homeDir: join(tempRoot, 'home'),
      }

      const personas = discoverPersonas(options)

      expect(personas.size).toBe(1)
      expect(personas.get('sidekick')!.display_name).toBe('User Sidekick')
      expect(personas.get('sidekick')!.theme).toBe('User override')
    })

    test('project personas override user personas', () => {
      // Default persona
      writeFileSync(
        join(defaultPersonasDir, 'sidekick.yaml'),
        `id: sidekick
display_name: Default
theme: Default
personality_traits: [helpful]
tone_traits: [friendly]
`
      )

      // User persona
      const userPersonasDir = join(tempRoot, 'home', '.sidekick', 'personas')
      mkdirSync(userPersonasDir, { recursive: true })
      writeFileSync(
        join(userPersonasDir, 'sidekick.yaml'),
        `id: sidekick
display_name: User
theme: User
personality_traits: [user]
tone_traits: [user]
`
      )

      // Project override (highest priority)
      const projectPersonasDir = join(tempRoot, 'project', '.sidekick', 'personas')
      mkdirSync(projectPersonasDir, { recursive: true })
      writeFileSync(
        join(projectPersonasDir, 'sidekick.yaml'),
        `id: sidekick
display_name: Project
theme: Project override
personality_traits: [project]
tone_traits: [project]
`
      )

      const options: PersonaLoaderOptions = {
        defaultPersonasDir,
        projectRoot: join(tempRoot, 'project'),
        homeDir: join(tempRoot, 'home'),
      }

      const personas = discoverPersonas(options)

      expect(personas.size).toBe(1)
      expect(personas.get('sidekick')!.display_name).toBe('Project')
      expect(personas.get('sidekick')!.theme).toBe('Project override')
    })

    test('merges personas from all layers', () => {
      // Default: sidekick and disabled
      writeFileSync(
        join(defaultPersonasDir, 'sidekick.yaml'),
        `id: sidekick
display_name: Sidekick
theme: Default
personality_traits: [helpful]
tone_traits: [friendly]
`
      )
      writeFileSync(
        join(defaultPersonasDir, 'disabled.yaml'),
        `id: disabled
display_name: Disabled
theme: No persona
personality_traits: []
tone_traits: []
`
      )

      // User: adds skippy
      const userPersonasDir = join(tempRoot, 'home', '.sidekick', 'personas')
      mkdirSync(userPersonasDir, { recursive: true })
      writeFileSync(
        join(userPersonasDir, 'skippy.yaml'),
        `id: skippy
display_name: Skippy
theme: Sci-fi snark
personality_traits: [sarcastic]
tone_traits: [snarky]
`
      )

      // Project: adds bones
      const projectPersonasDir = join(tempRoot, 'project', '.sidekick', 'personas')
      mkdirSync(projectPersonasDir, { recursive: true })
      writeFileSync(
        join(projectPersonasDir, 'bones.yaml'),
        `id: bones
display_name: Bones
theme: Medical grumpiness
personality_traits: [grumpy]
tone_traits: [matter-of-fact]
`
      )

      const options: PersonaLoaderOptions = {
        defaultPersonasDir,
        projectRoot: join(tempRoot, 'project'),
        homeDir: join(tempRoot, 'home'),
      }

      const personas = discoverPersonas(options)

      expect(personas.size).toBe(4)
      expect(personas.has('sidekick')).toBe(true)
      expect(personas.has('disabled')).toBe(true)
      expect(personas.has('skippy')).toBe(true)
      expect(personas.has('bones')).toBe(true)
    })

    test('skips invalid persona files without crashing', () => {
      // Valid persona
      writeFileSync(
        join(defaultPersonasDir, 'valid.yaml'),
        `id: valid
display_name: Valid
theme: Valid theme
personality_traits: [good]
tone_traits: [nice]
`
      )

      // Invalid persona (missing required fields)
      writeFileSync(
        join(defaultPersonasDir, 'invalid.yaml'),
        `id: invalid
# missing required fields
`
      )

      const mockLogger = createMockLogger()
      const options: PersonaLoaderOptions = {
        defaultPersonasDir,
        homeDir: join(tempRoot, 'home'),
        logger: mockLogger,
      }

      const personas = discoverPersonas(options)

      expect(personas.size).toBe(1)
      expect(personas.has('valid')).toBe(true)
      expect(personas.has('invalid')).toBe(false)
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    test('handles .yml extension', () => {
      writeFileSync(
        join(defaultPersonasDir, 'test.yml'),
        `id: test
display_name: Test
theme: Test theme
personality_traits: []
tone_traits: []
`
      )

      const options: PersonaLoaderOptions = {
        defaultPersonasDir,
        homeDir: join(tempRoot, 'home'),
      }

      const personas = discoverPersonas(options)

      expect(personas.size).toBe(1)
      expect(personas.has('test')).toBe(true)
    })
  })

  describe('createPersonaLoader', () => {
    test('creates loader with discover method', () => {
      writeFileSync(
        join(defaultPersonasDir, 'sidekick.yaml'),
        `id: sidekick
display_name: Sidekick
theme: Default
personality_traits: [helpful]
tone_traits: [friendly]
`
      )

      const loader = createPersonaLoader({
        defaultPersonasDir,
        homeDir: join(tempRoot, 'home'),
      })

      const personas = loader.discover()

      expect(personas.size).toBe(1)
      expect(personas.get('sidekick')).toBeDefined()
    })

    test('exposes cascade layers for debugging', () => {
      const projectRoot = join(tempRoot, 'project')
      const homeDir = join(tempRoot, 'home')

      const loader = createPersonaLoader({
        defaultPersonasDir,
        projectRoot,
        homeDir,
      })

      expect(loader.cascadeLayers).toContain(defaultPersonasDir)
      expect(loader.cascadeLayers).toContainEqual(expect.stringContaining('.sidekick/personas'))
      expect(loader.cascadeLayers.length).toBe(3)
    })

    test('loadFile method works', () => {
      const filePath = join(defaultPersonasDir, 'test.yaml')
      writeFileSync(
        filePath,
        `id: test
display_name: Test
theme: Test
personality_traits: []
tone_traits: []
`
      )

      const loader = createPersonaLoader({
        defaultPersonasDir,
        homeDir: join(tempRoot, 'home'),
      })

      const persona = loader.loadFile(filePath)

      expect(persona).not.toBeNull()
      expect(persona!.id).toBe('test')
    })
  })
})
