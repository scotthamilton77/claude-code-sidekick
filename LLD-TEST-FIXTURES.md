# Testing Fixtures & Harness (`testing-fixtures`)

## 1. Overview

The `testing-fixtures` package provides shared infrastructure for testing the Sidekick Node.js runtime. It centralizes mocks, test data loaders, and integration harnesses to ensure consistent testing patterns across all packages (`sidekick-core`, `sidekick-cli`, features).

## 2. Package Structure

```
packages/testing/fixtures/
├── src/
│   ├── mocks/              # Mock implementations of core services
│   │   ├── MockConfigService.ts
│   │   ├── MockLLMService.ts
│   │   ├── MockLogger.ts
│   │   ├── MockAssetResolver.ts
│   │   └── MockSupervisorClient.ts
│   ├── factories/          # Factory functions to generate typed test data
│   │   ├── config.factory.ts
│   │   ├── transcript.factory.ts
│   │   └── context.factory.ts
│   ├── harness/            # Integration test runners
│   │   ├── CLITestHarness.ts
│   │   └── TestEnvironment.ts
│   └── loaders/            # Helpers to load data from root test-data/
│       └── LegacyTranscriptLoader.ts
├── index.ts                # Public API export
└── package.json
```

## 3. Core Mocks

We provide a set of "Smart Mocks" that implement the core interfaces but allow for controlled behavior (recording calls, forcing errors, deterministic outputs).

### 3.1 MockRuntimeContext

A factory to create a fully mocked `RuntimeContext` for unit testing features.

```typescript
import { RuntimeContext } from '@sidekick/core';
import { MockConfigService } from './mocks/MockConfigService';
// ... other mocks

export function createMockContext(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    config: new MockConfigService(),
    logger: new MockLogger(),
    llm: new MockLLMService(),
    assets: new MockAssetResolver(),
    supervisor: new MockSupervisorClient(),
    paths: {
      project: '/mock/project',
      home: '/mock/home',
      // ...
    },
    ...overrides
  };
}
```

### 3.2 MockLLMService

Allows queuing responses and asserting on prompts without making network calls.

```typescript
export class MockLLMService implements LLMService {
  private queue: string[] = [];
  public recordedPrompts: any[] = [];

  queueResponse(content: string) {
    this.queue.push(content);
  }

  async complete(prompt: any): Promise<string> {
    this.recordedPrompts.push(prompt);
    return this.queue.shift() || 'Mock response';
  }
}
```

## 4. Test Data Management

### 4.1 Transcript Fixture Helper

We avoid custom parsing logic in tests. Instead, this helper uses the production `TranscriptService` (from `sidekick-core`) to load and parse files from the root `test-data/` directory. This ensures that integration tests validate the actual parsing pipeline (Parser -> Normalizer -> Scrubber).

```typescript
// src/helpers/TranscriptFixtureHelper.ts
import { TranscriptService } from '@sidekick/core';
import { createMockContext } from '../mocks/MockRuntimeContext';

export class TranscriptFixtureHelper {
  /**
   * Loads a transcript from test-data/ using the production pipeline.
   */
  static async load(filename: string): Promise<Transcript> {
    const path = this.resolvePath(filename);
    // Use a default context to instantiate the service
    const context = createMockContext(); 
    const service = new TranscriptService(context);
    return service.load(path);
  }

  static resolvePath(filename: string): string {
    // Resolves absolute path to repo root test-data/{filename}
    // Implementation handles finding the repo root from inside packages/
  }
}
```

### 4.2 Snapshot Testing

We use Vitest's snapshot capability for output verification, but we need stable inputs.
- **Deterministic IDs**: Mocks should use seeded randoms or static IDs.
- **Date Freezing**: The `TestEnvironment` setup will automatically freeze time.

## 5. Integration Test Harness

The `CLITestHarness` allows running the CLI in-process or as a subprocess, capturing stdin/stdout/stderr for assertion.

```typescript
export class CLITestHarness {
  constructor(private readonly cwd: string) {}

  async run(args: string[], input: string = ''): Promise<CLIResult> {
    // Sets up environment variables (SIDEKICK_CONFIG_PATH, etc.)
    // Invokes the CLI entry point
    // Captures output
    return {
      exitCode: 0,
      stdout: '...',
      stderr: '...'
    };
  }
}
```

## 6. Open Questions & Proposals

### 6.1 Fixture Location
**Question**: Should we copy `test-data` into this package?
**Decision**: **No**. Keep `test-data` at the repo root as the canonical source for both Python and Node tools. `testing-fixtures` will access it via relative paths or a symlink created during `pnpm install`.

### 6.2 Factory Pattern
**Proposal**: Use a library like `fishery` or simple factory functions?
**Decision**: **Simple Factory Functions**. We want to avoid extra dependencies. Simple functions that take `Partial<T>` and merge with defaults are sufficient.

### 6.3 Mocking Library
**Proposal**: Use `vitest` spies vs manual mock classes.
**Decision**: **Hybrid**. Use manual mock classes (like `MockLLMService`) for complex stateful mocks (queuing responses) where a simple spy is too verbose to set up repeatedly. Use `vi.spyOn` for simple method verification.
