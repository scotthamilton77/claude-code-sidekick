/**
 * Type definitions and Zod schemas for Statusline feature
 *
 * Defines configuration, state file schemas, and view model types
 * for rendering the statusline.
 *
 * @see docs/design/FEATURE-STATUSLINE.md
 */

import { z } from 'zod'

// ============================================================================
// Configuration Schema
// ============================================================================

/**
 * Zod schema for statusline configuration.
 * Matches docs/design/FEATURE-STATUSLINE.md §4 Configuration Schema.
 */
export const StatuslineConfigSchema = z.object({
  enabled: z.boolean().default(true),
  format: z.string().default('[{model}] | {tokens} | {cwd}{branch} | {summary}'),
  thresholds: z
    .object({
      tokens: z
        .object({
          warning: z.number().default(100000),
          critical: z.number().default(160000),
        })
        .default({}),
      cost: z
        .object({
          warning: z.number().default(0.5),
          critical: z.number().default(1.0),
        })
        .default({}),
    })
    .default({}),
  theme: z
    .object({
      useNerdFonts: z.boolean().default(true),
      colors: z
        .object({
          model: z.string().default('blue'),
          tokens: z.string().default('green'),
          summary: z.string().default('magenta'),
        })
        .default({}),
    })
    .default({}),
})

export type StatuslineConfig = z.infer<typeof StatuslineConfigSchema>

export const DEFAULT_STATUSLINE_CONFIG: StatuslineConfig = StatuslineConfigSchema.parse({})

// ============================================================================
// State File Schemas (Read-Only)
// ============================================================================

/**
 * Session state from .sidekick/sessions/{id}/state/session-state.json
 * Written by Supervisor with token/cost metrics.
 */
export const SessionStateSchema = z.object({
  sessionId: z.string(),
  timestamp: z.number(),
  tokens: z.number().default(0),
  cost: z.number().default(0),
  durationMs: z.number().default(0),
  modelName: z.string().default('unknown'),
})

export type SessionState = z.infer<typeof SessionStateSchema>

/**
 * Session summary from .sidekick/sessions/{id}/state/session-summary.json
 * Written by feature-session-summary.
 */
export const SessionSummaryStateSchema = z.object({
  session_id: z.string(),
  timestamp: z.string(),
  session_title: z.string(),
  session_title_confidence: z.number(),
  session_title_key_phrases: z.array(z.string()).optional(),
  latest_intent: z.string(),
  latest_intent_confidence: z.number(),
  latest_intent_key_phrases: z.array(z.string()).optional(),
  pivot_detected: z.boolean().optional(),
  previous_title: z.string().optional(),
  previous_intent: z.string().optional(),
})

export type SessionSummaryState = z.infer<typeof SessionSummaryStateSchema>

/**
 * Resume message from .sidekick/sessions/{id}/state/resume-message.json
 * Written by feature-session-summary on pivot detection.
 */
export const ResumeMessageStateSchema = z.object({
  last_task_id: z.string().nullable(),
  resume_last_goal_message: z.string(),
  snarky_comment: z.string(),
  timestamp: z.string(),
})

export type ResumeMessageState = z.infer<typeof ResumeMessageStateSchema>

// ============================================================================
// Display Mode
// ============================================================================

/**
 * Statusline display modes per docs/design/FEATURE-STATUSLINE.md §6.2.
 * Determines what content to show based on session state.
 */
export type DisplayMode = 'resume_message' | 'empty_summary' | 'first_prompt' | 'session_summary'

// ============================================================================
// View Model
// ============================================================================

/**
 * Threshold status for color coding.
 */
export type ThresholdStatus = 'normal' | 'warning' | 'critical'

/**
 * Processed view model ready for template rendering.
 * All values are pre-computed strings or formatted data.
 */
export interface StatuslineViewModel {
  /** Current model name (e.g., "claude-3-5-sonnet") */
  model: string
  /** Formatted token count (e.g., "45k") */
  tokens: string
  /** Token threshold status for color coding */
  tokensStatus: ThresholdStatus
  /** Formatted cost (e.g., "$0.15") */
  cost: string
  /** Cost threshold status for color coding */
  costStatus: ThresholdStatus
  /** Formatted duration (e.g., "12m") */
  duration: string
  /** Current working directory (shortened) */
  cwd: string
  /** Git branch with optional icon (e.g., "⎇ main" or "(main)") */
  branch: string
  /** Display mode determines summary content */
  displayMode: DisplayMode
  /** Summary text (varies by display mode) */
  summary: string
  /** Session title from summary */
  title: string
  /** Snarky comment if available */
  snarkyComment?: string
}

// ============================================================================
// Service Result Types
// ============================================================================

/**
 * Result from StateReader operations.
 * Indicates whether data was fresh or stale.
 */
export interface StateReadResult<T> {
  data: T
  source: 'fresh' | 'stale' | 'default'
  /** File mtime if available */
  mtime?: number
}

/**
 * Render result from StatuslineService.
 */
export interface StatuslineRenderResult {
  /** Rendered ANSI string for terminal */
  text: string
  /** Display mode used */
  displayMode: DisplayMode
  /** Whether stale data was used */
  staleData: boolean
  /** Raw view model (for --format json) */
  viewModel: StatuslineViewModel
}

// ============================================================================
// Default Values
// ============================================================================

export const EMPTY_SESSION_STATE: SessionState = {
  sessionId: '',
  timestamp: 0,
  tokens: 0,
  cost: 0,
  durationMs: 0,
  modelName: 'unknown',
}

export const EMPTY_SESSION_SUMMARY: SessionSummaryState = {
  session_id: '',
  timestamp: new Date().toISOString(),
  session_title: '',
  session_title_confidence: 0,
  latest_intent: '',
  latest_intent_confidence: 0,
}

export const DEFAULT_PLACEHOLDERS = {
  newSession: 'New session',
  awaitingFirstTurn: 'Awaiting first turn',
} as const
