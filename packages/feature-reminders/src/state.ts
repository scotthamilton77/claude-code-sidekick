/**
 * Feature-Reminders State Accessors
 *
 * Typed state accessors for the reminders feature.
 * Encapsulates filenames, schemas, and defaults for reminder-related state.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 * @see docs/ROADMAP.md Phase 9.3.7
 */

import { sessionState, SessionStateAccessor } from '@sidekick/core'
import type { MinimalStateService, PRBaselineState, VCUnverifiedState } from '@sidekick/types'
import { PRBaselineStateSchema, VCUnverifiedStateSchema } from '@sidekick/types'

// ============================================================================
// State Descriptors
// ============================================================================

/**
 * PR Baseline state descriptor.
 * Stores baseline metrics when verify-completion was consumed.
 * Used by pause-and-reflect to determine if a new reminder should be staged.
 * Default: null (file may not exist until VC is consumed)
 * trackHistory: true - tracks when verification milestones occur
 */
const PRBaselineDescriptor = sessionState('pr-baseline.json', PRBaselineStateSchema, {
  defaultValue: null,
  trackHistory: true,
})

/**
 * VC Unverified state descriptor.
 * Tracks unverified source code changes and verification cycle count.
 * Used to re-stage verify-completion on UserPromptSubmit.
 * Default: null (file may not exist if no unverified changes)
 * trackHistory: true - tracks verification cycle patterns
 */
const VCUnverifiedDescriptor = sessionState('vc-unverified.json', VCUnverifiedStateSchema, {
  defaultValue: null,
  trackHistory: true,
})

// ============================================================================
// State Accessor Types
// ============================================================================

/**
 * Type for the reminders state accessors.
 */
export interface RemindersStateAccessors {
  /** PR baseline state (when verify-completion was consumed) */
  prBaseline: SessionStateAccessor<PRBaselineState, null>
  /** VC unverified state (unverified source code changes) */
  vcUnverified: SessionStateAccessor<VCUnverifiedState, null>
}

// ============================================================================
// State Factory
// ============================================================================

/**
 * Create typed state accessors for the reminders feature.
 *
 * @example
 * const remindersState = createRemindersState(ctx.stateService)
 * const result = await remindersState.prBaseline.read(sessionId)
 */
export function createRemindersState(stateService: MinimalStateService): RemindersStateAccessors {
  return {
    prBaseline: new SessionStateAccessor(stateService, PRBaselineDescriptor),
    vcUnverified: new SessionStateAccessor(stateService, VCUnverifiedDescriptor),
  }
}
