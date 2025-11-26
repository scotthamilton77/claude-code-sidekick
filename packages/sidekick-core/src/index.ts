// Re-export shared types from @sidekick/types for consumer convenience
export type { LLMProvider, LLMRequest, LLMResponse, Logger, LogLevel, Message, Telemetry } from '@sidekick/types'

export * from './assets'
export * from './config'
export * from './feature-registry'
export * from './feature-types'
export * from './ipc/client'
export * from './ipc/protocol'
export { IpcServer } from './ipc/server'
export { getPidPath, getSocketPath, getTokenPath } from './ipc/transport'

export { createConsoleLogger, type Logger as ConsoleLogger, type LoggerOptions as ConsoleLoggerOptions } from './logger'
export * from './runtime-context'
export * from './scope'
export {
  createLogManager,
  createLoggerFacade,
  setupGlobalErrorHandlers,
  type LogContext,
  type LogManager,
  type LogManagerOptions,
  type LoggerFacade,
  type LoggerFacadeOptions,
  type UpgradeOptions,
} from './structured-logging'

export { SupervisorClient } from './supervisor-client'

// Note: LLMService should be imported directly from '@sidekick/shared-providers'
// to avoid circular dependencies between packages
