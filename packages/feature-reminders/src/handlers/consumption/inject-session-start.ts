/**
 * Inject reminders into SessionStart hook (CLI-side)
 * @see docs/plans/2026-02-16-persona-injection.md
 */
import type { RuntimeContext } from '@sidekick/core'
import { createConsumptionHandler } from './consumption-handler-factory.js'

export function registerInjectSessionStart(context: RuntimeContext): void {
  createConsumptionHandler(context, {
    id: 'reminders:inject-session-start',
    hook: 'SessionStart',
  })
}
