// Re-export shared types from @sidekick/types for consumer convenience
export type {
  // LLM types
  LLMProvider,
  LLMRequest,
  LLMResponse,
  Message,
  // Logger types
  Logger,
  LogLevel,
  Telemetry,
  // Event types
  EventContext,
  HookName,
  HookEvent,
  SessionStartHookEvent,
  SessionEndHookEvent,
  UserPromptSubmitHookEvent,
  PreToolUseHookEvent,
  PostToolUseHookEvent,
  StopHookEvent,
  PreCompactHookEvent,
  TranscriptEventType,
  TranscriptEntry,
  TranscriptMetrics,
  TranscriptEvent,
  SidekickEvent,
  // Handler types
  HandlerFilter,
  HookFilter,
  TranscriptFilter,
  AllFilter,
  HookResponse,
  HandlerResult,
  HandlerContext,
  EventHandler,
  HandlerRegistration,
  HandlerRegistry,
} from '@sidekick/types'

// Re-export type guards from @sidekick/types
export {
  isHookEvent,
  isTranscriptEvent,
  isSessionStartEvent,
  isSessionEndEvent,
  isUserPromptSubmitEvent,
  isPreToolUseEvent,
  isPostToolUseEvent,
  isStopEvent,
  isPreCompactEvent,
} from '@sidekick/types'

export * from './assets'
export * from './config'
export * from './feature-registry'
export * from './feature-types'
export * from './ipc/client'
export * from './ipc/protocol'
export { IpcServer } from './ipc/server'
export { IpcService, type IpcServiceOptions } from './ipc-service'
export {
  getPidPath,
  getProjectHash,
  getSocketPath,
  getTokenPath,
  getUserPidPath,
  getUserSupervisorsDir,
} from './ipc/transport'

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

export { killAllSupervisors, SupervisorClient, type KillResult, type UserPidInfo } from './supervisor-client'
export { StagingServiceImpl, type StagingServiceOptions } from './staging-service'
export {
  createDefaultMetrics,
  createDefaultTokenUsage,
  TranscriptServiceImpl,
  type TranscriptServiceOptions,
} from './transcript-service'

// Note: LLMService should be imported directly from '@sidekick/shared-providers'
// to avoid circular dependencies between packages
