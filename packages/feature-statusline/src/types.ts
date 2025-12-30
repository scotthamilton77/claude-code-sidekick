/**
 * Type definitions and Zod schemas for Statusline feature
 *
 * Defines configuration, state file schemas, and view model types
 * for rendering the statusline.
 *
 * @see docs/design/FEATURE-STATUSLINE.md
 */

import {
  FirstPromptSummaryStateSchema,
  ResumeMessageStateSchema,
  SessionMetricsStateSchema,
  SessionSummaryStateSchema,
  type FirstPromptSummaryState,
  type ResumeMessageState,
  type SessionMetricsState,
  type SessionSummaryState,
} from '@sidekick/types'
import { z } from 'zod'

export {
  FirstPromptSummaryStateSchema,
  ResumeMessageStateSchema,
  SessionMetricsStateSchema,
  SessionSummaryStateSchema,
  type FirstPromptSummaryState,
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
  format: z.string().default('[{model}] | {contextBar} {tokens} | {cwd}{branch} | {summary}'),
  /** Confidence threshold for preferring session summary over first-prompt */
  confidenceThreshold: z.number().default(0.6),
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
 * Context bar status for color coding based on proximity to compaction.
 */
export type ContextBarStatus = 'low' | 'medium' | 'high'

/**
 * Context usage data for the context bar visualization.
 */
export interface ContextUsageData {
  /** Total tokens used (input + output) */
  totalTokens: number
  /** Context window size */
  contextWindowSize: number
  /** Effective limit before autocompact (~77.5% of window) */
  effectiveLimit: number
  /** Usage as fraction of effective limit (0-1+) */
  usageFraction: number
  /** Status for color coding */
  status: ContextBarStatus
}

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
  /** Git branch with icon (e.g., "⎇ main") */
  branch: string
  /** Color name for branch based on pattern (main=green, feature=blue, hotfix=red, other=magenta) */
  branchColor: string
  /** Display mode determines summary content */
  displayMode: DisplayMode
  /** Summary text (varies by display mode) */
  summary: string
  /** Session title from summary */
  title: string
  /** Snarky comment if available */
  snarkyComment?: string
  /** Context usage data for bar visualization (optional - only when hook provides context_window) */
  contextUsage?: ContextUsageData
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

/**
 * Schema for transcript-metrics.json written by TranscriptService.
 * Must match TranscriptMetrics interface from @sidekick/types.
 */
export const PersistedTranscriptStateSchema = z.object({
  sessionId: z.string(),
  metrics: z.object({
    // Turn-level metrics
    turnCount: z.number(),
    toolsThisTurn: z.number(),
    // Session-level metrics
    toolCount: z.number(),
    messageCount: z.number(),
    // Token metrics
    tokenUsage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
      cacheCreationInputTokens: z.number(),
      cacheReadInputTokens: z.number(),
      cacheTiers: z
        .object({
          ephemeral5mInputTokens: z.number(),
          ephemeral1hInputTokens: z.number(),
        })
        .optional(),
      serviceTierCounts: z.record(z.string(), z.number()).optional(),
      byModel: z
        .record(
          z.string(),
          z.object({
            inputTokens: z.number(),
            outputTokens: z.number(),
            requestCount: z.number(),
          })
        )
        .optional(),
    }),
    // Current context tokens (resets on clear/compact) - optional for backward compat
    currentContextTokens: z
      .object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        totalTokens: z.number(),
      })
      .optional(),
    // Derived ratios
    toolsPerTurn: z.number(),
    // Watermarks
    lastProcessedLine: z.number(),
    lastUpdatedAt: z.number(),
  }),
  persistedAt: z.number(),
})

export type PersistedTranscriptState = z.infer<typeof PersistedTranscriptStateSchema>

export const EMPTY_PERSISTED_STATE: PersistedTranscriptState = {
  sessionId: '',
  metrics: {
    turnCount: 0,
    toolsThisTurn: 0,
    toolCount: 0,
    messageCount: 0,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    toolsPerTurn: 0,
    lastProcessedLine: 0,
    lastUpdatedAt: 0,
  },
  persistedAt: 0,
}
