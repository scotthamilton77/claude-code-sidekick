export * from './assets.js'
export * from './config.js'
export * from './feature-registry.js'
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

// Re-export LLMService from shared-providers for convenience
export { LLMService, type LLMServiceConfig } from '@sidekick/shared-providers'
