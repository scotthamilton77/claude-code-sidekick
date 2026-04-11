/**
 * Hook Event Type Definitions
 *
 * Hook events from Claude Code's hook system.
 * Also contains EventContext (shared by both hook and transcript events).
 *
 * @see docs/design/flow.md §3.2 Event Schema (source of truth)
 * @see docs/design/CORE-RUNTIME.md §3.5 Handler Registration
 */

// ============================================================================
// Event Context
// ============================================================================

/**
 * Base context shared by all events.
 * Provides correlation and tracing capabilities.
 */
export interface EventContext {
  /** Required: correlates all events in a session */
  sessionId: string
  /** Unix timestamp (ms) */
  timestamp: number
  /** Unique ID for the CLI command execution */
  correlationId?: string
  /** Links causally-related events (e.g., hook → handler → staged reminder) */
  traceId?: string
  /** Subagent identifier (present when event fires inside a subagent) */
  agentId?: string
  /** Subagent type/name (present when event fires inside a subagent) */
  agentType?: string
}

/**
 * Narrowed context for subagent hook events (SubagentStart, SubagentStop).
 * Enforces D1: context.agentId and context.agentType are required and authoritative.
 * Payload.agentId/agentType are convenience copies of these required fields.
 */
export type SubagentEventContext = EventContext & {
  agentId: string
  agentType: string
}

// ============================================================================
// Hook Events - from Claude Code
// ============================================================================

/**
 * All supported hook names as a const tuple.
 * Single source of truth for both the HookName type and Zod validation.
 */
export const HOOK_NAMES = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'PreCompact',
  'SubagentStart',
  'SubagentStop',
] as const

/**
 * All supported hook names.
 * Derived from Claude Code's hook system.
 */
export type HookName = (typeof HOOK_NAMES)[number]

export interface SessionStartHookEvent {
  kind: 'hook'
  hook: 'SessionStart'
  context: EventContext
  payload: {
    startType: 'startup' | 'resume' | 'clear' | 'compact'
    transcriptPath: string
  }
}

export interface SessionEndHookEvent {
  kind: 'hook'
  hook: 'SessionEnd'
  context: EventContext
  payload: {
    endReason: 'clear' | 'logout' | 'prompt_input_exit' | 'other'
  }
}

export interface UserPromptSubmitHookEvent {
  kind: 'hook'
  hook: 'UserPromptSubmit'
  context: EventContext
  payload: {
    /** User's prompt text */
    prompt: string
    /** Path to transcript file */
    transcriptPath: string
    /** Current working directory */
    cwd: string
    /** Permission mode (e.g., "default") */
    permissionMode: string
  }
}

export interface PreToolUseHookEvent {
  kind: 'hook'
  hook: 'PreToolUse'
  context: EventContext
  payload: {
    toolName: string
    toolInput: Record<string, unknown>
  }
}

export interface PostToolUseHookEvent {
  kind: 'hook'
  hook: 'PostToolUse'
  context: EventContext
  payload: {
    toolName: string
    toolInput: Record<string, unknown>
    toolResult: unknown
  }
}

export interface StopHookEvent {
  kind: 'hook'
  hook: 'Stop'
  context: EventContext
  payload: {
    /** Path to transcript file */
    transcriptPath: string
    /** Permission mode (e.g., "default") */
    permissionMode: string
    /** Whether stop hook is active */
    stopHookActive: boolean
  }
}

export interface PreCompactHookEvent {
  kind: 'hook'
  hook: 'PreCompact'
  context: EventContext
  payload: {
    /** Path to current transcript */
    transcriptPath: string
    /** Path where CLI copied snapshot */
    transcriptSnapshotPath: string
  }
}

export interface SubagentStartHookEvent {
  kind: 'hook'
  hook: 'SubagentStart'
  context: SubagentEventContext
  payload: {
    /** Path to parent transcript file */
    transcriptPath: string
    /** Unique identifier for the subagent (convenience copy — same value as context.agentId) */
    agentId: string
    /** Agent type/name (convenience copy — same value as context.agentType) */
    agentType: string
  }
}

export interface SubagentStopHookEvent {
  kind: 'hook'
  hook: 'SubagentStop'
  context: SubagentEventContext
  payload: {
    /** Path to parent transcript file */
    transcriptPath: string
    /** Permission mode for the subagent session */
    permissionMode: string
    /** Unique identifier for the subagent (convenience copy — same value as context.agentId) */
    agentId: string
    /** Agent type/name (convenience copy — same value as context.agentType) */
    agentType: string
    /** Path to the subagent's own transcript JSONL */
    agentTranscriptPath: string
    /** Text content of the subagent's final response */
    lastAssistantMessage: string
    /** Whether stop hook is active (optional per docs/probe divergence) */
    stopHookActive?: boolean
  }
}

/**
 * Union of all hook event types.
 * Discriminated by the `hook` field.
 */
export type HookEvent =
  | SessionStartHookEvent
  | SessionEndHookEvent
  | UserPromptSubmitHookEvent
  | PreToolUseHookEvent
  | PostToolUseHookEvent
  | StopHookEvent
  | PreCompactHookEvent
  | SubagentStartHookEvent
  | SubagentStopHookEvent

// ============================================================================
// Hook-Specific Type Guards
// ============================================================================

export function isSessionStartEvent(event: HookEvent): event is SessionStartHookEvent {
  return event.hook === 'SessionStart'
}

export function isSessionEndEvent(event: HookEvent): event is SessionEndHookEvent {
  return event.hook === 'SessionEnd'
}

export function isUserPromptSubmitEvent(event: HookEvent): event is UserPromptSubmitHookEvent {
  return event.hook === 'UserPromptSubmit'
}

export function isPreToolUseEvent(event: HookEvent): event is PreToolUseHookEvent {
  return event.hook === 'PreToolUse'
}

export function isPostToolUseEvent(event: HookEvent): event is PostToolUseHookEvent {
  return event.hook === 'PostToolUse'
}

export function isStopEvent(event: HookEvent): event is StopHookEvent {
  return event.hook === 'Stop'
}

export function isPreCompactEvent(event: HookEvent): event is PreCompactHookEvent {
  return event.hook === 'PreCompact'
}

export function isSubagentStartEvent(event: HookEvent): event is SubagentStartHookEvent {
  return event.hook === 'SubagentStart'
}

export function isSubagentStopEvent(event: HookEvent): event is SubagentStopHookEvent {
  return event.hook === 'SubagentStop'
}
