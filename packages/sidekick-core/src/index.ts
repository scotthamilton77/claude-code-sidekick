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
  // Task types (Phase 5.2)
  TaskType,
  TaskPayload,
  SessionSummaryPayload,
  ResumeGenerationPayload,
  CleanupPayload,
  MetricsPersistPayload,
  FirstPromptSummaryPayload,
  TrackedTask,
  TaskRegistryState,
  // State types
  FirstPromptClassification,
  FirstPromptSummaryState,
  // Config types
  FirstPromptConfig,
  FirstPromptModelConfig,
} from '@sidekick/types'

// Re-export task type constants and schemas
export {
  TaskTypes,
  SessionSummaryPayloadSchema,
  ResumeGenerationPayloadSchema,
  CleanupPayloadSchema,
  MetricsPersistPayloadSchema,
  FirstPromptSummaryPayloadSchema,
  // State schemas
  FirstPromptClassificationSchema,
  FirstPromptSummaryStateSchema,
  // Config schemas
  FirstPromptConfigSchema,
  FirstPromptModelConfigSchema,
  DEFAULT_FIRST_PROMPT_CONFIG,
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
export { encodeProjectPath, reconstructTranscriptPath } from './claude-paths'
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
  LogEvents,
  logEvent,
  type EventLogContext,
  type LogContext,
  type LogManager,
  type LogManagerOptions,
  type LoggerFacade,
  type LoggerFacadeOptions,
  type UpgradeOptions,
} from './structured-logging'

export { killAllSupervisors, SupervisorClient, type KillResult, type UserPidInfo } from './supervisor-client'
export { StagingServiceCore, SessionScopedStagingService, type StagingServiceCoreOptions } from './staging-service'
export { HandlerRegistryImpl, type HandlerRegistryOptions } from './handler-registry'
export {
  extractContentPreview,
  extractTextFromContent,
  extractToolCallPreview,
  extractToolResultPreview,
} from './transcript-content'
export {
  createDefaultMetrics,
  createDefaultTokenUsage,
  TranscriptServiceImpl,
  type TranscriptServiceOptions,
} from './transcript-service'
export { ServiceFactoryImpl, type ServiceFactoryOptions } from './service-factory'

// Note: LLMService should be imported directly from '@sidekick/shared-providers'
// to avoid circular dependencies between packages
