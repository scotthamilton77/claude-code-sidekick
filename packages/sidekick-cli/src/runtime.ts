/**
 * Runtime Shell Bootstrap Module
 *
 * Implements the Sidekick runtime bootstrap sequence per docs/design/CLI.md §3.4 and
 * docs/design/CORE-RUNTIME.md §3.1.
 *
 * Orchestrates the multi-phase startup:
 * 1. Create bootstrap logger facade for early error capture
 * 2. Resolve execution scope (project vs user)
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
  createLoggerFacade,
  createLogManager,
  getDefaultAssetsDir,
  resolveScope,
  setupGlobalErrorHandlers,
  type LogLevel,
  type ScopeResolution,
  type ScopeResolutionInput,
} from '@sidekick/core'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

export interface BootstrapOptions extends ScopeResolutionInput {
  logLevel?: LogLevel
  stderrSink?: Writable
  defaultAssetsDir?: string
  command?: string
  correlationId?: string
  interactive?: boolean
  enableFileLogging?: boolean
}

export interface RuntimeShell {
  logger: Logger
  telemetry: Telemetry
  scope: ScopeResolution
  config: ConfigService
  assets: AssetResolver
  correlationId: string
  cleanup: () => void
  /**
   * Bind sessionId to the logger context.
   * Should be called once after sessionId is parsed from hook input.
   * All subsequent log calls will include sessionId in the context.
   */
  bindSessionId: (sessionId: string) => void
}

function getLogFilePath(scope: ScopeResolution): string {
  if (scope.scope === 'project' && scope.projectRoot) {
    return join(scope.projectRoot, '.sidekick', 'logs', 'sidekick.log')
  }
  return join(homedir(), '.sidekick', 'logs', 'sidekick.log')
}

export function bootstrapRuntime(options: BootstrapOptions): RuntimeShell {
  const correlationId = options.correlationId ?? randomUUID()

  // Phase 1: Create logger facade with bootstrap logger for early errors
  const loggerFacade = createLoggerFacade({
    bootstrapSink: options.stderrSink ?? process.stderr,
    bufferPreUpgrade: true,
  })

  // Resolve scope first
  const scope = resolveScope(options)

  // Initialize asset resolver early (needed for config feature defaults from YAML)
  const defaultAssetsDir = options.defaultAssetsDir ?? getDefaultAssetsDir()
  const assets = createAssetResolver({
    defaultAssetsDir,
    projectRoot: scope.projectRoot,
    homeDir: options.homeDir,
  })

  // Load configuration with cascade
  let config: ConfigService
  try {
    config = createConfigService({
      projectRoot: scope.projectRoot,
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
    scope: scope.scope,
    correlationId,
    command: options.command,
  }

  // Phase 2: Upgrade to full Pino logger with config-driven settings
  const logFilePath = getLogFilePath(scope)
  const isInteractive = options.interactive ?? process.env.SIDEKICK_INTERACTIVE === '1'
  const enableFileLogging = options.enableFileLogging ?? true

  // Create the full log manager for structured logging
  const logManager = createLogManager({
    name: scope.scope === 'project' ? 'sidekick:cli' : 'sidekick:cli:user',
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
    name: scope.scope === 'project' ? 'sidekick:cli' : 'sidekick:cli:user',
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
  let logger = logManager.getLogger()
  const telemetry = logManager.getTelemetry()

  // Set up global error handlers
  const cleanupErrorHandlers = setupGlobalErrorHandlers(logger)

  logger.debug('Runtime bootstrap complete', {
    scope: scope.scope,
    projectRoot: scope.projectRoot ?? null,
    source: scope.source,
    warnings: scope.warnings,
    logFile: enableFileLogging ? logFilePath : null,
  })

  if (config.sources.length > 0) {
    logger.debug('Configuration sources loaded', { sources: config.sources })
  }

  logger.debug('Asset resolver initialized', { cascadeLayers: assets.cascadeLayers })

  if (scope.dualInstallDetected) {
    logger.warn('Detected project-scope installation while running from user hooks. Deferring to project scope.')
    // Emit telemetry for dual-install detection
    telemetry.increment('dual_install_detected', { scope: scope.scope })
  }

  // Return the runtime shell
  // Use getter for logger so bindSessionId updates are reflected
  return {
    get logger() {
      return logger
    },
    telemetry,
    scope,
    config,
    assets,
    correlationId,
    cleanup: () => {
      cleanupErrorHandlers()
    },
    bindSessionId: (sessionId: string) => {
      // Update logContext and recreate the logger with sessionId included
      // This avoids duplicate context keys that would result from using child()
      logContext = { ...logContext, sessionId }
      const newLogManager = createLogManager({
        name: scope.scope === 'project' ? 'sidekick:cli' : 'sidekick:cli:user',
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
      logger = newLogManager.getLogger()
    },
  }
}
