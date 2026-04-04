/**
 * Cleanup P&R reminder on Stop hook
 *
 * P&R is designed to interrupt runaway execution. When the agent stops,
 * P&R is moot. This handler calls orchestrator.onStop() to clean it up.
 *
 * Defensive: Rule 4 (VC consumed -> unstage P&R) already covers the VC case,
 * but this handles the no-VC case where P&R would otherwise linger.
 *
 * @see docs/superpowers/specs/2026-04-04-pr-staging-toolresult-fix-design.md
 */

import type { RuntimeContext } from '@sidekick/core'
import type { DaemonContext, HandlerContext, SidekickEvent } from '@sidekick/types'
import { isDaemonContext, isHookEvent } from '@sidekick/types'

export function registerCleanupOnStop(context: RuntimeContext): void {
  if (!isDaemonContext(context)) return

  context.handlers.register({
    id: 'reminders:cleanup-on-stop',
    priority: 50,
    filter: { kind: 'hook', hooks: ['Stop'] },
    handler: async (event: SidekickEvent, ctx: HandlerContext) => {
      if (!isHookEvent(event)) return
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return

      const daemonCtx = ctx as unknown as DaemonContext
      const sessionId = event.context?.sessionId
      if (!sessionId) return

      if (daemonCtx.orchestrator) {
        await daemonCtx.orchestrator.onStop(sessionId)
      }
    },
  })
}
