/**
 * @fileoverview Feature system type definitions
 * Phase 4 Track B: Feature Registry type definitions
 *
 * Defines the contract for pluggable features in the Sidekick runtime.
 * Features can declare dependencies via the manifest and register hooks/commands
 * during the bootstrap process.
 */

import type { RuntimeContext } from './runtime-context'

/**
 * Feature manifest - metadata and dependency declarations
 */
export interface FeatureManifest {
  /** Unique feature identifier (kebab-case recommended) */
  id: string

  /** Semantic version string */
  version: string

  /** Human-readable description */
  description?: string

  /** Array of feature IDs this feature depends on */
  needs?: string[]
}

/**
 * Feature interface - all pluggable features must implement this
 */
export interface Feature {
  /** Feature metadata and dependencies */
  manifest: FeatureManifest

  /**
   * Register hooks, commands, or event listeners with the runtime
   * Called during bootstrap in topological order (dependencies first)
   */
  register: (context: RuntimeContext) => void | Promise<void>
}
