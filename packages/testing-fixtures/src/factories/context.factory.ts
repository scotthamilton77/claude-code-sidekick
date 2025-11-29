/**
 * Context Factory for Testing
 *
 * Creates mock RuntimeContext objects with sensible defaults.
 * Allows partial overrides for specific test scenarios.
 *
 * @example
 * ```typescript
 * const ctx = createMockContext({
 *   scope: 'user',
 *   logger: customLogger
 * });
 * ```
 */

import { MockConfigService } from '../mocks/MockConfigService'
import { MockLogger } from '../mocks/MockLogger'
import { MockLLMService } from '../mocks/MockLLMService'
import { MockAssetResolver } from '../mocks/MockAssetResolver'
import { MockHandlerRegistry } from '../mocks/MockHandlerRegistry'

export type Scope = 'user' | 'project'

export interface RuntimePaths {
  projectDir: string
  userDir: string
  configDir: string
  assetsDir: string
  logsDir: string
}

export interface RuntimeContext {
  config: MockConfigService
  logger: MockLogger
  llm: MockLLMService
  assets: MockAssetResolver
  handlers: MockHandlerRegistry
  paths: RuntimePaths
  scope: Scope
}

const DEFAULT_PATHS: RuntimePaths = {
  projectDir: '/mock/project',
  userDir: '/mock/home',
  configDir: '/mock/config',
  assetsDir: '/mock/assets',
  logsDir: '/mock/logs',
}

/**
 * Create a mock RuntimeContext with all services initialized.
 * Accepts partial overrides for customization.
 */
export function createMockContext(overrides?: Partial<RuntimeContext>): RuntimeContext {
  return {
    config: new MockConfigService(),
    logger: new MockLogger(),
    llm: new MockLLMService(),
    assets: new MockAssetResolver(),
    handlers: new MockHandlerRegistry(),
    paths: DEFAULT_PATHS,
    scope: 'project',
    ...overrides,
  }
}
