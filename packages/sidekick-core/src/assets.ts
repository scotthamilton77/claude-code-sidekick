/**
 * Asset Resolver Module
 *
 * Implements the asset resolver per docs/design/CORE-RUNTIME.md §3.3.
 *
 * Provides a cascading asset resolver that searches for prompts, schemas, and
 * templates across multiple locations in priority order (highest wins):
 *
 * 1. assets/sidekick/ (defaults, lowest priority)
 * 2. ~/.claude/hooks/sidekick/assets/ (user-installed, ephemeral)
 * 3. ~/.sidekick/assets/ (user-persistent)
 * 4. .claude/hooks/sidekick/assets/ (project-installed, ephemeral)
 * 5. .sidekick/assets/ (project-persistent)
 * 6. .sidekick/assets.local/ (project-local, highest priority)
 *
 * Supports text, JSON, and JSONC asset formats with proper error handling.
 *
 * @see docs/design/CORE-RUNTIME.md §3.3 Asset Resolver
 * @see docs/ARCHITECTURE.md §2.3 Static Assets
 */

import { parse as parseJsonc } from 'jsonc-parser'
import { existsSync, readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { homedir } from 'node:os'
import { join } from 'node:path'

// =============================================================================
// Cascading Resolver (Generic)
// =============================================================================

/**
 * Options for creating a cascading resolver with explicit layers.
 */
export interface CascadingResolverOptions {
  /** Cascade layers in order of precedence (lowest to highest priority) */
  cascadeLayers: string[]
}

/**
 * Generic cascading resolver interface.
 * Searches for files across cascade layers with highest priority winning.
 */
export interface CascadingResolver {
  /**
   * Resolve a file by relative path, returning its content.
   * Returns null if the file is not found in any cascade layer.
   */
  resolve(relativePath: string): string | null

  /**
   * Resolve a file, throwing if not found.
   */
  resolveOrThrow(relativePath: string): string

  /**
   * Resolve the absolute path to a file without reading it.
   * Returns null if the file is not found.
   */
  resolvePath(relativePath: string): string | null

  /**
   * Resolve and parse a JSON/JSONC file.
   * Returns null if the file is not found.
   */
  resolveJson<T = unknown>(relativePath: string): T | null

  /**
   * Resolve and parse a YAML file.
   * Returns null if the file is not found.
   */
  resolveYaml<T = unknown>(relativePath: string): T | null

  /**
   * The cascade layers in order of precedence (lowest to highest).
   * Useful for debugging.
   */
  cascadeLayers: string[]
}

/**
 * Create a generic cascading resolver with explicit layers.
 * Files are resolved from highest priority layer first (last in array).
 *
 * @param options - Configuration with explicit cascade layers
 * @returns A resolver that searches layers in priority order
 */
export function createCascadingResolver(options: CascadingResolverOptions): CascadingResolver {
  const { cascadeLayers } = options

  // Search layers in reverse order (highest priority first)
  const findFile = (relativePath: string): string | null => {
    for (let i = cascadeLayers.length - 1; i >= 0; i--) {
      const fullPath = join(cascadeLayers[i], relativePath)
      if (existsSync(fullPath)) {
        return fullPath
      }
    }
    return null
  }

  return {
    resolve(relativePath: string): string | null {
      const fullPath = findFile(relativePath)
      if (!fullPath) {
        return null
      }
      return readFileSync(fullPath, 'utf8')
    },

    resolveOrThrow(relativePath: string): string {
      const content = this.resolve(relativePath)
      if (content === null) {
        throw new Error(`File not found: ${relativePath}. Searched cascade layers: ${cascadeLayers.join(', ')}`)
      }
      return content
    },

    resolvePath(relativePath: string): string | null {
      return findFile(relativePath)
    },

    resolveJson<T = unknown>(relativePath: string): T | null {
      const content = this.resolve(relativePath)
      if (content === null) {
        return null
      }

      const errors: { error: number; offset: number; length: number }[] = []
      const parsed = parseJsonc(content, errors) as T

      if (errors.length > 0) {
        throw new Error(`Failed to parse JSON file ${relativePath}: syntax error at offset ${errors[0].offset}`)
      }

      return parsed
    },

    resolveYaml<T = unknown>(relativePath: string): T | null {
      const content = this.resolve(relativePath)
      if (content === null) {
        return null
      }

      try {
        return parseYaml(content) as T
      } catch (error) {
        throw new Error(
          `Failed to parse YAML file ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    },

    cascadeLayers,
  }
}

// =============================================================================
// Asset Resolver (Sidekick-specific cascade)
// =============================================================================

export interface AssetResolverOptions {
  defaultAssetsDir: string
  projectRoot?: string
  homeDir?: string
}

/**
 * Asset resolver with Sidekick-specific cascade layers.
 * Same interface as CascadingResolver, specific cascade configuration.
 */
export type AssetResolver = CascadingResolver

/**
 * Build the cascade layers for asset resolution.
 *
 * Order (lowest → highest priority):
 * 1. assets/sidekick/ (defaults)
 * 2. user-installed: ~/.claude/hooks/sidekick/assets/
 * 3. user-persistent: ~/.sidekick/assets/
 * 4. project-installed: .claude/hooks/sidekick/assets/
 * 5. project-persistent: .sidekick/assets/
 * 6. project-local: .sidekick/assets.local/
 */
function buildCascadeLayers(defaultAssetsDir: string, homeDir: string, projectRoot?: string): string[] {
  const layers: string[] = []

  // 1. Default assets (always first, lowest priority)
  layers.push(defaultAssetsDir)

  // 2. User-installed assets
  const userInstalled = join(homeDir, '.claude', 'hooks', 'sidekick', 'assets')
  layers.push(userInstalled)

  // 3. User-persistent assets
  const userPersistent = join(homeDir, '.sidekick', 'assets')
  layers.push(userPersistent)

  if (projectRoot) {
    // 4. Project-installed assets
    const projectInstalled = join(projectRoot, '.claude', 'hooks', 'sidekick', 'assets')
    layers.push(projectInstalled)

    // 5. Project-persistent assets
    const projectPersistent = join(projectRoot, '.sidekick', 'assets')
    layers.push(projectPersistent)

    // 6. Project-local assets (highest priority)
    const projectLocal = join(projectRoot, '.sidekick', 'assets.local')
    layers.push(projectLocal)
  }

  return layers
}

/**
 * Create an asset resolver with Sidekick-specific cascade layers.
 * Uses createCascadingResolver with the standard 6-layer asset cascade.
 *
 * @param options - Configuration with default assets dir and optional project/home paths
 * @returns An asset resolver for the Sidekick cascade
 */
export function createAssetResolver(options: AssetResolverOptions): AssetResolver {
  const home = options.homeDir ?? homedir()
  const cascadeLayers = buildCascadeLayers(options.defaultAssetsDir, home, options.projectRoot)
  return createCascadingResolver({ cascadeLayers })
}

/**
 * Get the default assets directory path.
 *
 * Checks two locations in order:
 * 1. Bundled assets (npm installed mode): ../assets/sidekick relative to dist/
 * 2. Workspace assets (dev mode): ../../../assets/sidekick relative to dist/ or src/
 *
 * Structure:
 * - npm installed: node_modules/@sidekick/core/dist/assets.js -> ../assets/sidekick
 * - Dev/Test: packages/sidekick-core/dist/assets.js -> ../../../assets/sidekick
 */
export function getDefaultAssetsDir(): string {
  // Check for bundled assets (npm installed mode)
  // From dist/assets.js -> ../assets/sidekick
  const bundledPath = join(__dirname, '..', 'assets', 'sidekick')
  if (existsSync(bundledPath)) {
    return bundledPath
  }

  // Dev mode: navigate to workspace root
  const workspaceRoot = join(__dirname, '..', '..', '..')
  return join(workspaceRoot, 'assets', 'sidekick')
}
