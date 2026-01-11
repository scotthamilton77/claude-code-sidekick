/**
 * Daemon Client Facade
 *
 * High-level client for managing the Daemon lifecycle (start/stop/status)
 * and communicating via IPC.
 *
 * @see docs/design/CLI.md §7 Daemon Lifecycle Management
 */
import { spawn } from 'child_process'
import fs from 'fs/promises'
import { constants as fsConstants } from 'fs'
import path from 'path'
import { IpcClient } from './ipc/client.js'
import {
  getLockPath,
  getPidPath,
  getSocketPath,
  getTokenPath,
  getUserPidPath,
  getUserDaemonsDir,
} from './ipc/transport.js'
import { Logger } from './logger.js'

/**
 * Lockfile timeout and retry settings for daemon startup serialization.
 */
const LOCK_TIMEOUT_MS = 10000 // Max time to wait for lock
const LOCK_RETRY_INTERVAL_MS = 100 // Polling interval when waiting for lock
const LOCK_STALE_THRESHOLD_MS = 30000 // Consider lock stale if older than this

/**
 * User-level PID file format for --kill-all discovery.
 */
export interface UserPidInfo {
  pid: number
  projectDir: string
  startedAt: string
}

interface PackageJson {
  version?: string
  bin?: string | Record<string, string>
  main?: string
}

interface HandshakeResponse {
  version: string
  status: string
}

// Read version from root package.json (single source of truth for monorepo)
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const CLIENT_VERSION: string = require('../../../package.json').version

export class DaemonClient {
  private projectDir: string
  private logger: Logger
  private ipcClient: IpcClient
  private token: string | null = null

  constructor(projectDir: string, logger: Logger) {
    this.projectDir = projectDir
    this.logger = logger
    this.ipcClient = new IpcClient(getSocketPath(projectDir), logger)
  }

  async start(): Promise<void> {
    // Use lockfile to serialize concurrent startup attempts
    await this.withStartupLock(async () => {
      // Clean up stale files if process died without cleanup
      await this.cleanupStaleFiles()

      if (await this.isRunning()) {
        // Check version compatibility
        const versionMatch = await this.checkVersion()
        if (versionMatch) {
          this.logger.debug('Daemon already running with matching version')
          return
        }

        // Version mismatch - stop old daemon before spawning new
        this.logger.info('Version mismatch, restarting daemon', {
          clientVersion: CLIENT_VERSION,
        })
        await this.stop()
        await this.waitForShutdown()
      }

      this.logger.info('Starting daemon...')

      // Resolve daemon entry point
      let daemonPath: string
      try {
        const pkgPath = require.resolve('@sidekick/daemon/package.json')
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
        const pkg: PackageJson = require(pkgPath)
        const binPath = pkg.bin ? (typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['sidekickd']) : pkg.main
        daemonPath = path.resolve(path.dirname(pkgPath), binPath ?? 'dist/index.js')
      } catch {
        // Fallback for dev environment: from dist/ → packages/sidekick-daemon/dist/
        daemonPath = path.resolve(__dirname, '../../sidekick-daemon/dist/index.js')
      }

      const child = spawn('node', [daemonPath, this.projectDir], {
        detached: true,
        stdio: 'ignore',
        cwd: this.projectDir,
      })

      child.unref()

      // Wait for startup
      await this.waitForStartup()
    })
  }

  /**
   * Execute a function while holding the startup lock.
   * Prevents race conditions when multiple hooks try to start the daemon.
   */
  private async withStartupLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockPath = getLockPath(this.projectDir)
    const startTime = Date.now()

    // Ensure .sidekick directory exists
    await fs.mkdir(path.dirname(lockPath), { recursive: true })

    while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
      try {
        // Try to create lockfile exclusively (O_CREAT | O_EXCL)
        const handle = await fs.open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY)

        // Write our PID and timestamp for debugging
        await handle.write(JSON.stringify({ pid: process.pid, timestamp: Date.now() }))
        await handle.close()

        this.logger.debug('Acquired startup lock', { lockPath, pid: process.pid })

        try {
          return await fn()
        } finally {
          // Release lock
          await this.releaseLock(lockPath)
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          // Lock exists - check if it's stale
          if (await this.isLockStale(lockPath)) {
            this.logger.debug('Removing stale lock', { lockPath })
            await fs.unlink(lockPath).catch(() => {})
            continue // Retry immediately
          }

          // Lock is held by another process, wait and retry
          this.logger.debug('Waiting for startup lock', { lockPath })
          await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS))
          continue
        }
        // Other error - rethrow
        throw err
      }
    }

    // Timeout - force remove lock and proceed (defensive)
    this.logger.warn('Lock acquisition timeout, forcing removal', { lockPath })
    await fs.unlink(lockPath).catch(() => {})
    return fn()
  }

  /**
   * Check if a lockfile is stale (owner process dead or too old).
   */
  private async isLockStale(lockPath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(lockPath, 'utf-8')
      const lockInfo = JSON.parse(content) as { pid: number; timestamp: number }

      // Check if lock is too old
      if (Date.now() - lockInfo.timestamp > LOCK_STALE_THRESHOLD_MS) {
        return true
      }

      // Check if owning process is still alive
      try {
        process.kill(lockInfo.pid, 0)
        return false // Process is alive
      } catch {
        return true // Process is dead
      }
    } catch {
      // Can't read/parse lock - consider it stale
      return true
    }
  }

  /**
   * Release the startup lock.
   */
  private async releaseLock(lockPath: string): Promise<void> {
    try {
      await fs.unlink(lockPath)
      this.logger.debug('Released startup lock', { lockPath })
    } catch {
      // Lock may have been forcefully removed - that's ok
    }
  }

  /**
   * Request daemon shutdown (fire-and-forget).
   * Sends shutdown request, receives ack, closes connection immediately.
   * Daemon self-terminates asynchronously after ack.
   */
  async stop(): Promise<void> {
    if (!(await this.isRunning())) {
      return
    }

    try {
      await this.ipcClient.connect()
      this.token = await this.readToken()

      // Handshake
      await this.ipcClient.call('handshake', { token: this.token })

      // Shutdown - daemon returns ack immediately, then self-terminates
      await this.ipcClient.call('shutdown', { token: this.token })

      // Close connection immediately after ack (don't wait for daemon to terminate)
      this.ipcClient.close()
    } catch (err) {
      this.logger.warn('Failed to stop daemon gracefully, killing...', { error: err })
      await this.killForcefully()
    }
  }

  /**
   * Request daemon shutdown and wait for it to stop.
   * Polls isRunning() every 1 second until daemon stops or timeout.
   *
   * @param timeoutMs - Maximum time to wait (default: 30000ms)
   * @returns true if daemon stopped, false if timeout reached
   */
  async stopAndWait(timeoutMs = 30000): Promise<boolean> {
    await this.stop()

    const pollIntervalMs = 1000
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      if (!(await this.isRunning())) {
        return true
      }
    }

    return false
  }

  async getStatus(): Promise<{ status: string; ping?: unknown; error?: unknown }> {
    const running = await this.isRunning()
    if (!running) {
      return { status: 'stopped' }
    }

    try {
      await this.ipcClient.connect()
      this.token = await this.readToken()
      await this.ipcClient.call('handshake', { token: this.token })
      const pong = await this.ipcClient.call('ping', { token: this.token })
      this.ipcClient.close()
      return { status: 'running', ping: pong }
    } catch (err) {
      return { status: 'unresponsive', error: err }
    }
  }

  /**
   * Forcefully kill the project-local daemon (--kill switch).
   * Does not attempt graceful shutdown via IPC - just sends SIGKILL.
   * Cleans up all associated files after kill.
   *
   * @see docs/design/CLI.md §7 Daemon Lifecycle Management
   */
  async kill(): Promise<{ killed: boolean; pid?: number }> {
    if (!(await this.isRunning())) {
      // Check for stale files and clean them up
      await this.cleanupStaleFiles()
      return { killed: false }
    }

    try {
      const pidPath = getPidPath(this.projectDir)
      const pid = parseInt(await fs.readFile(pidPath, 'utf-8'), 10)
      process.kill(pid, 'SIGKILL')
      this.logger.info('Forcefully killed daemon', { pid, projectDir: this.projectDir })

      // Clean up files after kill
      await this.cleanupStaleFiles()
      return { killed: true, pid }
    } catch (err) {
      this.logger.warn('Failed to kill daemon', { error: err })
      // Still try to clean up any stale files
      await this.cleanupStaleFiles()
      return { killed: false }
    }
  }

  private async isRunning(): Promise<boolean> {
    try {
      const pidPath = getPidPath(this.projectDir)
      const pid = parseInt(await fs.readFile(pidPath, 'utf-8'), 10)
      process.kill(pid, 0) // Check if process exists
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if running daemon version matches client version.
   * Per design/DAEMON.md §2.2: Version mismatch triggers restart.
   */
  private async checkVersion(): Promise<boolean> {
    try {
      await this.ipcClient.connect()
      this.token = await this.readToken()
      const response = (await this.ipcClient.call('handshake', {
        token: this.token,
      })) as HandshakeResponse
      this.ipcClient.close()

      const match = response.version === CLIENT_VERSION
      if (!match) {
        this.logger.debug('Daemon version mismatch', {
          daemonVersion: response.version,
          clientVersion: CLIENT_VERSION,
        })
      }
      return match
    } catch (err) {
      this.logger.warn('Failed to check daemon version', { error: err })
      // On error, assume mismatch to trigger restart
      return false
    }
  }

  /**
   * Wait for daemon to fully shut down (files removed).
   */
  private async waitForShutdown(timeoutMs = 5000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (!(await this.isRunning())) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    this.logger.warn('Daemon did not shut down within timeout, forcing kill')
    await this.killForcefully()
    await this.cleanupStaleFiles()
  }

  /**
   * Remove stale daemon files when process is dead but files remain.
   * Per design/DAEMON.md §2.2: "If process dead: Remove stale .pid, .sock, .token files"
   */
  private async cleanupStaleFiles(): Promise<void> {
    const pidPath = getPidPath(this.projectDir)

    try {
      const pidContent = await fs.readFile(pidPath, 'utf-8')
      const pid = parseInt(pidContent, 10)

      try {
        process.kill(pid, 0)
        // Process is alive, don't cleanup
        return
      } catch {
        // Process is dead, cleanup stale files
        this.logger.info('Cleaning up stale daemon files', { pid })
      }
    } catch {
      // No PID file, nothing to cleanup
      return
    }

    // Remove stale files (including user-level PID for --kill-all discovery)
    const filesToRemove = [
      getPidPath(this.projectDir),
      getSocketPath(this.projectDir),
      getTokenPath(this.projectDir),
      getUserPidPath(this.projectDir),
      getLockPath(this.projectDir),
    ]

    for (const file of filesToRemove) {
      try {
        await fs.unlink(file)
        this.logger.debug('Removed stale file', { file })
      } catch {
        // File may not exist
      }
    }
  }

  private async killForcefully(): Promise<void> {
    try {
      const pidPath = getPidPath(this.projectDir)
      const pid = parseInt(await fs.readFile(pidPath, 'utf-8'), 10)
      process.kill(pid, 'SIGKILL')
    } catch {
      // Process may not exist
    }
  }

  private async waitForStartup(timeoutMs = 5000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.isRunning()) {
        // Also check if socket exists
        try {
          await fs.access(getSocketPath(this.projectDir))
          return
        } catch {
          // Socket not ready yet
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Daemon failed to start within timeout')
  }

  private async readToken(): Promise<string> {
    return fs.readFile(getTokenPath(this.projectDir), 'utf-8')
  }
}

/**
 * Result of killing a single daemon during --kill-all.
 */
export interface KillResult {
  projectDir: string
  pid: number
  killed: boolean
  error?: string
}

/**
 * Kill all daemons by scanning ~/.sidekick/daemons/*.pid files.
 *
 * Used for the --kill-all CLI switch. Iterates through all user-level PID files,
 * verifies each process is alive, sends SIGKILL, and cleans up associated files.
 *
 * @param logger - Logger instance for reporting
 * @returns Array of results for each daemon found
 *
 * @see docs/design/CLI.md §7 Daemon Lifecycle Management
 */
export async function killAllDaemons(logger: Logger): Promise<KillResult[]> {
  const results: KillResult[] = []
  const daemonsDir = getUserDaemonsDir()

  let files: string[]
  try {
    files = await fs.readdir(daemonsDir)
  } catch {
    // Directory doesn't exist - no daemons running
    logger.debug('No daemons directory found', { path: daemonsDir })
    return results
  }

  const pidFiles = files.filter((f) => f.endsWith('.pid'))

  for (const pidFile of pidFiles) {
    const pidPath = path.join(daemonsDir, pidFile)

    try {
      const content = await fs.readFile(pidPath, 'utf-8')
      const info = JSON.parse(content) as UserPidInfo

      // Check if process is alive
      try {
        process.kill(info.pid, 0)
      } catch {
        // Process is dead, just clean up the stale file
        logger.debug('Cleaning up stale PID file', { pidFile, pid: info.pid })
        await fs.unlink(pidPath).catch(() => {})
        continue
      }

      // Process is alive, kill it
      try {
        process.kill(info.pid, 'SIGKILL')
        logger.info('Killed daemon', { pid: info.pid, projectDir: info.projectDir })
        results.push({ projectDir: info.projectDir, pid: info.pid, killed: true })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.warn('Failed to kill daemon', { pid: info.pid, error: errorMsg })
        results.push({ projectDir: info.projectDir, pid: info.pid, killed: false, error: errorMsg })
      }

      // Clean up user-level PID file
      await fs.unlink(pidPath).catch(() => {})

      // Also try to clean up project-level files
      const projectFiles = [getPidPath(info.projectDir), getSocketPath(info.projectDir), getTokenPath(info.projectDir)]
      for (const file of projectFiles) {
        await fs.unlink(file).catch(() => {})
      }
    } catch (err) {
      // Invalid JSON or read error - clean up the bad file
      logger.warn('Invalid PID file, removing', { pidFile, error: err instanceof Error ? err.message : String(err) })
      await fs.unlink(pidPath).catch(() => {})
    }
  }

  return results
}
