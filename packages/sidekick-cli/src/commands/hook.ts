/**
 * Hook Command Handler
 *
 * Handles hook event dispatch to the Daemon via IPC.
 *
 * Per docs/design/flow.md §5 Complete Hook Flows:
 * 1. CLI receives hook input from Claude Code
 * 2. CLI builds HookEvent from parsed input
 * 3. CLI sends event to Daemon via IPC (hook.invoke)
 * 4. Daemon dispatches to registered handlers
 * 5. CLI formats response for Claude Code
 *
 * @see docs/design/CLI.md §9 Process Model for Hooks
 * @see docs/design/flow.md §5 Complete Hook Flows
 */

import type { Writable } from 'node:stream'
import type { Logger } from '@sidekick/core'
import { IpcService, LogEvents, logEvent } from '@sidekick/core'
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
import { buildCLIContext, registerCLIFeatures } from '../context.js'
import type { RuntimeShell } from '../runtime.js'

/**
 * Hook response from Daemon.
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
 * Valid hook names (PascalCase).
 */
const VALID_HOOK_NAMES = new Set<HookName>([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'PreCompact',
])

/**
 * Validate that a hook event name is a valid PascalCase HookName.
 * Used to validate hookInput.hookEventName from stdin.
 */
export function validateHookName(hookEventName: string): HookName | undefined {
  return VALID_HOOK_NAMES.has(hookEventName as HookName) ? (hookEventName as HookName) : undefined
}

/**
 * Map CLI command (kebab-case) to internal HookName (PascalCase).
 * Used for CLI routing when command is passed as argv (e.g. during testing).
 */
const CLI_COMMAND_TO_HOOK: Record<string, HookName> = {
  'session-start': 'SessionStart',
  'session-end': 'SessionEnd',
  'user-prompt-submit': 'UserPromptSubmit',
  'pre-tool-use': 'PreToolUse',
  'post-tool-use': 'PostToolUse',
  stop: 'Stop',
  'pre-compact': 'PreCompact',
}

/**
 * Shared context for all hook events.
 */
interface EventContext {
  sessionId: string
  timestamp: number
  scope: 'project' | 'user'
  correlationId: string
}

/**
 * Extract tool-related fields from raw hook input.
 * Shared by PreToolUse and PostToolUse events.
 */
function extractToolFields(raw: Record<string, unknown>): {
  toolName: string
  toolInput: Record<string, unknown>
} {
  const toolName = typeof raw.tool_name === 'string' ? raw.tool_name : 'unknown'
  const toolInput =
    typeof raw.tool_input === 'object' && raw.tool_input !== null ? (raw.tool_input as Record<string, unknown>) : {}
  return { toolName, toolInput }
}

/**
 * Build SessionStart hook event.
 */
function buildSessionStartEvent(context: EventContext, input: ParsedHookInput): SessionStartHookEvent {
  const raw = input.raw
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

/**
 * Build SessionEnd hook event.
 */
function buildSessionEndEvent(context: EventContext, input: ParsedHookInput): SessionEndHookEvent {
  const raw = input.raw
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

/**
 * Build UserPromptSubmit hook event.
 */
function buildUserPromptSubmitEvent(context: EventContext, input: ParsedHookInput): UserPromptSubmitHookEvent {
  const raw = input.raw
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

/**
 * Build PreToolUse hook event.
 */
function buildPreToolUseEvent(context: EventContext, input: ParsedHookInput): PreToolUseHookEvent {
  const { toolName, toolInput } = extractToolFields(input.raw)
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

/**
 * Build PostToolUse hook event.
 */
function buildPostToolUseEvent(context: EventContext, input: ParsedHookInput): PostToolUseHookEvent {
  const { toolName, toolInput } = extractToolFields(input.raw)
  const toolResult = input.raw.tool_response ?? null
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

/**
 * Build Stop hook event.
 */
function buildStopEvent(context: EventContext, input: ParsedHookInput): StopHookEvent {
  const raw = input.raw
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

/**
 * Build PreCompact hook event.
 */
function buildPreCompactEvent(context: EventContext, input: ParsedHookInput): PreCompactHookEvent {
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
  const context: EventContext = {
    sessionId: input.sessionId,
    timestamp: Date.now(),
    scope,
    correlationId,
  }

  switch (hookName) {
    case 'SessionStart':
      return buildSessionStartEvent(context, input)
    case 'SessionEnd':
      return buildSessionEndEvent(context, input)
    case 'UserPromptSubmit':
      return buildUserPromptSubmitEvent(context, input)
    case 'PreToolUse':
      return buildPreToolUseEvent(context, input)
    case 'PostToolUse':
      return buildPostToolUseEvent(context, input)
    case 'Stop':
      return buildStopEvent(context, input)
    case 'PreCompact':
      return buildPreCompactEvent(context, input)
  }
}

/**
 * Merge CLI and Daemon hook responses.
 * CLI response takes precedence for reminder fields (blocking, reason, userMessage).
 * additionalContext is concatenated (CLI first, then Daemon).
 */
export function mergeHookResponses(daemonResponse: HookResponse | null, cliResponse: HookResponse): HookResponse {
  const merged: HookResponse = { ...daemonResponse }

  // CLI response takes precedence for these fields
  if (cliResponse.blocking !== undefined) {
    merged.blocking = cliResponse.blocking
  }
  if (cliResponse.reason !== undefined) {
    merged.reason = cliResponse.reason
  }
  if (cliResponse.userMessage !== undefined) {
    merged.userMessage = cliResponse.userMessage
  }

  // Concatenate additionalContext (CLI first, then Daemon)
  if (cliResponse.additionalContext !== undefined) {
    merged.additionalContext = daemonResponse?.additionalContext
      ? `${cliResponse.additionalContext}\n\n${daemonResponse.additionalContext}`
      : cliResponse.additionalContext
  }

  return merged
}

export interface HandleHookOptions {
  projectRoot: string
  sessionId: string
  hookInput: ParsedHookInput
  correlationId: string
  scope: 'project' | 'user'
  runtime: RuntimeShell
}

export interface HandleHookResult {
  exitCode: number
  output: string
}

/**
 * Handle a hook command by dispatching to Daemon.
 *
 * Process flow:
 * 1. Build typed HookEvent from parsed input
 * 2. Dispatch to Daemon via IPC (hook.invoke)
 * 3. Format response for Claude Code
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
  const { projectRoot, hookInput, correlationId, scope, runtime } = options
  const startTime = Date.now()

  // Log HookReceived event
  const logContext = {
    sessionId: hookInput.sessionId,
    scope,
    correlationId,
    hook: hookName,
  }
  logEvent(logger, LogEvents.hookReceived(logContext, { cwd: hookInput.cwd, mode: 'hook' }))

  // Build typed HookEvent from parsed input
  const event = buildHookEvent(hookName, hookInput, correlationId, scope)

  logger.debug('Dispatching hook event to daemon', {
    hook: hookName,
    sessionId: hookInput.sessionId,
  })

  // Build CLIContext and register consumption handlers
  const cliContext = buildCLIContext({
    runtime,
    sessionId: hookInput.sessionId,
    transcriptPath: hookInput.transcriptPath,
  })
  registerCLIFeatures(cliContext)

  // Create IpcService for daemon communication
  const ipcService = new IpcService(projectRoot, logger)

  try {
    // Send hook event to daemon via IPC
    // Graceful degradation: returns null if daemon unavailable
    const daemonResponse = await ipcService.send<HookResponse>('hook.invoke', {
      hook: hookName,
      event,
    })

    if (daemonResponse === null) {
      logger.warn('Daemon unavailable for hook', { hook: hookName })
    } else {
      logger.debug('Received hook response from daemon', {
        hook: hookName,
        hasBlocking: daemonResponse?.blocking,
        hasContext: !!daemonResponse?.additionalContext,
      })
    }

    // Invoke CLI-side consumption handlers
    const cliResponse = await cliContext.handlers.invokeHook(hookName, event)

    logger.debug('CLI handlers invoked', {
      hook: hookName,
      hasCliResponse: !!cliResponse,
      hasBlocking: cliResponse?.blocking,
    })

    // Merge responses (CLI takes precedence)
    const mergedResponse = mergeHookResponses(daemonResponse, cliResponse ?? {})

    // Output internal HookResponse format (shell scripts will translate to Claude Code format)
    const outputStr = JSON.stringify(mergedResponse)
    stdout.write(`${outputStr}\n`)

    // Log HookCompleted event
    logEvent(
      logger,
      LogEvents.hookCompleted(
        logContext,
        { durationMs: Date.now() - startTime },
        { reminderReturned: !!mergedResponse.additionalContext }
      )
    )

    return { exitCode: 0, output: outputStr }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    logger.error('Hook dispatch failed', { hook: hookName, error: error.message })

    // Log HookCompleted event (failure case)
    logEvent(logger, LogEvents.hookCompleted(logContext, { durationMs: Date.now() - startTime }))

    // Return empty response to allow action to proceed
    stdout.write('{}\n')
    return { exitCode: 0, output: '{}' }
  } finally {
    ipcService.close()
  }
}
/**
 * Check if a CLI command string represents a hook command.
 * Handles kebab-case CLI commands (e.g., 'session-start').
 */
export function isHookCommand(command: string): boolean {
  return CLI_COMMAND_TO_HOOK[command] !== undefined
}

/**
 * Get the HookName for a CLI command, or undefined if not a hook.
 * Maps kebab-case CLI commands to PascalCase HookName.
 */
export function getHookName(command: string): HookName | undefined {
  return CLI_COMMAND_TO_HOOK[command]
}
