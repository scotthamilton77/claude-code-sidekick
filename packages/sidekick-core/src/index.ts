// Re-export shared types from @sidekick/types for consumer convenience
export type { Logger, Telemetry, LogLevel, Message, LLMRequest, LLMResponse, LLMProvider } from '@sidekick/types'

export * from './assets.js'
export * from './config.js'
export * from './feature-registry.js'
export * from './feature-types.js'
export * from './ipc/client.js'
export * from './ipc/protocol.js'
export * from './ipc/server.js'
export * from './ipc/transport.js'
export {
  createConsoleLogger,
  type Logger as ConsoleLogger,
  type LoggerOptions as ConsoleLoggerOptions,
} from './logger.js'
export * from './runtime-context.js'
export * from './scope.js'
export * from './structured-logging.js'
export * from './supervisor-client.js'

// Note: LLMService should be imported directly from '@sidekick/shared-providers'
// to avoid circular dependencies between packages
