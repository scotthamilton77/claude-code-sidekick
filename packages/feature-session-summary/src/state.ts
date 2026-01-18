/**
 * Feature-Session-Summary State Accessors
 *
 * Typed state accessors for the session summary feature.
 * Encapsulates filenames, schemas, and defaults for summary-related state.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 */

import { sessionState, SessionStateAccessor } from '@sidekick/core'
import type {
  MinimalStateService,
  SessionSummaryState,
  SummaryCountdownState,
  ResumeMessageState,
  SnarkyMessageState,
  SessionPersonaState,
} from '@sidekick/types'
import {
  SessionSummaryStateSchema,
  SummaryCountdownStateSchema,
  ResumeMessageStateSchema,
  SnarkyMessageStateSchema,
  SessionPersonaStateSchema,
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
 * trackHistory: true - tracks how title and intent evolve throughout session
 *
 * Exported for read-only consumers (e.g., feature-statusline).
 */
export const SessionSummaryDescriptor = sessionState('session-summary.json', SessionSummaryStateSchema, {
  defaultValue: null,
  trackHistory: true,
})

/**
 * Summary countdown state descriptor.
 * Tracks tool uses until next summary update.
 * (No history tracking - operational state, not LLM content)
 */
const SummaryCountdownDescriptor = sessionState('summary-countdown.json', SummaryCountdownStateSchema, {
  defaultValue: DEFAULT_COUNTDOWN,
})

/**
 * Resume message state descriptor.
 * Stores resume prompts for returning users.
 * Default: null (file may not exist until user resumes a session)
 * trackHistory: true - tracks how resumption prompts evolve across pivots
 *
 * Exported for read-only consumers (e.g., feature-statusline).
 */
export const ResumeMessageDescriptor = sessionState('resume-message.json', ResumeMessageStateSchema, {
  defaultValue: null,
  trackHistory: true,
})

/**
 * Snarky message state descriptor.
 * Stores witty welcome messages.
 * trackHistory: true - tracks personality/commentary evolution
 *
 * Exported for read-only consumers (e.g., feature-statusline).
 */
export const SnarkyMessageDescriptor = sessionState('snarky-message.json', SnarkyMessageStateSchema, {
  defaultValue: DEFAULT_SNARKY_MESSAGE,
  trackHistory: true,
})

/**
 * Session persona state descriptor.
 * Stores selected persona for creative outputs.
 * Default: null (file may not exist until persona is selected)
 *
 * Exported for read-only consumers (e.g., feature-statusline).
 *
 * @see docs/design/PERSONA-PROFILES-DESIGN.md
 */
export const SessionPersonaDescriptor = sessionState('session-persona.json', SessionPersonaStateSchema, {
  defaultValue: null,
})

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
  /** Session persona (selected for creative outputs) */
  sessionPersona: SessionStateAccessor<SessionPersonaState, null>
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
    sessionPersona: new SessionStateAccessor(stateService, SessionPersonaDescriptor),
  }
}
