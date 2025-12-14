/**
 * Hook Command Handler
 *
 * Handles hook event dispatch to the Supervisor via IPC.
 * Implements Phase 8 of the roadmap: CLI→Supervisor Event Dispatch.
 *
 * Per docs/design/flow.md §5 Complete Hook Flows:
 * 1. CLI receives hook input from Claude Code
 * 2. CLI builds HookEvent from parsed input
 * 3. CLI sends event to Supervisor via IPC (hook.invoke)
 * 4. Supervisor dispatches to registered handlers
 * 5. CLI formats response for Claude Code
 *
 * @see docs/design/CLI.md §9 Process Model for Hooks
 * @see docs/design/flow.md §5 Complete Hook Flows
 */

import type { Writable } from 'node:stream'
import type { Logger } from '@sidekick/core'
import { IpcService } from '@sidekick/core'
import type {
  HookEvent,
  HookName,
  ParsedHookInput,
  SessionStartHookEvent,
  SessionEndHookEvent,
  UserPromptSubmitHookEvent,
  PreToolUseHookEvent,
  PostToolUseHookEvent,
  StopHookEvent,
  PreCompactHookEvent,
} from '@sidekick/types'

/**
 * Hook response from Supervisor.
 * Contains optional fields that map to Claude Code hook response contract.
 */
export interface HookResponse {
  /** Whether this response blocks the action */
  blocking?: boolean
  /** Reason for blocking (used as stopReason) */
  reason?: string
  /** Additional context to inject into system prompt */
  additionalContext?: string
  /** Message to show to the user */
  userMessage?: string
}

/**
 * Claude Code hook output format.
 * This is what we write to stdout for Claude Code to consume.
 */
export interface ClaudeCodeHookOutput {
  /** Continue or block decision (optional for non-blocking hooks) */
  continue?: boolean
  /** Reason text for blocking or context injection */
  reason?: string
  /** Suppress default behavior for this hook */
  suppressDefaultBehavior?: boolean
}

/**
 * Map hook event name from Claude Code format to internal HookName.
 * Claude Code uses snake_case, we use PascalCase.
 */
function normalizeHookName(hookEventName: string): HookName | undefined {
  const mapping: Record<string, HookName> = {
    SessionStart: 'SessionStart',
    session_start: 'SessionStart',
    SessionEnd: 'SessionEnd',
    session_end: 'SessionEnd',
    UserPromptSubmit: 'UserPromptSubmit',
    user_prompt_submit: 'UserPromptSubmit',
    PreToolUse: 'PreToolUse',
    pre_tool_use: 'PreToolUse',
    PostToolUse: 'PostToolUse',
    post_tool_use: 'PostToolUse',
    Stop: 'Stop',
    stop: 'Stop',
    PreCompact: 'PreCompact',
    pre_compact: 'PreCompact',
  }
  return mapping[hookEventName]
}

/**
 * Build a typed HookEvent from parsed stdin input.
 * Constructs the appropriate discriminated union member based on hook type.
 *
 * @see docs/design/flow.md §3.2 Event Schema
 */
export function buildHookEvent(
  hookName: HookName,
  input: ParsedHookInput,
  correlationId: string,
  scope: 'project' | 'user'
): HookEvent {
  const context = {
    sessionId: input.sessionId,
    timestamp: Date.now(),
    scope,
    correlationId,
  }

  const raw = input.raw

  switch (hookName) {
    case 'SessionStart': {
      // Map 'source' field to 'startType' per flow.md
      const source = typeof raw.source === 'string' ? raw.source : 'startup'
      const startType = source as 'startup' | 'resume' | 'clear' | 'compact'
      return {
        kind: 'hook',
        hook: 'SessionStart',
        context,
        payload: {
          startType,
          transcriptPath: input.transcriptPath,
        },
      } satisfies SessionStartHookEvent
    }

    case 'SessionEnd': {
      const reason = typeof raw.reason === 'string' ? raw.reason : 'other'
      return {
        kind: 'hook',
        hook: 'SessionEnd',
        context,
        payload: {
          endReason: reason as 'clear' | 'logout' | 'prompt_input_exit' | 'other',
        },
      } satisfies SessionEndHookEvent
    }

    case 'UserPromptSubmit': {
      const prompt = typeof raw.prompt === 'string' ? raw.prompt : ''
      const permissionMode = input.permissionMode ?? 'default'
      return {
        kind: 'hook',
        hook: 'UserPromptSubmit',
        context,
        payload: {
          prompt,
          transcriptPath: input.transcriptPath,
          cwd: input.cwd ?? process.cwd(),
          permissionMode,
        },
      } satisfies UserPromptSubmitHookEvent
    }

    case 'PreToolUse': {
      const toolName = typeof raw.tool_name === 'string' ? raw.tool_name : 'unknown'
      const toolInput =
        typeof raw.tool_input === 'object' && raw.tool_input !== null ? (raw.tool_input as Record<string, unknown>) : {}
      return {
        kind: 'hook',
        hook: 'PreToolUse',
        context,
        payload: {
          toolName,
          toolInput,
        },
      } satisfies PreToolUseHookEvent
    }

    case 'PostToolUse': {
      const toolName = typeof raw.tool_name === 'string' ? raw.tool_name : 'unknown'
      const toolInput =
        typeof raw.tool_input === 'object' && raw.tool_input !== null ? (raw.tool_input as Record<string, unknown>) : {}
      const toolResult = raw.tool_response ?? null
      return {
        kind: 'hook',
        hook: 'PostToolUse',
        context,
        payload: {
          toolName,
          toolInput,
          toolResult,
        },
      } satisfies PostToolUseHookEvent
    }

    case 'Stop': {
      const stopHookActive = raw.stop_hook_active === true
      const permissionMode = input.permissionMode ?? 'default'
      return {
        kind: 'hook',
        hook: 'Stop',
        context,
        payload: {
          transcriptPath: input.transcriptPath,
          permissionMode,
          stopHookActive,
        },
      } satisfies StopHookEvent
    }

    case 'PreCompact': {
      // CLI would have already copied transcript before calling this
      // For now, use empty string as we don't have the snapshot path
      return {
        kind: 'hook',
        hook: 'PreCompact',
        context,
        payload: {
          transcriptPath: input.transcriptPath,
          transcriptSnapshotPath: '', // Will be populated by CLI before dispatch
        },
      } satisfies PreCompactHookEvent
    }
  }
}

/**
 * Format supervisor response for Claude Code output.
 *
 * Claude Code expects specific fields per hook type:
 * - UserPromptSubmit: { continue: true } or no output
 * - PreToolUse/PostToolUse: { continue: false, reason: "..." } to block
 * - Stop: { continue: false, reason: "..." } to prevent stop
 *
 * @see https://code.claude.com/docs/en/hooks
 */
function formatClaudeCodeOutput(hookName: HookName, response: HookResponse | null): ClaudeCodeHookOutput | null {
  if (!response) {
    return null
  }

  // If blocking, format as Claude Code expects
  if (response.blocking) {
    return {
      continue: false,
      reason: response.reason ?? response.additionalContext ?? 'Sidekick reminder',
    }
  }

  // If there's additional context to inject (non-blocking reminder)
  if (response.additionalContext || response.userMessage) {
    return {
      continue: true,
      reason: response.additionalContext ?? response.userMessage,
    }
  }

  // No action needed
  return null
}

export interface HandleHookOptions {
  projectRoot: string
  sessionId: string
  hookInput: ParsedHookInput
  correlationId: string
  scope: 'project' | 'user'
}

export interface HandleHookResult {
  exitCode: number
  output: string
}

/**
 * Handle a hook command by dispatching to Supervisor and formatting response.
 *
 * @param hookName - The hook being invoked
 * @param options - Hook execution options
 * @param logger - Logger for diagnostic output
 * @param stdout - Output stream for Claude Code response
 * @returns Exit code and output string
 */
export async function handleHookCommand(
  hookName: HookName,
  options: HandleHookOptions,
  logger: Logger,
  stdout: Writable
): Promise<HandleHookResult> {
  const { projectRoot, hookInput, correlationId, scope } = options

  // Build typed HookEvent from parsed input
  const event = buildHookEvent(hookName, hookInput, correlationId, scope)

  logger.debug('Dispatching hook event to supervisor', {
    hook: hookName,
    sessionId: hookInput.sessionId,
  })

  // Create IpcService for supervisor communication
  const ipcService = new IpcService(projectRoot, logger)

  try {
    // Send hook event to supervisor via IPC
    // Graceful degradation: returns null if supervisor unavailable
    const response = await ipcService.send<HookResponse>('hook.invoke', {
      hook: hookName,
      event,
    })

    if (response === null) {
      // Supervisor unavailable - graceful degradation
      // Log warning and return empty response (allow action to proceed)
      logger.warn('Supervisor unavailable, returning empty hook response', { hook: hookName })
      stdout.write('{}\n')
      return { exitCode: 0, output: '{}' }
    }

    logger.debug('Received hook response from supervisor', {
      hook: hookName,
      hasBlocking: response?.blocking,
      hasContext: !!response?.additionalContext,
    })

    // Format response for Claude Code
    const output = formatClaudeCodeOutput(hookName, response)

    if (output) {
      const outputStr = JSON.stringify(output)
      stdout.write(`${outputStr}\n`)
      return { exitCode: 0, output: outputStr }
    }

    // No output needed (empty response)
    stdout.write('{}\n')
    return { exitCode: 0, output: '{}' }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    logger.error('Hook dispatch failed', { hook: hookName, error: error.message })

    // Return empty response to allow action to proceed
    stdout.write('{}\n')
    return { exitCode: 0, output: '{}' }
  } finally {
    ipcService.close()
  }
}

/**
 * Check if a command string represents a hook command.
 */
export function isHookCommand(command: string): boolean {
  return normalizeHookName(command) !== undefined
}

/**
 * Get the normalized hook name for a command, or undefined if not a hook.
 */
export function getHookName(command: string): HookName | undefined {
  return normalizeHookName(command)
}
