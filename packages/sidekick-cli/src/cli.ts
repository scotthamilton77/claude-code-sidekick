/**
 * CLI Entrypoint Module
 *
 * Implements the Sidekick Node CLI per docs/design/CLI.md §3 Hook Wrapper Layer.
 *
 * Parses command-line arguments, bootstraps the runtime shell, and executes
 * hook commands. Designed for testability with injectable I/O streams.
 *
 * Supports:
 * - Hook mode (--hook): Outputs structured JSON for Claude Code integration
 * - Interactive mode: Human-readable output for debugging
 * - Scope detection with dual-install awareness
 * - Hook input JSON parsing from stdin (per CLI.md §3.1)
 * - Hook event dispatch to Daemon via IPC
 *
 * @see docs/design/CLI.md §3 Hook Wrapper Layer
 * @see docs/design/CLI.md §3.1.1 Hook Input Structure
 * @see docs/design/CLI.md §9 Process Model for Hooks
 * @see docs/design/flow.md §5 Complete Hook Flows
 */

import { mkdir } from 'node:fs/promises'
import { PassThrough, Writable } from 'node:stream'
import yargsParser from 'yargs-parser'

import type { ParsedHookInput, MinimalStateService } from '@sidekick/types'

/**
 * Detect if running in Claude Code sandbox mode.
 * Sandbox mode sets SANDBOX_RUNTIME=1 and blocks Unix socket operations.
 */
function isInSandbox(): boolean {
  return process.env.SANDBOX_RUNTIME === '1'
}

/**
 * Error message for sandbox mode.
 * Provides actionable guidance for users running in Claude Code.
 */
const SANDBOX_ERROR_MESSAGE = `Error: Daemon commands cannot run in sandbox mode.

Claude Code's sandbox blocks Unix socket operations required for daemon IPC.
To run this command, use dangerouslyDisableSandbox: true in the Bash tool call.

Example: { "command": "pnpm sidekick daemon status", "dangerouslyDisableSandbox": true }
`
import { LogMetricsStateSchema } from '@sidekick/types'
import type { Logger } from '@sidekick/core'
import { bootstrapRuntime, type RuntimeShell } from './runtime'
import { getHookName, handleHookCommand, validateHookName } from './commands/hook.js'

interface ParsedArgs {
  command: string
  hookMode: boolean
  hookScriptPath?: string
  projectDir?: string
  scopeOverride?: 'user' | 'project'
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  wait?: boolean
  format?: 'text' | 'json' | 'table'
  width?: number
  port?: number
  host?: string
  open?: boolean
  preferProject?: boolean
  sessionIdArg?: string
  messageType?: 'snarky' | 'resume'
  help?: boolean
  kill?: boolean
  force?: boolean
  _?: (string | number)[]
}

interface RunCliOptions {
  argv: string[]
  stdinData?: string
  stdout?: Writable
  stderr?: Writable
  cwd?: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
  interactive?: boolean
  enableFileLogging?: boolean
}

/**
 * Parse CLI arguments using a well-tested open-source parser to reduce bespoke flag handling.
 */
function parseArgs(argv: string[]): ParsedArgs {
  const parsed = yargsParser(argv, {
    boolean: ['hook', 'wait', 'open', 'prefer-project', 'help', 'kill', 'force'],
    string: ['hook-script-path', 'project-dir', 'scope', 'log-level', 'format', 'host', 'session-id', 'type'],
    number: ['port', 'width'],
    alias: {
      h: 'help',
    },
    configuration: {
      'camel-case-expansion': false,
    },
  })

  const command = (parsed._[0] as string | undefined) ?? 'session-start'

  return {
    command,
    hookMode: Boolean(parsed.hook),
    hookScriptPath: parsed['hook-script-path'] as string | undefined,
    projectDir: parsed['project-dir'] as string | undefined,
    scopeOverride: parsed.scope as 'user' | 'project' | undefined,
    logLevel: parsed['log-level'] as ParsedArgs['logLevel'],
    wait: Boolean(parsed.wait),
    format: parsed.format as 'text' | 'json' | 'table' | undefined,
    width: parsed.width as number | undefined,
    port: parsed.port as number | undefined,
    host: parsed.host as string | undefined,
    open: parsed.open as boolean | undefined,
    preferProject: parsed['prefer-project'] as boolean | undefined,
    sessionIdArg: parsed['session-id'] as string | undefined,
    messageType: parsed.type as 'snarky' | 'resume' | undefined,
    help: Boolean(parsed.help),
    kill: Boolean(parsed.kill),
    force: Boolean(parsed.force),
    _: parsed._,
  }
}

/**
 * Parse hook input JSON from stdin.
 * Per CLI.md §3.1.1, the CLI extracts session_id directly from the hook input.
 *
 * @param stdinData - Raw JSON string from stdin (or undefined if not in hook mode)
 * @returns Parsed hook input with session_id, or undefined if parsing fails
 */
export function parseHookInput(stdinData: string | undefined): ParsedHookInput | undefined {
  if (!stdinData?.trim()) {
    return undefined
  }

  try {
    const raw = JSON.parse(stdinData) as Record<string, unknown>

    // Extract common fields (per CLI.md §3.1.1 and official Claude Code docs)
    const sessionId = typeof raw.session_id === 'string' ? raw.session_id : undefined
    const transcriptPath = typeof raw.transcript_path === 'string' ? raw.transcript_path : undefined
    const cwd = typeof raw.cwd === 'string' ? raw.cwd : undefined
    const hookEventName = typeof raw.hook_event_name === 'string' ? raw.hook_event_name : undefined
    const permissionMode = typeof raw.permission_mode === 'string' ? raw.permission_mode : undefined

    if (!sessionId) {
      // session_id is required - without it we can't correlate events
      return undefined
    }

    return {
      sessionId,
      transcriptPath: transcriptPath ?? '',
      cwd, // Optional - some hooks (Stop, SessionStart) may not include cwd
      hookEventName: hookEventName ?? 'unknown',
      permissionMode,
      raw,
    }
  } catch {
    // Invalid JSON - return undefined
    return undefined
  }
}

/**
 * Result of runtime initialization.
 */
interface InitializeRuntimeResult {
  runtime: RuntimeShell
  hookInput: ParsedHookInput | undefined
  parsed: ParsedArgs
  shouldExit: boolean
}

/**
 * Initialize runtime shell, parse arguments and hook input.
 * Returns early-exit flag if dual-install is detected.
 *
 * @param options - CLI options including argv, stdin, streams, environment
 * @returns Runtime, parsed args, hook input, and early-exit flag
 */
export function initializeRuntime(options: RunCliOptions): InitializeRuntimeResult {
  const stderr = options.stderr ?? new PassThrough()
  const parsed = parseArgs(options.argv)
  const homeDir = options.homeDir ?? options.env?.HOME

  // Parse hook input from stdin (per CLI.md §3.1.1)
  const hookInput = parseHookInput(options.stdinData)

  const runtime = bootstrapRuntime({
    hookScriptPath: parsed.hookScriptPath,
    projectDir: parsed.projectDir,
    scopeOverride: parsed.scopeOverride,
    logLevel: parsed.logLevel,
    stderrSink: stderr,
    cwd: options.cwd,
    homeDir,
    command: parsed.command,
    interactive: options.interactive ?? false,
    enableFileLogging: options.enableFileLogging ?? true,
  })

  // Debug log the full hook input for troubleshooting
  if (hookInput) {
    runtime.logger.debug('Hook input received', { hookInput: hookInput.raw })
  }

  // Check for dual-install scenario
  const shouldExit = runtime.scope.dualInstallDetected && parsed.scopeOverride !== 'project'
  if (shouldExit) {
    runtime.logger.warn('User-scope hook detected project installation. Exiting to prevent duplicate execution.')
  }

  return {
    runtime,
    hookInput,
    parsed,
    shouldExit,
  }
}

/**
 * Create session directory if session ID and state service are available.
 * Non-throwing: logs errors but continues execution.
 *
 * @param options - Session ID, state service, and logger
 */
export async function initializeSession(options: {
  sessionId: string | undefined
  stateService: MinimalStateService | undefined
  logger: Logger
}): Promise<void> {
  const { sessionId, stateService, logger } = options

  if (!sessionId || !stateService) {
    return
  }

  const sessionDir = stateService.sessionRootDir(sessionId)
  try {
    await mkdir(sessionDir, { recursive: true })
    logger.debug('Session directory created', { sessionId, sessionDir })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    logger.warn('Failed to create session directory', { sessionId, error: error.message })
  }
}

/**
 * Auto-start daemon if in hook mode with a project root.
 * Non-throwing: logs warnings on failure and gracefully degrades.
 *
 * @param options - Hook mode flag, project root, and logger
 * @returns Whether daemon was successfully started
 */
export async function ensureDaemon(options: {
  hookMode: boolean
  projectRoot: string | undefined
  logger: Logger
}): Promise<{ started: boolean }> {
  const { hookMode, projectRoot, logger } = options

  if (!hookMode || !projectRoot) {
    return { started: false }
  }

  try {
    const { DaemonClient } = await import('@sidekick/core')
    const daemonClient = new DaemonClient(projectRoot, logger)
    await daemonClient.start()
    logger.debug('Daemon auto-started for hook execution')
    return { started: true }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    logger.warn('Failed to auto-start daemon, proceeding with sync paths', {
      error: error.message,
    })
    return { started: false }
  }
}

const GLOBAL_HELP_TEXT = `Usage: sidekick <command> [options]

Commands:
  hook <hook-name>         Execute Claude Code hook (session-start, user-prompt-submit, etc.)
  persona <subcommand>     Manage session personas (list, set, clear, test)
  sessions                 List all daemon-tracked sessions
  daemon <subcommand>      Manage the background daemon (start, stop, status, kill)
  statusline               Render the status line (used by hooks)
  dev-mode <subcommand>    Manage development hooks (enable, disable, status, clean)
  ui                       Launch the web UI

Global Options:
  --help, -h               Show this help message
  --format=<format>        Output format: json or table (command-specific)
  --width=<n>              Table width in characters (default: 100)
  --project-dir=<path>     Override project directory
  --log-level=<level>      Set log level (debug, info, warn, error)

Examples:
  sidekick persona list --format=table
  sidekick sessions --format=table --width=120
  sidekick daemon status
  sidekick dev-mode enable
`

/**
 * Show global help text.
 */
function showGlobalHelp(stdout: Writable): { exitCode: number; stdout: string; stderr: string } {
  stdout.write(GLOBAL_HELP_TEXT)
  return { exitCode: 0, stdout: GLOBAL_HELP_TEXT, stderr: '' }
}

/**
 * Route command to appropriate handler based on command type.
 * Handles hook commands, daemon, statusline, ui, and fallback cases.
 *
 * @param context - Parsed args, runtime, hook input, output stream, daemon state
 * @returns Exit code and output strings
 */
export async function routeCommand(context: {
  parsed: ParsedArgs
  runtime: RuntimeShell
  hookInput: ParsedHookInput | undefined
  stdout: Writable
  daemonStarted: boolean
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { parsed, runtime, hookInput, stdout, daemonStarted } = context

  runtime.logger.debug('Raw hook input', { hookInput })

  // Handle hook commands by dispatching to daemon
  // Per docs/design/flow.md §5: CLI sends event to Daemon via IPC
  if (parsed.hookMode && hookInput && runtime.scope.projectRoot) {
    // Prefer hookInput.hookEventName (PascalCase from stdin), fall back to parsed.command (kebab-case from argv)
    const hookName = validateHookName(hookInput.hookEventName) ?? getHookName(parsed.command)
    if (hookName) {
      const result = await handleHookCommand(
        hookName,
        {
          projectRoot: runtime.scope.projectRoot,
          sessionId: hookInput.sessionId,
          hookInput,
          correlationId: runtime.correlationId,
          scope: runtime.scope.scope,
          runtime,
        },
        runtime.logger,
        stdout
      )
      return { exitCode: result.exitCode, stdout: result.output, stderr: '' }
    }
  }

  // Handle global help request (not in hook mode)
  // Show help when: --help flag with default command, or explicit 'help' command
  if (!parsed.hookMode) {
    const isDefaultCommand = parsed.command === 'session-start'
    const isHelpCommand = parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h'
    if ((parsed.help && isDefaultCommand) || isHelpCommand) {
      return showGlobalHelp(stdout)
    }
  }

  // Fallback: If hook input is missing or not recognized, return empty response
  // This handles edge cases like malformed stdin or unknown hook types
  if (parsed.hookMode && !hookInput) {
    runtime.logger.warn('Hook mode invoked without valid hook input, returning empty response', {
      command: parsed.command,
      daemonStarted,
    })
    stdout.write('{}\n')
    return { exitCode: 0, stdout: '{}', stderr: '' }
  }

  // Handle unified hook command: sidekick hook <hook-name>
  // Outputs Claude Code format directly (no bash+jq translation needed)
  if (parsed.command === 'hook') {
    const { parseHookArg, handleUnifiedHookCommand } = await import('./commands/hook-command.js')
    const hookArg = parsed._?.[1] as string | undefined
    const hookName = parseHookArg(hookArg)

    // Show help for 'sidekick hook --help' or 'sidekick hook' without subcommand
    if (parsed.help || !hookArg) {
      const helpText = `Usage: sidekick hook <hook-name>

Execute a Claude Code hook and output the response in Claude Code format.

Hook Names (kebab-case or PascalCase):
  session-start       Session started (startup, resume, clear, compact)
  session-end         Session ended (notification only)
  user-prompt-submit  User submitted a prompt
  pre-tool-use        Before a tool is executed
  post-tool-use       After a tool is executed
  stop                Claude is about to stop
  pre-compact         Before transcript compaction

Examples:
  echo '{"session_id":"abc"}' | sidekick hook session-start
  npx @sidekick/cli hook user-prompt-submit
`
      stdout.write(helpText)
      return { exitCode: 0, stdout: helpText, stderr: '' }
    }

    if (!hookName) {
      const errorMsg = `Error: Unknown hook name '${hookArg}'\nRun 'sidekick hook --help' for available hooks.\n`
      stdout.write(errorMsg)
      return { exitCode: 1, stdout: errorMsg, stderr: '' }
    }

    if (!hookInput) {
      runtime.logger.warn('Hook command invoked without valid hook input', { hookName })
      stdout.write('{}\n')
      return { exitCode: 0, stdout: '{}', stderr: '' }
    }

    if (!runtime.scope.projectRoot) {
      runtime.logger.warn('Hook command invoked without project root', { hookName })
      stdout.write('{}\n')
      return { exitCode: 0, stdout: '{}', stderr: '' }
    }

    const result = await handleUnifiedHookCommand(
      hookName,
      {
        projectRoot: runtime.scope.projectRoot,
        hookInput,
        correlationId: runtime.correlationId,
        scope: runtime.scope.scope,
        runtime,
      },
      runtime.logger,
      stdout
    )
    return { exitCode: result.exitCode, stdout: result.output, stderr: '' }
  }

  if (parsed.command === 'daemon') {
    // Check for --help/-h and --kill flags which yargs-parser consumes
    const subcommand = parsed.help ? '--help' : parsed.kill ? 'kill' : (parsed._ && (parsed._[1] as string)) || 'status'

    // Fail fast in sandbox mode - Unix sockets are blocked
    if (isInSandbox() && subcommand !== '--help') {
      stdout.write(SANDBOX_ERROR_MESSAGE)
      return { exitCode: 1, stdout: SANDBOX_ERROR_MESSAGE, stderr: '' }
    }

    const { handleDaemonCommand } = await import('./commands/daemon.js')
    const result = await handleDaemonCommand(
      subcommand,
      runtime.scope.projectRoot || process.cwd(),
      runtime.logger,
      stdout,
      { wait: parsed.wait }
    )
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }

  if (parsed.command === 'statusline') {
    const { handleStatuslineCommand, parseStatuslineInput } = await import('./commands/statusline.js')
    // Session ID can come from CLI arg (--session-id) or hook input (stdin JSON)
    // CLI arg takes precedence for interactive commands like statusline
    const sessionId = parsed.sessionIdArg ?? hookInput?.sessionId

    // Parse statusline-specific input from hook if available
    // Claude Code provides model, tokens, cost directly - no need to read state files
    const parsedHookInput = hookInput?.raw ? parseStatuslineInput(hookInput.raw) : undefined

    // statusline only supports 'text' | 'json', not 'table'
    const statuslineFormat = parsed.format === 'text' || parsed.format === 'json' ? parsed.format : undefined
    const result = await handleStatuslineCommand(runtime.scope.projectRoot || process.cwd(), runtime.logger, stdout, {
      format: statuslineFormat,
      sessionId,
      hookInput: parsedHookInput,
      configService: runtime.config,
      assets: runtime.assets,
      help: parsed.help,
    })
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }

  if (parsed.command === 'ui') {
    const { handleUiCommand } = await import('./commands/ui.js')
    const result = await handleUiCommand(runtime.scope.projectRoot || process.cwd(), runtime.logger, stdout, {
      port: parsed.port,
      host: parsed.host,
      open: parsed.open,
      preferProject: parsed.preferProject,
    })
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }

  if (parsed.command === 'persona') {
    const { handlePersonaCommand } = await import('./commands/persona.js')
    // persona <subcommand> [args] --session-id=<id>
    // Subcommands: list, set, clear, test
    // Check for --help/-h flags which yargs-parser consumes
    const subcommand = parsed.help ? '--help' : (parsed._?.[1] as string | undefined)
    const args = parsed._?.slice(2) ?? []

    const result = await handlePersonaCommand(
      subcommand,
      args,
      runtime.scope.projectRoot || process.cwd(),
      runtime.logger,
      stdout,
      {
        sessionId: parsed.sessionIdArg,
        format: parsed.format === 'json' || parsed.format === 'table' ? parsed.format : undefined,
        testType: parsed.messageType,
        width: parsed.width,
      }
    )
    return { exitCode: result.exitCode, stdout: result.output, stderr: '' }
  }

  if (parsed.command === 'sessions') {
    const { handleSessionsCommand } = await import('./commands/sessions.js')
    const result = await handleSessionsCommand(runtime.scope.projectRoot || process.cwd(), runtime.logger, stdout, {
      format: parsed.format === 'json' || parsed.format === 'table' ? parsed.format : undefined,
      help: parsed.help,
      width: parsed.width,
    })
    return { exitCode: result.exitCode, stdout: result.output, stderr: '' }
  }

  if (parsed.command === 'dev-mode') {
    // Check for --help/-h flags which yargs-parser consumes
    const subcommand = parsed.help ? '--help' : (parsed._ && (parsed._[1] as string)) || 'status'
    const { handleDevModeCommand } = await import('./commands/dev-mode.js')
    const result = await handleDevModeCommand(
      subcommand,
      runtime.scope.projectRoot || process.cwd(),
      runtime.logger,
      stdout,
      { force: Boolean(parsed.force) }
    )
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }

  // Interactive mode: show informational message
  // Hook mode falls through here only if command isn't recognized as a hook
  if (!parsed.hookMode) {
    stdout.write(`Sidekick CLI executed ${parsed.command} in ${runtime.scope.scope} scope\n`)
  }

  return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
}

/**
 * Persist CLI log metrics to state directory.
 * Writes cli-log-metrics.json with warning/error counts for statusline {logs} indicator.
 *
 * @param stateService - State service for atomic writes
 * @param sessionId - Session ID
 * @param counts - Log counts to persist
 * @param logger - Logger for debug/error messages
 */
async function persistCliLogMetrics(
  stateService: MinimalStateService,
  sessionId: string,
  counts: { warnings: number; errors: number },
  logger: Logger
): Promise<void> {
  const logMetricsPath = stateService.sessionStatePath(sessionId, 'cli-log-metrics.json')

  const logMetrics = {
    sessionId,
    warningCount: counts.warnings,
    errorCount: counts.errors,
    lastUpdatedAt: Date.now(),
  }

  try {
    await stateService.write(logMetricsPath, logMetrics, LogMetricsStateSchema)
    logger.debug('CLI log metrics persisted', { sessionId, counts })
  } catch (err) {
    // Non-critical - log and continue
    logger.warn('Failed to persist CLI log metrics', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Execute the Sidekick Node CLI entrypoint.
 *
 * This function is intentionally side-effect free aside from writes to the provided output streams,
 * making it easy to exercise via unit tests without spawning a separate process.
 *
 * Now refactored into orchestration of smaller functions for better testability.
 */
export async function runCli(options: RunCliOptions): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = options.stdout ?? new PassThrough()

  // 1. Initialize runtime (synchronous)
  const initResult = initializeRuntime(options)
  if (initResult.shouldExit) {
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  const { runtime, hookInput, parsed } = initResult

  // 2. Initialize session directory (async, no-throw)
  const sessionId = parsed.sessionIdArg ?? hookInput?.sessionId

  // Bind sessionId to logger context so all subsequent logs include it
  // Also load existing log counts for cross-invocation accumulation
  if (sessionId) {
    runtime.bindSessionId(sessionId)
    await runtime.loadExistingLogCounts(sessionId)
  }

  await initializeSession({
    sessionId,
    stateService: runtime.stateService,
    logger: runtime.logger,
  })

  // 3. Ensure daemon is running (async, no-throw)
  // Trigger for both --hook flag mode and unified 'sidekick hook <name>' command
  const isHookExecution = parsed.hookMode || parsed.command === 'hook'
  const { started: daemonStarted } = await ensureDaemon({
    hookMode: isHookExecution,
    projectRoot: runtime.scope.projectRoot,
    logger: runtime.logger,
  })

  // 4. Route command to appropriate handler
  const result = await routeCommand({
    parsed,
    runtime,
    hookInput,
    stdout,
    daemonStarted,
  })

  // 5. Persist CLI log metrics (async, no-throw)
  if (sessionId) {
    await persistCliLogMetrics(runtime.stateService, sessionId, runtime.getLogCounts(), runtime.logger)
  }

  return result
}
