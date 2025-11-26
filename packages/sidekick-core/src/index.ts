// Phase 1 logger (simple console logger - still exported for backward compatibility)
export type { Logger as SimpleLogger, LoggerOptions as SimpleLoggerOptions, LogLevel as SimpleLogLevel } from './logger'
export { createConsoleLogger } from './logger'

// Phase 3 structured logging (Pino-based)
export type {
  Logger,
  LogLevel,
  LogContext,
  Telemetry,
  TelemetryMetric,
  LogManager,
  LogManagerOptions,
  LoggerFacade,
  LoggerFacadeOptions,
  UpgradeOptions,
} from './structured-logging'
export { LOG_LEVELS, createLogManager, createLoggerFacade, setupGlobalErrorHandlers } from './structured-logging'

export type { Scope, ScopeResolution, ScopeResolutionInput } from './scope'
export { resolveScope } from './scope'
export type { SidekickConfig, ConfigService, ConfigServiceOptions } from './config'
export { loadConfig, createConfigService, SidekickConfigSchema } from './config'
export type { AssetResolver, AssetResolverOptions } from './assets'
export { createAssetResolver, getDefaultAssetsDir } from './assets'
