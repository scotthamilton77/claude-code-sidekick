/**
 * Inject reminders into Stop hook (CLI-side)
 *
 * Uses factory with buildResponse strategy for smart completion detection:
 * 1. For verify-completion: Run LLM classification via Supervisor IPC
 * 2. Based on classification, return blocking or non-blocking response
 * 3. Side effects in onConsume: Delete staged P&R, update P&R baseline
 *
 * @see docs/design/FEATURE-REMINDERS.md §3.1 Consumption Handlers
 */

import type { HookResponse, RuntimeContext } from '@sidekick/core'
import { IpcService } from '@sidekick/core'
import type { StopHookEvent } from '@sidekick/types'
import { createConsumptionHandler, buildDefaultResponse } from './consumption-handler-factory.js'
import { ReminderIds } from '../../types.js'
import type { CompletionCategory } from '../../types.js'

/** Classification result from Supervisor IPC */
interface ClassificationResult {
  category: CompletionCategory
  confidence: number
  shouldBlock: boolean
  userMessage?: string
  reasoning?: string
}

export function registerInjectStop(context: RuntimeContext): void {
  createConsumptionHandler(context, {
    id: 'reminders:inject-stop',
    hook: 'Stop',
    supportsBlocking: true,

    buildResponse: async ({ reminder, cliCtx, sessionId, event, supportsBlocking }) => {
      // For non-verify-completion reminders, use default behavior
      if (reminder.name !== ReminderIds.VERIFY_COMPLETION) {
        return buildDefaultResponse(reminder, supportsBlocking)
      }

      // Smart completion detection: classify assistant's stopping intent
      const projectDir = cliCtx.paths.projectDir
      if (!projectDir) {
        cliCtx.logger.warn('Cannot run completion classification: projectDir not available')
        return buildDefaultResponse(reminder, supportsBlocking)
      }

      // Get transcript path from event
      const stopEvent = event as StopHookEvent
      const transcriptPath = stopEvent.payload?.transcriptPath

      // Call Supervisor for classification
      const ipc = new IpcService(projectDir, cliCtx.logger)
      try {
        const classification = (await ipc.send('completion.classify', {
          sessionId,
          transcriptPath,
        })) as ClassificationResult

        cliCtx.logger.info('Completion classification result', {
          category: classification.category,
          confidence: classification.confidence,
          shouldBlock: classification.shouldBlock,
        })

        // Determine response based on classification
        if (classification.shouldBlock) {
          // Claiming completion with high confidence - block with verification
          // Clear unverified state since verification is now happening
          try {
            await ipc.send('vc-unverified.clear', { sessionId })
          } catch (clearErr) {
            cliCtx.logger.warn('Failed to clear vc-unverified state', { error: String(clearErr) })
          }
          return buildDefaultResponse(reminder, supportsBlocking)
        } else {
          // Non-blocking: set unverified state so we re-stage on next UserPromptSubmit
          const metrics = reminder.stagedAt ?? { turnCount: 0, toolsThisTurn: 0 }
          try {
            await ipc.send('vc-unverified.set', {
              sessionId,
              classification: {
                category: classification.category,
                confidence: classification.confidence,
              },
              metrics: {
                turnCount: metrics.turnCount,
                toolsThisTurn: metrics.toolsThisTurn,
              },
            })
          } catch (setErr) {
            cliCtx.logger.warn('Failed to set vc-unverified state', { error: String(setErr) })
          }

          if (classification.category === 'ASKING_QUESTION' || classification.category === 'ANSWERING_QUESTION') {
            // Silent - no interruption
            return {}
          } else {
            // OTHER - notify user but don't block
            const response: HookResponse = {}
            if (classification.userMessage) {
              response.userMessage = classification.userMessage
            }
            return response
          }
        }
      } catch (err) {
        // On IPC failure, default to blocking (safe fallback)
        cliCtx.logger.error('Completion classification IPC failed - defaulting to block', { error: String(err) })
        return buildDefaultResponse(reminder, supportsBlocking)
      } finally {
        ipc.close()
      }
    },

    onConsume: async ({ reminder, reader, cliCtx, sessionId }) => {
      // Side effects for verify-completion consumption
      if (reminder.name === ReminderIds.VERIFY_COMPLETION) {
        // 1. Delete any staged P&R to prevent cascade
        reader.deleteReminder('PreToolUse', ReminderIds.PAUSE_AND_REFLECT)

        // 2. Send IPC to Supervisor to update P&R baseline
        const projectDir = cliCtx.paths.projectDir
        if (projectDir) {
          const ipc = new IpcService(projectDir, cliCtx.logger)
          try {
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
