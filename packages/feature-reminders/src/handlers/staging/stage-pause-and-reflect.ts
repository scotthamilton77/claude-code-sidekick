/**
 * Stage "pause and reflect" reminder when toolsThisTurn exceeds threshold
 *
 * Threshold is calculated relative to:
 * 1. Start of turn (default baseline = 0)
 * 2. Last P&R consumption (reactivation)
 * 3. Last VC consumption (baseline reset via pr-baseline.json)
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { RuntimeContext } from '@sidekick/core'
import { isTranscriptEvent, type PRBaselineState } from '@sidekick/types'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../../types.js'

export function registerStagePauseAndReflect(context: RuntimeContext): void {
  createStagingHandler(context, {
    id: 'reminders:stage-pause-and-reflect',
    priority: 80,
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    execute: async (event, ctx) => {
      if (!isTranscriptEvent(event)) return undefined

      const metrics = event.metadata.metrics
      const sessionId = event.context?.sessionId
      const featureConfig = context.config.getFeature<RemindersSettings>('reminders')
      const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }

      // Read P&R baseline set by VC consumption (if any)
      // FIXME wouldn't a countdown be simpler, and putting countdown resets into an event handler, and/or a feature controller class?
      let prBaseline: PRBaselineState | null = null
      const projectDir = context.paths.projectDir
      if (sessionId && projectDir) {
        try {
          const stateDir = join(projectDir, '.sidekick', 'sessions', sessionId, 'state')
          const baselineData = await readFile(join(stateDir, 'pr-baseline.json'), 'utf-8')
          prBaseline = JSON.parse(baselineData) as PRBaselineState
        } catch {
          // No baseline file - use default threshold (baseline = 0)
        }
      }

      // Calculate effective baseline for threshold
      // If VC was consumed this turn, use its toolsThisTurn as the new baseline
      let effectiveBaseline = 0
      if (prBaseline && prBaseline.turnCount === metrics.turnCount) {
        effectiveBaseline = prBaseline.toolsThisTurn
      }

      // Check consumption history for reactivation decision
      const lastConsumed = await ctx.staging.getLastConsumed('PreToolUse', ReminderIds.PAUSE_AND_REFLECT)
      if (lastConsumed?.stagedAt) {
        // Use last P&R consumption as baseline if it's higher than VC baseline
        if (lastConsumed.stagedAt.turnCount === metrics.turnCount) {
          effectiveBaseline = Math.max(effectiveBaseline, lastConsumed.stagedAt.toolsThisTurn)
        }

        // Reactivate only on new turn OR after threshold more tools since baseline
        const shouldReactivate =
          metrics.turnCount > lastConsumed.stagedAt.turnCount ||
          metrics.toolsThisTurn >= effectiveBaseline + config.pause_and_reflect_threshold

        if (!shouldReactivate) return undefined
      }

      // Check threshold relative to baseline
      const toolsSinceBaseline = metrics.toolsThisTurn - effectiveBaseline
      if (toolsSinceBaseline < config.pause_and_reflect_threshold) return undefined

      // Unstage verify-completion to prevent cascade: pause-and-reflect blocks the model,
      // which triggers Stop hook, which would consume verify-completion - defeating the
      // purpose of pause-and-reflect (to reflect mid-turn, not verify completion)
      await ctx.staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)

      return {
        reminderId: ReminderIds.PAUSE_AND_REFLECT,
        targetHook: 'PreToolUse',
        templateContext: { toolsThisTurn: metrics.toolsThisTurn },
      }
    },
  })
}
