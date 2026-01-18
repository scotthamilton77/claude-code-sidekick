/**
 * Validates all persona YAML files in assets/sidekick/personas/ against the schema.
 */
import { readdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { getDefaultPersonasDir, loadPersonaFile } from '../persona-loader'

describe('Persona file validation', () => {
  const personasDir = getDefaultPersonasDir()
  const files = readdirSync(personasDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))

  test('personas directory exists and has files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  test.each(files)('%s validates against schema', (filename) => {
    const filePath = join(personasDir, filename)
    const warnings: string[] = []

    const persona = loadPersonaFile(filePath, {
      warn: (msg: string) => warnings.push(msg),
      trace: () => {},
      debug: () => {},
      info: () => {},
      error: () => {},
      fatal: () => {},
      child: () => ({}) as never,
      flush: async () => {},
    })

    // Should parse successfully
    expect(persona).not.toBeNull()

    if (persona) {
      // ID should match filename
      const expectedId = basename(filename, extname(filename))
      expect(persona.id).toBe(expectedId)

      // Required fields should be present
      expect(persona.display_name).toBeTruthy()
      expect(persona.theme).toBeTruthy()
      expect(Array.isArray(persona.personality_traits)).toBe(true)
      expect(Array.isArray(persona.tone_traits)).toBe(true)

      // If statusline_empty_messages exists, it should be an array
      if (persona.statusline_empty_messages !== undefined) {
        expect(Array.isArray(persona.statusline_empty_messages)).toBe(true)
      }
    }

    // No warnings for ID mismatch
    const idMismatchWarning = warnings.find((w) => w.includes('does not match filename'))
    expect(idMismatchWarning).toBeUndefined()
  })

  test('sidekick persona has statusline_empty_messages', () => {
    const sidekickPath = join(personasDir, 'sidekick.yaml')
    const persona = loadPersonaFile(sidekickPath)

    expect(persona).not.toBeNull()
    expect(persona?.statusline_empty_messages).toBeDefined()
    expect(persona?.statusline_empty_messages?.length).toBeGreaterThan(0)
  })

  test('disabled persona has empty traits arrays', () => {
    const disabledPath = join(personasDir, 'disabled.yaml')
    const persona = loadPersonaFile(disabledPath)

    expect(persona).not.toBeNull()
    expect(persona?.personality_traits).toEqual([])
    expect(persona?.tone_traits).toEqual([])
  })
})
