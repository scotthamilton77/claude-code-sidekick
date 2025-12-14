/**
 * Type definitions for Session Summary feature
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 * @see docs/design/FEATURE-RESUME.md
 */

import type { ResumeMessageState, SessionSummaryState, SummaryCountdownState } from '@sidekick/types'

export type { ResumeMessageState, SessionSummaryState, SummaryCountdownState }

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
 * Minimum confidence threshold for generating resume artifacts.
 * Both title and intent confidence must be >= this value.
 */
export const RESUME_MIN_CONFIDENCE = 0.7
