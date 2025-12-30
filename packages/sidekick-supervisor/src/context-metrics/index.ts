/**
 * Context Metrics Module
 *
 * Provides visibility into Claude Code's context window overhead:
 * - System prompt tokens
 * - System tools tokens
 * - MCP tools tokens
 * - Custom agents tokens
 * - Memory files tokens
 * - Autocompact buffer tokens
 */

// Types and schemas
export {
  type BaseTokenMetricsState,
  type ProjectContextMetrics,
  type SessionContextMetrics,
  type ParsedContextTable,
  type MetricsSource,
  BaseTokenMetricsStateSchema,
  ProjectContextMetricsSchema,
  SessionContextMetricsSchema,
  DEFAULT_BASE_METRICS,
  DEFAULT_PROJECT_METRICS,
} from './types.js'

// Transcript parser
export {
  parseContextTable,
  parseTokenCount,
  isContextCommandOutput,
  extractContextOutput,
} from './transcript-parser.js'

// Service
export {
  ContextMetricsService,
  createContextMetricsService,
  type ContextMetricsServiceConfig,
} from './context-metrics-service.js'
