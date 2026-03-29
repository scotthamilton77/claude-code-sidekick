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

// Hook types (extracted from statusline-service.ts)
export type {
  ClaudeCodeStatusInput,
  ClaudeCodeModel,
  ClaudeCodeWorkspace,
  ClaudeCodeOutputStyle,
  ClaudeCodeCost,
  ClaudeCodeCurrentUsage,
  ClaudeCodeContextWindow,
  ClaudeCodeWorktree,
} from './hook-types.js'

// ANSI utilities
export { stripAnsi, visibleLength } from './ansi-utils.js'

// Truncation strategies
export { truncateSuffix, truncatePrefix, truncatePath } from './truncation.js'

// Token resolution (extracted from StatuslineService.buildViewModel)
export { resolveEffectiveTokens, type TokenResolutionResult } from './token-resolution.js'

// Resume discovery (extracted from state-reader.ts)
export {
  discoverPreviousResumeMessage as discoverPreviousResumeMessageDI,
  projectRootFromSessionsDir,
  type DiscoveryResult,
  type ResumeDiscoveryConfig,
} from './resume-discovery.js'

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
export { StatuslineService, createStatuslineService, type StatuslineServiceConfig } from './statusline-service.js'
export {
  readContextOverhead,
  getDefaultOverhead,
  type ContextOverhead,
  type ContextOverheadReaderConfig,
} from './context-overhead-reader.js'
