/**
 * UI Command Handler
 *
 * Implements CLI command for launching the Sidekick Monitoring UI.
 *
 * Command: sidekick ui [--port PORT] [--host HOST] [--no-open]
 *
 * Features:
 * - Launches the production UI server
 * - Prints accessible URL
 * - Optionally opens browser (default: yes, disable with --no-open)
 * - Handles graceful shutdown on SIGINT/SIGTERM
 *
 * @see docs/ROADMAP.md Phase 7.E.2
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { resolve, join } from 'node:path'
import type { Logger } from '@sidekick/core'

export interface UiCommandOptions {
  port?: number
  host?: string
  open?: boolean
  preferProject?: boolean
}

export interface UiCommandResult {
  exitCode: number
}

/**
 * Resolve path to the UI package's production server script.
 */
function resolveProductionServer(): string {
  // This file is in packages/sidekick-cli/dist/commands/ui.js
  // We need packages/sidekick-ui/server/production.js
  // In CommonJS, __dirname points to the directory containing the current file
  const cliCommandsDir = __dirname // dist/commands
  const cliPackageDir = resolve(cliCommandsDir, '..', '..') // packages/sidekick-cli
  const workspaceRoot = resolve(cliPackageDir, '..') // packages/
  return join(workspaceRoot, 'sidekick-ui', 'server', 'production.js')
}

/**
 * Attempt to open URL in default browser (best-effort, cross-platform).
 */
function openBrowser(url: string, logger: Logger): void {
  const platform = process.platform
  let command: string
  let args: string[]

  // Determine platform-specific open command
  if (platform === 'darwin') {
    command = 'open'
    args = [url]
  } else if (platform === 'win32') {
    command = 'cmd'
    args = ['/c', 'start', url]
  } else {
    // Linux/Unix - try xdg-open
    command = 'xdg-open'
    args = [url]
  }

  try {
    const proc = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    })
    proc.unref()
    logger.debug('Browser open command executed', { command, url })
  } catch (err) {
    // Best-effort - don't fail if browser opening fails
    logger.warn('Failed to open browser', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Handle the `sidekick ui` command.
 */
export async function handleUiCommand(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: UiCommandOptions = {}
): Promise<UiCommandResult> {
  const port = options.port ?? 3000
  const host = options.host ?? 'localhost'
  const shouldOpen = options.open !== false // Default: true
  const preferProject = options.preferProject !== false

  const serverScript = resolveProductionServer()
  const url = `http://${host}:${port}`

  // Build arguments for production server
  const args: string[] = ['--port', String(port)]
  if (!preferProject) {
    args.push('--prefer-user')
  }

  logger.info('Starting Sidekick UI server', { port, host, serverScript })

  // Spawn the production server as a child process
  const serverProcess: ChildProcess = spawn('node', [serverScript, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], // Pipe stdout/stderr so we can capture output
    cwd: projectDir,
  })

  // Track if server started successfully
  let serverStarted = false

  // Forward server output to stdout
  if (serverProcess.stdout) {
    serverProcess.stdout.on('data', (data: Buffer) => {
      const output = data.toString()
      stdout.write(output)

      // Detect when server is listening
      if (!serverStarted && output.includes('Server listening')) {
        serverStarted = true

        // Print user-friendly message
        stdout.write(`\n`)
        stdout.write(`Sidekick UI running at ${url}\n`)
        stdout.write(`Press Ctrl+C to stop\n`)
        stdout.write(`\n`)

        // Open browser if requested
        if (shouldOpen) {
          openBrowser(url, logger)
        }
      }
    })
  }

  if (serverProcess.stderr) {
    serverProcess.stderr.on('data', (data: Buffer) => {
      stdout.write(data.toString())
    })
  }

  // Handle server process exit
  serverProcess.on('exit', (code, signal) => {
    if (signal) {
      logger.info('UI server terminated by signal', { signal })
    } else if (code !== 0 && code !== null) {
      logger.error('UI server exited with error', { exitCode: code })
    } else {
      logger.info('UI server stopped')
    }
  })

  // Graceful shutdown on SIGINT/SIGTERM
  const shutdown = (signal: string): void => {
    logger.debug('Received shutdown signal, stopping UI server', { signal })
    stdout.write(`\nShutting down UI server...\n`)

    if (serverProcess.pid) {
      serverProcess.kill('SIGTERM')

      // Give server 5 seconds to shut down gracefully, then force kill
      const killTimer = setTimeout(() => {
        if (serverProcess.exitCode === null) {
          logger.warn('UI server did not stop gracefully, force killing')
          serverProcess.kill('SIGKILL')
        }
      }, 5000)

      serverProcess.on('exit', () => {
        clearTimeout(killTimer)
      })
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Wait for server process to exit
  return new Promise((resolve) => {
    serverProcess.on('exit', (code) => {
      resolve({ exitCode: code ?? 0 })
    })
  })
}
