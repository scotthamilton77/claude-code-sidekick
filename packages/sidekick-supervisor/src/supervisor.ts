import {
  createAssetResolver,
  createConfigService,
  createHookableLogger,
  createLogManager,
  getDefaultAssetsDir,
  getPidPath,
  getSocketPath,
  getTokenPath,
  getUserPidPath,
  getUserSupervisorsDir,
  HandlerRegistryImpl,
  IpcServer,
  Logger,
  LogManager,
  reconstructTranscriptPath,
  ServiceFactoryImpl,
  LogEvents,
  logEvent,
  type AssetResolver,
  type ConfigService,
  type SidekickConfig,
} from '@sidekick/core'
import { registerStagingHandlers, classifyCompletion } from '@sidekick/feature-reminders'
import { registerHandlers as registerSessionSummaryHandlers } from '@sidekick/feature-session-summary'
import type {
  HandlerRegistry,
  TranscriptService,
  TranscriptMetrics,
  StagingService,
  ServiceFactory,
  HookName,
  HookEvent,
  SupervisorStatus,
  SupervisorContext,
  RuntimePaths,
} from '@sidekick/types'
import { ProfileProviderFactory, type LLMProvider } from '@sidekick/shared-providers'
import { InstrumentedLLMProvider } from '@sidekick/core'
import { randomBytes } from 'crypto'
import { homedir } from 'os'
import fs from 'fs/promises'
import path from 'path'
import { ConfigChangeEvent, ConfigWatcher } from './config-watcher.js'
import { ContextMetricsService, createContextMetricsService } from './context-metrics/index.js'
import { StateManager } from './state-manager.js'
import { createTaskRegistry, registerStandardTaskHandlers, TaskRegistry } from './task-handlers.js'
import { TaskEngine } from './task-engine.js'

// Read version from root package.json (single source of truth for monorepo)
// Path is relative to dist/ output location: dist/ → packages/pkg/ → packages/ → root/
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const VERSION: string = require('../../../package.json').version

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
  private configService: ConfigService
  private logger: Logger
  private logManager: LogManager
  private stateManager: StateManager
  private taskEngine: TaskEngine
  private taskRegistry: TaskRegistry
  private ipcServer: IpcServer
  private configWatcher: ConfigWatcher
  private handlerRegistry: HandlerRegistry
  private serviceFactory: ServiceFactory
  private assetResolver: AssetResolver
  private llmProvider: LLMProvider | null = null
  private profileProviderFactory: ProfileProviderFactory
  private instrumentedProviders = new Map<string, InstrumentedLLMProvider>()
  private contextMetricsService: ContextMetricsService
  /** Per-session log counters for statusline {logs} indicator */
  private logCounters = new Map<string, { warnings: number; errors: number }>()
  /** Global log counters for supervisor-level errors (not tied to any session) */
  private globalLogCounters = { warnings: 0, errors: 0 }
  private token: string = ''
  private lastActivityTime: number = Date.now()
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private evictionTimer: ReturnType<typeof setInterval> | null = null
  private startTime: number = Date.now()

  constructor(projectDir: string) {
    this.projectDir = projectDir

    // Initialize Asset Resolver first (needed for configService YAML defaults)
    this.assetResolver = createAssetResolver({
      defaultAssetsDir: getDefaultAssetsDir(),
      projectRoot: projectDir,
    })

    // Create ConfigService with assets to enable YAML feature defaults
    this.configService = createConfigService({
      projectRoot: projectDir,
      assets: this.assetResolver,
    })

    // Initialize Logger with counting wrapper for statusline {logs} indicator
    const logDir = path.join(projectDir, '.sidekick', 'logs')
    this.logManager = createLogManager({
      name: 'supervisor',
      level: this.configService.core.logging.level,
      context: { scope: 'project' },
      destinations: {
        file: { path: path.join(logDir, 'supervisor.log') },
        console: { enabled: this.configService.core.logging.consoleEnabled },
      },
    })
    // Wrap logger to count warnings/errors for statusline display
    // Uses hookable logger pattern to extract sessionId from log metadata
    this.logger = createHookableLogger(this.logManager.getLogger(), {
      levels: ['warn', 'error', 'fatal'],
      hook: (level, _msg, meta) => {
        // Extract sessionId from log metadata context
        const sessionId =
          (meta?.context as { sessionId?: string })?.sessionId ?? (meta as { sessionId?: string })?.sessionId
        if (sessionId) {
          // Session-specific counter
          const counters = this.logCounters.get(sessionId)
          if (counters) {
            if (level === 'warn') counters.warnings++
            else counters.errors++ // error and fatal
          }
        } else {
          // Global counter for supervisor-level logs without session context
          if (level === 'warn') this.globalLogCounters.warnings++
          else this.globalLogCounters.errors++ // error and fatal
        }
      },
    })

    // Initialize Components
    this.stateManager = new StateManager(path.join(projectDir, '.sidekick', 'state'), this.logger)
    this.taskEngine = new TaskEngine(this.logger, this.getContextForTask.bind(this))
    this.taskRegistry = createTaskRegistry(this.stateManager, this.logger)

    // Initialize Config Watcher for hot-reload (design/SUPERVISOR.md §4.3)
    this.configWatcher = new ConfigWatcher(projectDir, this.logger, this.handleConfigChange.bind(this))

    // Initialize Handler Registry (Phase 5.3)
    this.handlerRegistry = new HandlerRegistryImpl({
      logger: this.logger,
      sessionId: '', // Updated on SessionStart
      scope: 'project',
    })

    // Initialize Service Factory for session-scoped services (Phase 4)
    const stateDir = path.join(projectDir, '.sidekick')
    this.serviceFactory = new ServiceFactoryImpl({
      stateDir,
      logger: this.logger,
      scope: 'project',
      handlers: this.handlerRegistry,
      watchDebounceMs: this.configService.transcript.watchDebounceMs,
      metricsPersistIntervalMs: this.configService.transcript.metricsPersistIntervalMs,
    })

    // Initialize Context Metrics Service (METRICS_PLAN.md)
    this.contextMetricsService = createContextMetricsService({
      projectDir,
      logger: this.logger,
      skipCliCapture: false,
    })

    // Initialize Profile Provider Factory for profile-based LLM provider creation
    this.profileProviderFactory = new ProfileProviderFactory(this.configService, this.logger)

    // Register staging handlers (Phase 8.5 - Reminders feature)
    // These handlers listen for SessionStart/transcript events and stage reminders
    // for CLI consumption. They need SupervisorContext at invocation time.
    this.registerStagingHandlers()

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

      // 4. Initialize Context Metrics (writes defaults, triggers async CLI capture)
      await this.contextMetricsService.initialize()

      // 5. Clean up orphaned tasks from previous runs (Phase 5.2 orphan prevention)
      const orphanCount = await this.taskRegistry.cleanupOrphans()
      if (orphanCount > 0) {
        this.logger.info('Cleaned up orphaned tasks', { orphanCount })
      }

      // 6. Register standard task handlers (Phase 5.2 task types)
      registerStandardTaskHandlers(
        this.taskEngine,
        this.stateManager,
        this.projectDir,
        this.logger,
        this.configService.getAll(),
        this.assetResolver
      )

      // 7. Start IPC Server
      await this.ipcServer.start()

      // 8. Start config watcher for hot-reload
      this.configWatcher.start()

      // 9. Start idle timeout checker
      this.startIdleCheck()

      // 10. Start heartbeat for monitoring UI
      this.startHeartbeat()

      // 11. Start periodic session eviction (Phase 6)
      this.startEvictionTimer()

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

    // Clear eviction timer
    this.stopEvictionTimer()

    // Stop config watcher
    this.configWatcher.stop()

    // Shutdown all instrumented LLM providers (persists final metrics)
    try {
      for (const [sessionId, provider] of this.instrumentedProviders) {
        provider.shutdown()
        this.logger.debug('Shutdown instrumented LLM provider', { sessionId })
      }
      this.instrumentedProviders.clear()
    } catch (err) {
      this.logger.error('Failed to shutdown instrumented LLM providers', { error: err })
    }

    // Shutdown all session services via factory
    // Per docs/design/SUPERVISOR.md §2.2: Shutdown sequence must stop TranscriptService
    try {
      const count = await this.serviceFactory.shutdownAllSessions()
      if (count > 0) {
        this.logger.info('Session services shutdown complete', { count })
      }
    } catch (err) {
      this.logger.error('Failed to shutdown session services', { error: err })
    }

    try {
      // Stop accepting new IPC
      await this.ipcServer.stop()
    } catch (err) {
      this.logger.error('Failed to stop IPC server', { error: err })
    }

    try {
      // Shutdown Task Engine - wait for running tasks to complete
      await this.taskEngine.shutdown(this.configService.core.supervisor.shutdownTimeoutMs)
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
      const oldConfig = this.configService.getAll()
      const newConfigService = createConfigService({
        projectRoot: this.projectDir,
        assets: this.assetResolver,
      })
      const newConfig = newConfigService.getAll()

      // Log all config value changes
      const changes = this.diffConfigs(oldConfig, newConfig)
      if (changes.length > 0) {
        this.logger.info('Configuration values changed', { changes })
      }

      // Apply critical config changes immediately (per SUPERVISOR.md §4.4)
      if (newConfig.core.logging.level !== oldConfig.core.logging.level) {
        this.logManager.setLevel(newConfig.core.logging.level)
        this.logger.info('Log level updated', {
          oldLevel: oldConfig.core.logging.level,
          newLevel: newConfig.core.logging.level,
        })
      }

      // Update stored config service
      this.configService = newConfigService

      this.logger.info('Configuration reloaded successfully')
    } catch (err) {
      this.logger.error('Failed to reload configuration', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Compare two config objects and return a list of changed values.
   */
  private diffConfigs(
    oldConfig: SidekickConfig,
    newConfig: SidekickConfig,
    path: string[] = []
  ): Array<{ path: string; old: unknown; new: unknown }> {
    const changes: Array<{ path: string; old: unknown; new: unknown }> = []

    const compareObjects = (
      oldObj: Record<string, unknown>,
      newObj: Record<string, unknown>,
      currentPath: string[]
    ): void => {
      const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)])

      for (const key of allKeys) {
        const oldVal = oldObj[key]
        const newVal = newObj[key]
        const keyPath = [...currentPath, key]

        if (oldVal === newVal) continue

        if (
          oldVal !== null &&
          newVal !== null &&
          typeof oldVal === 'object' &&
          typeof newVal === 'object' &&
          !Array.isArray(oldVal) &&
          !Array.isArray(newVal)
        ) {
          // Recurse into nested objects
          compareObjects(oldVal as Record<string, unknown>, newVal as Record<string, unknown>, keyPath)
        } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changes.push({ path: keyPath.join('.'), old: oldVal, new: newVal })
        }
      }
    }

    compareObjects(
      oldConfig as unknown as Record<string, unknown>,
      newConfig as unknown as Record<string, unknown>,
      path
    )
    return changes
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
      case 'reminder.consumed':
        return this.handleReminderConsumed(p)
      case 'completion.classify':
        return this.handleCompletionClassify(p)
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

    const { sessionId, correlationId } = event.context ?? {}

    // Create request-scoped logger with session and correlation context
    // This logger is passed through the call chain for full request tracing
    const requestLogger = this.logger.child({
      context: { sessionId, correlationId },
    })

    requestLogger.debug('Handling hook invocation', { hook })

    // Log EventReceived event
    if (sessionId) {
      logEvent(
        requestLogger,
        LogEvents.eventReceived({ sessionId, scope: 'project', correlationId, hook }, { eventKind: 'hook', hook })
      )
    }

    // Build context and start transcript service for non-SessionEnd hooks
    // Note: resolveTranscriptPath does NOT create the service - setContextForHook does,
    // AFTER setting initial context with config (to avoid race condition)
    if (sessionId && hook !== 'SessionEnd') {
      const payload = event.payload as { transcriptPath?: string } | undefined
      const transcriptPath = this.resolveTranscriptPath(sessionId, payload?.transcriptPath)
      await this.setContextForHook(sessionId, transcriptPath, { logger: requestLogger })
    }

    // Handle SessionStart: clear staging on startup/clear
    if (hook === 'SessionStart') {
      await this.handleSessionStart(event, { logger: requestLogger })
    }

    // Handle SessionEnd: shutdown session services
    if (hook === 'SessionEnd') {
      await this.handleSessionEnd(event, { logger: requestLogger })
    }

    // Handle UserPromptSubmit: clear staged reminders and P&R baseline
    if (hook === 'UserPromptSubmit') {
      await this.handleUserPromptSubmitCleanup(event, { logger: requestLogger })
    }

    // Ensure log counters exist for this session (supervisor may have restarted)
    if (sessionId && !this.logCounters.has(sessionId)) {
      const existing = await this.loadExistingLogCounts(sessionId)
      this.logCounters.set(sessionId, existing)
      requestLogger.debug('Log counters initialized from file for hook', { hook, existing })
    }

    // Dispatch to registered handlers
    const response = await this.handlerRegistry.invokeHook(hook, event, { logger: requestLogger })

    return response
  }

  /**
   * Handle SessionStart-specific logic: clear staging on startup/clear.
   *
   * Per docs/design/FEATURE-REMINDERS.md §4.1: Clear staging on startup/clear.
   */
  private async handleSessionStart(event: HookEvent, options?: { logger?: Logger }): Promise<void> {
    const log = options?.logger ?? this.logger
    const payload = event.payload as { startType?: string }
    const sessionId = event.context?.sessionId

    if (!sessionId) {
      log.warn('SessionStart event missing sessionId')
      return
    }

    // Clean staging on startup or clear (Phase 5.4)
    const startType = payload.startType
    if (startType === 'startup' || startType === 'clear') {
      const stagingService = this.serviceFactory.getStagingService(sessionId)
      await stagingService.clearStaging(undefined, { logger: log })

      // Log RemindersCleared event
      const correlationId = event.context?.correlationId
      const clearEvent = LogEvents.remindersCleared(
        { sessionId, scope: 'project', correlationId },
        { clearedCount: 0 }, // Count not tracked - acceptable for startup cleanup
        'session_start'
      )
      logEvent(log, clearEvent)

      // Initialize log counters for new/cleared session
      // For startup: load existing counts (supervisor might have restarted mid-session)
      // For clear: reset to 0 (user wants a fresh start)
      if (startType === 'clear') {
        this.logCounters.set(sessionId, { warnings: 0, errors: 0 })
        log.debug('Log counters reset for cleared session')
      } else {
        const existing = await this.loadExistingLogCounts(sessionId)
        this.logCounters.set(sessionId, existing)
        log.debug('Log counters initialized from file for startup', { existing })
      }

      log.info('Staging cleared on session start', { startType })
    } else {
      // For resume, load existing counts if not already tracking this session
      if (!this.logCounters.has(sessionId)) {
        const existing = await this.loadExistingLogCounts(sessionId)
        this.logCounters.set(sessionId, existing)
        log.debug('Log counters loaded from file for resumed session', { existing })
      }
    }
  }

  /**
   * Shutdown session services on SessionEnd.
   * Uses ServiceFactory for proper cleanup.
   * Per docs/design/SUPERVISOR.md §4.7.
   */
  private async handleSessionEnd(event: HookEvent, options?: { logger?: Logger }): Promise<void> {
    const log = options?.logger ?? this.logger
    const sessionId = event.context?.sessionId
    if (sessionId) {
      // Shutdown instrumented LLM provider (persists final metrics)
      const instrumentedProvider = this.instrumentedProviders.get(sessionId)
      if (instrumentedProvider) {
        instrumentedProvider.shutdown()
        this.instrumentedProviders.delete(sessionId)
        log.debug('Shutdown instrumented LLM provider')
      }

      // Clean up log counters for this session
      this.logCounters.delete(sessionId)

      await this.serviceFactory.shutdownSession(sessionId)
      log.info('Session ended')
    }
  }

  /**
   * Handle reminder.consumed IPC from CLI.
   * When verify-completion is consumed, stores P&R baseline to reset threshold.
   */
  private async handleReminderConsumed(params: Record<string, unknown> | undefined): Promise<void> {
    const sessionId = params?.sessionId as string | undefined
    const reminderName = params?.reminderName as string | undefined
    const metrics = params?.metrics as { turnCount: number; toolsThisTurn: number } | undefined

    if (!sessionId || !reminderName || !metrics) {
      throw new Error('reminder.consumed requires sessionId, reminderName, and metrics')
    }

    // Only update P&R baseline for verify-completion consumption
    // FIXME this should go into a feature controller handler instead of supervisor directly.
    if (reminderName === 'verify-completion') {
      const stateDir = path.join(this.projectDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(stateDir, { recursive: true })

      const baseline = {
        turnCount: metrics.turnCount,
        toolsThisTurn: metrics.toolsThisTurn,
        timestamp: Date.now(),
      }

      await fs.writeFile(path.join(stateDir, 'pr-baseline.json'), JSON.stringify(baseline, null, 2))

      this.logger.debug('Updated P&R baseline after VC consumption', { sessionId, baseline })
    }
  }

  /**
   * Handle completion.classify IPC from CLI.
   * Classifies the assistant's stopping intent using LLM.
   */
  private async handleCompletionClassify(
    params: Record<string, unknown> | undefined
  ): Promise<{ category: string; confidence: number; shouldBlock: boolean; userMessage?: string; reasoning?: string }> {
    const sessionId = params?.sessionId as string | undefined
    const transcriptPath = params?.transcriptPath as string | undefined

    if (!sessionId) {
      throw new Error('completion.classify requires sessionId')
    }

    this.logger.info('Completion classification requested', { sessionId })

    const resolvedTranscriptPath = transcriptPath ?? reconstructTranscriptPath(this.projectDir, sessionId)
    this.logger.debug('Resolved transcript path for classification', { transcriptPath: resolvedTranscriptPath })
    const paths: RuntimePaths = {
      projectDir: this.projectDir,
      userConfigDir: path.join(homedir(), '.sidekick'),
      projectConfigDir: path.join(this.projectDir, '.sidekick'),
      hookScriptPath: undefined,
    }

    if (!this.llmProvider) {
      this.llmProvider = this.profileProviderFactory.createDefault()
    }

    const stagingService = this.serviceFactory.getStagingService(sessionId)
    const transcriptService = await this.serviceFactory.prepareTranscriptService(sessionId, resolvedTranscriptPath)
    await transcriptService.start()

    const featureConfig = this.configService.getFeature<{ settings?: { completion_detection?: unknown } }>('reminders')
    const settings = featureConfig.settings?.completion_detection as
      | import('@sidekick/feature-reminders').CompletionDetectionSettings
      | undefined

    const ctx: SupervisorContext = {
      role: 'supervisor',
      config: {
        core: {
          logging: { level: this.configService.core.logging.level },
          development: { enabled: this.configService.core.development.enabled },
        },
        llm: {
          defaultProfile: this.configService.llm.defaultProfile,
          profiles: this.configService.llm.profiles,
          fallbacks: this.configService.llm.fallbacks,
        },
        getAll: () => this.configService.getAll(),
        getFeature: <T = Record<string, unknown>>(name: string) => this.configService.getFeature<T>(name),
      },
      logger: this.logger,
      assets: this.assetResolver,
      paths,
      handlers: this.handlerRegistry,
      llm: this.llmProvider,
      profileFactory: this.profileProviderFactory,
      staging: stagingService,
      transcript: transcriptService,
    }

    const result = await classifyCompletion({ ctx, settings })

    this.logger.info('Completion classification complete', {
      sessionId,
      category: result.classification.category,
      shouldBlock: result.shouldBlock,
    })
    this.logger.debug('Completion classification details', {
      confidence: result.classification.confidence,
      reasoning: result.classification.reasoning?.slice(0, 1000),
      userMessage: result.userMessage,
    })

    return {
      category: result.classification.category,
      confidence: result.classification.confidence,
      shouldBlock: result.shouldBlock,
      userMessage: result.userMessage,
      reasoning: result.classification.reasoning,
    }
  }

  /**
   * Resolve transcript path for a session.
   * Called by handleHookInvoke() before setting context.
   *
   * Note: Does NOT create the TranscriptService - that happens in setContextForHook()
   * AFTER the initial context is set. This avoids the race condition where transcript
   * events fire before handlers have access to config.
   *
   * @param sessionId - Session ID from event context
   * @param providedTranscriptPath - Optional transcript path from event payload
   * @returns The resolved transcript path
   */
  private resolveTranscriptPath(sessionId: string, providedTranscriptPath?: string): string {
    // Determine transcript path: use provided or reconstruct using utility
    const transcriptPath = providedTranscriptPath ?? reconstructTranscriptPath(this.projectDir, sessionId)
    if (!providedTranscriptPath) {
      this.logger.debug('Reconstructed transcript path', { sessionId, transcriptPath })
    }
    return transcriptPath
  }

  /**
   * Get SupervisorContext for task execution.
   *
   * Used by TaskEngine to provide context to task handlers.
   * If sessionId is provided, uses session-specific instrumented provider.
   * If no sessionId, uses base provider (for global tasks like cleanup).
   *
   * @param sessionId - Optional session ID for session-specific context
   */
  private getContextForTask(sessionId?: string): SupervisorContext {
    // Build runtime paths
    const paths: RuntimePaths = {
      projectDir: this.projectDir,
      userConfigDir: path.join(homedir(), '.sidekick'),
      projectConfigDir: path.join(this.projectDir, '.sidekick'),
      hookScriptPath: undefined,
    }

    // Create base LLM provider if needed (lazy init, uses default profile)
    if (!this.llmProvider) {
      this.llmProvider = this.profileProviderFactory.createDefault()
    }

    // Get the appropriate LLM provider
    let llmProvider: LLMProvider = this.llmProvider
    if (sessionId) {
      // Try to get existing instrumented provider for this session
      const instrumented = this.instrumentedProviders.get(sessionId)
      if (instrumented) {
        llmProvider = instrumented
      } else {
        // Create instrumented provider on-demand
        const stateDir = path.join(paths.projectConfigDir ?? paths.userConfigDir, 'sessions', sessionId, 'state')
        const newInstrumented = new InstrumentedLLMProvider(this.llmProvider, {
          sessionId,
          stateDir,
          logger: this.logger,
        })
        newInstrumented.initialize()
        this.instrumentedProviders.set(sessionId, newInstrumented)
        this.logger.debug('Created instrumented LLM provider for task', { sessionId })
        llmProvider = newInstrumented
      }
    }

    // Get staging service if sessionId provided, otherwise use a no-op stub
    const stagingService: StagingService = sessionId
      ? this.serviceFactory.getStagingService(sessionId)
      : {
          stageReminder: async () => {},
          readReminder: () => Promise.resolve(null),
          clearStaging: async () => {},
          listReminders: () => Promise.resolve([]),
          deleteReminder: async () => {},
          listConsumedReminders: () => Promise.resolve([]),
          getLastConsumed: () => Promise.resolve(null),
        }

    // For tasks, we don't always have a transcript service - use a stub
    const defaultMetrics: TranscriptMetrics = {
      turnCount: 0,
      toolCount: 0,
      toolsThisTurn: 0,
      messageCount: 0,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheTiers: {
          ephemeral5mInputTokens: 0,
          ephemeral1hInputTokens: 0,
        },
        serviceTierCounts: {},
        byModel: {},
      },
      currentContextTokens: 0,
      isPostCompactIndeterminate: false,
      toolsPerTurn: 0,
      lastProcessedLine: 0,
      lastUpdatedAt: 0,
    }
    const transcriptService: TranscriptService = {
      initialize: async () => {},
      prepare: async () => {},
      start: async () => {},
      shutdown: async () => {},
      getTranscript: () => ({
        entries: [],
        metadata: { sessionId: '', transcriptPath: '', lineCount: 0, lastModified: 0 },
        toString: () => '',
      }),
      getExcerpt: () => ({ content: '', lineCount: 0, startLine: 0, endLine: 0, bookmarkApplied: false }),
      getMetrics: () => defaultMetrics,
      getMetric: <K extends keyof TranscriptMetrics>(key: K) => defaultMetrics[key],
      onMetricsChange: () => () => {},
      onThreshold: () => () => {},
      capturePreCompactState: async () => {},
      getCompactionHistory: () => [],
    }

    return {
      role: 'supervisor',
      config: {
        core: {
          logging: { level: this.configService.core.logging.level },
          development: { enabled: this.configService.core.development.enabled },
        },
        llm: {
          defaultProfile: this.configService.llm.defaultProfile,
          profiles: this.configService.llm.profiles,
          fallbacks: this.configService.llm.fallbacks,
        },
        getAll: () => this.configService.getAll(),
        getFeature: <T = Record<string, unknown>>(name: string) => {
          return this.configService.getFeature<T>(name)
        },
      },
      logger: this.logger,
      assets: this.assetResolver,
      paths,
      handlers: this.handlerRegistry,
      llm: llmProvider,
      profileFactory: this.profileProviderFactory,
      staging: stagingService,
      transcript: transcriptService,
    }
  }

  /**
   * Build and set SupervisorContext for the current hook invocation.
   * Called per-request to ensure handlers receive correct session-scoped services.
   *
   * Uses the prepare/start pattern to avoid race condition:
   * 1. Prepare transcript service (no events yet)
   * 2. Wire up full context with all services
   * 3. Start transcript service (events fire with full context available)
   *
   * @param sessionId - Session ID from event context
   * @param transcriptPath - Transcript path for this session
   */
  private async setContextForHook(
    sessionId: string,
    transcriptPath: string,
    options?: { logger?: Logger }
  ): Promise<void> {
    const log = options?.logger ?? this.logger

    if (!(this.handlerRegistry instanceof HandlerRegistryImpl)) {
      return
    }

    // Build runtime paths
    const paths: RuntimePaths = {
      projectDir: this.projectDir,
      userConfigDir: path.join(homedir(), '.sidekick'),
      projectConfigDir: path.join(this.projectDir, '.sidekick'),
      hookScriptPath: undefined,
    }

    // Create LLM provider if needed (lazy init, uses default profile)
    if (!this.llmProvider) {
      this.llmProvider = this.profileProviderFactory.createDefault()
    }

    // Get or create instrumented provider for this session (tracks metrics per-session)
    let instrumentedProvider = this.instrumentedProviders.get(sessionId)
    if (!instrumentedProvider) {
      const stateDir = path.join(paths.projectConfigDir ?? paths.userConfigDir, 'sessions', sessionId, 'state')
      instrumentedProvider = new InstrumentedLLMProvider(this.llmProvider, {
        sessionId,
        stateDir,
        logger: log,
      })
      instrumentedProvider.initialize()
      this.instrumentedProviders.set(sessionId, instrumentedProvider)
      log.debug('Created instrumented LLM provider for session')
    }

    // Get staging service (doesn't trigger transcript events)
    const stagingService = this.serviceFactory.getStagingService(sessionId)

    // STEP 1: Prepare transcript service WITHOUT starting (no events yet)
    const transcriptService = await this.serviceFactory.prepareTranscriptService(sessionId, transcriptPath)

    // STEP 2: Wire up full context with all services
    // Handlers will receive this context when events fire
    // Note: We pass the request-scoped logger so handlers can log with correlationId
    const supervisorContext: SupervisorContext = {
      role: 'supervisor',
      config: {
        core: {
          logging: { level: this.configService.core.logging.level },
          development: { enabled: this.configService.core.development.enabled },
        },
        llm: {
          defaultProfile: this.configService.llm.defaultProfile,
          profiles: this.configService.llm.profiles,
          fallbacks: this.configService.llm.fallbacks,
        },
        getAll: () => this.configService.getAll(),
        getFeature: <T = Record<string, unknown>>(name: string) => this.configService.getFeature<T>(name),
      },
      logger: log,
      assets: this.assetResolver,
      paths,
      handlers: this.handlerRegistry,
      llm: instrumentedProvider,
      profileFactory: this.profileProviderFactory,
      staging: stagingService,
      transcript: transcriptService,
    }

    // Update handler registry with session info and providers
    this.handlerRegistry.updateSession({ sessionId, transcriptPath })
    this.handlerRegistry.setStagingProvider(() => stagingService)
    this.handlerRegistry.setMetricsProvider(() => transcriptService.getMetrics())

    // Set context BEFORE starting transcript service
    this.handlerRegistry.setContext(supervisorContext as unknown as Record<string, unknown>)

    // STEP 3: Start transcript service - NOW events can fire with full context
    await transcriptService.start()

    log.debug('SupervisorContext set for handler invocation')
  }

  /**
   * Handle UserPromptSubmit cleanup: clear staged reminders and P&R baseline.
   *
   * User submitting a new prompt resets the context:
   * - Stale reminders should not fire
   * - P&R baseline resets for new turn threshold
   */
  private async handleUserPromptSubmitCleanup(event: HookEvent, options?: { logger?: Logger }): Promise<void> {
    const log = options?.logger ?? this.logger
    const sessionId = event.context?.sessionId

    if (!sessionId) {
      log.warn('UserPromptSubmit event missing sessionId')
      return
    }

    // Clear any pending reminders staged for tool-use and stop hooks
    // User submitting a prompt resets the context - stale reminders should not fire
    const stagingService = this.serviceFactory.getStagingService(sessionId)
    const hooksToClear: Array<'PreToolUse' | 'PostToolUse' | 'Stop'> = ['PreToolUse', 'PostToolUse', 'Stop']
    for (const hook of hooksToClear) {
      await stagingService.clearStaging(hook, { logger: log })
    }
    log.debug('Cleared staged reminders on UserPromptSubmit', { hooks: hooksToClear })

    // Build state directory path
    const stateDir = path.join(this.projectDir, '.sidekick', 'sessions', sessionId, 'state')

    // Clear P&R baseline on new user prompt (new turn resets threshold)
    try {
      await fs.unlink(path.join(stateDir, 'pr-baseline.json'))
      log.debug('Cleared P&R baseline on UserPromptSubmit')
    } catch {
      // File may not exist - ignore
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
    const idleTimeoutMs = this.configService.core.supervisor.idleTimeoutMs

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
   * Start periodic session eviction timer.
   * Per Phase 6: Evicts orphaned sessions (e.g., from crashed Claude Code instances)
   * to prevent memory leaks. Runs every 5 minutes.
   */
  private startEvictionTimer(): void {
    const EVICTION_INTERVAL_MS = 5 * 60 * 1000 // Every 5 minutes

    this.evictionTimer = setInterval(() => {
      void this.serviceFactory.evictStaleSessions()
    }, EVICTION_INTERVAL_MS)

    // Don't let the interval keep the process alive
    this.evictionTimer.unref()

    this.logger.info('Session eviction timer started', { intervalMs: EVICTION_INTERVAL_MS })
  }

  private stopEvictionTimer(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer)
      this.evictionTimer = null
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

    // Persist log metrics for each active session
    await this.persistLogMetrics()
  }

  /**
   * Load existing log counts from supervisor-log-metrics.json.
   * Used to restore counts after supervisor restart mid-session.
   */
  private async loadExistingLogCounts(sessionId: string): Promise<{ warnings: number; errors: number }> {
    const stateDir = path.join(this.projectDir, '.sidekick', 'sessions', sessionId, 'state')
    const logMetricsPath = path.join(stateDir, 'supervisor-log-metrics.json')

    try {
      const content = await fs.readFile(logMetricsPath, 'utf-8')
      const parsed = JSON.parse(content) as { warningCount?: number; errorCount?: number }
      const existing = {
        warnings: typeof parsed.warningCount === 'number' ? parsed.warningCount : 0,
        errors: typeof parsed.errorCount === 'number' ? parsed.errorCount : 0,
      }
      this.logger.debug('Loaded existing supervisor log counts', { sessionId, existing })
      return existing
    } catch {
      // File doesn't exist or is invalid - start fresh (normal for new sessions)
      return { warnings: 0, errors: 0 }
    }
  }

  /**
   * Persist log metrics for all active sessions and global supervisor metrics.
   * Writes supervisor-log-metrics.json to each session's state directory,
   * and supervisor-global-log-metrics.json to the supervisor state directory.
   */
  private async persistLogMetrics(): Promise<void> {
    const now = Date.now()

    // Persist per-session log metrics
    for (const [sessionId, counts] of this.logCounters) {
      const stateDir = path.join(this.projectDir, '.sidekick', 'sessions', sessionId, 'state')
      const logMetricsPath = path.join(stateDir, 'supervisor-log-metrics.json')

      const logMetrics = {
        sessionId,
        warningCount: counts.warnings,
        errorCount: counts.errors,
        lastUpdatedAt: now,
      }

      try {
        await fs.mkdir(stateDir, { recursive: true })
        await fs.writeFile(logMetricsPath, JSON.stringify(logMetrics, null, 2))
      } catch (err) {
        // Log but don't crash - log metrics are non-critical
        this.logger.warn('Failed to persist log metrics', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Persist global supervisor log metrics (for logs without session context)
    const globalMetrics = {
      warningCount: this.globalLogCounters.warnings,
      errorCount: this.globalLogCounters.errors,
      lastUpdatedAt: now,
    }

    try {
      await this.stateManager.update('supervisor-global-log-metrics', globalMetrics)
    } catch (err) {
      // Log but don't crash - log metrics are non-critical
      // Note: This log itself won't cause infinite recursion since the hook
      // only increments counters, it doesn't trigger persistence
      this.logger.warn('Failed to persist global log metrics', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Register staging handlers for the Reminders feature.
   *
   * Staging handlers listen for SessionStart and transcript events,
   * then stage reminders for CLI consumption. They require SupervisorContext
   * at invocation time (not registration time), which is set in handleSessionStart.
   *
   * @see docs/design/FEATURE-REMINDERS.md §3.1 Staging Handlers
   */
  private registerStagingHandlers(): void {
    // Build RuntimePaths for the context
    const paths: RuntimePaths = {
      projectDir: this.projectDir,
      userConfigDir: path.join(homedir(), '.sidekick'),
      projectConfigDir: path.join(this.projectDir, '.sidekick'),
      hookScriptPath: undefined, // Not applicable for supervisor
    }

    // Create a registration context with role='supervisor' for type guards.
    // Services (staging, transcript, llm) aren't available yet - they're created
    // per-session in handleSessionStart. The handlers access them via the
    // HandlerContext passed at invocation time.
    const registrationContext: SupervisorContext = {
      role: 'supervisor',
      config: {
        core: {
          logging: { level: this.configService.core.logging.level },
          development: { enabled: this.configService.core.development.enabled },
        },
        llm: {
          defaultProfile: this.configService.llm.defaultProfile,
          profiles: this.configService.llm.profiles,
          fallbacks: this.configService.llm.fallbacks,
        },
        getAll: () => this.configService.getAll(),
        getFeature: <T = Record<string, unknown>>(name: string) => this.configService.getFeature<T>(name),
      },
      logger: this.logger,
      assets: this.assetResolver,
      paths,
      handlers: this.handlerRegistry,
      // Placeholder services - will be replaced via setContext() in handleSessionStart
      llm: null as unknown as LLMProvider,
      profileFactory: this.profileProviderFactory,
      staging: null as unknown as StagingService,
      transcript: null as unknown as TranscriptService,
    }

    // Register handlers - they'll receive full context at invocation time
    registerStagingHandlers(registrationContext)
    registerSessionSummaryHandlers(registrationContext)
    this.contextMetricsService.registerHandlers(this.handlerRegistry)

    this.logger.debug('Feature handlers registered (Reminders, Session Summary, Context Metrics)')
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
