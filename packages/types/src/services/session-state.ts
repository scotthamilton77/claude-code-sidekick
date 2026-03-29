/**
 * Session State Domain Types
 *
 * Session-level state schemas for summary, persona, snarky/resume messages.
 * Persisted to `.sidekick/sessions/{sessionId}/state/`.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 * @see docs/design/PERSONA-PROFILES-DESIGN.md
 * @see docs/design/FEATURE-RESUME.md
 */

import { z } from 'zod'

// ============================================================================
// Session Summary State
// ============================================================================

/**
 * Session summary state persisted to disk.
 * Contains LLM-analyzed session title and current intent with confidence scores.
 *
 * Location: `.sidekick/sessions/{sessionId}/state/session-summary.json`
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.4
 */
export const SessionSummaryStateSchema = z.object({
  /** Session identifier */
  session_id: z.string(),
  /** ISO8601 timestamp of last update */
  timestamp: z.string(),
  /** LLM-generated session title */
  session_title: z.string(),
  /** Confidence in session title (0-1) */
  session_title_confidence: z.number(),
  /** Key phrases from title analysis */
  session_title_key_phrases: z.array(z.string()).optional(),
  /** Current user intent */
  latest_intent: z.string(),
  /** Confidence in intent (0-1) */
  latest_intent_confidence: z.number(),
  /** Key phrases from intent analysis */
  latest_intent_key_phrases: z.array(z.string()).optional(),
  /** Whether a significant pivot was detected */
  pivot_detected: z.boolean().optional(),
  /** Previous title (for diff display) */
  previous_title: z.string().optional(),
  /** Previous intent (for diff display) */
  previous_intent: z.string().optional(),
  /** Analysis statistics */
  stats: z
    .object({
      /** Tokens used for analysis */
      total_tokens: z.number().optional(),
      /** Processing time in milliseconds */
      processing_time_ms: z.number().optional(),
    })
    .optional(),
})

export type SessionSummaryState = z.infer<typeof SessionSummaryStateSchema>

/**
 * Default placeholder values for session summary state.
 * Used by create-first-summary handler and statusline service for consistent defaults.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.1
 */
export const SESSION_SUMMARY_PLACEHOLDERS = {
  /** Default title for new sessions before first analysis */
  newSession: 'New Session',
  /** Default intent message while awaiting first user prompt */
  awaitingFirstPrompt: 'Awaiting first prompt...',
} as const

// ============================================================================
// Session Persona State
// ============================================================================

/**
 * Session persona state persisted to disk.
 * Selected on SessionStart and used to shape creative outputs (snarky, resume).
 *
 * Location: `.sidekick/sessions/{sessionId}/state/session-persona.json`
 *
 * @see docs/design/PERSONA-PROFILES-DESIGN.md - Session Persona State
 */
export const SessionPersonaStateSchema = z.object({
  /** Selected persona identifier */
  persona_id: z.string(),
  /** List of persona IDs that were available for selection */
  selected_from: z.array(z.string()),
  /** ISO8601 timestamp of selection */
  timestamp: z.string(),
})

export type SessionPersonaState = z.infer<typeof SessionPersonaStateSchema>

/**
 * Tracks which persona was last staged into reminders for change detection.
 * Three logical states:
 * - File absent: never staged (session initialization)
 * - { personaId: null }: explicitly cleared mid-session
 * - { personaId: "X" }: persona X was last staged
 *
 * Location: `.sidekick/sessions/{sessionId}/state/last-staged-persona.json`
 *
 * @see docs/plans/2026-02-16-persona-change-detection-design.md
 */
export const LastStagedPersonaSchema = z.object({
  /** Last staged persona ID, or null if explicitly cleared */
  personaId: z.string().nullable(),
})

export type LastStagedPersona = z.infer<typeof LastStagedPersonaSchema>

/**
 * Internal countdown state for throttling session summary updates.
 * Stored alongside session summary for persistence across Daemon restarts.
 *
 * Location: Part of `.sidekick/sessions/{sessionId}/state/session-summary.json`
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.5 Countdown Mechanism
 */
export const SummaryCountdownStateSchema = z.object({
  /** Tool uses remaining until next analysis */
  countdown: z.number(),
  /** Transcript line where we last had high confidence */
  bookmark_line: z.number(),
})

export type SummaryCountdownState = z.infer<typeof SummaryCountdownStateSchema>

// ============================================================================
// Snarky Message State
// ============================================================================

/**
 * Snarky message state persisted to disk.
 * Generated as a side-effect of session summary updates when title/intent changes.
 * Used by statusline to show a witty welcome message.
 *
 * Location: `.sidekick/sessions/{sessionId}/state/snarky-message.json`
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.2.4
 */
export const SnarkyMessageStateSchema = z.object({
  /** The snarky message text */
  message: z.string(),
  /** ISO8601 timestamp when generated */
  timestamp: z.string(),
})

export type SnarkyMessageState = z.infer<typeof SnarkyMessageStateSchema>

// ============================================================================
// Resume Message State
// ============================================================================

/**
 * Resume message state persisted to disk.
 * Generated as a side-effect of session summary updates when pivot is detected.
 * Used by statusline to show returning user a friendly prompt.
 *
 * Location: `.sidekick/sessions/{sessionId}/state/resume-message.json`
 *
 * @see docs/design/FEATURE-RESUME.md §5.2
 */
export const ResumeMessageStateSchema = z.object({
  /** Most recent task ID from the summary, if available */
  last_task_id: z.string().nullable(),
  /** Source summary's session title */
  session_title: z.string().nullable(),
  /** Snarky welcome message for returning user */
  snarky_comment: z.string(),
  /** ISO8601 timestamp when this was generated */
  timestamp: z.string(),
  /** Persona ID that generated this message (null when persona disabled) */
  persona_id: z.string().nullable().default(null),
  /** Display name for attribution (null when persona disabled) */
  persona_display_name: z.string().nullable().default(null),
})

export type ResumeMessageState = z.infer<typeof ResumeMessageStateSchema>
