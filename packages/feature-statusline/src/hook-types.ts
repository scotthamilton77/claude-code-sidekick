/**
 * Claude Code Hook Input Types
 *
 * Type declarations for the status hook input from Claude Code.
 * These define the exact structure passed to statusline hooks.
 *
 * Extracted from statusline-service.ts to reduce module size
 * and make types reusable across the feature package.
 *
 * @see https://docs.anthropic.com/en/docs/claude-code/hooks
 */

/**
 * Model information from Claude Code status hook.
 */
export interface ClaudeCodeModel {
  /** Model identifier (e.g., "claude-opus-4-1") */
  id: string
  /** Human-readable display name (e.g., "Opus") */
  display_name: string
}

/**
 * Workspace information from Claude Code status hook.
 */
export interface ClaudeCodeWorkspace {
  /** Current working directory */
  current_dir: string
  /** Original project directory (where Claude Code was launched) */
  project_dir: string
}

/**
 * Output style configuration from Claude Code.
 */
export interface ClaudeCodeOutputStyle {
  /** Style name (e.g., "default") */
  name: string
}

/**
 * Cost and duration metrics from Claude Code status hook.
 */
export interface ClaudeCodeCost {
  /** Total accumulated cost in USD */
  total_cost_usd: number
  /** Total wall-clock duration in milliseconds */
  total_duration_ms: number
  /** Total time spent in API calls in milliseconds */
  total_api_duration_ms: number
  /** Total lines of code added during session */
  total_lines_added: number
  /** Total lines of code removed during session */
  total_lines_removed: number
}

/**
 * Current context window usage from Claude Code.
 */
export interface ClaudeCodeCurrentUsage {
  /** Input tokens in current context */
  input_tokens: number
  /** Output tokens in current context */
  output_tokens: number
  /** Tokens used for cache creation */
  cache_creation_input_tokens: number
  /** Tokens read from cache */
  cache_read_input_tokens: number
}

/**
 * Context window information from Claude Code status hook.
 */
export interface ClaudeCodeContextWindow {
  /** Cumulative input tokens across session */
  total_input_tokens: number
  /** Cumulative output tokens across session */
  total_output_tokens: number
  /** Maximum context window size for the model */
  context_window_size: number
  /** Current context window usage (resets on compact). May be null at session start. */
  current_usage: ClaudeCodeCurrentUsage | null
}

/**
 * Worktree information from Claude Code status hook.
 * Present only when the session is running inside a git worktree.
 */
export interface ClaudeCodeWorktree {
  /** Worktree name */
  name: string
  /** Full path to worktree directory */
  path: string
  /** Branch name in the worktree */
  branch: string
  /** Original working directory (main repo root) */
  original_cwd?: string
  /** Branch name of the original repo */
  original_branch?: string
}

/**
 * Complete status hook input from Claude Code.
 * This is the exact structure passed to statusline hooks.
 *
 * @see https://docs.anthropic.com/en/docs/claude-code/hooks
 */
export interface ClaudeCodeStatusInput {
  /** Event type (always "Status" for statusline hooks) */
  hook_event_name: 'Status'
  /** Session identifier */
  session_id: string
  /** Path to the transcript JSON file */
  transcript_path: string
  /** Current working directory */
  cwd: string
  /** Model information */
  model: ClaudeCodeModel
  /** Workspace paths */
  workspace: ClaudeCodeWorkspace
  /** Claude Code version */
  version: string
  /** Output style configuration */
  output_style: ClaudeCodeOutputStyle
  /** Cost and duration metrics */
  cost: ClaudeCodeCost
  /** Context window information */
  context_window: ClaudeCodeContextWindow
  /** Worktree information (present only when session is in a git worktree) */
  worktree?: ClaudeCodeWorktree
}
