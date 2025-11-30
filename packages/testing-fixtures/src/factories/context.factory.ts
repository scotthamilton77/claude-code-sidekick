/**
 * Context Factory for Testing
 *
 * Creates mock RuntimeContext objects (CLIContext or SupervisorContext)
 * with sensible defaults. Uses canonical types from @sidekick/types.
 *
 * Updated for Phase 4.1 discriminated union context types.
 *
 * @example
 * ```typescript
 * // Create a SupervisorContext for LLM testing
 * const ctx = createMockSupervisorContext({
 *   llm: customLLMService
 * });
 *
 * // Create a CLIContext for hook testing
 * const ctx = createMockCLIContext();
 * ```
 */

import type { RuntimeContext, CLIContext, SupervisorContext, RuntimePaths, SupervisorClient } from '@sidekick/types'
import { MockConfigService } from '../mocks/MockConfigService'
import { MockLogger } from '../mocks/MockLogger'
import { MockLLMService } from '../mocks/MockLLMService'
import { MockAssetResolver } from '../mocks/MockAssetResolver'
import { MockHandlerRegistry } from '../mocks/MockHandlerRegistry'
import { MockStagingService } from '../mocks/MockStagingService'
import { MockTranscriptService } from '../mocks/MockTranscriptService'

// Re-export canonical types for convenience
export type { RuntimeContext, CLIContext, SupervisorContext, RuntimePaths }

const DEFAULT_PATHS: RuntimePaths = {
  projectDir: '/mock/project',
  userConfigDir: '/mock/home/.sidekick',
  projectConfigDir: '/mock/project/.sidekick',
}

/**
 * Mock SupervisorClient for CLIContext testing.
 */
export class MockSupervisorClient implements SupervisorClient {
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
 * Options for creating a mock SupervisorContext.
 */
export interface MockSupervisorContextOptions {
  config?: MockConfigService
  logger?: MockLogger
  assets?: MockAssetResolver
  handlers?: MockHandlerRegistry
  paths?: RuntimePaths
  llm?: MockLLMService
  staging?: MockStagingService
  transcript?: MockTranscriptService
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
  supervisor?: MockSupervisorClient
}

/**
 * Create a mock SupervisorContext with all services initialized.
 * Use this when testing code that requires LLM, staging, or transcript services.
 */
export function createMockSupervisorContext(overrides?: MockSupervisorContextOptions): SupervisorContext {
  return {
    role: 'supervisor',
    config: overrides?.config ?? new MockConfigService(),
    logger: overrides?.logger ?? new MockLogger(),
    assets: overrides?.assets ?? new MockAssetResolver(),
    handlers: overrides?.handlers ?? new MockHandlerRegistry(),
    paths: overrides?.paths ?? DEFAULT_PATHS,
    llm: overrides?.llm ?? new MockLLMService(),
    staging: overrides?.staging ?? new MockStagingService(),
    transcript: overrides?.transcript ?? new MockTranscriptService(),
  }
}

/**
 * Create a mock CLIContext with all services initialized.
 * Use this when testing code that requires supervisor client communication.
 */
export function createMockCLIContext(overrides?: MockCLIContextOptions): CLIContext {
  return {
    role: 'cli',
    config: overrides?.config ?? new MockConfigService(),
    logger: overrides?.logger ?? new MockLogger(),
    assets: overrides?.assets ?? new MockAssetResolver(),
    handlers: overrides?.handlers ?? new MockHandlerRegistry(),
    paths: overrides?.paths ?? DEFAULT_PATHS,
    supervisor: overrides?.supervisor ?? new MockSupervisorClient(),
  }
}
