/**
 * @fileoverview Runtime context type definitions and re-exports
 *
 * Discriminated union types for CLI and Daemon contexts.
 * Enables type-safe role detection and role-specific service access.
 *
 * NOTE: Service interfaces (ConfigService, AssetResolver, etc.) are defined in
 * @sidekick/types and should be imported from there. The implementations
 * (classes) are in sidekick-core modules (./config.ts, ./assets.ts).
 *
 * @see docs/design/CLI.md §4 Daemon Interaction
 * @see docs/design/CORE-RUNTIME.md §4.1 Runtime Context
 */

// Re-export context types from @sidekick/types
// Note: ConfigService and AssetResolver interfaces are NOT re-exported here
// to avoid conflict with the class implementations in ./config.ts and ./assets.ts.
// Import interfaces from @sidekick/types directly.
export type {
  // Runtime path type
  RuntimePaths,
  // Daemon client interface (used by CLIContext)
  DaemonClient,
  // Service interfaces for Daemon-only services
  TranscriptService,
  StagingService,
  StagedReminder,
  CompactionEntry,
  Unsubscribe,
  // Context types (discriminated union)
  BaseContext,
  CLIContext,
  DaemonContext,
  RuntimeContext,
} from '@sidekick/types'

// Re-export type guards
export { isCLIContext, isDaemonContext } from '@sidekick/types'

/**
 * Import note for consumers:
 *
 * - For context types: import from '@sidekick/core' or '@sidekick/types'
 * - For service interfaces (ConfigService, AssetResolver): import from '@sidekick/types'
 * - For service implementations: import from '@sidekick/core' (they implement the interfaces)
 *
 * The RuntimeContext is a discriminated union:
 * - CLIContext: { role: 'cli', daemon: DaemonClient }
 * - DaemonContext: { role: 'daemon', llm, staging, transcript }
 *
 * Use type guards for role-specific code:
 * ```typescript
 * if (ctx.role === 'daemon') {
 *   // TypeScript narrows to DaemonContext
 *   await ctx.llm.complete({ ... });
 * }
 * ```
 */
