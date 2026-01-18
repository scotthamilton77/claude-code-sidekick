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
 * @see docs/ROADMAP.md Phase 9.6
 */

import type { Logger, MinimalStateService, StagingService, HookName } from '@sidekick/types'
import { createRemindersState, type RemindersStateAccessors } from './state.js'
import { ReminderIds } from './types.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Dependencies for ReminderOrchestrator.
 * Uses constructor injection for testability.
 */
export interface ReminderOrchestratorDeps {
  /** Staging service for deleting reminders */
  staging: StagingService
  /** State service for baseline state via remindersState accessors */
  stateService: MinimalStateService
  /** Logger for observability */
  logger: Logger
}

/**
 * Reminder identification for orchestrator methods.
 */
export interface ReminderRef {
  /** Reminder name (e.g., 'pause-and-reflect', 'verify-completion') */
  name: string
  /** Hook where the reminder was staged/consumed */
  hook: HookName
}

/**
 * Metrics snapshot for baseline tracking.
 */
export interface MetricsSnapshot {
  turnCount: number
  toolsThisTurn: number
  toolCount: number
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
export class ReminderOrchestrator {
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
    // P&R staged → unstage VC (cascade prevention)
    if (reminder.name === ReminderIds.PAUSE_AND_REFLECT) {
      try {
        await this.deps.staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)
        this.deps.logger.debug('Unstaged VC after P&R staged', { sessionId })
      } catch (err) {
        this.deps.logger.warn('Failed to unstage VC after P&R staged', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
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
  async onReminderConsumed(reminder: ReminderRef, sessionId: string, metrics: MetricsSnapshot): Promise<void> {
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
          error: err instanceof Error ? err.message : String(err),
        })
      }

      // VC consumed → unstage P&R (prevent double block)
      try {
        await this.deps.staging.deleteReminder('PreToolUse', ReminderIds.PAUSE_AND_REFLECT)
        this.deps.logger.debug('Unstaged P&R after VC consumed', { sessionId })
      } catch (err) {
        this.deps.logger.warn('Failed to unstage P&R after VC consumed', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
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
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Rule 2 (unstage VC or re-stage if unverified) stays in
    // unstage-verify-completion.ts for now due to complexity
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
