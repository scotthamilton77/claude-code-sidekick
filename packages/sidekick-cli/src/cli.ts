/**
 * CLI Entrypoint Module
 *
 * Implements the Sidekick Node CLI per docs/design/CLI.md §3 Hook Wrapper Layer.
 *
 * Parses command-line arguments, bootstraps the runtime shell, and executes
 * hook commands. Designed for testability with injectable I/O streams.
 *
 * Supports:
 * - Unified hook command: `sidekick hook <name>` for Claude Code integration
 * - Interactive mode: Human-readable output for debugging
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
 * Version string injected at build time by esbuild.
 * Falls back to 'dev' when running unbundled (e.g., during development/testing).
 */
declare const __SIDEKICK_VERSION__: string | undefined
const VERSION = typeof __SIDEKICK_VERSION__ !== 'undefined' ? __SIDEKICK_VERSION__ : 'dev'

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
import { isInSandbox } from '@sidekick/core'
import { bootstrapRuntime, type RuntimeShell } from './runtime'

interface ParsedArgs {
  command: string | undefined
  projectDir?: string
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  wait?: boolean
  format?: 'text' | 'json' | 'table'
  width?: number
  port?: number
  host?: string
  open?: boolean
  sessionIdArg?: string
  messageType?: 'snarky' | 'resume'
  help?: boolean
  version?: boolean
  kill?: boolean
  check?: boolean
  force?: boolean
  fix?: boolean
  forceDevMode?: boolean
  'dry-run'?: boolean
  scope?: string
  _?: (string | number)[]
  // Setup command scripting flags (undefined = not specified, true/false = explicitly set)
  statuslineScope?: 'user' | 'project' | 'local'
  gitignore?: boolean
  personas?: boolean
  apiKeyScope?: 'user' | 'project'
  autoConfig?: 'auto' | 'manual'
  only?: string
  marketplaceScope?: 'user' | 'project' | 'local'
  pluginScope?: 'user' | 'project' | 'local'
  alias?: boolean
  // User profile scripting flags
  userProfileName?: string
  userProfileRole?: string
  userProfileInterests?: string
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
 * Error thrown when CLI receives unrecognized options.
 */
export class UnknownOptionError extends Error {
  constructor(public readonly unknownOptions: string[]) {
    const formatted = unknownOptions.map((k) => `--${k}`).join(', ')
    super(`Unrecognized option(s): ${formatted}`)
    this.name = 'UnknownOptionError'
  }
}

/** Declared CLI options for strict validation. */
const CLI_OPTIONS = {
  boolean: [
    'wait',
    'open',
    'prefer-project',
    'help',
    'version',
    'kill',
    'force',
    'fix',
    'force-dev-mode',
    'dry-run',
    'check',
    'gitignore',
    'personas',
    'alias',
  ] as const,
  string: [
    'project-dir',
    'log-level',
    'format',
    'host',
    'session-id',
    'type',
    'scope',
    'statusline-scope',
    'api-key-scope',
    'auto-config',
    'only',
    'marketplace-scope',
    'plugin-scope',
    'user-profile-name',
    'user-profile-role',
    'user-profile-interests',
  ] as const,
  number: ['port', 'width'] as const,
  alias: { h: 'help', v: 'version' } as const,
}

/** All keys yargs-parser may produce from declared options + positional args. */
const KNOWN_KEYS = new Set<string>([
  '_', // positional args (always present)
  ...CLI_OPTIONS.boolean,
  ...CLI_OPTIONS.string,
  ...CLI_OPTIONS.number,
  ...Object.keys(CLI_OPTIONS.alias),
])

/**
 * Parse CLI arguments using a well-tested open-source parser to reduce bespoke flag handling.
 * Throws UnknownOptionError for any unrecognized switches.
 */
function parseArgs(argv: string[]): ParsedArgs {
  const parsed = yargsParser(argv, {
    boolean: [...CLI_OPTIONS.boolean],
    string: [...CLI_OPTIONS.string],
    number: [...CLI_OPTIONS.number],
    alias: { ...CLI_OPTIONS.alias },
    configuration: {
      'camel-case-expansion': false,
    },
  })

  // Strict validation: reject unrecognized options
  const unknownKeys = Object.keys(parsed).filter((k) => !KNOWN_KEYS.has(k))
  if (unknownKeys.length > 0) {
    throw new UnknownOptionError(unknownKeys)
  }

  const command = parsed._[0] as string | undefined

  // For --gitignore/--no-gitignore and --personas/--no-personas, we need to distinguish between:
  // - Flag explicitly set to true (--flag)
  // - Flag explicitly set to false (--no-flag)
  // - Flag not specified at all
  // yargs-parser treats --no-flag as setting flag=false, so we check argv directly
  const hasGitignoreFlag = argv.some((arg) => arg === '--gitignore' || arg === '--no-gitignore')
  const hasPersonasFlag = argv.some((arg) => arg === '--personas' || arg === '--no-personas')
  const hasAliasFlag = argv.some((arg) => arg === '--alias' || arg === '--no-alias')

  return {
    command,
    projectDir: parsed['project-dir'] as string | undefined,
    logLevel: parsed['log-level'] as ParsedArgs['logLevel'],
    wait: Boolean(parsed.wait),
    format: parsed.format as 'text' | 'json' | 'table' | undefined,
    width: parsed.width as number | undefined,
    port: parsed.port as number | undefined,
    host: parsed.host as string | undefined,
    open: parsed.open as boolean | undefined,
    sessionIdArg: parsed['session-id'] as string | undefined,
    messageType: parsed.type as 'snarky' | 'resume' | undefined,
    help: Boolean(parsed.help),
    version: Boolean(parsed.version),
    kill: Boolean(parsed.kill),
    check: Boolean(parsed.check),
    force: Boolean(parsed.force),
    fix: Boolean(parsed.fix),
    forceDevMode: Boolean(parsed['force-dev-mode']),
    'dry-run': Boolean(parsed['dry-run']),
    _: parsed._,
    // Setup command scripting flags - only set if explicitly provided
    statuslineScope: parsed['statusline-scope'] as 'user' | 'project' | 'local' | undefined,
    gitignore: hasGitignoreFlag ? Boolean(parsed.gitignore) : undefined,
    personas: hasPersonasFlag ? Boolean(parsed.personas) : undefined,
    apiKeyScope: parsed['api-key-scope'] as 'user' | 'project' | undefined,
    autoConfig: parsed['auto-config'] as 'auto' | 'manual' | undefined,
    scope: parsed.scope as string | undefined,
    only: parsed.only as string | undefined,
    marketplaceScope: parsed['marketplace-scope'] as 'user' | 'project' | 'local' | undefined,
    pluginScope: parsed['plugin-scope'] as 'user' | 'project' | 'local' | undefined,
    alias: hasAliasFlag ? Boolean(parsed.alias) : undefined,
    userProfileName: parsed['user-profile-name'] as string | undefined,
    userProfileRole: parsed['user-profile-role'] as string | undefined,
    userProfileInterests: parsed['user-profile-interests'] as string | undefined,
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
 *
 * @param options - CLI options including argv, stdin, streams, environment
 * @returns Runtime, parsed args, and hook input
 */
export function initializeRuntime(options: RunCliOptions): InitializeRuntimeResult {
  const stderr = options.stderr ?? new PassThrough()
  const parsed = parseArgs(options.argv)
  const homeDir = options.homeDir ?? options.env?.HOME

  // Parse hook input from stdin (per CLI.md §3.1.1)
  const hookInput = parseHookInput(options.stdinData)

  const runtime = bootstrapRuntime({
    projectDir: parsed.projectDir,
    logLevel: parsed.logLevel,
    stderrSink: stderr,
    homeDir,
    command: parsed.command,
    interactive: options.interactive ?? false,
    enableFileLogging: options.enableFileLogging ?? true,
  })

  // Debug log the full hook input for troubleshooting
  if (hookInput) {
    runtime.logger.debug('Hook input received', { hookInput: hookInput.raw })
  }

  return {
    runtime,
    hookInput,
    parsed,
    shouldExit: false, // No longer needed - Claude Code handles deduplication
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

const GLOBAL_HELP_TEXT = `Usage: sidekick <command> [options]

Commands:
  hook <hook-name>         Execute Claude Code hook (session-start, user-prompt-submit, etc.)
  persona <subcommand>     Manage session personas (list, set, clear, pin, unpin, test)
  config <subcommand>      Manage configuration (get, set, unset, list)
  sessions                 List all daemon-tracked sessions
  daemon <subcommand>      Manage the background daemon (start, stop, status, kill)
  statusline               Render the status line (used by hooks)
  dev-mode <subcommand>    Manage development hooks (enable, disable, status, clean)
  ui                       Launch the web UI
  setup                    Run the setup wizard (configure statusline, API keys)
  install                  Alias for setup
  doctor [--fix]           Check sidekick health (--fix to auto-repair)
  uninstall [--force]      Remove sidekick (plugin, hooks, settings, data)

Global Options:
  --help, -h               Show this help message
  --version, -v            Show version number
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
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { parsed, runtime, hookInput, stdout } = context

  runtime.logger.debug('Raw hook input', { hookInput })

  // Handle global help: no command or explicit 'help' command
  if (!parsed.command || parsed.command === 'help') {
    return showGlobalHelp(stdout)
  }

  // Handle unified hook command: sidekick hook <hook-name>
  // Outputs Claude Code format directly
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

    // Fail fast: hook execution requires explicit --project-dir
    // (Claude Code always provides this via $CLAUDE_PROJECT_DIR expansion)
    if (!parsed.projectDir) {
      const errorMsg = 'Hook command requires --project-dir to be specified\n'
      stdout.write(errorMsg)
      return { exitCode: 1, stdout: errorMsg, stderr: '' }
    }

    if (!hookInput) {
      runtime.logger.warn('Hook command invoked without valid hook input', { hookName })
      stdout.write('{}\n')
      return { exitCode: 0, stdout: '{}', stderr: '' }
    }

    if (!runtime.projectRoot) {
      runtime.logger.warn('Hook command invoked without project root', { hookName })
      stdout.write('{}\n')
      return { exitCode: 0, stdout: '{}', stderr: '' }
    }

    const result = await handleUnifiedHookCommand(
      hookName,
      {
        projectRoot: runtime.projectRoot,
        hookInput,
        correlationId: runtime.correlationId,
        runtime,
        forceDevMode: parsed.forceDevMode,
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
    const result = await handleDaemonCommand(subcommand, runtime.projectRoot || process.cwd(), runtime.logger, stdout, {
      wait: parsed.wait,
    })
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
    const result = await handleStatuslineCommand(runtime.projectRoot || process.cwd(), runtime.logger, stdout, {
      format: statuslineFormat,
      sessionId,
      hookInput: parsedHookInput,
      configService: runtime.config,
      assets: runtime.assets,
      help: parsed.help,
      forceDevMode: parsed.forceDevMode,
    })
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }

  if (parsed.command === 'ui') {
    const { handleUiCommand } = await import('./commands/ui.js')
    const result = await handleUiCommand(runtime.logger, stdout, {
      port: parsed.port,
      host: parsed.host,
      open: parsed.open,
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
      runtime.projectRoot || process.cwd(),
      runtime.logger,
      stdout,
      {
        sessionId: parsed.sessionIdArg,
        format: parsed.format === 'json' || parsed.format === 'table' ? parsed.format : undefined,
        testType: parsed.messageType,
        width: parsed.width,
        scope: parsed.scope === 'user' || parsed.scope === 'project' ? parsed.scope : undefined,
        assets: runtime.assets,
      }
    )
    return { exitCode: result.exitCode, stdout: result.output, stderr: '' }
  }

  if (parsed.command === 'config') {
    const { handleConfigCommand } = await import('./commands/config.js')
    const subcommand = parsed.help ? '--help' : (parsed._?.[1] as string | undefined)
    const args = parsed._?.slice(2) ?? []

    const result = handleConfigCommand(subcommand, args, runtime.projectRoot || process.cwd(), runtime.logger, stdout, {
      scope: parsed.scope as 'user' | 'project' | 'local' | undefined,
      format: parsed.format === 'json' ? 'json' : undefined,
      assets: runtime.assets,
    })
    return { exitCode: result.exitCode, stdout: result.output, stderr: '' }
  }

  if (parsed.command === 'sessions') {
    const { handleSessionsCommand } = await import('./commands/sessions.js')
    const result = await handleSessionsCommand(runtime.projectRoot || process.cwd(), runtime.logger, stdout, {
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
      runtime.projectRoot || process.cwd(),
      runtime.logger,
      stdout,
      { force: Boolean(parsed.force) }
    )
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }

  if (parsed.command === 'setup' || parsed.command === 'install') {
    const { handleSetupCommand } = await import('./commands/setup.js')
    const result = await handleSetupCommand(runtime.projectRoot || process.cwd(), runtime.logger, stdout, {
      help: parsed.help,
      checkOnly: parsed.check,
      fix: parsed.fix,
      force: parsed.force,
      only: parsed.only,
      stdin: process.stdin,
      // Scripting flags for non-interactive setup
      statuslineScope: parsed.statuslineScope,
      gitignore: parsed.gitignore,
      personas: parsed.personas,
      apiKeyScope: parsed.apiKeyScope,
      autoConfig: parsed.autoConfig,
      marketplaceScope: parsed.marketplaceScope,
      pluginScope: parsed.pluginScope,
      alias: parsed.alias,
      userProfileName: parsed.userProfileName,
      userProfileRole: parsed.userProfileRole,
      userProfileInterests: parsed.userProfileInterests,
    })
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }

  if (parsed.command === 'uninstall') {
    if (parsed.help) {
      const helpText = `Usage: sidekick uninstall [options]

Remove sidekick from user and/or project scope (plugin, hooks, settings, data).

Options:
  --force                  Skip confirmation prompts
  --dry-run                Show what would be removed without acting
  --scope=<user|project>   Limit uninstall to a specific scope

Examples:
  sidekick uninstall
  sidekick uninstall --dry-run
  sidekick uninstall --force --scope=project
`
      stdout.write(helpText)
      return { exitCode: 0, stdout: helpText, stderr: '' }
    }
    const { handleUninstallCommand } = await import('./commands/uninstall.js')
    const result = await handleUninstallCommand(runtime.projectRoot || process.cwd(), runtime.logger, stdout, {
      force: Boolean(parsed.force),
      dryRun: Boolean(parsed['dry-run']),
      scope: parsed.scope as 'user' | 'project' | undefined,
      stdin: process.stdin,
    })
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }

  if (parsed.command === 'doctor') {
    const { runDoctor } = await import('./commands/setup/doctor.js')
    return runDoctor(runtime.projectRoot || process.cwd(), runtime.logger, stdout, {
      fix: parsed.fix,
      only: parsed.only,
    }).then((r) => ({ exitCode: r.exitCode, stdout: '', stderr: '' }))
  }

  // Unknown command - show error and hint
  const errorMsg = `Unknown command: ${parsed.command}\nRun 'sidekick help' for available commands.\n`
  stdout.write(errorMsg)
  return { exitCode: 1, stdout: errorMsg, stderr: '' }
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

  // Handle --version early, before any runtime initialization
  const quickParsed = yargsParser(options.argv, {
    boolean: ['version'],
    alias: { v: 'version' },
  })
  if (quickParsed.version) {
    const versionOutput = `${VERSION}\n`
    stdout.write(versionOutput)
    return { exitCode: 0, stdout: versionOutput, stderr: '' }
  }

  // 1. Initialize runtime (synchronous)
  let initResult: InitializeRuntimeResult
  try {
    initResult = initializeRuntime(options)
  } catch (err) {
    if (err instanceof UnknownOptionError) {
      const errorMsg = `Error: ${err.message}\nRun 'sidekick --help' for available options.\n`
      stdout.write(errorMsg)
      return { exitCode: 1, stdout: errorMsg, stderr: '' }
    }
    throw err
  }
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

  // 3. Route command to appropriate handler
  // Note: daemon startup is handled inside handleUnifiedHookCommand (after auto-configure)
  const result = await routeCommand({
    parsed,
    runtime,
    hookInput,
    stdout,
  })

  // 4. Persist CLI log metrics (async, no-throw)
  if (sessionId) {
    await persistCliLogMetrics(runtime.stateService, sessionId, runtime.getLogCounts(), runtime.logger)
  }

  // 5. Flush logger to ensure async file transport writes complete
  await runtime.logger.flush()

  return result
}
