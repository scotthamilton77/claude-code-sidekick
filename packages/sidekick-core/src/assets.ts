/**
 * Asset Resolver Module
 *
 * Implements Phase 2 of the Sidekick Node runtime per docs/design/CORE-RUNTIME.md §3.3.
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
// Asset Resolver
// =============================================================================

export interface AssetResolverOptions {
  defaultAssetsDir: string
  projectRoot?: string
  homeDir?: string
}

export interface AssetResolver {
  /**
   * Resolve an asset by relative path, returning its content.
   * Returns null if the asset is not found in any cascade layer.
   */
  resolve(relativePath: string): string | null

  /**
   * Resolve an asset, throwing if not found.
   */
  resolveOrThrow(relativePath: string): string

  /**
   * Resolve the absolute path to an asset without reading it.
   * Returns null if the asset is not found.
   */
  resolvePath(relativePath: string): string | null

  /**
   * Resolve and parse a JSON/JSONC asset.
   * Returns null if the asset is not found.
   */
  resolveJson<T = unknown>(relativePath: string): T | null

  /**
   * Resolve and parse a YAML asset.
   * Returns null if the asset is not found.
   */
  resolveYaml<T = unknown>(relativePath: string): T | null

  /**
   * The cascade layers in order of precedence (lowest to highest).
   * Useful for debugging.
   */
  cascadeLayers: string[]
}

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

export function createAssetResolver(options: AssetResolverOptions): AssetResolver {
  const homeDir = options.homeDir ?? homedir()
  const cascadeLayers = buildCascadeLayers(options.defaultAssetsDir, homeDir, options.projectRoot)

  // Search layers in reverse order (highest priority first)
  const findAsset = (relativePath: string): string | null => {
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
      const fullPath = findAsset(relativePath)
      if (!fullPath) {
        return null
      }
      return readFileSync(fullPath, 'utf8')
    },

    resolveOrThrow(relativePath: string): string {
      const content = this.resolve(relativePath)
      if (content === null) {
        throw new Error(`Asset not found: ${relativePath}. Searched cascade layers: ${cascadeLayers.join(', ')}`)
      }
      return content
    },

    resolvePath(relativePath: string): string | null {
      return findAsset(relativePath)
    },

    resolveJson<T = unknown>(relativePath: string): T | null {
      const content = this.resolve(relativePath)
      if (content === null) {
        return null
      }

      const errors: { error: number; offset: number; length: number }[] = []
      const parsed = parseJsonc(content, errors) as T

      if (errors.length > 0) {
        throw new Error(`Failed to parse JSON asset ${relativePath}: syntax error at offset ${errors[0].offset}`)
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
          `Failed to parse YAML asset ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    },

    cascadeLayers,
  }
}

/**
 * Get the default assets directory path.
 * In development (vitest), this is relative to src/.
 * When compiled, this is relative to dist/.
 * Both require navigating 3 levels up to workspace root.
 *
 * Structure:
 * - Compiled: packages/sidekick-core/dist/assets.js -> ../../../assets/sidekick
 * - Dev/Test: packages/sidekick-core/src/assets.ts -> ../../../assets/sidekick
 */
export function getDefaultAssetsDir(): string {
  const workspaceRoot = join(__dirname, '..', '..', '..')
  return join(workspaceRoot, 'assets', 'sidekick')
}
