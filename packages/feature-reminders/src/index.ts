/**
 * Reminders Feature
 *
 * Context-aware prompts injected at specific intervals or events.
 * Uses staging/consumption pattern where Supervisor stages reminders
 * and CLI consumes them.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */

import type { Feature, FeatureManifest, RuntimeContext } from '@sidekick/core'
import { registerStagingHandlers } from './handlers/staging'
import { registerConsumptionHandlers } from './handlers/consumption'

export const manifest: FeatureManifest = {
  id: 'reminders',
  version: '0.0.0',
  description: 'Context-aware prompts at specific intervals or events',
  needs: [], // No dependencies on other features
}

export function register(context: RuntimeContext): void {
  // Register staging handlers (runs in Supervisor, transcript events)
  registerStagingHandlers(context)

  // Register consumption handlers (runs in CLI, hook events)
  registerConsumptionHandlers(context)
}

// Default export for dynamic loading
const feature: Feature = { manifest, register }
export default feature

// Re-export types and utilities
export * from './types'
export * from './reminder-utils'
