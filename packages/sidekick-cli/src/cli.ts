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
 *
 * @see docs/design/CLI.md §3 Hook Wrapper Layer
 * @see docs/design/CLI.md §9 Process Model for Hooks
 */

import { PassThrough, Writable } from 'node:stream'
import yargsParser from 'yargs-parser'

import { bootstrapRuntime } from './runtime'

interface ParsedArgs {
  command: string
  hookMode: boolean
  hookScriptPath?: string
  projectDir?: string
  scopeOverride?: 'user' | 'project'
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  wait?: boolean
  format?: 'text' | 'json'
  sessionId?: string
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
    boolean: ['hook', 'wait'],
    string: ['hook-script-path', 'project-dir', 'scope', 'log-level', 'format', 'session-id'],
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
    sessionId: parsed['session-id'] as string | undefined,
    _: parsed._,
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

  // Auto-start supervisor on hook mode (not interactive mode)
  if (parsed.hookMode && runtime.scope.projectRoot) {
    try {
      const { SupervisorClient } = await import('@sidekick/core')
      const supervisorClient = new SupervisorClient(runtime.scope.projectRoot, runtime.logger)
      await supervisorClient.start()
      runtime.logger.debug('Supervisor auto-started for hook execution')
    } catch (err) {
      // Graceful degradation: log warning but don't fail the hook
      const error = err instanceof Error ? err : new Error(String(err))
      runtime.logger.warn('Failed to auto-start supervisor, proceeding with sync paths', {
        error: error.message,
      })
    }
  }

  const payload = {
    command: parsed.command,
    status: 'ok' as const,
    message: 'Node runtime skeleton ready',
    scope: runtime.scope.scope,
    projectRoot: runtime.scope.projectRoot ?? null,
    hookScriptPath: runtime.scope.hookScriptPath ?? null,
    config: {
      logLevel: runtime.config.core.logging.level,
      llmProvider: runtime.config.llm.provider,
      configSources: runtime.config.sources,
    },
    assets: {
      cascadeLayers: runtime.assets.cascadeLayers,
    },
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
      sessionId: parsed.sessionId,
    })
    return { exitCode: result.exitCode, stdout: '', stderr: '' }
  }

  if (parsed.hookMode) {
    stdout.write(`${JSON.stringify(payload)}\n`)
  } else {
    stdout.write(`Sidekick CLI stub executed ${parsed.command} in ${runtime.scope.scope} scope\n`)
  }

  return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
}
