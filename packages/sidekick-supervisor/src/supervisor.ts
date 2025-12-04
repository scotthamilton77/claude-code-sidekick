import {
  createLogManager,
  getPidPath,
  getSocketPath,
  getTokenPath,
  getUserPidPath,
  getUserSupervisorsDir,
  HandlerRegistryImpl,
  IpcServer,
  loadConfig,
  Logger,
  LogManager,
  SidekickConfig,
  StagingServiceImpl,
  TranscriptServiceImpl,
  LogEvents,
  logEvent,
} from '@sidekick/core'
import type {
  HandlerRegistry,
  TranscriptService,
  StagingService,
  HookName,
  HookEvent,
  SupervisorStatus,
} from '@sidekick/types'
import { randomBytes } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { ConfigChangeEvent, ConfigWatcher } from './config-watcher.js'
import { StateManager } from './state-manager.js'
import { createTaskRegistry, registerStandardTaskHandlers, TaskRegistry } from './task-handlers.js'
import { TaskEngine } from './task-engine.js'

// Read version from package.json at startup
// Path is relative to dist/ output location
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const VERSION: string = require('../package.json').version

// Idle check interval (how often to check for idle timeout)
const IDLE_CHECK_INTERVAL_MS = 30 * 1000 // Check every 30 seconds

// Heartbeat interval: write supervisor status every 5 seconds per design/SUPERVISOR.md §4.6
const HEARTBEAT_INTERVAL_MS = 5 * 1000

/**
 * Supervisor Process Entrypoint
 *
 * The Supervisor is a long-running background process responsible for:
 * 1. Single-writer state management (preventing race conditions)
 * 2. Background task execution (heavy compute offloading)
 * 3. IPC communication with the CLI
 *
 * @see docs/design/SUPERVISOR.md
 */

export class Supervisor {
  private projectDir: string
  private config: SidekickConfig
  private logger: Logger
  private logManager: LogManager
  private stateManager: StateManager
  private taskEngine: TaskEngine
  private taskRegistry: TaskRegistry
  private ipcServer: IpcServer
  private configWatcher: ConfigWatcher
  private handlerRegistry: HandlerRegistry
  private transcriptService: TranscriptService | null = null
  private stagingService: StagingService | null = null
  private token: string = ''
  private lastActivityTime: number = Date.now()
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private startTime: number = Date.now()

  constructor(projectDir: string) {
    this.projectDir = projectDir

    // Load config from project
    this.config = loadConfig({ projectRoot: projectDir })

    // Initialize Logger
    const logDir = path.join(projectDir, '.sidekick', 'logs')
    this.logManager = createLogManager({
      name: 'supervisor',
      level: this.config.core.logging.level,
      destinations: {
        file: { path: path.join(logDir, 'supervisor.log') },
        console: { enabled: this.config.core.logging.consoleEnabled },
      },
    })
    this.logger = this.logManager.getLogger()

    // Initialize Components
    this.stateManager = new StateManager(path.join(projectDir, '.sidekick', 'state'), this.logger)
    this.taskEngine = new TaskEngine(this.logger)
    this.taskRegistry = createTaskRegistry(this.stateManager, this.logger)

    // Initialize Config Watcher for hot-reload (design/SUPERVISOR.md §4.3)
    this.configWatcher = new ConfigWatcher(projectDir, this.logger, this.handleConfigChange.bind(this))

    // Initialize Handler Registry (Phase 5.3)
    this.handlerRegistry = new HandlerRegistryImpl({
      logger: this.logger,
      sessionId: '', // Updated on SessionStart
      scope: 'project',
    })

    // Initialize IPC
    const socketPath = getSocketPath(projectDir)
    this.ipcServer = new IpcServer(socketPath, this.logger, this.handleIpcRequest.bind(this))
  }

  async start(): Promise<void> {
    try {
      this.logger.info('Supervisor starting', { projectDir: this.projectDir, pid: process.pid })

      // 0. Set up process-level error handlers (per design/SUPERVISOR.md §5)
      this.setupErrorHandlers()

      // 1. Write PID file
      await this.writePid()

      // 2. Generate and write Token
      await this.writeToken()

      // 3. Initialize State Manager
      await this.stateManager.initialize()

      // 4. Clean up orphaned tasks from previous runs (Phase 5.2 orphan prevention)
      const orphanCount = await this.taskRegistry.cleanupOrphans()
      if (orphanCount > 0) {
        this.logger.info('Cleaned up orphaned tasks', { orphanCount })
      }

      // 5. Register standard task handlers (Phase 5.2 task types)
      registerStandardTaskHandlers(this.taskEngine, this.stateManager, this.projectDir, this.logger)

      // 6. Start IPC Server
      await this.ipcServer.start()

      // 7. Start config watcher for hot-reload
      this.configWatcher.start()

      // 8. Start idle timeout checker
      this.startIdleCheck()

      // 9. Start heartbeat for monitoring UI
      this.startHeartbeat()

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

    // Stop heartbeat
    this.stopHeartbeat()

    // Stop config watcher
    this.configWatcher.stop()

    // Stop TranscriptService file watcher (Phase 5.3 requirement)
    // Per docs/design/SUPERVISOR.md §2.2: Shutdown sequence must stop TranscriptService
    try {
      if (this.transcriptService) {
        await this.transcriptService.shutdown()
        this.transcriptService = null
        this.logger.info('TranscriptService shutdown complete')
      }
    } catch (err) {
      this.logger.error('Failed to shutdown TranscriptService', { error: err })
    }

    try {
      // Stop accepting new IPC
      await this.ipcServer.stop()
    } catch (err) {
      this.logger.error('Failed to stop IPC server', { error: err })
    }

    try {
      // Shutdown Task Engine - wait for running tasks to complete
      await this.taskEngine.shutdown(this.config.core.supervisor.shutdownTimeoutMs)
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
   * Per design/SUPERVISOR.md §4.3: Reload config in-memory on change.
   */
  private handleConfigChange(event: ConfigChangeEvent): void {
    this.logger.info('Configuration change detected', { file: event.file, eventType: event.eventType })

    // Reload configuration
    try {
      const newConfig = loadConfig({ projectRoot: this.projectDir })

      // Apply critical config changes immediately
      if (newConfig.core.logging.level !== this.config.core.logging.level) {
        this.logger.info('Log level changed, updating logger', {
          old: this.config.core.logging.level,
          new: newConfig.core.logging.level,
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
        // Return ack immediately, then self-terminate after response is sent
        // This prevents deadlock where client waits for response while server.close() waits for client
        setImmediate(() => void this.stop())
        return { status: 'stopping' }
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
      case 'hook.invoke':
        return this.handleHookInvoke(p)
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
   * Handle hook event invocation from CLI.
   * Dispatches the event to registered handlers and returns aggregated response.
   *
   * @see docs/design/SUPERVISOR.md §4.2 Handler System
   */
  private async handleHookInvoke(params: Record<string, unknown> | undefined): Promise<unknown> {
    const hook = params?.hook as HookName | undefined
    const event = params?.event as HookEvent | undefined

    if (!hook || !event) {
      throw new Error('hook.invoke requires hook and event parameters')
    }

    this.logger.debug('Handling hook invocation', { hook, sessionId: event.context?.sessionId })

    // Handle SessionStart: initialize TranscriptService
    if (hook === 'SessionStart') {
      await this.handleSessionStart(event)
    }

    // Handle SessionEnd: shutdown TranscriptService
    if (hook === 'SessionEnd') {
      await this.handleSessionEnd()
    }

    // Dispatch to registered handlers
    const response = await this.handlerRegistry.invokeHook(hook, event)

    return response
  }

  /**
   * Initialize TranscriptService and StagingService on SessionStart.
   * Per docs/design/SUPERVISOR.md §4.7 and docs/design/TRANSCRIPT-PROCESSING.md §6.
   * Per docs/design/FEATURE-REMINDERS.md §4.1: Clear staging on startup/clear.
   */
  private async handleSessionStart(event: HookEvent): Promise<void> {
    const payload = event.payload as { transcriptPath?: string; startType?: string }
    const sessionId = event.context?.sessionId

    if (!sessionId) {
      this.logger.warn('SessionStart event missing sessionId')
      return
    }

    // Update handler registry with session info
    if (this.handlerRegistry instanceof HandlerRegistryImpl) {
      this.handlerRegistry.updateSession({
        sessionId,
        transcriptPath: payload.transcriptPath,
      })
    }

    // Initialize StagingService for this session (Phase 5.4)
    const stateDir = path.join(this.projectDir, '.sidekick')
    this.stagingService = new StagingServiceImpl({
      sessionId,
      stateDir,
      logger: this.logger,
      scope: 'project',
    })

    // Clean staging on startup or clear (Phase 5.4)
    const startType = payload.startType
    if (startType === 'startup' || startType === 'clear') {
      await this.stagingService.clearStaging()

      // Log RemindersCleared event
      const clearEvent = LogEvents.remindersCleared(
        { sessionId, scope: 'project' },
        { clearedCount: 0 }, // Count not tracked - acceptable for startup cleanup
        'session_start'
      )
      logEvent(this.logger, clearEvent)

      this.logger.info('Staging cleared on session start', { startType })
    }

    // Provide StagingService to handler registry (Phase 5.4)
    if (this.handlerRegistry instanceof HandlerRegistryImpl) {
      this.handlerRegistry.setStagingProvider(() => this.stagingService!)
    }

    // Create and initialize TranscriptService
    if (payload.transcriptPath) {
      this.transcriptService = new TranscriptServiceImpl({
        watchDebounceMs: this.config.transcript.watchDebounceMs,
        metricsPersistIntervalMs: this.config.transcript.metricsPersistIntervalMs,
        handlers: this.handlerRegistry,
        logger: this.logger,
        stateDir,
      })

      await this.transcriptService.initialize(sessionId, payload.transcriptPath)

      // Provide metrics getter to handler registry
      if (this.handlerRegistry instanceof HandlerRegistryImpl) {
        this.handlerRegistry.setMetricsProvider(() => this.transcriptService!.getMetrics())
      }

      this.logger.info('TranscriptService initialized', { sessionId, transcriptPath: payload.transcriptPath })
    }
  }

  /**
   * Shutdown TranscriptService on SessionEnd.
   * Per docs/design/SUPERVISOR.md §4.7.
   */
  private async handleSessionEnd(): Promise<void> {
    if (this.transcriptService) {
      await this.transcriptService.shutdown()
      this.transcriptService = null
      this.logger.info('TranscriptService shutdown on SessionEnd')
    }
  }

  /**
   * Write PID files to both project-level and user-level locations.
   *
   * Project-level: .sidekick/supervisor.pid (simple PID number)
   * User-level: ~/.sidekick/supervisors/{hash}.pid (JSON with project path and PID)
   *
   * @see docs/design/CLI.md §7 Supervisor Lifecycle Management
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
   * @see docs/design/CLI.md §7 Supervisor Lifecycle Management
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
   * Per design/CLI.md §7: Self-terminate after configured idle timeout (default 5 minutes).
   * Set supervisor.idleTimeoutMs to 0 to disable idle timeout.
   */
  private startIdleCheck(): void {
    const idleTimeoutMs = this.config.core.supervisor.idleTimeoutMs

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

  /**
   * Start the heartbeat mechanism.
   * Per design/SUPERVISOR.md §4.6: Write supervisor status every 5 seconds for Monitoring UI.
   */
  private startHeartbeat(): void {
    // Write initial heartbeat immediately
    void this.writeHeartbeat()

    this.heartbeatInterval = setInterval(() => {
      void this.writeHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)

    // Don't let the interval keep the process alive
    this.heartbeatInterval.unref()

    this.logger.debug('Heartbeat started', { intervalMs: HEARTBEAT_INTERVAL_MS })
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * Write current supervisor status to state file.
   * Per design/SUPERVISOR.md §4.6: Includes timestamp, pid, uptime, memory, queue stats.
   */
  private async writeHeartbeat(): Promise<void> {
    const memUsage = process.memoryUsage()
    const taskStatus = this.taskEngine.getStatus()

    const status: SupervisorStatus = {
      timestamp: Date.now(),
      pid: process.pid,
      version: VERSION,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
      },
      queue: {
        pending: taskStatus.pending,
        active: taskStatus.active,
      },
      activeTasks: taskStatus.activeTasks,
    }

    try {
      await this.stateManager.update('supervisor-status', status as unknown as Record<string, unknown>)
    } catch (err) {
      // Log but don't crash - heartbeat is non-critical
      this.logger.warn('Failed to write heartbeat status', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Set up process-level error handlers for uncaught exceptions and unhandled rejections.
   * Per design/SUPERVISOR.md §5: Log fatal error to supervisor.log, attempt graceful cleanup, exit.
   * CLI will restart the supervisor on next run.
   */
  private setupErrorHandlers(): void {
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

      // Log the fatal error to supervisor.log
      this.logger.fatal(`Fatal ${type}`, {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
        pid: process.pid,
        projectDir: this.projectDir,
      })

      // Attempt graceful cleanup (best-effort, may fail if process is unstable)
      // We use cleanup() which removes PID, token, and user PID files
      // IPC server and task engine may already be in bad state, so we skip them
      void this.cleanup().finally(() => {
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

    this.logger.debug('Process error handlers installed')
  }
}

// Re-export SupervisorStatus from @sidekick/types for backward compatibility with tests
export type { SupervisorStatus } from '@sidekick/types'
