/**
 * @sidekick/types - Shared Type Definitions
 *
 * Zero-dependency package containing all shared interfaces for the Sidekick runtime.
 * This package breaks the circular dependency between sidekick-core and shared-providers.
 *
 * Both packages import types from here and re-export for consumer convenience.
 */

export * from './logger.js'
export * from './llm.js'
export * from './events.js'
export * from './handler-registry.js'
export * from './paths.js'
export * from './services/index.js'
export * from './context.js'
export * from './tasks.js'
export * from './hook-input.js'
