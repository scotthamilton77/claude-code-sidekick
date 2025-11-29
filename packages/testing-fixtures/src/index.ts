/**
 * Testing Fixtures Package
 *
 * Provides shared mocks, factories, and test utilities for the Sidekick
 * Node runtime packages. Implements Phase 4 Track C per docs/design/TEST-FIXTURES.md.
 *
 * @see docs/design/TEST-FIXTURES.md
 * @see docs/ROADMAP.md Phase 4 Track C
 */

// Mocks
export { MockLLMService } from './mocks/MockLLMService'
export type { LLMRequest, LLMResponse } from './mocks/MockLLMService'

export { MockLogger } from './mocks/MockLogger'
export type { LogRecord } from './mocks/MockLogger'

export { MockTelemetry } from './mocks/MockTelemetry'
export type { CounterRecord, GaugeRecord, HistogramRecord } from './mocks/MockTelemetry'

export { MockConfigService } from './mocks/MockConfigService'

export { MockAssetResolver } from './mocks/MockAssetResolver'

export { MockHandlerRegistry } from './mocks/MockHandlerRegistry'
export type { RegisteredHandler } from './mocks/MockHandlerRegistry'

// Factories
export { createMockContext } from './factories/context.factory'
export type { RuntimeContext, RuntimePaths, Scope } from './factories/context.factory'

export { createTestConfig } from './factories/config.factory'

export { createTestFeature, createRecordingFeature } from './factories/feature.factory'
export type { FeatureConfig, FeatureHooks, TestFeature } from './factories/feature.factory'
