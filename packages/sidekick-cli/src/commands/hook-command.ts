/**
 * Unified Hook Command Handler
 *
 * Implements `sidekick hook <hook-name>` command that:
 * 1. Accepts Claude Code hook input via stdin
 * 2. Executes hook logic (daemon + CLI handlers)
 * 3. Translates internal HookResponse to Claude Code format
 * 4. Outputs Claude Code-compatible JSON to stdout
 *
 * This replaces the bash+jq translation layer in dev-sidekick scripts,
 * enabling the plugin to invoke hooks directly via:
 *   npx @sidekick/cli hook session-start
 *
 * @see docs/plans/2026-01-19-installation-distribution-design.md
 */

import type { Writable } from 'node:stream'
import type { Logger, SetupState } from '@sidekick/core'
import { SetupStatusService, createAssetResolver, getDefaultAssetsDir } from '@sidekick/core'
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
 * Load safe word context from YAML template.
 * Returns undefined if loading fails (caller should skip injection).
 */
function loadSafeWordContext(safeWord: string, projectRoot: string | undefined, logger: Logger): string | undefined {
  try {
    const resolver = createAssetResolver({
      defaultAssetsDir: getDefaultAssetsDir(),
      projectRoot,
    })
    const template = resolver.resolveYaml<{ additionalContext?: string }>('reminders/safe-word-liveness.yaml')
    if (template?.additionalContext) {
      return template.additionalContext.replace('{{safeWord}}', safeWord)
    }
    logger.error('safe-word-liveness.yaml missing additionalContext field', { projectRoot })
    return undefined
  } catch (err) {
    logger.error('Failed to load safe-word-liveness.yaml', {
      error: err instanceof Error ? err.message : String(err),
      projectRoot,
    })
    return undefined
  }
}

function addUserMessage(response: ClaudeCodeHookResponse, userMessage: string | undefined): void {
  if (userMessage) {
    response.systemMessage = userMessage
  }
}

function translateSessionStart(internal: HookResponse): ClaudeCodeHookResponse {
  const response: ClaudeCodeHookResponse = {}

  if (internal.blocking === true) {
    response.continue = false
    response.stopReason = internal.reason ?? 'Blocked by Sidekick'
  }

  if (internal.additionalContext) {
    response.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: internal.additionalContext }
  }

  addUserMessage(response, internal.userMessage)
  return response
}

function translateUserPromptSubmit(internal: HookResponse): ClaudeCodeHookResponse {
  const response: ClaudeCodeHookResponse = {}

  if (internal.blocking === true) {
    response.decision = 'block'
    response.reason = internal.reason ?? 'Blocked by Sidekick'
  }

  if (internal.additionalContext) {
    response.hookSpecificOutput = {
      hookEventName: 'UserPromptSubmit',
      additionalContext: internal.additionalContext,
    }
  }

  addUserMessage(response, internal.userMessage)
  return response
}

function translatePreToolUse(internal: HookResponse): ClaudeCodeHookResponse {
  const response: ClaudeCodeHookResponse = {}

  if (internal.blocking === true) {
    response.hookSpecificOutput = {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: combineReasonAndContext(internal.reason, internal.additionalContext),
    }
  } else if (internal.additionalContext) {
    response.hookSpecificOutput = {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: internal.additionalContext,
    }
  }

  addUserMessage(response, internal.userMessage)
  return response
}

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

  addUserMessage(response, internal.userMessage)
  return response
}

function translateStop(internal: HookResponse): ClaudeCodeHookResponse {
  const response: ClaudeCodeHookResponse = {}

  if (internal.blocking === true) {
    response.decision = 'block'
    if (!internal.reason && !internal.additionalContext) {
      response.reason = 'Task not complete - please continue'
    } else {
      response.reason = combineReasonAndContext(internal.reason, internal.additionalContext, '\n')
    }
  }

  addUserMessage(response, internal.userMessage)
  return response
}

const TRANSLATORS: Record<HookName, (internal: HookResponse) => ClaudeCodeHookResponse> = {
  SessionStart: translateSessionStart,
  SessionEnd: () => ({}),
  UserPromptSubmit: translateUserPromptSubmit,
  PreToolUse: translatePreToolUse,
  PostToolUse: translatePostToolUse,
  Stop: translateStop,
  PreCompact: () => ({}),
}

export function translateToClaudeCodeFormat(hookName: HookName, internal: HookResponse): ClaudeCodeHookResponse {
  return TRANSLATORS[hookName](internal)
}

const HOOK_ARG_TO_NAME: Record<string, HookName> = {
  'session-start': 'SessionStart',
  'session-end': 'SessionEnd',
  'user-prompt-submit': 'UserPromptSubmit',
  'pre-tool-use': 'PreToolUse',
  'post-tool-use': 'PostToolUse',
  stop: 'Stop',
  'pre-compact': 'PreCompact',
  SessionStart: 'SessionStart',
  SessionEnd: 'SessionEnd',
  UserPromptSubmit: 'UserPromptSubmit',
  PreToolUse: 'PreToolUse',
  PostToolUse: 'PostToolUse',
  Stop: 'Stop',
  PreCompact: 'PreCompact',
}

export function parseHookArg(arg: string | undefined): HookName | undefined {
  return arg ? HOOK_ARG_TO_NAME[arg] : undefined
}

export interface HookCommandOptions {
  projectRoot: string
  hookInput: ParsedHookInput
  correlationId: string
  runtime: RuntimeShell
  /** Force execution even in conflict state (dev-mode passes this) */
  force?: boolean
}

/**
 * Messages for degraded mode (setup not complete).
 */
const DEGRADED_MODE_MESSAGES: Record<
  Exclude<SetupState, 'healthy'>,
  { additionalContext: string; userMessage: string }
> = {
  'not-run': {
    additionalContext: `Sidekick plugin detected but not configured. Features like reminders, personas, and statusline are unavailable until setup is complete. If you haven't already, ask the user if you should execute the sidekick-config skill.`,
    userMessage: `Sidekick is installed but not configured. Run 'sidekick setup' to configure.`,
  },
  partial: {
    additionalContext: `Sidekick user setup is complete but this project is not configured. Features like reminders, personas, and statusline are unavailable until project setup is complete. If you haven't already, ask the user if you should execute the sidekick-config skill.`,
    userMessage: `Sidekick project setup incomplete. Run 'sidekick setup' in this project to configure.`,
  },
  unhealthy: {
    additionalContext: `Sidekick is configured but unhealthy (possibly invalid API keys or missing configuration). Features are unavailable until issues are resolved. If you haven't already, ask the user if you should execute sidekick doctor.`,
    userMessage: `Sidekick configuration is unhealthy. Run 'sidekick doctor' to diagnose issues.`,
  },
}

/**
 * Hooks that should show informative degraded mode messages.
 * Other hooks return {} silently in degraded mode.
 */
const VERBOSE_DEGRADED_HOOKS: ReadonlySet<HookName> = new Set(['SessionStart', 'UserPromptSubmit'])

/**
 * Check setup state and return degraded mode response if not healthy.
 * Returns null if setup is healthy and normal hook execution should proceed.
 *
 * @param projectRoot - Project directory for setup status lookup
 * @param hookName - The hook being invoked (determines verbosity)
 * @param logger - Logger for diagnostic output
 * @returns HookResponse for degraded mode, or null for normal execution
 */
async function checkSetupState(projectRoot: string, hookName: HookName, logger: Logger): Promise<HookResponse | null> {
  let state: SetupState
  try {
    const setupService = new SetupStatusService(projectRoot)
    state = await setupService.getSetupState()
  } catch (err) {
    // If we can't check setup state, assume healthy and proceed
    logger.warn('Failed to check setup state, assuming healthy', {
      error: err instanceof Error ? err.message : String(err),
      hookName,
      projectRoot,
    })
    return null
  }

  if (state === 'healthy') {
    return null // Normal execution
  }

  // Log at appropriate level based on state
  const logData = { setupState: state, hookName, projectRoot }
  if (state === 'not-run') {
    logger.info('Hook operating in degraded mode - setup not run', logData)
  } else {
    logger.warn('Hook operating in degraded mode', logData)
  }

  // Only SessionStart and UserPromptSubmit return informative messages
  // Other hooks return empty response silently
  if (!VERBOSE_DEGRADED_HOOKS.has(hookName)) {
    return {}
  }

  const messages = DEGRADED_MODE_MESSAGES[state]
  return {
    additionalContext: messages.additionalContext,
    userMessage: messages.userMessage,
  }
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
  const { projectRoot, hookInput, correlationId, runtime, force } = options

  logger.debug('Unified hook command invoked', { hookName, sessionId: hookInput.sessionId })

  // Check for dev-mode conflict: if devMode flag is true in project status,
  // dev-mode hooks are active. Since dev-mode hooks pass --force, we can
  // distinguish plugin hooks (no --force) from dev-mode hooks (--force).
  // If devMode is true and --force not passed, we're the plugin hooks and
  // should bail early to let dev-mode hooks win.
  if (!force) {
    try {
      const setupService = new SetupStatusService(projectRoot)
      const devMode = await setupService.getDevMode()
      if (devMode) {
        logger.debug('Dev-mode active, bailing early (let dev-mode hooks win)', {
          hookName,
          devMode,
        })
        stdout.write('{}\n')
        return { exitCode: 0, output: '{}' }
      }
    } catch (err) {
      // If we can't check status, proceed normally (fail open)
      logger.warn('Failed to check plugin/dev-mode status, proceeding normally', {
        error: err instanceof Error ? err.message : String(err),
        hookName,
      })
    }
  }

  // Check setup state before attempting daemon/IPC operations
  // Skip daemon entirely if setup is not healthy to avoid ProviderErrors
  const degradedResponse = await checkSetupState(projectRoot, hookName, logger)
  if (degradedResponse !== null) {
    // Return degraded mode response - no daemon interaction
    // Only SessionStart and UserPromptSubmit return informative messages;
    // other hooks return {} silently in degraded mode
    const claudeResponse = translateToClaudeCodeFormat(hookName, degradedResponse)
    const outputStr = JSON.stringify(claudeResponse)
    stdout.write(`${outputStr}\n`)
    logger.debug('Hook completed in degraded mode', { hookName })
    return { exitCode: 0, output: outputStr }
  }

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

  // Inject safe word liveness probe for SessionStart
  if (hookName === 'SessionStart') {
    const safeWord = process.env.SIDEKICK_SAFE_WORD ?? 'nope'
    const safeWordContext = loadSafeWordContext(safeWord, projectRoot, logger)

    if (safeWordContext) {
      internalResponse.additionalContext = internalResponse.additionalContext
        ? `${internalResponse.additionalContext}\n\n${safeWordContext}`
        : safeWordContext
    }
  }

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
