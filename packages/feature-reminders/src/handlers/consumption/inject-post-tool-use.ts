/**
 * Inject reminders into PostToolUse hook (CLI-side)
 * @see docs/design/FEATURE-REMINDERS.md §3.1 Consumption Handlers
 */

import type { RuntimeContext } from '@sidekick/core'
import { createConsumptionHandler } from './consumption-handler-factory.js'

export function registerInjectPostToolUse(context: RuntimeContext): void {
  createConsumptionHandler(context, {
    id: 'reminders:inject-post-tool-use',
    hook: 'PostToolUse',
  })
}
