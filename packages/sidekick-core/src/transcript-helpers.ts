/**
 * Shared helpers for transcript processing modules.
 *
 * Cross-cutting constants, types, and utility functions extracted from
 * TranscriptServiceImpl to avoid circular dependencies between modules.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import type { TranscriptMetrics, TokenUsageMetrics } from '@sidekick/types'

// ============================================================================
// Constants
// ============================================================================

/**
 * Built-in Claude Code slash commands to exclude from transcript excerpts.
 *
 * These are filtered because they're session management, settings, or status queries
 * that don't provide meaningful context for session summary analysis. Custom commands
 * (not in this list) are preserved since their parameters may be task-relevant.
 *
 * Note: /rename is intentionally NOT excluded - the rename parameter can hint at
 * the session's purpose and help the summary analyzer infer a title.
 */
export const EXCLUDED_BUILTIN_COMMANDS = new Set([
  '/add-dir',
  '/agents',
  '/bashes',
  '/bug',
  '/clear',
  '/compact',
  '/config',
  '/context',
  '/cost',
  '/doctor',
  '/exit',
  '/export',
  '/help',
  '/hooks',
  '/ide',
  '/init',
  '/install-github-app',
  '/login',
  '/logout',
  '/mcp',
  '/memory',
  '/model',
  '/output-style',
  '/permissions',
  '/plan',
  '/plugin',
  '/pr-comments',
  '/privacy-settings',
  '/release-notes',
  '/remote-env',
  '/resume',
  '/review',
  '/rewind',
  '/sandbox',
  '/security-review',
  '/stats',
  '/status',
  '/statusline',
  '/teleport',
  '/terminal-setup',
  '/theme',
  '/todos',
  '/usage',
  '/vim',
])

/**
 * Default size for excerpt circular buffer.
 * Must be larger than typical maxLines to account for filtering.
 * 500 entries @ ~50KB avg = ~25MB max memory (acceptable).
 */
export const EXCERPT_BUFFER_SIZE = 500

// ============================================================================
// Types
// ============================================================================

/**
 * Raw usage metadata from Claude Code transcript entries.
 * Extracted from assistant message.usage field.
 */
export interface RawUsageMetadata {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
  service_tier?: string
}

/**
 * Buffered entry for excerpt generation.
 * Stores raw line content to support flexible filtering at query time.
 */
export interface BufferedEntry {
  /** 1-indexed line number in transcript file */
  lineNumber: number
  /** Raw JSON line content */
  rawLine: string
  /** Pre-parsed UUID for summary validation (null if not present) */
  uuid: string | null
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if content is a built-in slash command that should be excluded.
 *
 * Built-in commands are wrapped in <command-name>/cmd</command-name> tags.
 * Custom commands are preserved since their parameters may be task-relevant.
 *
 * @param content - Raw content string to check
 * @returns true if this is an excluded built-in command
 */
export function isExcludedBuiltinCommand(content: string | null): boolean {
  if (!content) return false

  // Match <command-name>/something</command-name> pattern
  const match = content.match(/<command-name>(\/[a-z-]+)<\/command-name>/i)
  if (!match) return false

  const command = match[1].toLowerCase()
  return EXCLUDED_BUILTIN_COMMANDS.has(command)
}

// ============================================================================
// Default Metrics Creators
// ============================================================================

/**
 * Creates default token usage metrics with all zeros.
 */
export function createDefaultTokenUsage(): TokenUsageMetrics {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheTiers: {
      ephemeral5mInputTokens: 0,
      ephemeral1hInputTokens: 0,
    },
    serviceTierCounts: {},
    byModel: {},
  }
}

/**
 * Creates default transcript metrics with all zeros.
 */
export function createDefaultMetrics(): TranscriptMetrics {
  return {
    turnCount: 0,
    toolCount: 0,
    toolsThisTurn: 0,
    messageCount: 0,
    tokenUsage: createDefaultTokenUsage(),
    currentContextTokens: null,
    isPostCompactIndeterminate: false,
    toolsPerTurn: 0,
    lastProcessedLine: 0,
    lastUpdatedAt: 0,
  }
}
