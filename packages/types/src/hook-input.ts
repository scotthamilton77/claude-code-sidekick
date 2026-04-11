/**
 * Hook Input Type Definitions
 *
 * Types for the JSON payload that Claude Code sends to hooks via stdin.
 * Per CLI.md §3.1.1, the CLI extracts session_id and other fields from this JSON.
 *
 * @see docs/design/CLI.md §3.1.1 Hook Input Structure
 * @see https://code.claude.com/docs/en/hooks (official Claude Code hooks documentation)
 */

import { z } from 'zod'

// ============================================================================
// Hook Input Schema (from Claude Code)
// ============================================================================

/**
 * Common fields present in all hook input payloads from Claude Code.
 * The CLI extracts these fields to:
 * - Correlate logs and events (session_id)
 * - Organize session state files
 * - Route to appropriate handlers
 */
export const HookInputBaseSchema = z.object({
  /** Unique identifier for the current Claude session */
  session_id: z.string(),
  /** Absolute path to the session transcript file */
  transcript_path: z.string(),
  /** Current working directory when hook was triggered (optional for some hooks) */
  cwd: z.string().optional(),
  /** Current permission level: "default", "plan", "acceptEdits", or "bypassPermissions" */
  permission_mode: z.string().optional(),
  /** Name of the triggered hook (e.g., "UserPromptSubmit", "SessionStart") */
  hook_event_name: z.string(),
  /** Unique identifier for the subagent (present when hook fires inside a subagent) */
  agent_id: z.string().optional(),
  /** Agent type/name: "Bash", "Explore", "Plan", or custom (present when inside a subagent) */
  agent_type: z.string().optional(),
})

/**
 * UserPromptSubmit hook input with user's message.
 * Note: Field is `prompt`, not `user_prompt` per official docs.
 */
export const UserPromptSubmitInputSchema = HookInputBaseSchema.extend({
  /** The user's message text */
  prompt: z.string(),
})

/**
 * PreToolUse hook input with tool details.
 */
export const PreToolUseInputSchema = HookInputBaseSchema.extend({
  /** Name of the tool being invoked */
  tool_name: z.string(),
  /** Tool input parameters (object with tool-specific schema) */
  tool_input: z.record(z.string(), z.unknown()),
  /** Unique ID for this tool invocation */
  tool_use_id: z.string(),
})

/**
 * PostToolUse hook input with tool details and response.
 */
export const PostToolUseInputSchema = HookInputBaseSchema.extend({
  /** Name of the tool that was invoked */
  tool_name: z.string(),
  /** Tool input parameters (object with tool-specific schema) */
  tool_input: z.record(z.string(), z.unknown()),
  /** Tool execution result */
  tool_response: z.record(z.string(), z.unknown()),
  /** Unique ID for this tool invocation */
  tool_use_id: z.string(),
})

/**
 * Stop / SubagentStop hook input.
 */
export const StopInputSchema = HookInputBaseSchema.extend({
  /** True if Claude is continuing from a previous stop hook */
  stop_hook_active: z.boolean().optional(),
})

/**
 * SessionStart hook input.
 */
export const SessionStartInputSchema = HookInputBaseSchema.extend({
  /** Trigger source: "startup", "resume", "clear", or "compact" */
  source: z.string().optional(),
})

/**
 * SessionEnd hook input.
 */
export const SessionEndInputSchema = HookInputBaseSchema.extend({
  /** Exit reason: "exit", "clear", "logout", "prompt_input_exit", or "other" */
  reason: z.string().optional(),
})

/**
 * PreCompact hook input.
 */
export const PreCompactInputSchema = HookInputBaseSchema.extend({
  /** Trigger: "manual" or "auto" */
  trigger: z.string().optional(),
  /** Custom instructions from /compact command (empty for auto) */
  custom_instructions: z.string().optional(),
})

/**
 * Notification hook input.
 */
export const NotificationInputSchema = HookInputBaseSchema.extend({
  /** Notification message text */
  message: z.string(),
  /** Type: "permission_prompt", "idle_prompt", "auth_success", or "elicitation_dialog" */
  notification_type: z.string(),
})

/**
 * SubagentStart hook input.
 * Fired when the parent Claude session dispatches an Agent-tool subagent.
 */
export const SubagentStartInputSchema = HookInputBaseSchema.extend({
  /** Unique identifier for the subagent (required per official docs) */
  agent_id: z.string(),
  /** Agent name: "Bash", "Explore", "Plan", or custom agent name */
  agent_type: z.string(),
})

/**
 * SubagentStop hook input.
 * Fired when a subagent terminates.
 */
export const SubagentStopInputSchema = HookInputBaseSchema.extend({
  /** Unique identifier for the subagent */
  agent_id: z.string(),
  /** Agent name */
  agent_type: z.string(),
  /** Path to subagent's own transcript JSONL */
  agent_transcript_path: z.string(),
  /** Text content of the subagent's final response */
  last_assistant_message: z.string(),
  /** Permission mode for the subagent session */
  permission_mode: z.string(),
  /** Optional: whether stop hook is active (probe doc says never populated; official docs show false) */
  stop_hook_active: z.boolean().optional(),
})

// ============================================================================
// Statusline Input Schema (special hook - not routed through hook dispatcher)
// ============================================================================

/**
 * Model information provided by Claude Code in statusline input.
 * @see https://code.claude.com/docs/en/statusline
 */
export const StatuslineModelSchema = z.object({
  /** Full model identifier (e.g., "claude-opus-4-1") */
  id: z.string(),
  /** Human-readable display name (e.g., "Opus") */
  display_name: z.string(),
})

/**
 * Context window usage provided by Claude Code in statusline input.
 */
export const StatuslineContextWindowSchema = z.object({
  /** Total input tokens used in session */
  total_input_tokens: z.number(),
  /** Total output tokens used in session */
  total_output_tokens: z.number().optional(),
  /** Maximum context window size for the model */
  context_window_size: z.number().optional(),
})

/**
 * Cost and duration information provided by Claude Code in statusline input.
 */
export const StatuslineCostSchema = z.object({
  /** Total cost in USD for the session */
  total_cost_usd: z.number(),
  /** Total duration in milliseconds */
  total_duration_ms: z.number().optional(),
  /** Total API request duration in milliseconds */
  total_api_duration_ms: z.number().optional(),
  /** Total lines added in session */
  total_lines_added: z.number().optional(),
  /** Total lines removed in session */
  total_lines_removed: z.number().optional(),
})

/**
 * Workspace information provided by Claude Code in statusline input.
 */
export const StatuslineWorkspaceSchema = z.object({
  /** Current working directory */
  current_dir: z.string(),
  /** Original project directory */
  project_dir: z.string(),
})

/**
 * Statusline hook input from Claude Code.
 * This contains all the metrics data directly, unlike other hooks.
 *
 * @see https://code.claude.com/docs/en/statusline
 */
export const StatuslineInputSchema = z.object({
  /** Hook event name (always "Status" for statusline) */
  hook_event_name: z.literal('Status').optional(),
  /** Session identifier */
  session_id: z.string(),
  /** Path to transcript file */
  transcript_path: z.string().optional(),
  /** Current working directory */
  cwd: z.string().optional(),
  /** Claude Code version */
  version: z.string().optional(),
  /** Model information with id and display_name */
  model: StatuslineModelSchema,
  /** Workspace paths */
  workspace: StatuslineWorkspaceSchema.optional(),
  /** Cost and duration metrics */
  cost: StatuslineCostSchema.optional(),
  /** Context window usage */
  context_window: StatuslineContextWindowSchema.optional(),
  /** Output style configuration */
  output_style: z.object({ name: z.string() }).optional(),
})

/**
 * Union type for all hook inputs.
 * CLI parses this to extract common fields.
 * Ordered to match HOOK_NAMES in hook-events.ts so the two stay in lockstep.
 */
export const HookInputSchema = z.union([
  SessionStartInputSchema,
  SessionEndInputSchema,
  UserPromptSubmitInputSchema,
  PreToolUseInputSchema,
  PostToolUseInputSchema,
  StopInputSchema,
  PreCompactInputSchema,
  SubagentStartInputSchema,
  SubagentStopInputSchema,
  NotificationInputSchema,
  HookInputBaseSchema, // Fallback for hooks without extra fields
])

// ============================================================================
// Type Exports
// ============================================================================

export type HookInputBase = z.infer<typeof HookInputBaseSchema>
export type UserPromptSubmitInput = z.infer<typeof UserPromptSubmitInputSchema>
export type PreToolUseInput = z.infer<typeof PreToolUseInputSchema>
export type PostToolUseInput = z.infer<typeof PostToolUseInputSchema>
export type StopInput = z.infer<typeof StopInputSchema>
export type SessionStartInput = z.infer<typeof SessionStartInputSchema>
export type SessionEndInput = z.infer<typeof SessionEndInputSchema>
export type PreCompactInput = z.infer<typeof PreCompactInputSchema>
export type NotificationInput = z.infer<typeof NotificationInputSchema>
export type SubagentStartInput = z.infer<typeof SubagentStartInputSchema>
export type SubagentStopInput = z.infer<typeof SubagentStopInputSchema>
export type HookInput = z.infer<typeof HookInputSchema>

// Statusline types (not part of HookInput union - handled separately)
export type StatuslineModel = z.infer<typeof StatuslineModelSchema>
export type StatuslineContextWindow = z.infer<typeof StatuslineContextWindowSchema>
export type StatuslineCost = z.infer<typeof StatuslineCostSchema>
export type StatuslineWorkspace = z.infer<typeof StatuslineWorkspaceSchema>
export type StatuslineInput = z.infer<typeof StatuslineInputSchema>

/**
 * Parsed hook input with guaranteed common fields.
 * The CLI populates this after parsing stdin JSON.
 */
export interface ParsedHookInput {
  /** Session ID extracted from hook input */
  sessionId: string
  /** Transcript path for session */
  transcriptPath: string
  /** Working directory (may be undefined for some hooks) */
  cwd: string | undefined
  /** Hook event name */
  hookEventName: string
  /** Permission mode */
  permissionMode: string | undefined
  /** Subagent identifier (present when hook fires inside a subagent) */
  agentId?: string
  /** Subagent type/name (present when hook fires inside a subagent) */
  agentType?: string
  /** Raw parsed payload for hook-specific fields */
  raw: Record<string, unknown>
}
