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
 * Union type for all hook inputs.
 * CLI parses this to extract common fields.
 */
export const HookInputSchema = z.union([
  UserPromptSubmitInputSchema,
  PreToolUseInputSchema,
  PostToolUseInputSchema,
  StopInputSchema,
  SessionStartInputSchema,
  SessionEndInputSchema,
  PreCompactInputSchema,
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
export type HookInput = z.infer<typeof HookInputSchema>

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
  /** Raw parsed payload for hook-specific fields */
  raw: Record<string, unknown>
}
