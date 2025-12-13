/**
 * Type definitions for Session Summary feature
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 * @see docs/design/FEATURE-RESUME.md
 */

/**
 * Session summary state persisted to disk
 * Location: .sidekick/sessions/{session_id}/state/session-summary.json
 */
export interface SessionSummaryState {
  session_id: string
  timestamp: string // ISO8601
  session_title: string
  session_title_confidence: number // 0-1
  session_title_key_phrases?: string[]
  latest_intent: string
  latest_intent_confidence: number // 0-1
  latest_intent_key_phrases?: string[]
  pivot_detected?: boolean
  previous_title?: string
  previous_intent?: string
  stats?: {
    total_tokens?: number
    processing_time_ms?: number
  }
}

/**
 * Internal countdown state for throttling
 * Stored alongside session summary
 */
export interface SummaryCountdownState {
  countdown: number // Tool uses until next analysis
  bookmark_line: number // Transcript line where we had high confidence
}

/**
 * Configuration for session summary feature
 */
export interface SessionSummaryConfig {
  enabled: boolean
  excerptLines: number
  filterToolMessages: boolean
  keepHistory: boolean
  maxTitleWords: number
  maxIntentWords: number
  snarkyMessages: boolean
  countdown: {
    lowConfidence: number
    mediumConfidence: number
    highConfidence: number
  }
  bookmark: {
    confidenceThreshold: number
    resetThreshold: number
  }
  minUserMessages: number
  minRecentLines: number
}

/**
 * Default configuration values
 */
export const DEFAULT_SESSION_SUMMARY_CONFIG: SessionSummaryConfig = {
  enabled: true,
  excerptLines: 80,
  filterToolMessages: true,
  keepHistory: false,
  maxTitleWords: 8,
  maxIntentWords: 12,
  snarkyMessages: true,
  countdown: {
    lowConfidence: 5,
    mediumConfidence: 20,
    highConfidence: 10000,
  },
  bookmark: {
    confidenceThreshold: 0.8,
    resetThreshold: 0.7,
  },
  minUserMessages: 5,
  minRecentLines: 50,
}

/**
 * Resume message state persisted to disk.
 * Generated as a side-effect of session summary updates when pivot is detected.
 * Location: .sidekick/sessions/{session_id}/state/resume-message.json
 * @see docs/design/FEATURE-RESUME.md
 */
export interface ResumeMessageState {
  /** Most recent task ID from the summary, if available */
  last_task_id: string | null
  /** Question format: "Shall we resume..." or "Want to continue..." */
  resume_last_goal_message: string
  /** Snarky welcome message for returning user */
  snarky_comment: string
  /** ISO8601 timestamp when this was generated */
  timestamp: string
}

/**
 * Minimum confidence threshold for generating resume artifacts.
 * Both title and intent confidence must be >= this value.
 */
export const RESUME_MIN_CONFIDENCE = 0.7
