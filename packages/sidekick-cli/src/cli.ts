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
 * - Hook event dispatch to Supervisor via IPC (Phase 8)
 *
 * @see docs/design/CLI.md §3 Hook Wrapper Layer
 * @see docs/design/CLI.md §3.1.1 Hook Input Structure
 * @see docs/design/CLI.md §9 Process Model for Hooks
 * @see docs/design/flow.md §5 Complete Hook Flows
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import yargsParser from 'yargs-parser'

import type { ParsedHookInput } from '@sidekick/types'
import { bootstrapRuntime } from './runtime'
import { getHookName, handleHookCommand, isHookCommand } from './commands/hook.js'

interface ParsedArgs {
  command: string
  hookMode: boolean
  hookScriptPath?: string
  projectDir?: string
  scopeOverride?: 'user' | 'project'
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  wait?: boolean
  format?: 'text' | 'json'
  port?: number
  host?: string
  open?: boolean
  preferProject?: boolean
  sessionIdArg?: string
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
    boolean: ['hook', 'wait', 'open', 'prefer-project'],
    string: ['hook-script-path', 'project-dir', 'scope', 'log-level', 'format', 'host', 'session-id'],
    number: ['port'],
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
    logLevel: (parsed['log-level'] as ParsedArgs['logLevel']) ?? 'info',
    wait: Boolean(parsed.wait),
    format: parsed.format as 'text' | 'json' | undefined,
    port: parsed.port as number | undefined,
    host: parsed.host as string | undefined,
    open: parsed.open as boolean | undefined,
    preferProject: parsed['prefer-project'] as boolean | undefined,
    sessionIdArg: parsed['session-id'] as string | undefined,
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
function parseHookInput(stdinData: string | undefined): ParsedHookInput | undefined {
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
 * Execute the Sidekick Node CLI entrypoint.
 *
 * This function is intentionally side-effect free aside from writes to the provided output streams,
 * making it easy to exercise via unit tests without spawning a separate process.
 */
export async function runCli(options: RunCliOptions): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = options.stdout ?? new PassThrough()
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

  if (runtime.scope.dualInstallDetected && parsed.scopeOverride !== 'project') {
    runtime.logger.warn('User-scope hook detected project installation. Exiting to prevent duplicate execution.')
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }

  // Session ID can come from CLI arg (--session-id) or hook input (stdin JSON)
  // CLI arg takes precedence for interactive commands like statusline
  const sessionId = parsed.sessionIdArg ?? hookInput?.sessionId
  if (sessionId && runtime.scope.projectRoot) {
    const sessionDir = join(runtime.scope.projectRoot, '.sidekick', 'sessions', sessionId)
    try {
      await mkdir(sessionDir, { recursive: true })
      runtime.logger.debug('Session directory created', { sessionId, sessionDir })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      runtime.logger.warn('Failed to create session directory', { sessionId, error: error.message })
    }
  }

  // Auto-start supervisor on hook mode (not interactive mode)
  let supervisorStarted = false
  if (parsed.hookMode && runtime.scope.projectRoot) {
    try {
      const { SupervisorClient } = await import('@sidekick/core')
      const supervisorClient = new SupervisorClient(runtime.scope.projectRoot, runtime.logger)
      await supervisorClient.start()
      supervisorStarted = true
      runtime.logger.debug('Supervisor auto-started for hook execution')
    } catch (err) {
      // Graceful degradation: log warning but don't fail the hook
      const error = err instanceof Error ? err : new Error(String(err))
      runtime.logger.warn('Failed to auto-start supervisor, proceeding with sync paths', {
        error: error.message,
      })
    }
  }

  // Handle hook commands by dispatching to supervisor (Phase 8)
  // Per docs/design/flow.md §5: CLI sends event to Supervisor via IPC
  if (parsed.hookMode && isHookCommand(parsed.command) && hookInput && runtime.scope.projectRoot) {
    const hookName = getHookName(parsed.command)
    if (hookName) {
      const result = await handleHookCommand(
        hookName,
        {
          projectRoot: runtime.scope.projectRoot,
          sessionId: hookInput.sessionId,
          hookInput,
          correlationId: runtime.correlationId,
          scope: runtime.scope.scope,
        },
        runtime.logger,
        stdout
      )
      return { exitCode: result.exitCode, stdout: result.output, stderr: '' }
    }
  }

  // Fallback: If hook input is missing or not recognized, return empty response
  // This handles edge cases like malformed stdin or unknown hook types
  if (parsed.hookMode && !hookInput) {
    runtime.logger.warn('Hook mode invoked without valid hook input, returning empty response', {
      command: parsed.command,
      supervisorStarted,
    })
    stdout.write('{}\n')
    return { exitCode: 0, stdout: '{}', stderr: '' }
  }

  if (parsed.command === 'supervisor') {
    const subcommand = (parsed._ && (parsed._[1] as string)) || 'status'
    const { handleSupervisorCommand } = await import('./commands/supervisor.js')
    const result = await handleSupervisorCommand(
      subcommand,
      runtime.scope.projectRoot || process.cwd(),
      runtime.logger,
      stdout,
      { wait: parsed.wait }
    )
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }

  if (parsed.command === 'statusline') {
    const { handleStatuslineCommand } = await import('./commands/statusline.js')
    const result = await handleStatuslineCommand(runtime.scope.projectRoot || process.cwd(), runtime.logger, stdout, {
      format: parsed.format,
      sessionId,
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

  // Interactive mode: show informational message
  // Hook mode falls through here only if command isn't recognized as a hook
  if (!parsed.hookMode) {
    stdout.write(`Sidekick CLI executed ${parsed.command} in ${runtime.scope.scope} scope\n`)
  }

  return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
}
