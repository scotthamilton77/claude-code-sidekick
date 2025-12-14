/**
 * Type definitions and Zod schemas for Statusline feature
 *
 * Defines configuration, state file schemas, and view model types
 * for rendering the statusline.
 *
 * @see docs/design/FEATURE-STATUSLINE.md
 */

import {
  ResumeMessageStateSchema,
  SessionMetricsStateSchema,
  SessionSummaryStateSchema,
  type ResumeMessageState,
  type SessionMetricsState,
  type SessionSummaryState,
} from '@sidekick/types'
import { z } from 'zod'

export {
  ResumeMessageStateSchema,
  SessionMetricsStateSchema,
  SessionSummaryStateSchema,
  type ResumeMessageState,
  type SessionMetricsState,
  type SessionSummaryState,
}

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
        .default({
          warning: 100000,
          critical: 160000,
        }),
      cost: z
        .object({
          warning: z.number().default(0.5),
          critical: z.number().default(1.0),
        })
        .default({
          warning: 0.5,
          critical: 1.0,
        }),
    })
    .default({
      tokens: {
        warning: 100000,
        critical: 160000,
      },
      cost: {
        warning: 0.5,
        critical: 1.0,
      },
    }),
  theme: z
    .object({
      useNerdFonts: z.boolean().default(true),
      colors: z
        .object({
          model: z.string().default('blue'),
          tokens: z.string().default('green'),
          summary: z.string().default('magenta'),
        })
        .default({
          model: 'blue',
          tokens: 'green',
          summary: 'magenta',
        }),
    })
    .default({
      useNerdFonts: true,
      colors: {
        model: 'blue',
        tokens: 'green',
        summary: 'magenta',
      },
    }),
})

export type StatuslineConfig = z.infer<typeof StatuslineConfigSchema>

export const DEFAULT_STATUSLINE_CONFIG: StatuslineConfig = StatuslineConfigSchema.parse({})

// ============================================================================
// State File Schemas (Read-Only)
// ============================================================================

// Imported from @sidekick/types

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

export const EMPTY_SESSION_STATE: SessionMetricsState = {
  sessionId: '',
  lastUpdatedAt: 0,
  durationSeconds: 0,
  costUsd: 0,
  primaryModel: 'unknown',
  tokens: {
    input: 0,
    output: 0,
    total: 0,
    cacheCreation: 0,
    cacheRead: 0,
  },
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

export const PersistedTranscriptStateSchema = z.object({
  sessionId: z.string(),
  metrics: z.object({
    tokenUsage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
      cacheCreationInputTokens: z.number(),
      cacheReadInputTokens: z.number(),
    }),
    costUsd: z.number(),
    durationSeconds: z.number(),
    primaryModel: z.string().optional(),
    lastUpdatedAt: z.number(),
  }),
  persistedAt: z.number(),
})

export type PersistedTranscriptState = z.infer<typeof PersistedTranscriptStateSchema>

export const EMPTY_PERSISTED_STATE: PersistedTranscriptState = {
  sessionId: '',
  metrics: {
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    costUsd: 0,
    durationSeconds: 0,
    primaryModel: 'unknown',
    lastUpdatedAt: 0,
  },
  persistedAt: 0,
}
