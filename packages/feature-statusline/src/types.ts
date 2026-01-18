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
  TranscriptMetricsStateSchema,
  SessionSummaryStateSchema,
  LogMetricsStateSchema,
  SnarkyMessageStateSchema,
  EMPTY_LOG_METRICS,
  SESSION_SUMMARY_PLACEHOLDERS,
  type ResumeMessageState,
  type TranscriptMetricsState,
  type SessionSummaryState,
  type LogMetricsState,
  type SnarkyMessageState,
} from '@sidekick/types'
import { z } from 'zod'

export {
  ResumeMessageStateSchema,
  TranscriptMetricsStateSchema,
  SessionSummaryStateSchema,
  LogMetricsStateSchema,
  SnarkyMessageStateSchema,
  EMPTY_LOG_METRICS,
  type ResumeMessageState,
  type TranscriptMetricsState,
  type SessionSummaryState,
  type LogMetricsState,
  type SnarkyMessageState,
}

// ============================================================================
// Symbol Mode Types
// ============================================================================

/**
 * Normalized symbol mode for statusline display.
 * - "full": All Unicode symbols including emojis (🪙, 📁, ⚠, ✗, ⎇)
 * - "safe": BMP-only symbols that avoid VS Code terminal width issues (△, ×, ∗)
 * - "ascii": ASCII-only characters for maximum compatibility
 */
export type SymbolMode = 'full' | 'safe' | 'ascii'

/**
 * Normalize useNerdFonts config value to a SymbolMode.
 * Handles backward compatibility with boolean values.
 */
export function normalizeSymbolMode(value: boolean | 'full' | 'safe' | 'ascii'): SymbolMode {
  if (value === true || value === 'full') return 'full'
  if (value === false || value === 'ascii') return 'ascii'
  return value // 'safe'
}

// ============================================================================
// Configuration Schema
// ============================================================================

/**
 * Zod schema for statusline configuration.
 * Matches docs/design/FEATURE-STATUSLINE.md §4 Configuration Schema.
 * All defaults come from assets/sidekick/defaults/features/statusline.defaults.yaml
 */
export const StatuslineConfigSchema = z.object({
  enabled: z.boolean(),
  format: z.string(),
  thresholds: z.object({
    tokens: z.object({
      warning: z.number(),
      critical: z.number(),
    }),
    cost: z.object({
      warning: z.number(),
      critical: z.number(),
    }),
    logs: z.object({
      /** Warning count threshold for yellow indicator */
      warning: z.number(),
      /** Error count threshold for red indicator (any error = critical) */
      critical: z.number(),
    }),
  }),
  theme: z.object({
    /**
     * Icon/symbol mode for statusline display:
     * - true or "full": All Unicode symbols including emojis (🪙, 📁, ⚠, ✗, ⎇)
     * - "safe": BMP-only symbols that avoid VS Code terminal width issues (△, ×, ∗)
     * - false or "ascii": ASCII-only characters for maximum compatibility
     */
    useNerdFonts: z.union([z.boolean(), z.enum(['full', 'safe', 'ascii'])]),
    supportedMarkdown: z.object({
      /** Convert **text** to ANSI bold */
      bold: z.boolean(),
      /** Convert *text* or _text_ to ANSI italic */
      italic: z.boolean(),
      /** Convert `text` to ANSI dim */
      code: z.boolean(),
    }),
    colors: z.object({
      model: z.string(),
      tokens: z.string(),
      title: z.string(),
      summary: z.string(),
      cwd: z.string(),
      duration: z.string(),
      branch: z.string().optional(), // Optional: if set, overrides pattern-based coloring
    }),
  }),
})

export type StatuslineConfig = z.infer<typeof StatuslineConfigSchema>

/**
 * Default statusline config for test fixtures.
 * Production code loads from assets/sidekick/defaults/features/statusline.defaults.yaml
 * Values here must match the YAML file.
 */
export const DEFAULT_STATUSLINE_CONFIG: StatuslineConfig = {
  enabled: true,
  format: '[{model}] | {contextBar} {tokenPercentageActual} | {logs} | {cwd}{branch}\n{title} | {summary}',
  thresholds: {
    tokens: { warning: 100000, critical: 160000 },
    cost: { warning: 0.5, critical: 1.0 },
    logs: { warning: 5, critical: 1 },
  },
  theme: {
    useNerdFonts: 'safe',
    supportedMarkdown: { bold: true, italic: true, code: true },
    colors: {
      model: 'blue',
      tokens: 'green',
      title: 'blue',
      summary: 'magenta',
      cwd: 'white',
      duration: 'white',
    },
  },
}

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
export type DisplayMode = 'resume_message' | 'empty_summary' | 'session_summary'

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
  /** Context tokens used (conversation content) */
  contextTokens: number
  /** Autocompact buffer tokens (~45k reserved) */
  bufferTokens: number
  /** Total tokens (context + buffer) - matches /context report */
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
  /** Context window size formatted (e.g., "200k") */
  contextWindow: string
  /** Actual token usage without compaction buffer (e.g., "45k") */
  tokenUsageActual: string
  /** Effective token usage with compaction buffer (e.g., "90k") */
  tokenUsageEffective: string
  /** Actual usage as percentage of context window (e.g., "22%") */
  tokenPercentageActual: string
  /** Effective usage as percentage of context window (e.g., "45%") */
  tokenPercentageEffective: string
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
  /** Warning count this session */
  warningCount: number
  /** Error count this session */
  errorCount: number
  /** Log status for color coding (normal/warning/critical) */
  logStatus: ThresholdStatus
  /** Persona name for session (empty if no persona or disabled) */
  personaName: string
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

export const EMPTY_TRANSCRIPT_STATE: TranscriptMetricsState = {
  sessionId: '',
  lastUpdatedAt: 0,
  tokens: {
    input: 0,
    output: 0,
    total: 0,
    cacheCreation: 0,
    cacheRead: 0,
  },
  currentContextTokens: null,
  isPostCompactIndeterminate: false,
}

export const EMPTY_SESSION_SUMMARY: SessionSummaryState = {
  session_id: '',
  timestamp: new Date().toISOString(),
  session_title: '',
  session_title_confidence: 0,
  latest_intent: '',
  latest_intent_confidence: 0,
}

/**
 * Default placeholder values for statusline display.
 * Derived from canonical SESSION_SUMMARY_PLACEHOLDERS in @sidekick/types.
 */
export const DEFAULT_PLACEHOLDERS = {
  newSession: SESSION_SUMMARY_PLACEHOLDERS.newSession,
  awaitingFirstTurn: SESSION_SUMMARY_PLACEHOLDERS.awaitingFirstPrompt,
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
    // Current context window tokens (from API usage, resets on compact)
    currentContextTokens: z.number().nullable(),
    // True after compact_boundary detected until first usage block arrives
    isPostCompactIndeterminate: z.boolean(),
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
    currentContextTokens: null,
    isPostCompactIndeterminate: false,
    toolsPerTurn: 0,
    lastProcessedLine: 0,
    lastUpdatedAt: 0,
  },
  persistedAt: 0,
}
