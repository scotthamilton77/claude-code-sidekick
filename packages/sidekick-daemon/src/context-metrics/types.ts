/**
 * Context Metrics Types
 *
 * Re-exports types from @sidekick/types and defines internal types
 * for parsing Claude Code's /context command output.
 *
 */

// Re-export schemas and types from @sidekick/types
export {
  BaseTokenMetricsStateSchema,
  ProjectContextMetricsSchema,
  SessionContextMetricsSchema,
  DEFAULT_BASE_METRICS,
  DEFAULT_PROJECT_METRICS,
  type BaseTokenMetricsState,
  type ProjectContextMetrics,
  type SessionContextMetrics,
} from '@sidekick/types'

// ============================================================================
// Parsed Context Table (internal to context-metrics)
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
