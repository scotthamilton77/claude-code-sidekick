/**
 * Config-YAML Alignment Enforcement Test
 *
 * This test ensures all required config schema fields have corresponding
 * YAML defaults. If a developer adds a new required field to a schema
 * without adding a YAML default, this test will fail.
 *
 * Per task 9.4.2: "Test exists that verifies all config keys have YAML defaults.
 * Test fails if new config key added without YAML default."
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { CoreConfigSchema, LlmConfigSchema, TranscriptConfigSchema } from '../config'

// Path to YAML defaults in the monorepo
const ASSETS_ROOT = join(__dirname, '../../../../assets/sidekick/defaults')

/**
 * Recursively extract all paths from a nested object.
 * Returns paths like ['logging.level', 'logging.format', 'paths.state']
 */
function extractPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const paths: string[] = []

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Recurse into nested objects
      paths.push(...extractPaths(value as Record<string, unknown>, path))
    } else {
      // Leaf value - add the path
      paths.push(path)
    }
  }

  return paths
}

/**
 * Load a YAML file and return its contents.
 */
function loadYamlFile(filename: string): Record<string, unknown> {
  const filePath = join(ASSETS_ROOT, filename)
  if (!existsSync(filePath)) {
    throw new Error(`YAML defaults file not found: ${filePath}`)
  }
  const content = readFileSync(filePath, 'utf8')
  return parseYaml(content) ?? {}
}

/**
 * Check if a path exists in the object (has a non-undefined value).
 */
function pathExists(obj: Record<string, unknown>, path: string): boolean {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return false
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current !== undefined
}

describe('Config-YAML Alignment', () => {
  describe('CoreConfigSchema', () => {
    it('should have YAML defaults for all required fields', () => {
      const yamlDefaults = loadYamlFile('core.defaults.yaml')
      const yamlPaths = extractPaths(yamlDefaults)

      // Expected required paths from CoreConfigSchema
      // These are the leaf paths that must have values in YAML
      const requiredPaths = [
        'logging.level',
        'logging.format',
        'logging.consoleEnabled',
        'paths.state',
        'daemon.idleTimeoutMs',
        'daemon.shutdownTimeoutMs',
        'ipc.connectTimeoutMs',
        'ipc.requestTimeoutMs',
        'ipc.maxRetries',
        'ipc.retryDelayMs',
        'development.enabled',
      ]

      for (const path of requiredPaths) {
        expect(pathExists(yamlDefaults, path)).toBe(true)
      }
    })

    it('should successfully parse YAML defaults through schema', () => {
      const yamlDefaults = loadYamlFile('core.defaults.yaml')
      const result = CoreConfigSchema.safeParse(yamlDefaults)

      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
        throw new Error(`YAML defaults fail schema validation:\n${issues.join('\n')}`)
      }

      expect(result.success).toBe(true)
    })
  })

  describe('LlmConfigSchema', () => {
    it('should have YAML defaults for all required fields', () => {
      const yamlDefaults = loadYamlFile('llm.defaults.yaml')

      // Required top-level fields
      expect(yamlDefaults).toHaveProperty('defaultProfile')
      expect(yamlDefaults).toHaveProperty('profiles')

      // Profiles must have at least the default profile
      const profiles = yamlDefaults.profiles as Record<string, unknown>
      const defaultProfile = yamlDefaults.defaultProfile as string
      expect(profiles).toHaveProperty(defaultProfile)

      // Each profile must have all required LlmProfile fields
      const requiredProfileFields = ['provider', 'model', 'temperature', 'maxTokens', 'timeout', 'timeoutMaxRetries']

      for (const [profileName, profile] of Object.entries(profiles)) {
        for (const field of requiredProfileFields) {
          expect(
            pathExists(profile as Record<string, unknown>, field),
            `Profile "${profileName}" missing required field "${field}"`
          ).toBe(true)
        }
      }
    })

    it('should successfully parse YAML defaults through schema', () => {
      const yamlDefaults = loadYamlFile('llm.defaults.yaml')
      const result = LlmConfigSchema.safeParse(yamlDefaults)

      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
        throw new Error(`YAML defaults fail schema validation:\n${issues.join('\n')}`)
      }

      expect(result.success).toBe(true)
    })

    it('should have fallback profiles with all required fields', () => {
      const yamlDefaults = loadYamlFile('llm.defaults.yaml')
      const fallbacks = yamlDefaults.fallbackProfiles as Record<string, unknown> | undefined

      if (fallbacks) {
        const requiredProfileFields = ['provider', 'model', 'temperature', 'maxTokens', 'timeout', 'timeoutMaxRetries']

        for (const [profileName, profile] of Object.entries(fallbacks)) {
          for (const field of requiredProfileFields) {
            expect(
              pathExists(profile as Record<string, unknown>, field),
              `Fallback "${profileName}" missing required field "${field}"`
            ).toBe(true)
          }
        }
      }
    })
  })

  describe('TranscriptConfigSchema', () => {
    it('should have YAML defaults for all required fields', () => {
      const yamlDefaults = loadYamlFile('transcript.defaults.yaml')

      const requiredPaths = ['watchDebounceMs', 'metricsPersistIntervalMs']

      for (const path of requiredPaths) {
        expect(pathExists(yamlDefaults, path), `Missing required YAML default: ${path}`).toBe(true)
      }
    })

    it('should successfully parse YAML defaults through schema', () => {
      const yamlDefaults = loadYamlFile('transcript.defaults.yaml')
      const result = TranscriptConfigSchema.safeParse(yamlDefaults)

      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
        throw new Error(`YAML defaults fail schema validation:\n${issues.join('\n')}`)
      }

      expect(result.success).toBe(true)
    })
  })

  describe('Schema-YAML synchronization', () => {
    it('should fail if schema adds a required field without YAML default', () => {
      // This test documents the expected behavior:
      // If someone adds a new required field to CoreConfigSchema, LlmConfigSchema,
      // or TranscriptConfigSchema without updating the corresponding YAML defaults,
      // the "should successfully parse YAML defaults through schema" tests above will fail.

      // Example: If we were to add a required "newField" to LoggingSchema,
      // the CoreConfigSchema parse would fail because core.defaults.yaml
      // doesn't have logging.newField

      // This is a documentation test - the actual enforcement is in the parse tests above
      expect(true).toBe(true)
    })
  })
})
