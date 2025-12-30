/**
 * Context Metrics Types and Schemas
 *
 * Defines types for tracking Claude Code's context window overhead:
 * - System prompt tokens
 * - System tools tokens
 * - MCP tools tokens
 * - Custom agents tokens
 * - Memory files tokens
 * - Autocompact buffer tokens
 *
 * @see METRICS_PLAN.md
 */

import { z } from 'zod'

// ============================================================================
// Base Token Metrics (Captured once per install, global)
// ============================================================================

/**
 * Source of where metrics were captured from.
 */
export type MetricsSource = 'defaults' | 'context_command'

/**
 * Base token metrics that are consistent across projects.
 * Captured once via `claude -p "/context"` and stored globally.
 *
 * Location: `~/.sidekick/state/base-token-metrics.json`
 */
export const BaseTokenMetricsStateSchema = z.object({
  /** System prompt tokens (~3.2k) */
  systemPromptTokens: z.number(),
  /** System tools tokens (~17.9k) */
  systemToolsTokens: z.number(),
  /** Autocompact buffer tokens (~45k reserved) */
  autocompactBufferTokens: z.number(),
  /** Unix timestamp (ms) when captured */
  capturedAt: z.number(),
  /** Source of the metrics */
  capturedFrom: z.enum(['defaults', 'context_command']),
  /** Session ID used for capture (if from context_command) */
  sessionId: z.string().optional(),
})

export type BaseTokenMetricsState = z.infer<typeof BaseTokenMetricsStateSchema>

// ============================================================================
// Project Context Metrics (Per-project, variable)
// ============================================================================

/**
 * Project-specific context metrics that vary per-project.
 * Updated when /context command output is observed in transcripts.
 *
 * Location: `.sidekick/state/project-context-metrics.json`
 */
export const ProjectContextMetricsSchema = z.object({
  /** MCP tools tokens (variable per project) */
  mcpToolsTokens: z.number(),
  /** Custom agents tokens (variable per project) */
  customAgentsTokens: z.number(),
  /** Memory files tokens (minimum seen - baseline for project) */
  memoryFilesTokens: z.number(),
  /** Unix timestamp (ms) of last update */
  lastUpdatedAt: z.number(),
})

export type ProjectContextMetrics = z.infer<typeof ProjectContextMetricsSchema>

// ============================================================================
// Session Context Metrics (Per-session, current values)
// ============================================================================

/**
 * Full context metrics for a specific session.
 * Represents the current state of context usage in that session.
 *
 * Location: `.sidekick/sessions/{id}/state/context-metrics.json`
 */
export const SessionContextMetricsSchema = z.object({
  /** Session identifier */
  sessionId: z.string(),
  /** System prompt tokens */
  systemPromptTokens: z.number(),
  /** System tools tokens */
  systemToolsTokens: z.number(),
  /** MCP tools tokens */
  mcpToolsTokens: z.number(),
  /** Custom agents tokens */
  customAgentsTokens: z.number(),
  /** Memory files tokens (current session value, may be higher than project baseline) */
  memoryFilesTokens: z.number(),
  /** Autocompact buffer tokens */
  autocompactBufferTokens: z.number(),
  /** Total overhead (sum of all above) */
  totalOverheadTokens: z.number(),
  /** Unix timestamp (ms) of last update */
  lastUpdatedAt: z.number(),
})

export type SessionContextMetrics = z.infer<typeof SessionContextMetricsSchema>

// ============================================================================
// Parsed Context Table
// ============================================================================

/**
 * Parsed /context command output.
 * Contains all categories from the markdown table.
 */
export interface ParsedContextTable {
  /** System prompt tokens */
  systemPrompt: number
  /** System tools tokens */
  systemTools: number
  /** MCP tools tokens (may be 0 if no MCP servers) */
  mcpTools: number
  /** Custom agents tokens (may be 0 if no custom agents) */
  customAgents: number
  /** Memory files tokens */
  memoryFiles: number
  /** Messages tokens (conversation history) */
  messages: number
  /** Autocompact buffer tokens */
  autocompactBuffer: number
  /** Total context window size */
  contextWindowSize: number
  /** Total tokens used */
  totalTokens: number
}

// ============================================================================
// Defaults
// ============================================================================

/**
 * Default base token metrics.
 * Used when real capture hasn't been performed yet.
 *
 * Values based on observed Claude Code /context output:
 * - System prompt: ~3.2k tokens
 * - System tools: ~17.9k tokens
 * - Autocompact buffer: ~45k tokens (reserved for context management)
 */
export const DEFAULT_BASE_METRICS: BaseTokenMetricsState = {
  systemPromptTokens: 3200,
  systemToolsTokens: 17900,
  autocompactBufferTokens: 45000,
  capturedAt: 0,
  capturedFrom: 'defaults',
}

/**
 * Default project context metrics.
 * Used when project hasn't been analyzed yet.
 */
export const DEFAULT_PROJECT_METRICS: ProjectContextMetrics = {
  mcpToolsTokens: 0,
  customAgentsTokens: 0,
  memoryFilesTokens: 0,
  lastUpdatedAt: 0,
}
