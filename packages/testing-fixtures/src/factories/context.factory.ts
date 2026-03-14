/**
 * Context Factory for Testing
 *
 * Creates mock RuntimeContext objects (CLIContext or DaemonContext)
 * with sensible defaults. Uses canonical types from @sidekick/types.
 *
 * @example
 * ```typescript
 * // Create a DaemonContext for LLM testing
 * const ctx = createMockDaemonContext({
 *   llm: customLLMService
 * });
 *
 * // Create a CLIContext for hook testing
 * const ctx = createMockCLIContext();
 * ```
 */

import type {
  RuntimeContext,
  CLIContext,
  DaemonContext,
  RuntimePaths,
  DaemonClient,
  ProfileProviderFactory,
  LLMProvider,
  ReminderCoordinator,
} from '@sidekick/types'
import { MockConfigService } from '../mocks/MockConfigService'
import { MockLogger } from '../mocks/MockLogger'
import { MockLLMService } from '../mocks/MockLLMService'
import { MockAssetResolver } from '../mocks/MockAssetResolver'
import { MockHandlerRegistry } from '../mocks/MockHandlerRegistry'
import { MockStagingService } from '../mocks/MockStagingService'
import { MockTranscriptService } from '../mocks/MockTranscriptService'
import { MockStateService } from '../mocks/MockStateService'

// Re-export canonical types for convenience
export type { RuntimeContext, CLIContext, DaemonContext, RuntimePaths }

const DEFAULT_PATHS: RuntimePaths = {
  projectDir: '/mock/project',
  userConfigDir: '/mock/home/.sidekick',
  projectConfigDir: '/mock/project/.sidekick',
}

/**
 * Mock ProfileProviderFactory for testing.
 * Returns the same MockLLMService for all profiles.
 */
export class MockProfileProviderFactory implements ProfileProviderFactory {
  constructor(private readonly llm: LLMProvider = new MockLLMService()) {}

  createForProfile(_profileId: string, _fallbackProfileId?: string): LLMProvider {
    return this.llm
  }

  createDefault(): LLMProvider {
    return this.llm
  }
}

/**
 * Mock DaemonClient for CLIContext testing.
 */
export class MockDaemonClient implements DaemonClient {
  private _isRunning = false
  private _status: { status: string; ping?: unknown; error?: unknown } = { status: 'stopped' }

  start(): Promise<void> {
    this._isRunning = true
    this._status = { status: 'running' }
    return Promise.resolve()
  }

  stop(): Promise<void> {
    this._isRunning = false
    this._status = { status: 'stopped' }
    return Promise.resolve()
  }

  getStatus(): Promise<{ status: string; ping?: unknown; error?: unknown }> {
    return Promise.resolve(this._status)
  }

  kill(): Promise<{ killed: boolean; pid?: number }> {
    this._isRunning = false
    this._status = { status: 'stopped' }
    return Promise.resolve({ killed: true })
  }

  // Test utilities

  get isRunning(): boolean {
    return this._isRunning
  }

  setStatus(status: { status: string; ping?: unknown; error?: unknown }): void {
    this._status = status
  }
}

/**
 * Options for creating a mock DaemonContext.
 */
export interface MockDaemonContextOptions {
  config?: MockConfigService
  logger?: MockLogger
  assets?: MockAssetResolver
  handlers?: MockHandlerRegistry
  paths?: RuntimePaths
  llm?: MockLLMService
  profileFactory?: MockProfileProviderFactory
  staging?: MockStagingService
  transcript?: MockTranscriptService
  stateService?: MockStateService
  orchestrator?: ReminderCoordinator
  personaClearCache?: { consume(): string | null }
}

/**
 * Options for creating a mock CLIContext.
 */
export interface MockCLIContextOptions {
  config?: MockConfigService
  logger?: MockLogger
  assets?: MockAssetResolver
  handlers?: MockHandlerRegistry
  paths?: RuntimePaths
  daemon?: MockDaemonClient
}

/**
 * Create a mock DaemonContext with all services initialized.
 * Use this when testing code that requires LLM, staging, or transcript services.
 */
export function createMockDaemonContext(overrides?: MockDaemonContextOptions): DaemonContext {
  const llm = overrides?.llm ?? new MockLLMService()
  return {
    role: 'daemon',
    config: overrides?.config ?? new MockConfigService(),
    logger: overrides?.logger ?? new MockLogger(),
    assets: overrides?.assets ?? new MockAssetResolver(),
    handlers: overrides?.handlers ?? new MockHandlerRegistry(),
    paths: overrides?.paths ?? DEFAULT_PATHS,
    llm,
    profileFactory: overrides?.profileFactory ?? new MockProfileProviderFactory(llm),
    staging: overrides?.staging ?? new MockStagingService(),
    transcript: overrides?.transcript ?? new MockTranscriptService(),
    stateService: overrides?.stateService ?? new MockStateService(),
    ...(overrides?.orchestrator ? { orchestrator: overrides.orchestrator } : {}),
    ...(overrides?.personaClearCache ? { personaClearCache: overrides.personaClearCache } : {}),
  }
}

/**
 * Create a mock CLIContext with all services initialized.
 * Use this when testing code that requires daemon client communication.
 */
export function createMockCLIContext(overrides?: MockCLIContextOptions): CLIContext {
  return {
    role: 'cli',
    config: overrides?.config ?? new MockConfigService(),
    logger: overrides?.logger ?? new MockLogger(),
    assets: overrides?.assets ?? new MockAssetResolver(),
    handlers: overrides?.handlers ?? new MockHandlerRegistry(),
    paths: overrides?.paths ?? DEFAULT_PATHS,
    daemon: overrides?.daemon ?? new MockDaemonClient(),
  }
}
