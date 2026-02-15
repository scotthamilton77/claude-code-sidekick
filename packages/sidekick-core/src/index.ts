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
  // Task types
  TaskType,
  TaskPayload,
  SessionSummaryPayload,
  ResumeGenerationPayload,
  CleanupPayload,
  MetricsPersistPayload,
  TrackedTask,
  TaskRegistryState,
} from '@sidekick/types'

// Re-export task type constants and schemas
export {
  TaskTypes,
  SessionSummaryPayloadSchema,
  ResumeGenerationPayloadSchema,
  CleanupPayloadSchema,
  MetricsPersistPayloadSchema,
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
export {
  createPersonaLoader,
  discoverPersonas,
  getDefaultPersonasDir,
  loadPersonaFile,
  type PersonaLoader,
  type PersonaLoaderOptions,
  type PersonaLoadResult,
} from './persona-loader'
export * from './config'
export * from './feature-registry'
export * from './feature-types'
export * from './ipc/client'
export * from './ipc/protocol'
export { IpcServer } from './ipc/server'
export { IpcService, type IpcServiceOptions } from './ipc-service'
export {
  getLockPath,
  getPidPath,
  getProjectHash,
  getSocketPath,
  getTokenPath,
  getUserPidPath,
  getUserDaemonsDir,
} from './ipc/transport'

export { createConsoleLogger, type Logger as ConsoleLogger, type LoggerOptions as ConsoleLoggerOptions } from './logger'
export * from './runtime-context'
export * from './project-root'
export {
  createLogManager,
  createLoggerFacade,
  setupGlobalErrorHandlers,
  getComponentLogLevel,
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

export { killAllDaemons, DaemonClient, type KillResult, type KillAllOptions, type UserPidInfo } from './daemon-client'
export {
  SetupStatusService,
  createSetupStatusService,
  type SetupStatusServiceOptions,
  type ApiKeyName,
  type SetupState,
  type DoctorCheckOptions,
  type DoctorCheckResult,
  type DoctorItemResult,
  type DoctorApiKeyResult,
  type PluginInstallationStatus,
  type PluginLivenessStatus,
  type ApiKeySource,
  type ApiKeyDetectionResult,
  type ScopeDetectionResult,
  type AllScopesDetectionResult,
} from './setup-status-service'
// Re-export validation utilities from shared-providers
export { validateOpenRouterKey, validateOpenAIKey, type ValidationResult } from '@sidekick/shared-providers'
export {
  installGitignoreSection,
  removeGitignoreSection,
  detectGitignoreStatus,
  SIDEKICK_SECTION_START,
  SIDEKICK_SECTION_END,
  GITIGNORE_ENTRIES,
  type GitignoreResult,
} from './gitignore'
export { StagingServiceCore, SessionScopedStagingService, type StagingServiceCoreOptions } from './staging-service'
export {
  getStagingRoot,
  getHookDir,
  getReminderPath,
  isValidPathSegment,
  validatePathSegment,
  filterActiveReminderFiles,
  CONSUMED_FILE_PATTERN,
  createConsumedFilePattern,
  extractConsumedTimestamp,
} from './staging-paths'
export { HandlerRegistryImpl, type HandlerRegistryOptions } from './handler-registry'
export {
  extractContentPreview,
  extractTextFromContent,
  extractToolCallPreview,
  extractToolResultPreview,
} from './transcript-content'
export {
  getTimestampedPath,
  copyWithTimestamp,
  renameWithTimestamp,
  renameWithTimestampSync,
  copyWithTimestampSync,
  type TimestampedFileOptions,
} from './file-utils'
export {
  createDefaultMetrics,
  createDefaultTokenUsage,
  TranscriptServiceImpl,
  type TranscriptServiceOptions,
} from './transcript-service'
export { ServiceFactoryImpl, type ServiceFactoryOptions } from './service-factory'
export { InstrumentedLLMProvider, type InstrumentedLLMProviderConfig } from './instrumented-llm-provider'
export { InstrumentedProfileProviderFactory, type InstrumentationConfig } from './instrumented-profile-factory'
export { createHookableLogger, type LogHook, type HookableLoggerOptions } from './hookable-logger'
export {
  StateService,
  StateNotFoundError,
  StateCorruptError,
  type StateReadResult,
  type StateServiceOptions,
  // Typed state accessors
  sessionState,
  globalState,
  SessionStateAccessor,
  GlobalStateAccessor,
  type StateDescriptor,
  // Descriptors for state files owned by @sidekick/core
  TranscriptMetricsDescriptor,
  CompactionHistoryDescriptor,
  DaemonLogMetricsDescriptor,
  CliLogMetricsDescriptor,
  DaemonGlobalLogMetricsDescriptor,
  // Types for state schemas
  type PersistedTranscriptState,
} from './state/index.js'

export { isInSandbox } from './sandbox'

// Note: LLMService should be imported directly from '@sidekick/shared-providers'
// to avoid circular dependencies between packages
