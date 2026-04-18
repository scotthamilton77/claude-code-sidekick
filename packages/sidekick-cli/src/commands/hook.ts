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
  SubagentStartHookEvent,
  SubagentStopHookEvent,
  SubagentEventContext,
} from '@sidekick/types'
import { HOOK_NAMES } from '@sidekick/types'
import { buildCLIContext, registerCLIFeatures } from '../context.js'
import type { RuntimeShell } from '../runtime.js'

/**
 * Truncate a flat record for log file storage.
 * - Strings longer than 500 chars are sliced with an ellipsis.
 * - Records with more than 20 top-level keys are trimmed to 20 keys with _truncated: true.
 * Only top-level values are processed; nested objects are not inspected.
 */
export function truncateForLog(raw: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(raw)
  const needsKeyTruncation = entries.length > 20
  const result: Record<string, unknown> = {}

  const toProcess = needsKeyTruncation ? entries.slice(0, 20) : entries
  for (const [key, value] of toProcess) {
    if (typeof value === 'string' && value.length > 500) {
      result[key] = value.slice(0, 500) + '…'
    } else {
      result[key] = value
    }
  }

  if (needsKeyTruncation) {
    result['_truncated'] = true
  }

  return result
}

/** Base hook input fields to strip before logging (internal/redundant with context). */
const STRIP_FIELDS = new Set(['session_id', 'transcript_path', 'hook_event_name'])

/**
 * Build the hook-specific input record for logging:
 * strips system base fields, then truncates large values.
 * Exported for testing.
 */
export function buildHookInput(raw: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!STRIP_FIELDS.has(key)) {
      filtered[key] = value
    }
  }
  return truncateForLog(filtered)
}

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
 * Valid hook names (PascalCase). Derived from the canonical HOOK_NAMES tuple
 * in @sidekick/types so adding a hook in one place is enough.
 */
const VALID_HOOK_NAMES: ReadonlySet<HookName> = new Set(HOOK_NAMES)

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
  'subagent-start': 'SubagentStart',
  'subagent-stop': 'SubagentStop',
}

/**
 * Shared context for all hook events.
 */
interface EventContext {
  sessionId: string
  timestamp: number
  correlationId: string
  agentId?: string
  agentType?: string
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
 * Build SubagentStart hook event.
 * Both context.agentId/agentType and payload.agentId/agentType are populated from
 * the same input values (D1: they must always agree).
 *
 * agentId/agentType are required on SubagentStart per the schema, but parseHookInput
 * does not enforce that — so we fall back to empty string if somehow absent.
 */
function buildSubagentStartEvent(context: SubagentEventContext, input: ParsedHookInput): SubagentStartHookEvent {
  return {
    kind: 'hook',
    hook: 'SubagentStart',
    context,
    payload: {
      transcriptPath: input.transcriptPath,
      agentId: context.agentId,
      agentType: context.agentType,
    },
  } satisfies SubagentStartHookEvent
}

/**
 * Build SubagentStop hook event.
 * Both context.agentId/agentType and payload.agentId/agentType are populated from
 * the same input values (D1: they must always agree).
 */
function buildSubagentStopEvent(context: SubagentEventContext, input: ParsedHookInput): SubagentStopHookEvent {
  const raw = input.raw
  const agentTranscriptPath = typeof raw.agent_transcript_path === 'string' ? raw.agent_transcript_path : ''
  const lastAssistantMessage = typeof raw.last_assistant_message === 'string' ? raw.last_assistant_message : ''
  const permissionMode = input.permissionMode ?? 'default'
  const stopHookActive = typeof raw.stop_hook_active === 'boolean' ? raw.stop_hook_active : undefined
  return {
    kind: 'hook',
    hook: 'SubagentStop',
    context,
    payload: {
      transcriptPath: input.transcriptPath,
      permissionMode,
      agentId: context.agentId,
      agentType: context.agentType,
      agentTranscriptPath,
      lastAssistantMessage,
      ...(stopHookActive !== undefined && { stopHookActive }),
    },
  } satisfies SubagentStopHookEvent
}

/**
 * Build a typed HookEvent from parsed stdin input.
 * Constructs the appropriate discriminated union member based on hook type.
 *
 * @see docs/design/flow.md §3.2 Event Schema
 */
export function buildHookEvent(hookName: HookName, input: ParsedHookInput, correlationId: string): HookEvent {
  const context: EventContext = {
    sessionId: input.sessionId,
    timestamp: Date.now(),
    correlationId,
    ...(input.agentId !== undefined && { agentId: input.agentId }),
    ...(input.agentType !== undefined && { agentType: input.agentType }),
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
    case 'SubagentStart': {
      const subagentContext: SubagentEventContext = {
        ...context,
        agentId: input.agentId ?? '',
        agentType: input.agentType ?? '',
      }
      return buildSubagentStartEvent(subagentContext, input)
    }
    case 'SubagentStop': {
      const subagentContext: SubagentEventContext = {
        ...context,
        agentId: input.agentId ?? '',
        agentType: input.agentType ?? '',
      }
      return buildSubagentStopEvent(subagentContext, input)
    }
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
  runtime: RuntimeShell
  /** Whether the daemon is available for IPC. When false, IPC send is skipped. */
  daemonAvailable?: boolean
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
  // Recursion guard (defense-in-depth): the real external entry point
  // `handleUnifiedHookCommand` already short-circuits on this env var; this
  // repeat check protects any caller that reaches `handleHookCommand` directly
  // (tests, future internal dispatchers). See hook-command.ts for the primary
  // guard and claude-cli-spawn.ts for where the env var is set.
  if (process.env.SIDEKICK_SUBPROCESS === '1') {
    stdout.write('{}\n')
    return { exitCode: 0, output: '{}' }
  }

  const { projectRoot, hookInput, correlationId, runtime } = options
  const startTime = Date.now()

  // Log HookReceived event
  const logContext = {
    sessionId: hookInput.sessionId,
    correlationId,
    hook: hookName,
  }
  const builtInput = buildHookInput(hookInput.raw)
  logEvent(
    logger,
    LogEvents.hookReceived(logContext, {
      cwd: hookInput.cwd,
      mode: 'hook',
      ...(Object.keys(builtInput).length > 0 ? { input: builtInput } : {}),
    })
  )
  logger.debug('Hook invocation received', { hook: hookName, sessionId: hookInput.sessionId })

  // Build typed HookEvent from parsed input
  const event = buildHookEvent(hookName, hookInput, correlationId)

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

  // Send hook event to daemon via IPC (gated on daemon availability)
  let daemonResponse: HookResponse | null = null
  if (options.daemonAvailable !== false) {
    const ipcService = new IpcService(projectRoot, logger)
    try {
      daemonResponse = await ipcService.send<HookResponse>('hook.invoke', {
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
  } else {
    logger.debug('Skipping IPC send - daemon not available', { hook: hookName })
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

  // Output internal HookResponse format
  const outputStr = JSON.stringify(mergedResponse)
  stdout.write(`${outputStr}\n`)

  // Log HookCompleted event
  const returnValue =
    Object.keys(mergedResponse).length > 0 ? truncateForLog(mergedResponse as Record<string, unknown>) : undefined

  logEvent(
    logger,
    LogEvents.hookCompleted(
      logContext,
      { durationMs: Date.now() - startTime },
      { reminderReturned: !!mergedResponse.additionalContext, returnValue }
    )
  )

  return { exitCode: 0, output: outputStr }
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
