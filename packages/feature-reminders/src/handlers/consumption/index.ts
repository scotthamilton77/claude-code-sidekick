/**
 * Consumption handlers for Reminders feature (CLI-side)
 *
 * These handlers run in the CLI process in response to hook events.
 * They consume staged reminders and inject them at appropriate points.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */

import type { RuntimeContext } from '@sidekick/core'
import { registerInjectUserPromptSubmit } from './inject-user-prompt-submit'
import { registerInjectPreToolUse } from './inject-pre-tool-use'
import { registerInjectPostToolUse } from './inject-post-tool-use'
import { registerInjectStop } from './inject-stop'

/**
 * Register all consumption handlers
 */
export function registerConsumptionHandlers(context: RuntimeContext): void {
  registerInjectUserPromptSubmit(context)
  registerInjectPreToolUse(context)
  registerInjectPostToolUse(context)
  registerInjectStop(context)
}
