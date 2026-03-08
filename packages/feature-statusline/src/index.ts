/**
 * Statusline Feature
 *
 * Real-time statusline rendering for shell prompt integration.
 * Reads state files prepared by Daemon to display session info,
 * token counts, costs, and contextual summaries.
 *
 * This is a CLI-only feature - it does not register handlers.
 * Invoked directly via `sidekick statusline` command.
 *
 * @see docs/design/FEATURE-STATUSLINE.md
 */

// Types and schemas
export * from './types.js'

// ANSI utilities
export { stripAnsi, visibleLength } from './ansi-utils.js'

// Truncation strategies
export { truncateSuffix, truncatePrefix, truncatePath } from './truncation.js'

// Core components
export { StateReader, createStateReader, type StateReaderConfig } from './state-reader.js'
export { GitProvider, createGitProvider, type GitProviderConfig, type GitBranchResult } from './git-provider.js'
export {
  Formatter,
  createFormatter,
  formatTokens,
  formatCost,
  formatDuration,
  formatBranch,
  getThresholdStatus,
  type FormatterConfig,
} from './formatter.js'
export {
  StatuslineService,
  createStatuslineService,
  type StatuslineServiceConfig,
  type ClaudeCodeStatusInput,
  type ClaudeCodeModel,
  type ClaudeCodeWorkspace,
  type ClaudeCodeOutputStyle,
  type ClaudeCodeCost,
  type ClaudeCodeCurrentUsage,
  type ClaudeCodeContextWindow,
  type ClaudeCodeWorktree,
} from './statusline-service.js'
export {
  readContextOverhead,
  getDefaultOverhead,
  type ContextOverhead,
  type ContextOverheadReaderConfig,
} from './context-overhead-reader.js'
