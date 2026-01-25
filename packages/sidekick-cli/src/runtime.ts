/**
 * Runtime Shell Bootstrap Module
 *
 * Implements the Sidekick runtime bootstrap sequence per docs/design/CLI.md §3.4 and
 * docs/design/CORE-RUNTIME.md §3.1.
 *
 * Orchestrates the multi-phase startup:
 * 1. Create bootstrap logger facade for early error capture
 * 2. Resolve project root from --project-dir
 * 3. Initialize asset resolver (needed for config feature defaults)
 * 4. Load cascaded configuration with validation
 * 5. Upgrade to structured Pino logger with file transport
 * 6. Set up global error handlers
 *
 * Returns a RuntimeShell providing access to all core services:
 * - logger: Structured Pino-based logging
 * - telemetry: Metrics emission (counters, gauges, histograms)
 * - config: Validated configuration service
 * - assets: Cascading asset resolver
 * - cleanup: Teardown function for graceful shutdown
 *
 * @see docs/design/CLI.md §3.4 Bootstrap Sequence
 * @see docs/design/CORE-RUNTIME.md §3.1 Bootstrap & Lifecycle
 */

import type { AssetResolver, ConfigService, LogContext, Logger, Telemetry } from '@sidekick/core'
import {
  createAssetResolver,
  createConfigService,
  createHookableLogger,
  createLoggerFacade,
  createLogManager,
  getDefaultAssetsDir,
  resolveProjectRoot,
  setupGlobalErrorHandlers,
  StateService,
  type LogLevel,
  type ProjectRootInput,
} from '@sidekick/core'
import { LogMetricsStateSchema, type MinimalStateService } from '@sidekick/types'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

export interface BootstrapOptions extends ProjectRootInput {
  logLevel?: LogLevel
  stderrSink?: Writable
  defaultAssetsDir?: string
  command?: string
  correlationId?: string
  interactive?: boolean
  enableFileLogging?: boolean
  homeDir?: string
}

export interface RuntimeShell {
  logger: Logger
  telemetry: Telemetry
  projectRoot?: string
  config: ConfigService
  assets: AssetResolver
  stateService: MinimalStateService
  correlationId: string
  cleanup: () => void
  /**
   * Bind sessionId to the logger context.
   * Should be called once after sessionId is parsed from hook input.
   * All subsequent log calls will include sessionId in the context.
   */
  bindSessionId: (sessionId: string) => void
  /**
   * Get current log counts (warnings and errors) for the CLI process.
   * Used for statusline {logs} indicator.
   */
  getLogCounts: () => { warnings: number; errors: number }
  /**
   * Reset log counts to zero.
   * Called when session starts or clears.
   */
  resetLogCounts: () => void
  /**
   * Load existing log counts from cli-log-metrics.json file.
   * Adds existing counts to the current counters for cross-invocation accumulation.
   * Called after bindSessionId when project root is available.
   */
  loadExistingLogCounts: (sessionId: string) => Promise<void>
}

function getLogFilePath(projectRoot: string | undefined): string {
  if (projectRoot) {
    return join(projectRoot, '.sidekick', 'logs', 'sidekick.log')
  }
  return join(homedir(), '.sidekick', 'logs', 'sidekick.log')
}

export function bootstrapRuntime(options: BootstrapOptions): RuntimeShell {
  const correlationId = options.correlationId ?? randomUUID()

  // Log counters for statusline {logs} indicator
  let logCounters = { warnings: 0, errors: 0 }

  // Create logger facade with bootstrap logger for early errors
  const loggerFacade = createLoggerFacade({
    bootstrapSink: options.stderrSink ?? process.stderr,
    bufferPreUpgrade: true,
  })

  // Resolve project root from --project-dir
  const { projectRoot } = resolveProjectRoot(options)

  // Initialize asset resolver early (needed for config feature defaults from YAML)
  const defaultAssetsDir = options.defaultAssetsDir ?? getDefaultAssetsDir()
  const assets = createAssetResolver({
    defaultAssetsDir,
    projectRoot,
    homeDir: options.homeDir,
  })

  // Load configuration with cascade
  let config: ConfigService
  try {
    config = createConfigService({
      projectRoot,
      homeDir: options.homeDir,
      assets,
    })
  } catch (err) {
    loggerFacade.error('Failed to load configuration', {
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  // Determine effective log level (CLI override > config)
  const effectiveLogLevel = options.logLevel ?? config.core.logging.level

  // Build context for structured logs
  // Use let so we can update with sessionId later
  let logContext: LogContext = {
    correlationId,
    command: options.command,
  }

  // Upgrade to full Pino logger with config-driven settings
  const logFilePath = getLogFilePath(projectRoot)
  const isInteractive = options.interactive ?? process.env.SIDEKICK_INTERACTIVE === '1'
  const enableFileLogging = options.enableFileLogging ?? true

  // Create the full log manager for structured logging
  const logManager = createLogManager({
    name: 'sidekick:cli',
    level: effectiveLogLevel,
    context: logContext,
    destinations: {
      file: enableFileLogging ? { path: logFilePath } : undefined,
      console: {
        enabled: isInteractive,
        pretty: isInteractive,
        stream: options.stderrSink,
      },
    },
  })

  // Upgrade the facade to use Pino
  loggerFacade.upgrade({
    name: 'sidekick:cli',
    level: effectiveLogLevel,
    context: logContext,
    destinations: {
      file: enableFileLogging ? { path: logFilePath } : undefined,
      console: {
        enabled: isInteractive,
        pretty: isInteractive,
      },
    },
    onUpgradeError: (err: Error) => {
      loggerFacade.warn('Pino initialization failed, using fallback logger', {
        error: err.message,
      })
    },
  })

  // Get the logger and telemetry from the log manager
  // Use mutable reference so bindSessionId can update it
  // Wrap with hookable logger for counting warnings/errors
  let logger = createHookableLogger(logManager.getLogger(), {
    levels: ['warn', 'error', 'fatal'],
    hook: (level) => {
      if (level === 'warn') logCounters.warnings++
      else logCounters.errors++ // error and fatal
    },
  })
  const telemetry = logManager.getTelemetry()

  // Set up global error handlers
  const cleanupErrorHandlers = setupGlobalErrorHandlers(logger)

  logger.debug('Runtime bootstrap complete', {
    projectRoot: projectRoot ?? null,
    logFile: enableFileLogging ? logFilePath : null,
  })

  if (config.sources.length > 0) {
    logger.debug('Configuration sources loaded', { sources: config.sources })
  }

  logger.debug('Asset resolver initialized', { cascadeLayers: assets.cascadeLayers })

  // Create StateService for CLI state operations
  // Use projectRoot if available, otherwise fall back to user home
  const stateRoot = projectRoot ?? join(homedir(), '.claude')
  const stateService = new StateService(stateRoot, { logger })

  // Return the runtime shell
  // Use getter for logger so bindSessionId updates are reflected
  return {
    get logger() {
      return logger
    },
    telemetry,
    projectRoot,
    config,
    assets,
    stateService,
    correlationId,
    cleanup: () => {
      cleanupErrorHandlers()
    },
    bindSessionId: (sessionId: string) => {
      // Update logContext and recreate the logger with sessionId included
      // This avoids duplicate context keys that would result from using child()
      logContext = { ...logContext, sessionId }
      const newLogManager = createLogManager({
        name: 'sidekick:cli',
        level: effectiveLogLevel,
        context: logContext,
        destinations: {
          file: enableFileLogging ? { path: logFilePath } : undefined,
          console: {
            enabled: isInteractive,
            pretty: isInteractive,
            stream: options.stderrSink,
          },
        },
      })
      // Wrap with hookable logger to maintain counting
      logger = createHookableLogger(newLogManager.getLogger(), {
        levels: ['warn', 'error', 'fatal'],
        hook: (level) => {
          if (level === 'warn') logCounters.warnings++
          else logCounters.errors++ // error and fatal
        },
      })
    },
    getLogCounts: () => ({ ...logCounters }),
    resetLogCounts: () => {
      logCounters = { warnings: 0, errors: 0 }
    },
    loadExistingLogCounts: async (sessionId: string) => {
      const logMetricsPath = stateService.sessionStatePath(sessionId, 'cli-log-metrics.json')
      try {
        const result = await stateService.read(logMetricsPath, LogMetricsStateSchema, {
          sessionId,
          warningCount: 0,
          errorCount: 0,
          lastUpdatedAt: 0,
        })
        if (result.source !== 'default') {
          logCounters.warnings += result.data.warningCount
          logCounters.errors += result.data.errorCount
          logger.debug('Loaded existing CLI log counts', {
            sessionId,
            existing: { warnings: result.data.warningCount, errors: result.data.errorCount },
            total: logCounters,
          })
        }
      } catch {
        // File doesn't exist or is invalid - start fresh (normal for new sessions)
      }
    },
  }
}
