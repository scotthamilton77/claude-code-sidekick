/**
 * I/O operations extracted from Daemon class: PID files, auth tokens,
 * file cleanup, and process-level error handlers.
 *
 * These functions perform filesystem and process operations but have no
 * dependency on Daemon instance state — they accept all context as parameters.
 *
 * @see docs/design/CLI.md §7 Daemon Lifecycle Management
 * @see docs/design/DAEMON.md §5 Error Handling
 */
import { getPidPath, getTokenPath, getUserPidPath, getUserDaemonsDir, type Logger } from '@sidekick/core'
import { randomBytes } from 'crypto'
import fs from 'fs/promises'
import path from 'path'

/**
 * Write PID files to both project-level and user-level locations.
 *
 * Project-level: .sidekick/daemon.pid (simple PID number)
 * User-level: ~/.sidekick/daemons/{hash}.pid (JSON with project path and PID)
 *
 * @param projectDir - Project root directory
 */
export async function writePid(projectDir: string): Promise<void> {
  // Project-level PID file (simple PID for backward compatibility)
  const pidPath = getPidPath(projectDir)
  await fs.mkdir(path.dirname(pidPath), { recursive: true })
  await fs.writeFile(pidPath, process.pid.toString(), 'utf-8')

  // User-level PID file for --kill-all discovery
  const userPidPath = getUserPidPath(projectDir)
  await fs.mkdir(getUserDaemonsDir(), { recursive: true })
  const userPidData = JSON.stringify({
    pid: process.pid,
    projectDir,
    startedAt: new Date().toISOString(),
  })
  await fs.writeFile(userPidPath, userPidData, 'utf-8')
}

/**
 * Generate and persist the IPC auth token.
 *
 * Format: 64-char hex string from 32 cryptographically random bytes.
 * Written with mode 0600 so only the owning user can read it.
 * Deleted on shutdown (cleanup) or stale-file recovery (DaemonClient).
 *
 * @param projectDir - Project root directory
 * @returns The generated token string
 */
export async function writeToken(projectDir: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const tokenPath = getTokenPath(projectDir)
  await fs.mkdir(path.dirname(tokenPath), { recursive: true })
  await fs.writeFile(tokenPath, token, { mode: 0o600, encoding: 'utf-8' })
  return token
}

/**
 * Clean up all daemon files on shutdown.
 * Removes project-level PID, token, and user-level PID files.
 *
 * @param projectDir - Project root directory
 */
export async function cleanup(projectDir: string): Promise<void> {
  const filesToRemove = [
    getPidPath(projectDir),
    getTokenPath(projectDir),
    getUserPidPath(projectDir), // User-level PID for --kill-all discovery
    // Socket is cleaned up by IpcServer
  ]

  for (const file of filesToRemove) {
    try {
      await fs.unlink(file)
    } catch {
      // File may not exist
    }
  }
}

/**
 * Set up process-level error handlers for uncaught exceptions and unhandled rejections.
 * Per design/DAEMON.md §5: Log fatal error to sidekickd.log, attempt graceful cleanup, exit.
 * CLI will restart the daemon on next run.
 *
 * @param logger - Logger instance for fatal error output
 * @param projectDir - Project root directory (for log context)
 * @param cleanupFn - Async cleanup function to call before exit
 */
export function setupErrorHandlers(logger: Logger, projectDir: string, cleanupFn: () => Promise<void>): void {
  // Track if we're already handling a fatal error to prevent recursion
  let isHandlingFatalError = false

  /**
   * Handle fatal errors: log, attempt cleanup, exit.
   * Uses synchronous cleanup where possible since process may be in unstable state.
   */
  const handleFatalError = (type: string, error: unknown): void => {
    // Prevent recursion if cleanup itself throws
    if (isHandlingFatalError) {
      // Last resort: write to stderr and exit immediately
      console.error(`Recursive fatal error during ${type} handling:`, error)
      process.exit(1)
    }
    isHandlingFatalError = true

    // Log the fatal error to sidekickd.log
    logger.fatal(`Fatal ${type}`, {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      pid: process.pid,
      projectDir,
    })

    // Attempt graceful cleanup (best-effort, may fail if process is unstable)
    // We use cleanupFn() which removes PID, token, and user PID files
    // IPC server and task engine may already be in bad state, so we skip them
    void cleanupFn().finally(() => {
      process.exit(1)
    })
  }

  // Handle uncaught synchronous exceptions
  process.on('uncaughtException', (err: Error) => {
    handleFatalError('uncaughtException', err)
  })

  // Handle unhandled promise rejections (async errors that weren't caught)
  process.on('unhandledRejection', (reason: unknown) => {
    handleFatalError('unhandledRejection', reason)
  })

  logger.debug('Process error handlers installed')
}
