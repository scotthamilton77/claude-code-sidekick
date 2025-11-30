/**
 * Runtime Context Type Definitions
 *
 * Discriminated union types for CLI and Supervisor contexts.
 * Enables type-safe role detection and role-specific service access.
 *
 * @see docs/design/CORE-RUNTIME.md §4.1 Runtime Context
 */

import type { HandlerRegistry } from './handler-registry.js'
import type { LLMProvider } from './llm.js'
import type { Logger } from './logger.js'
import type { RuntimePaths } from './paths.js'
import type { MinimalConfigService, MinimalAssetResolver } from './services/config.js'
import type { StagingService } from './services/staging.js'
import type { SupervisorClient } from './services/supervisor-client.js'
import type { TranscriptService } from './services/transcript.js'

// ============================================================================
// Runtime Context (Discriminated Union)
// ============================================================================

/**
 * Base context shared by CLI and Supervisor.
 * Contains services available in both roles.
 *
 * NOTE: Uses minimal service constraints to avoid circular dependencies.
 * Actual implementations (ConfigService, AssetResolver) are in @sidekick/core
 * and satisfy these minimal constraints via structural typing.
 */
export interface BaseContext {
  /** Configuration service (minimal constraint) */
  config: MinimalConfigService
  /** Structured logger */
  logger: Logger
  /** Asset resolver (minimal constraint) */
  assets: MinimalAssetResolver
  /** Resolved runtime paths */
  paths: RuntimePaths
  /** Handler registry for event dispatch */
  handlers: HandlerRegistry
}

/**
 * CLI context with role discriminant and Supervisor client.
 * CLI handles synchronous hook responses.
 */
export interface CLIContext extends BaseContext {
  /** Role discriminant for type narrowing */
  role: 'cli'
  /** Supervisor IPC client */
  supervisor: SupervisorClient
}

/**
 * Supervisor context with role discriminant and async services.
 * Supervisor handles background work, LLM calls, and file staging.
 */
export interface SupervisorContext extends BaseContext {
  /** Role discriminant for type narrowing */
  role: 'supervisor'
  /** LLM provider for completions */
  llm: LLMProvider
  /** Staging service for reminder files */
  staging: StagingService
  /** Transcript service for metrics */
  transcript: TranscriptService
}

/**
 * Discriminated union of runtime contexts.
 * TypeScript narrows on `context.role` property.
 *
 * @example
 * ```typescript
 * function handleEvent(ctx: RuntimeContext) {
 *   if (ctx.role === 'supervisor') {
 *     // TypeScript knows ctx is SupervisorContext
 *     await ctx.llm.complete({ ... });
 *   }
 * }
 * ```
 */
export type RuntimeContext = CLIContext | SupervisorContext

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for CLI context.
 */
export function isCLIContext(ctx: RuntimeContext): ctx is CLIContext {
  return ctx.role === 'cli'
}

/**
 * Type guard for Supervisor context.
 */
export function isSupervisorContext(ctx: RuntimeContext): ctx is SupervisorContext {
  return ctx.role === 'supervisor'
}
