/**
 * Feature-Reminders State Accessors
 *
 * Typed state accessors for the reminders feature.
 * Encapsulates filenames, schemas, and defaults for reminder-related state.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */

import { sessionState, SessionStateAccessor } from '@sidekick/core'
import type {
  MinimalStateService,
  PRBaselineState,
  ReminderThrottleState,
  VCUnverifiedState,
  VerificationToolsState,
} from '@sidekick/types'
import {
  PRBaselineStateSchema,
  ReminderThrottleStateSchema,
  VCUnverifiedStateSchema,
  VerificationToolsStateSchema,
} from '@sidekick/types'

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

/**
 * Verification Tools state descriptor.
 * Per-tool tracking of build/typecheck/test/lint verification status.
 * Default: {} (empty — no tools tracked until first file edit)
 * trackHistory: false — high-frequency updates, no need for history
 */
const VerificationToolsDescriptor = sessionState('verification-tools.json', VerificationToolsStateSchema, {
  defaultValue: {},
  trackHistory: false,
})

/**
 * Reminder Throttle state descriptor.
 * Per-reminder counters and cached resolved reminders for re-staging.
 * Default: {} (empty — no throttled reminders until first staging)
 * trackHistory: false — high-frequency updates, no need for history
 */
const ReminderThrottleDescriptor = sessionState('reminder-throttle.json', ReminderThrottleStateSchema, {
  defaultValue: {},
  trackHistory: false,
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
  /** Per-tool verification status (build, typecheck, test, lint) */
  verificationTools: SessionStateAccessor<VerificationToolsState, Record<string, never>>
  /** Reminder throttle state (per-reminder counters and cached reminders) */
  reminderThrottle: SessionStateAccessor<ReminderThrottleState, Record<string, never>>
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
    verificationTools: new SessionStateAccessor(stateService, VerificationToolsDescriptor),
    reminderThrottle: new SessionStateAccessor(stateService, ReminderThrottleDescriptor),
  }
}
