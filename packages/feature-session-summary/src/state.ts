/**
 * Feature-Session-Summary State Accessors
 *
 * Typed state accessors for the session summary feature.
 * Encapsulates filenames, schemas, and defaults for summary-related state.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 * @see docs/ROADMAP.md Phase 9.3.7
 */

import { sessionState, SessionStateAccessor } from '@sidekick/core'
import type {
  MinimalStateService,
  SessionSummaryState,
  SummaryCountdownState,
  ResumeMessageState,
  SnarkyMessageState,
} from '@sidekick/types'
import {
  SessionSummaryStateSchema,
  SummaryCountdownStateSchema,
  ResumeMessageStateSchema,
  SnarkyMessageStateSchema,
} from '@sidekick/types'

// ============================================================================
// Default Values
// ============================================================================

/**
 * Default countdown state for new sessions.
 */
const DEFAULT_COUNTDOWN: SummaryCountdownState = {
  countdown: 0,
  bookmark_line: 0,
}

/**
 * Default snarky message state (empty).
 */
const DEFAULT_SNARKY_MESSAGE: SnarkyMessageState = {
  message: '',
  timestamp: '',
}

// ============================================================================
// State Descriptors
// ============================================================================

/**
 * Session summary state descriptor.
 * Stores LLM-generated session title and intent.
 * Default: null (file may not exist until first summary is generated)
 *
 * Exported for read-only consumers (e.g., feature-statusline).
 */
export const SessionSummaryDescriptor = sessionState('session-summary.json', SessionSummaryStateSchema, null)

/**
 * Summary countdown state descriptor.
 * Tracks tool uses until next summary update.
 */
const SummaryCountdownDescriptor = sessionState(
  'summary-countdown.json',
  SummaryCountdownStateSchema,
  DEFAULT_COUNTDOWN
)

/**
 * Resume message state descriptor.
 * Stores resume prompts for returning users.
 * Default: null (file may not exist until user resumes a session)
 *
 * Exported for read-only consumers (e.g., feature-statusline).
 */
export const ResumeMessageDescriptor = sessionState('resume-message.json', ResumeMessageStateSchema, null)

/**
 * Snarky message state descriptor.
 * Stores witty welcome messages.
 *
 * Exported for read-only consumers (e.g., feature-statusline).
 */
export const SnarkyMessageDescriptor = sessionState(
  'snarky-message.json',
  SnarkyMessageStateSchema,
  DEFAULT_SNARKY_MESSAGE
)

// ============================================================================
// State Accessor Types
// ============================================================================

/**
 * Type for the session summary state accessors.
 */
export interface SessionSummaryStateAccessors {
  /** Session summary (title and intent) */
  sessionSummary: SessionStateAccessor<SessionSummaryState, null>
  /** Summary countdown (tool uses until update) */
  summaryCountdown: SessionStateAccessor<SummaryCountdownState, SummaryCountdownState>
  /** Resume message (prompts for returning users) */
  resumeMessage: SessionStateAccessor<ResumeMessageState, null>
  /** Snarky message (witty welcome) */
  snarkyMessage: SessionStateAccessor<SnarkyMessageState, SnarkyMessageState>
}

// ============================================================================
// State Factory
// ============================================================================

/**
 * Create typed state accessors for the session summary feature.
 *
 * @example
 * const summaryState = createSessionSummaryState(ctx.stateService)
 * const result = await summaryState.sessionSummary.read(sessionId)
 */
export function createSessionSummaryState(stateService: MinimalStateService): SessionSummaryStateAccessors {
  return {
    sessionSummary: new SessionStateAccessor(stateService, SessionSummaryDescriptor),
    summaryCountdown: new SessionStateAccessor(stateService, SummaryCountdownDescriptor),
    resumeMessage: new SessionStateAccessor(stateService, ResumeMessageDescriptor),
    snarkyMessage: new SessionStateAccessor(stateService, SnarkyMessageDescriptor),
  }
}
