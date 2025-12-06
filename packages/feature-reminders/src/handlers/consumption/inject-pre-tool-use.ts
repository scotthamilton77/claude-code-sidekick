/**
 * Inject reminders into PreToolUse hook (CLI-side)
 * @see docs/design/FEATURE-REMINDERS.md §3.1 Consumption Handlers
 */

import type { RuntimeContext } from '@sidekick/core'
import { createConsumptionHandler } from './consumption-handler-factory.js'

export function registerInjectPreToolUse(context: RuntimeContext): void {
  createConsumptionHandler(context, {
    id: 'reminders:inject-pre-tool-use',
    hook: 'PreToolUse',
    supportsBlocking: true,
  })
}
