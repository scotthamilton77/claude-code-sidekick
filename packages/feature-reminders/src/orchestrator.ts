/**
 * ReminderOrchestrator
 *
 * Centralizes cross-reminder coordination rules. Handlers call orchestrator
 * methods after their primary action to trigger coordination rules.
 *
 * Rules:
 * 1. P&R staged → unstage VC (cascade prevention)
 * 2. UserPromptSubmit → unstage VC or re-stage if unverified (complex - stays in handler)
 * 3. VC consumed → reset P&R baseline
 * 4. VC consumed → unstage P&R (prevent double block)
 *
 * @see docs/plans/2026-01-18-reminder-orchestrator-design.md
 */

import { logEvent, toErrorMessage } from '@sidekick/core'
import type {
  Logger,
  MinimalStateService,
  StagingService,
  ReminderCoordinator,
  ReminderRef,
  CoordinationMetrics,
} from '@sidekick/types'
import { ReminderEvents } from './events.js'
import { createRemindersState, type RemindersStateAccessors } from './state.js'
import { ReminderIds, ALL_VC_REMINDER_IDS } from './types.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Dependencies for ReminderOrchestrator.
 * Uses constructor injection for testability.
 */
export interface ReminderOrchestratorDeps {
  /** Factory to get session-scoped staging service */
  getStagingService(sessionId: string): StagingService
  /** State service for baseline state via remindersState accessors */
  stateService: MinimalStateService
  /** Logger for observability */
  logger: Logger
}

// ============================================================================
// ReminderOrchestrator
// ============================================================================

/**
 * Orchestrates cross-reminder coordination rules.
 *
 * Handlers call orchestrator methods after their primary action:
 * - Staging handlers call `onReminderStaged()` after staging
 * - Consumption handlers call `onReminderConsumed()` after consumption
 * - UserPromptSubmit handler calls `onUserPromptSubmit()` (placeholder for future)
 *
 * Methods catch and log errors without throwing - a failed rule shouldn't
 * break the handler's primary action.
 */
export class ReminderOrchestrator implements ReminderCoordinator {
  private readonly remindersState: RemindersStateAccessors

  constructor(private readonly deps: ReminderOrchestratorDeps) {
    this.remindersState = createRemindersState(deps.stateService)
  }

  /**
   * Called after a reminder is staged (daemon context).
   *
   * Rules triggered:
   * - Rule 1: P&R staged → unstage VC (cascade prevention)
   */
  async onReminderStaged(reminder: ReminderRef, sessionId: string): Promise<void> {
    // P&R staged → unstage all VC reminders (cascade prevention)
    if (reminder.name === ReminderIds.PAUSE_AND_REFLECT) {
      try {
        const staging = this.deps.getStagingService(sessionId)
        const eventContext = { sessionId }
        const sessionLogger = this.deps.logger.child({ context: { sessionId } })
        let deletedCount = 0
        for (const vcId of ALL_VC_REMINDER_IDS) {
          const deleted = await staging.deleteReminder('Stop', vcId)
          if (deleted) {
            deletedCount++
            logEvent(
              sessionLogger,
              ReminderEvents.reminderUnstaged(eventContext, {
                reminderName: vcId,
                hookName: 'Stop',
                reason: 'pause_and_reflect_cascade',
                triggeredBy: 'cascade_from_pause_and_reflect',
              })
            )
          }
        }
        this.deps.logger.debug('VC unstage: P&R cascade complete', {
          sessionId,
          deletedCount,
          totalChecked: ALL_VC_REMINDER_IDS.length,
        })
      } catch (err) {
        this.deps.logger.warn('Failed to unstage VC reminders after P&R staged', {
          sessionId,
          error: toErrorMessage(err),
        })
      }
    }
  }

  /**
   * Called after a reminder is consumed (CLI context).
   *
   * Rules triggered:
   * - Rule 3: VC consumed → reset P&R baseline
   * - Rule 4: VC consumed → unstage P&R (prevent double block)
   */
  async onReminderConsumed(reminder: ReminderRef, sessionId: string, metrics: CoordinationMetrics): Promise<void> {
    if (reminder.name === ReminderIds.VERIFY_COMPLETION) {
      // VC consumed → reset P&R baseline
      try {
        await this.remindersState.prBaseline.write(sessionId, {
          timestamp: Date.now(),
          turnCount: metrics.turnCount,
          toolsThisTurn: metrics.toolsThisTurn,
        })
        this.deps.logger.debug('Reset P&R baseline after VC consumed', { sessionId })
      } catch (err) {
        this.deps.logger.warn('Failed to reset P&R baseline after VC consumed', {
          sessionId,
          error: toErrorMessage(err),
        })
      }

      // VC consumed → unstage P&R (prevent double block)
      await this.unstagePauseAndReflect(sessionId, 'vc_consumed_cascade', 'cascade_from_verify_completion')
    }
  }

  /**
   * Called on UserPromptSubmit (daemon context).
   *
   * Clears P&R baseline since new user prompt resets the turn context.
   * Rule 2 (unstage VC or re-stage if unverified) stays in its handler
   * due to complexity.
   */
  async onUserPromptSubmit(sessionId: string): Promise<void> {
    // Clear P&R baseline - new user prompt resets turn threshold
    try {
      await this.remindersState.prBaseline.delete(sessionId)
      this.deps.logger.debug('Cleared P&R baseline on UserPromptSubmit', { sessionId })
    } catch (err) {
      this.deps.logger.warn('Failed to clear P&R baseline on UserPromptSubmit', {
        sessionId,
        error: toErrorMessage(err),
      })
    }

    // Rule 2 (unstage VC or re-stage if unverified) stays in
    // unstage-verify-completion.ts for now due to complexity
  }

  /**
   * Called when Stop hook fires.
   *
   * P&R is designed to interrupt runaway execution — once the agent stops,
   * it's irrelevant. This is defensive: Rule 4 (VC consumed → unstage P&R)
   * covers the VC case, but this handles the no-VC case where P&R would
   * otherwise linger on PreToolUse.
   */
  async onStop(sessionId: string): Promise<void> {
    await this.unstagePauseAndReflect(sessionId, 'agent_stopping', 'stop_hook')
  }

  /**
   * Delete P&R from PreToolUse staging and log the event.
   * Shared by Rule 4 (VC consumed → unstage P&R) and onStop (agent stopping).
   */
  private async unstagePauseAndReflect(sessionId: string, reason: string, triggeredBy: string): Promise<void> {
    try {
      const staging = this.deps.getStagingService(sessionId)
      const deleted = await staging.deleteReminder('PreToolUse', ReminderIds.PAUSE_AND_REFLECT)
      if (deleted) {
        logEvent(
          this.deps.logger.child({ context: { sessionId } }),
          ReminderEvents.reminderUnstaged(
            { sessionId },
            {
              reminderName: ReminderIds.PAUSE_AND_REFLECT,
              hookName: 'PreToolUse',
              reason,
              triggeredBy,
            }
          )
        )
      }
      this.deps.logger.debug('P&R unstaged', { sessionId, deleted, reason })
    } catch (err) {
      this.deps.logger.warn('Failed to unstage P&R', {
        sessionId,
        reason,
        error: toErrorMessage(err),
      })
    }
  }

  /**
   * Read P&R baseline state for a session.
   * Returns null if no baseline exists.
   *
   * Used by stage-pause-and-reflect to calculate threshold.
   */
  async readPRBaseline(sessionId: string): Promise<{ turnCount: number; toolsThisTurn: number } | null> {
    const result = await this.remindersState.prBaseline.read(sessionId)
    if (result.source === 'default' || result.data === null) {
      return null
    }
    return {
      turnCount: result.data.turnCount,
      toolsThisTurn: result.data.toolsThisTurn,
    }
  }
}
