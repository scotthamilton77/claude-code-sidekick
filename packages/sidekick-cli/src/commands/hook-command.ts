/**
 * Unified Hook Command Handler
 *
 * Implements `sidekick hook <hook-name>` command that:
 * 1. Accepts Claude Code hook input via stdin
 * 2. Executes hook logic (daemon + CLI handlers)
 * 3. Translates internal HookResponse to Claude Code format
 * 4. Outputs Claude Code-compatible JSON to stdout
 *
 * This replaces the bash+jq translation layer in dev-hooks scripts,
 * enabling the plugin to invoke hooks directly via:
 *   npx @sidekick/cli hook session-start
 *
 * @see docs/plans/2026-01-19-installation-distribution-design.md
 */

import type { Writable } from 'node:stream'
import type { Logger } from '@sidekick/core'
import type { HookName, ParsedHookInput } from '@sidekick/types'
import type { RuntimeShell } from '../runtime.js'
import { handleHookCommand, type HookResponse } from './hook.js'

/**
 * Claude Code hook response format.
 * Different hooks have different expected fields.
 */
export interface ClaudeCodeHookResponse {
  // SessionStart blocking
  continue?: boolean
  stopReason?: string

  // UserPromptSubmit, PostToolUse, Stop blocking
  decision?: 'block' | 'allow'
  reason?: string

  // Common: message shown to user
  systemMessage?: string

  // Hook-specific output
  hookSpecificOutput?: {
    hookEventName?: string
    additionalContext?: string
    // PreToolUse specific
    permissionDecision?: 'allow' | 'deny'
    permissionDecisionReason?: string
  }
}

/**
 * Combine reason and additionalContext into a single string.
 * Used when Claude Code expects a single reason field.
 */
function combineReasonAndContext(
  reason: string | undefined,
  additionalContext: string | undefined,
  separator = '\n\n'
): string {
  if (reason && additionalContext) {
    return `${reason}${separator}${additionalContext}`
  }
  return reason ?? additionalContext ?? 'Blocked by Sidekick'
}

/**
 * Translate internal HookResponse to Claude Code SessionStart format.
 *
 * Claude Code expects:
 * - blocking → { continue: false, stopReason }
 * - userMessage → { systemMessage }
 * - additionalContext → { hookSpecificOutput: { additionalContext } }
 */
function translateSessionStart(internal: HookResponse): ClaudeCodeHookResponse {
  const response: ClaudeCodeHookResponse = {}

  if (internal.blocking === true) {
    response.continue = false
    response.stopReason = internal.reason ?? 'Blocked by Sidekick'
  }

  if (internal.userMessage) {
    response.systemMessage = internal.userMessage
  }

  if (internal.additionalContext) {
    response.hookSpecificOutput = { additionalContext: internal.additionalContext }
  }

  return response
}

/**
 * Translate internal HookResponse to Claude Code UserPromptSubmit format.
 *
 * Claude Code expects:
 * - blocking → { decision: "block", reason }
 * - userMessage → { systemMessage }
 * - additionalContext → { hookSpecificOutput: { hookEventName, additionalContext } }
 */
function translateUserPromptSubmit(internal: HookResponse): ClaudeCodeHookResponse {
  const response: ClaudeCodeHookResponse = {}

  if (internal.blocking === true) {
    response.decision = 'block'
    response.reason = internal.reason ?? 'Blocked by Sidekick'
  }

  if (internal.userMessage) {
    response.systemMessage = internal.userMessage
  }

  if (internal.additionalContext) {
    response.hookSpecificOutput = {
      hookEventName: 'UserPromptSubmit',
      additionalContext: internal.additionalContext,
    }
  }

  return response
}

/**
 * Translate internal HookResponse to Claude Code PreToolUse format.
 *
 * Claude Code expects:
 * - blocking → { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason } }
 * - non-blocking with context → { hookSpecificOutput: { permissionDecision: "allow", permissionDecisionReason } }
 * - userMessage → { systemMessage }
 */
function translatePreToolUse(internal: HookResponse): ClaudeCodeHookResponse {
  const response: ClaudeCodeHookResponse = {}

  if (internal.blocking === true) {
    response.hookSpecificOutput = {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: combineReasonAndContext(internal.reason, internal.additionalContext),
    }
  } else if (internal.additionalContext) {
    // Non-blocking but with context - use permissionDecisionReason
    response.hookSpecificOutput = {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: internal.additionalContext,
    }
  }

  if (internal.userMessage) {
    response.systemMessage = internal.userMessage
  }

  return response
}

/**
 * Translate internal HookResponse to Claude Code PostToolUse format.
 *
 * Claude Code expects:
 * - blocking → { decision: "block", reason } (combined reason+context)
 * - non-blocking with context → { hookSpecificOutput: { hookEventName, additionalContext } }
 * - userMessage → { systemMessage }
 */
function translatePostToolUse(internal: HookResponse): ClaudeCodeHookResponse {
  const response: ClaudeCodeHookResponse = {}

  if (internal.blocking === true) {
    response.decision = 'block'
    response.reason = combineReasonAndContext(internal.reason, internal.additionalContext)
  } else if (internal.additionalContext) {
    response.hookSpecificOutput = {
      hookEventName: 'PostToolUse',
      additionalContext: internal.additionalContext,
    }
  }

  if (internal.userMessage) {
    response.systemMessage = internal.userMessage
  }

  return response
}

/**
 * Translate internal HookResponse to Claude Code Stop format.
 *
 * Claude Code expects:
 * - blocking → { decision: "block", reason } (combined reason+context)
 * - userMessage → { systemMessage }
 *
 * Note: Stop has no hookSpecificOutput.additionalContext - context goes into reason.
 */
function translateStop(internal: HookResponse): ClaudeCodeHookResponse {
  const response: ClaudeCodeHookResponse = {}

  if (internal.blocking === true) {
    response.decision = 'block'
    // Stop uses \n separator instead of \n\n
    response.reason = combineReasonAndContext(internal.reason, internal.additionalContext, '\n')
    // Override default if neither reason nor context
    if (!internal.reason && !internal.additionalContext) {
      response.reason = 'Task not complete - please continue'
    }
  }

  if (internal.userMessage) {
    response.systemMessage = internal.userMessage
  }

  return response
}

/**
 * Translator for notification-only hooks (SessionEnd, PreCompact).
 * These hooks cannot block or return meaningful responses.
 */
function translateNotificationOnly(_internal: HookResponse): ClaudeCodeHookResponse {
  return {}
}

/**
 * Map of hook names to their translation functions.
 */
const TRANSLATORS: Record<HookName, (internal: HookResponse) => ClaudeCodeHookResponse> = {
  SessionStart: translateSessionStart,
  SessionEnd: translateNotificationOnly,
  UserPromptSubmit: translateUserPromptSubmit,
  PreToolUse: translatePreToolUse,
  PostToolUse: translatePostToolUse,
  Stop: translateStop,
  PreCompact: translateNotificationOnly,
}

/**
 * Translate internal HookResponse to Claude Code format.
 *
 * @param hookName - The hook being processed
 * @param internal - Internal HookResponse from daemon/CLI handlers
 * @returns Claude Code-compatible response object
 */
export function translateToClaudeCodeFormat(hookName: HookName, internal: HookResponse): ClaudeCodeHookResponse {
  const translator = TRANSLATORS[hookName]
  return translator(internal)
}

/**
 * Kebab-case CLI arguments to HookName mapping.
 * PascalCase names are derived from keys in TRANSLATORS.
 */
const KEBAB_TO_HOOK: Record<string, HookName> = {
  'session-start': 'SessionStart',
  'session-end': 'SessionEnd',
  'user-prompt-submit': 'UserPromptSubmit',
  'pre-tool-use': 'PreToolUse',
  'post-tool-use': 'PostToolUse',
  stop: 'Stop',
  'pre-compact': 'PreCompact',
}

/**
 * Combined map accepting both kebab-case and PascalCase arguments.
 * PascalCase entries are generated from TRANSLATORS keys (canonical list).
 */
const HOOK_ARG_TO_NAME: Record<string, HookName> = {
  ...KEBAB_TO_HOOK,
  ...Object.fromEntries(Object.keys(TRANSLATORS).map((name) => [name, name as HookName])),
}

/**
 * Parse hook name from CLI argument.
 * Accepts both kebab-case and PascalCase.
 *
 * @param arg - Hook name argument from CLI
 * @returns Normalized HookName or undefined if invalid
 */
export function parseHookArg(arg: string | undefined): HookName | undefined {
  if (!arg) return undefined
  return HOOK_ARG_TO_NAME[arg]
}

export interface HookCommandOptions {
  projectRoot: string
  hookInput: ParsedHookInput
  correlationId: string
  runtime: RuntimeShell
}

export interface HookCommandResult {
  exitCode: number
  output: string
}

/**
 * Parse JSON response from internal hook handler.
 * Returns empty object on parse failure or empty input.
 */
function parseInternalResponse(output: string, hookName: HookName, logger: Logger): HookResponse {
  if (!output) return {}
  try {
    return JSON.parse(output) as HookResponse
  } catch (err) {
    logger.warn('Failed to parse internal hook response', {
      hookName,
      error: err instanceof Error ? err.message : String(err),
      output,
    })
    return {}
  }
}

/**
 * Handle `sidekick hook <hook-name>` command.
 *
 * This is the unified entry point for Claude Code plugin hooks:
 * 1. Accepts Claude Code hook input via stdin (already parsed)
 * 2. Dispatches to existing hook logic (daemon + CLI handlers)
 * 3. Translates internal response to Claude Code format
 * 4. Outputs Claude Code-compatible JSON
 *
 * @param hookName - The hook to execute
 * @param options - Hook execution options
 * @param logger - Logger for diagnostic output
 * @param stdout - Output stream for Claude Code response
 * @returns Exit code and output string
 */
export async function handleUnifiedHookCommand(
  hookName: HookName,
  options: HookCommandOptions,
  logger: Logger,
  stdout: Writable
): Promise<HookCommandResult> {
  const { projectRoot, hookInput, correlationId, runtime } = options

  logger.debug('Unified hook command invoked', { hookName, sessionId: hookInput.sessionId })

  // Create a capture stream to intercept internal response
  let internalOutput = ''
  const captureStream = {
    write(chunk: string | Buffer): boolean {
      internalOutput += chunk.toString()
      return true
    },
  } as Writable

  // Execute existing hook logic, capturing internal response
  await handleHookCommand(
    hookName,
    {
      projectRoot,
      sessionId: hookInput.sessionId,
      hookInput,
      correlationId,
      runtime,
    },
    logger,
    captureStream
  )

  // Parse internal response (empty string yields empty object)
  const internalResponse = parseInternalResponse(internalOutput.trim(), hookName, logger)

  // Translate to Claude Code format
  const claudeResponse = translateToClaudeCodeFormat(hookName, internalResponse)

  // Output Claude Code-compatible JSON
  const outputStr = JSON.stringify(claudeResponse)
  stdout.write(`${outputStr}\n`)

  logger.debug('Hook command completed', {
    hookName,
    hasBlocking: internalResponse.blocking,
    hasContext: !!internalResponse.additionalContext,
  })

  return { exitCode: 0, output: outputStr }
}
