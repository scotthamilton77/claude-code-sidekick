/**
 * Session Summary Feature
 *
 * Maintains session title and latest intent via LLM analysis.
 * Uses staging pattern where Daemon generates summaries
 * and writes state files for CLI/Statusline consumption.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 */

import type { Feature, FeatureManifest, RuntimeContext } from '@sidekick/core'
import { registerHandlers } from './handlers/index.js'

export const manifest: FeatureManifest = {
  id: 'session-summary',
  version: '0.0.0',
  description: 'Maintains session title and intent via LLM analysis',
  needs: [], // No dependencies on other features
}

export function register(context: RuntimeContext): void {
  registerHandlers(context)
}

const feature: Feature = { manifest, register }
export default feature

export * from './types'
export * from './handlers/index.js'
export * from './state.js'

// Re-export event factories for logging
export { SessionSummaryEvents, DecisionEvents, type EventLogContext as SummaryEventLogContext } from './events.js'
