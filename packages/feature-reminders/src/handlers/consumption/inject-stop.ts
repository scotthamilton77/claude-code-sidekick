/**
 * Inject reminders into Stop hook (CLI-side)
 *
 * Uses factory with onConsume callback for VC-specific logic:
 * 1. Delete staged P&R when consuming VC (prevent cascade)
 * 2. Send reminder.consumed IPC to Supervisor to update P&R baseline
 *
 * @see docs/design/FEATURE-REMINDERS.md §3.1 Consumption Handlers
 */

import type { RuntimeContext } from '@sidekick/core'
import { IpcService } from '@sidekick/core'
import { createConsumptionHandler } from './consumption-handler-factory.js'
import { ReminderIds } from '../../types.js'

export function registerInjectStop(context: RuntimeContext): void {
  createConsumptionHandler(context, {
    id: 'reminders:inject-stop',
    hook: 'Stop',
    supportsBlocking: true,
    onConsume: async ({ reminder, reader, cliCtx, sessionId }) => {
      // Special handling for verify-completion consumption
      if (reminder.name === ReminderIds.VERIFY_COMPLETION) {
        // 1. Delete any staged P&R to prevent cascade
        reader.deleteReminder('PreToolUse', ReminderIds.PAUSE_AND_REFLECT)

        // 2. Send IPC to Supervisor to update P&R baseline (only if projectDir available)
        const projectDir = cliCtx.paths.projectDir
        if (!projectDir) {
          cliCtx.logger.warn('Cannot send reminder.consumed IPC: projectDir not available')
        } else {
          const ipc = new IpcService(projectDir, cliCtx.logger)
          try {
            // Use stagedAt metrics (best available approximation of consumption point)
            const metrics = reminder.stagedAt ?? { turnCount: 0, toolsThisTurn: 0 }
            await ipc.send('reminder.consumed', {
              sessionId,
              reminderName: reminder.name,
              metrics: {
                turnCount: metrics.turnCount,
                toolsThisTurn: metrics.toolsThisTurn,
              },
            })
          } finally {
            ipc.close()
          }
        }
      }
    },
  })
}
