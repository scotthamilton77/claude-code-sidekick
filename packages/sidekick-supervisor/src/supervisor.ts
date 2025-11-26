import {
  createLogManager,
  getPidPath,
  getSocketPath,
  getTokenPath,
  getUserPidPath,
  getUserSupervisorsDir,
  IpcServer,
  loadConfig,
  Logger,
  LogManager,
  SidekickConfig,
} from '@sidekick/core'
import { randomBytes } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { ConfigWatcher, ConfigChangeEvent } from './config-watcher.js'
import { StateManager } from './state-manager.js'
import { TaskEngine } from './task-engine.js'

// Read version from package.json at startup
// Path is relative to dist/ output location
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const VERSION: string = require('../package.json').version

// Idle check interval (how often to check for idle timeout)
const IDLE_CHECK_INTERVAL_MS = 30 * 1000 // Check every 30 seconds

/**
 * Supervisor Process Entrypoint
 *
 * The Supervisor is a long-running background process responsible for:
 * 1. Single-writer state management (preventing race conditions)
 * 2. Background task execution (heavy compute offloading)
 * 3. IPC communication with the CLI
 *
 * @see LLD-SUPERVISOR.md
 */

export class Supervisor {
  private projectDir: string
  private config: SidekickConfig
  private logger: Logger
  private logManager: LogManager
  private stateManager: StateManager
  private taskEngine: TaskEngine
  private ipcServer: IpcServer
  private configWatcher: ConfigWatcher
  private token: string = ''
  private lastActivityTime: number = Date.now()
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null

  constructor(projectDir: string) {
    this.projectDir = projectDir

    // Load config from project
    this.config = loadConfig({ projectRoot: projectDir })

    // Initialize Logger
    const logDir = path.join(projectDir, '.sidekick', 'logs')
    this.logManager = createLogManager({
      name: 'supervisor',
      level: this.config.logLevel,
      destinations: {
        file: { path: path.join(logDir, 'supervisor.log') },
        console: { enabled: this.config.consoleLogging },
      },
    })
    this.logger = this.logManager.getLogger()

    // Initialize Components
    this.stateManager = new StateManager(path.join(projectDir, '.sidekick', 'state'), this.logger)
    this.taskEngine = new TaskEngine(this.logger)

    // Initialize Config Watcher for hot-reload (LLD-SUPERVISOR §4.3)
    this.configWatcher = new ConfigWatcher(projectDir, this.logger, this.handleConfigChange.bind(this))

    // Initialize IPC
    const socketPath = getSocketPath(projectDir)
    this.ipcServer = new IpcServer(socketPath, this.logger, this.handleIpcRequest.bind(this))
  }

  async start(): Promise<void> {
    try {
      this.logger.info('Supervisor starting', { projectDir: this.projectDir, pid: process.pid })

      // 1. Write PID file
      await this.writePid()

      // 2. Generate and write Token
      await this.writeToken()

      // 3. Initialize State Manager
      await this.stateManager.initialize()

      // 4. Start IPC Server
      await this.ipcServer.start()

      // 5. Start config watcher for hot-reload
      this.configWatcher.start()

      // 6. Start idle timeout checker
      this.startIdleCheck()

      this.logger.info('Supervisor started successfully')
    } catch (err) {
      this.logger.fatal('Failed to start supervisor', { error: err })
      await this.cleanup()
      process.exit(1)
    }
  }

  async stop(): Promise<void> {
    this.logger.info('Supervisor stopping')

    // Stop idle checker
    this.stopIdleCheck()

    // Stop config watcher
    this.configWatcher.stop()

    try {
      // Stop accepting new IPC
      await this.ipcServer.stop()
    } catch (err) {
      this.logger.error('Failed to stop IPC server', { error: err })
    }

    try {
      // Shutdown Task Engine - wait for running tasks to complete
      await this.taskEngine.shutdown(this.config.supervisor.shutdownTimeoutMs)
    } catch (err) {
      this.logger.error('Failed to shutdown task engine', { error: err })
    }

    // Cleanup files
    await this.cleanup()

    this.logger.info('Supervisor stopped')
    process.exit(0)
  }

  /**
   * Handle configuration file changes for hot-reload.
   * Per LLD-SUPERVISOR §4.3: Reload config in-memory on change.
   */
  private handleConfigChange(event: ConfigChangeEvent): void {
    this.logger.info('Configuration change detected', { file: event.file, eventType: event.eventType })

    // Reload configuration
    try {
      const newConfig = loadConfig({ projectRoot: this.projectDir })

      // Apply critical config changes immediately
      if (newConfig.logLevel !== this.config.logLevel) {
        this.logger.info('Log level changed, updating logger', {
          old: this.config.logLevel,
          new: newConfig.logLevel,
        })
        // Note: Full log level change would require recreating the logger
        // For now, we just note it. Full implementation would update the Pino level.
      }

      // Update stored config
      this.config = newConfig

      this.logger.info('Configuration reloaded successfully')
    } catch (err) {
      this.logger.error('Failed to reload configuration', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private async handleIpcRequest(method: string, params: unknown): Promise<unknown> {
    // Reset idle timer on any activity
    this.lastActivityTime = Date.now()

    this.logger.debug('IPC Request', { method })

    const p = params as Record<string, unknown> | undefined

    // Verify token for all requests except handshake (which validates it inside)
    if (method !== 'handshake') {
      const token = p?.token
      if (!token || token !== this.token) {
        this.logger.warn('Unauthorized IPC request', { method })
        throw new Error('Unauthorized')
      }
    }

    switch (method) {
      case 'handshake':
        return this.handleHandshake(p)
      case 'shutdown':
        return this.stop()
      case 'state.update':
        return this.stateManager.update(
          p?.file as string,
          p?.data as Record<string, unknown>,
          p?.merge as boolean | undefined
        )
      case 'task.enqueue':
        return this.taskEngine.enqueue(
          p?.type as string,
          p?.payload as Record<string, unknown>,
          p?.priority as number | undefined
        )
      case 'ping':
        return 'pong'
      default:
        throw new Error(`Method not found: ${method}`)
    }
  }

  private handleHandshake(params: Record<string, unknown> | undefined): { version: string; status: string } {
    if (params?.token !== this.token) {
      throw new Error('Invalid token')
    }
    return { version: VERSION, status: 'ok' }
  }

  /**
   * Write PID files to both project-level and user-level locations.
   *
   * Project-level: .sidekick/supervisor.pid (simple PID number)
   * User-level: ~/.sidekick/supervisors/{hash}.pid (JSON with project path and PID)
   *
   * @see LLD-CLI.md §7 Supervisor Lifecycle Management
   */
  private async writePid(): Promise<void> {
    // Project-level PID file (simple PID for backward compatibility)
    const pidPath = getPidPath(this.projectDir)
    await fs.mkdir(path.dirname(pidPath), { recursive: true })
    await fs.writeFile(pidPath, process.pid.toString(), 'utf-8')

    // User-level PID file for --kill-all discovery
    const userPidPath = getUserPidPath(this.projectDir)
    await fs.mkdir(getUserSupervisorsDir(), { recursive: true })
    const userPidData = JSON.stringify({
      pid: process.pid,
      projectDir: this.projectDir,
      startedAt: new Date().toISOString(),
    })
    await fs.writeFile(userPidPath, userPidData, 'utf-8')
  }

  private async writeToken(): Promise<void> {
    this.token = randomBytes(32).toString('hex')
    const tokenPath = getTokenPath(this.projectDir)
    await fs.mkdir(path.dirname(tokenPath), { recursive: true })
    await fs.writeFile(tokenPath, this.token, { mode: 0o600, encoding: 'utf-8' })
  }

  /**
   * Clean up all supervisor files on shutdown.
   * Removes project-level PID, token, and user-level PID files.
   *
   * @see LLD-CLI.md §7 Supervisor Lifecycle Management
   */
  private async cleanup(): Promise<void> {
    const filesToRemove = [
      getPidPath(this.projectDir),
      getTokenPath(this.projectDir),
      getUserPidPath(this.projectDir), // User-level PID for --kill-all discovery
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
   * Start the idle timeout checker.
   * Per LLD-CLI §7: Self-terminate after configured idle timeout (default 5 minutes).
   * Set supervisor.idleTimeoutMs to 0 to disable idle timeout.
   */
  private startIdleCheck(): void {
    const idleTimeoutMs = this.config.supervisor.idleTimeoutMs

    // 0 = disabled
    if (idleTimeoutMs === 0) {
      this.logger.info('Idle timeout disabled')
      return
    }

    this.lastActivityTime = Date.now()
    this.idleCheckInterval = setInterval(() => {
      const idleTime = Date.now() - this.lastActivityTime
      if (idleTime >= idleTimeoutMs) {
        this.logger.info('Idle timeout reached, shutting down', {
          idleTimeMs: idleTime,
          idleTimeoutMs,
        })
        void this.stop()
      }
    }, IDLE_CHECK_INTERVAL_MS)

    // Don't let the interval keep the process alive if everything else is done
    this.idleCheckInterval.unref()
  }

  private stopIdleCheck(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval)
      this.idleCheckInterval = null
    }
  }
}
