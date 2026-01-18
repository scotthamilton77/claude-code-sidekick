/**
 * Persona Loader Module
 *
 * Loads persona definitions from a cascading set of directories:
 * 1. assets/sidekick/personas/ (defaults, lowest priority)
 * 2. ~/.sidekick/personas/ (user)
 * 3. .sidekick/personas/ (project, highest priority)
 *
 * When the same persona ID exists in multiple layers, the highest priority wins.
 *
 * Uses the generic CascadingResolver from assets.ts for consistent cascade behavior,
 * with persona-specific cascade layers and directory scanning for discovery.
 *
 * @see docs/design/PERSONA-PROFILES-DESIGN.md - Persona Asset Cascade
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { PersonaDefinitionSchema, type PersonaDefinition } from '@sidekick/types'
import type { Logger } from '@sidekick/types'
import { createCascadingResolver, type CascadingResolver } from './assets.js'

// =============================================================================
// Types
// =============================================================================

export interface PersonaLoaderOptions {
  /** Directory containing default persona assets */
  defaultPersonasDir: string
  /** Project root directory (for .sidekick/personas/) */
  projectRoot?: string
  /** Home directory override (for testing) */
  homeDir?: string
  /** Logger for warnings and errors */
  logger?: Logger
}

export interface PersonaLoadResult {
  /** Successfully loaded persona, or null if failed */
  persona: PersonaDefinition | null
  /** Error message if loading failed */
  error?: string
  /** Source layer where the persona was loaded from */
  source: 'project' | 'user' | 'default'
}

/**
 * Persona loader instance returned by createPersonaLoader.
 */
export interface PersonaLoader {
  /** Discover all available personas from the cascade layers */
  discover(): Map<string, PersonaDefinition>
  /** Load a specific persona by filename using cascade resolution */
  load(filename: string): PersonaDefinition | null
  /** Load a specific persona file by absolute path */
  loadFile(filePath: string): PersonaDefinition | null
  /** The underlying cascading resolver */
  readonly resolver: CascadingResolver
  /** The cascade layers for debugging */
  readonly cascadeLayers: string[]
}

// =============================================================================
// Cascade Layer Building
// =============================================================================

/**
 * Build the cascade layers for persona resolution.
 *
 * Order (lowest → highest priority):
 * 1. assets/sidekick/personas/ (defaults)
 * 2. ~/.sidekick/personas/ (user)
 * 3. .sidekick/personas/ (project)
 */
function buildPersonaCascadeLayers(defaultPersonasDir: string, homeDir: string, projectRoot?: string): string[] {
  const layers: string[] = []

  // 1. Default personas (lowest priority)
  layers.push(defaultPersonasDir)

  // 2. User personas
  layers.push(join(homeDir, '.sidekick', 'personas'))

  // 3. Project personas (highest priority)
  if (projectRoot) {
    layers.push(join(projectRoot, '.sidekick', 'personas'))
  }

  return layers
}

// =============================================================================
// Single Persona Loading
// =============================================================================

/**
 * Load and validate a single persona from a resolver.
 * Uses the cascading resolver's YAML parsing and validates with Zod schema.
 *
 * @param resolver - Cascading resolver configured for persona paths
 * @param filename - YAML filename (e.g., 'skippy.yaml')
 * @param logger - Optional logger for warnings
 * @returns The validated persona definition, or null if invalid/not found
 */
function loadPersonaFromResolver(
  resolver: CascadingResolver,
  filename: string,
  logger?: Logger
): PersonaDefinition | null {
  try {
    const raw = resolver.resolveYaml<unknown>(filename)
    if (raw === null) {
      return null
    }

    const result = PersonaDefinitionSchema.safeParse(raw)
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
      logger?.warn(`Invalid persona file ${filename}: ${issues}`)
      return null
    }

    // Validate that id matches filename stem
    const filenameStem = basename(filename, extname(filename))
    if (result.data.id !== filenameStem) {
      logger?.warn(
        `Persona file ${filename}: id "${result.data.id}" does not match filename "${filenameStem}", using file id`
      )
    }

    return result.data
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger?.warn(`Failed to load persona file ${filename}: ${message}`)
    return null
  }
}

/**
 * Load and validate a single persona from an absolute file path.
 * Standalone function for loading personas outside the cascade.
 *
 * @param filePath - Absolute path to the persona YAML file
 * @param logger - Optional logger for warnings
 * @returns The validated persona definition, or null if invalid
 */
export function loadPersonaFile(filePath: string, logger?: Logger): PersonaDefinition | null {
  // Check if file exists first - warn if not (since this is an explicit file request)
  if (!existsSync(filePath)) {
    logger?.warn(`Persona file not found: ${filePath}`)
    return null
  }

  // Create a single-layer resolver for the file's directory
  const dir = join(filePath, '..')
  const filename = basename(filePath)
  const resolver = createCascadingResolver({ cascadeLayers: [dir] })
  return loadPersonaFromResolver(resolver, filename, logger)
}

// =============================================================================
// Directory Scanning
// =============================================================================

/**
 * List all YAML files in a directory.
 * Returns empty array if directory doesn't exist.
 */
function listYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }

  try {
    return readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
  } catch {
    return []
  }
}

// =============================================================================
// Persona Discovery
// =============================================================================

/**
 * Discover all available personas from the cascade layers.
 *
 * Returns a Map of persona ID -> PersonaDefinition.
 * Higher priority layers override lower priority layers for the same ID.
 *
 * @param options - Loader configuration
 * @returns Map of persona ID to definition
 */
export function discoverPersonas(options: PersonaLoaderOptions): Map<string, PersonaDefinition> {
  const { defaultPersonasDir, projectRoot, logger } = options
  const home = options.homeDir ?? homedir()

  const cascadeLayers = buildPersonaCascadeLayers(defaultPersonasDir, home, projectRoot)
  const personas = new Map<string, PersonaDefinition>()

  // Process layers from lowest to highest priority
  // Higher priority will overwrite lower priority entries
  for (const layerPath of cascadeLayers) {
    const filenames = listYamlFiles(layerPath)

    for (const filename of filenames) {
      // Create a resolver just for this layer to load the file
      const resolver = createCascadingResolver({ cascadeLayers: [layerPath] })
      const persona = loadPersonaFromResolver(resolver, filename, logger)
      if (persona) {
        personas.set(persona.id, persona)
      }
    }
  }

  return personas
}

/**
 * Create a persona loader instance with cached options.
 *
 * @param options - Loader configuration
 * @returns Object with discover and load methods
 */
export function createPersonaLoader(options: PersonaLoaderOptions): PersonaLoader {
  const home = options.homeDir ?? homedir()
  const cascadeLayers = buildPersonaCascadeLayers(options.defaultPersonasDir, home, options.projectRoot)

  // Create resolver for single-file lookups across the cascade
  const resolver = createCascadingResolver({ cascadeLayers })

  return {
    /**
     * Discover all available personas.
     * @returns Map of persona ID to definition
     */
    discover(): Map<string, PersonaDefinition> {
      return discoverPersonas(options)
    },

    /**
     * Load a specific persona by filename.
     * Uses cascade resolution - highest priority layer wins.
     * @param filename - YAML filename (e.g., 'skippy.yaml')
     * @returns Persona definition or null if not found/invalid
     */
    load(filename: string): PersonaDefinition | null {
      return loadPersonaFromResolver(resolver, filename, options.logger)
    },

    /**
     * Load a specific persona file by absolute path.
     * @param filePath - Absolute path to persona YAML file
     * @returns Persona definition or null if invalid
     */
    loadFile(filePath: string): PersonaDefinition | null {
      return loadPersonaFile(filePath, options.logger)
    },

    /**
     * The underlying cascading resolver.
     * Useful for accessing raw YAML content or debugging.
     */
    resolver,

    /**
     * Get the cascade layers for debugging.
     */
    get cascadeLayers(): string[] {
      return cascadeLayers
    },
  }
}

/**
 * Get the default personas directory path.
 * Follows same pattern as getDefaultAssetsDir() in assets.ts.
 */
export function getDefaultPersonasDir(): string {
  const workspaceRoot = join(__dirname, '..', '..', '..')
  return join(workspaceRoot, 'assets', 'sidekick', 'personas')
}
