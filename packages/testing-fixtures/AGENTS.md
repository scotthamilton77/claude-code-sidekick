# AGENTS.md — @sidekick/testing-fixtures

## Role

Shared test infrastructure—mocks, factories, and utilities for all Sidekick packages.

## Available Mocks

| Mock | Replaces | Key Methods |
|------|----------|-------------|
| `MockLLMService` | `LLMService` | `.addResponse()`, `.getRequests()` |
| `MockLogger` | `LoggerFacade` | `.getLogs()`, `.clear()` |
| `MockTelemetry` | `Telemetry` | `.getCounters()`, `.getGauges()` |
| `MockConfigService` | `ConfigService` | `.set()`, `.reset()` |
| `MockAssetResolver` | `AssetResolver` | `.addAsset()`, `.resolve()` |

## Factories

| Factory | Returns |
|---------|---------|
| `createMockContext()` | Complete `RuntimeContext` with all mocks wired |
| `createTestConfig()` | `SidekickConfig` with sensible defaults |
| `createTestFeature()` | Minimal feature for registration tests |
| `createRecordingFeature()` | Feature that records all handler invocations |

## Usage Pattern

```typescript
import { createMockContext, MockLLMService } from '@sidekick/testing-fixtures'

const ctx = createMockContext()
const llm = ctx.llm as MockLLMService
llm.addResponse({ content: 'test response' })
// ... run code under test ...
expect(llm.getRequests()).toHaveLength(1)
```

## Constraints

- **No real I/O**: All mocks must be synchronous and in-memory
- **Assertion-free**: Mocks record; tests assert
- **Cross-package**: Design for reuse across all `packages/*/`
