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
│   │   ├── MockSupervisorClient.ts
│   │   ├── MockHandlerRegistry.ts   # Handler registration and dispatch
│   │   ├── MockTranscriptService.ts # Transcript watching and metrics
│   │   └── MockStagingService.ts    # Reminder file staging
│   ├── factories/          # Factory functions to generate typed test data
│   │   ├── config.factory.ts
│   │   ├── transcript.factory.ts
│   │   ├── context.factory.ts
│   │   ├── event.factory.ts         # SidekickEvent variants
│   │   ├── reminder.factory.ts      # Staged reminder files
│   │   └── metrics.factory.ts       # TranscriptMetrics snapshots
│   ├── harness/            # Integration test runners
│   │   ├── CLITestHarness.ts
│   │   ├── SupervisorTestHarness.ts # Supervisor process testing
│   │   ├── StagingHelper.ts         # Stage directory utilities
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

**Note**: Unlike production `RuntimeContext` which uses a discriminated union (`CLIContext` vs `SupervisorContext` per **LLD-CORE-RUNTIME.md §4.1**), the mock context intentionally combines all properties from both roles. This allows test code to verify feature behavior without caring which runtime context the feature would run in. Tests requiring role-specific behavior should use explicit overrides.

```typescript
import { RuntimeContext } from '@sidekick/core';
import { MockConfigService } from './mocks/MockConfigService';
import { MockHandlerRegistry } from './mocks/MockHandlerRegistry';
import { MockTranscriptService } from './mocks/MockTranscriptService';
import { MockStagingService } from './mocks/MockStagingService';
// ... other mocks

export function createMockContext(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    config: new MockConfigService(),
    logger: new MockLogger(),
    llm: new MockLLMService(),
    assets: new MockAssetResolver(),
    supervisor: new MockSupervisorClient(),
    handlers: new MockHandlerRegistry(),
    transcript: new MockTranscriptService(),
    staging: new MockStagingService(),
    paths: {
      project: '/mock/project',
      home: '/mock/home',
      sessionDir: '/mock/.sidekick/sessions/test-session',
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

### 3.3 MockHandlerRegistry

Tracks handler registrations and allows controlled dispatch for testing handler chains.

```typescript
export class MockHandlerRegistry implements HandlerRegistry {
  public registrations: HandlerRegistration[] = [];
  public dispatchedEvents: SidekickEvent[] = [];
  private mockResults: Map<string, HandlerResult> = new Map();

  register(options: HandlerRegistration): void {
    this.registrations.push(options);
    // Sort by priority (higher first) to match production behavior
    this.registrations.sort((a, b) => b.priority - a.priority);
  }

  // Test helper: set what a handler should return
  setHandlerResult(handlerId: string, result: HandlerResult): void {
    this.mockResults.set(handlerId, result);
  }

  // Test helper: dispatch event and collect results
  async dispatch(event: SidekickEvent): Promise<HandlerResult[]> {
    this.dispatchedEvents.push(event);
    const results: HandlerResult[] = [];
    for (const reg of this.registrations) {
      if (this.matchesFilter(event, reg.filter)) {
        const result = this.mockResults.get(reg.id) ?? {};
        results.push(result);
        if (result.stop) break;
      }
    }
    return results;
  }

  private matchesFilter(event: SidekickEvent, filter: HandlerFilter): boolean {
    // Implementation matches production filter logic
  }
}
```

### 3.4 MockTranscriptService

Provides controlled transcript metrics and event emission for testing handlers that depend on transcript state.

```typescript
export class MockTranscriptService implements TranscriptService {
  private metrics: TranscriptMetrics = {
    turnCount: 0,
    toolCount: 0,
    toolsThisTurn: 0,
    totalTokens: 0,
  };
  public emittedEvents: TranscriptEvent[] = [];

  // Test helper: set metrics directly
  setMetrics(metrics: Partial<TranscriptMetrics>): void {
    this.metrics = { ...this.metrics, ...metrics };
  }

  getMetrics(): TranscriptMetrics {
    return { ...this.metrics };
  }

  // Test helper: simulate transcript event
  emitEvent(eventType: TranscriptEventType, payload: Partial<TranscriptEvent['payload']>): void {
    const event: TranscriptEvent = {
      kind: 'transcript',
      eventType,
      context: createEventContext(),
      payload: { lineNumber: 0, entry: {}, ...payload },
      metadata: { transcriptPath: '/mock/transcript.jsonl', metrics: this.getMetrics() },
    };
    this.emittedEvents.push(event);
  }

  // Simulate metrics updates that would happen from transcript parsing
  incrementTurn(): void {
    this.metrics.turnCount++;
    this.metrics.toolsThisTurn = 0;
  }

  incrementTool(): void {
    this.metrics.toolCount++;
    this.metrics.toolsThisTurn++;
  }
}
```

### 3.5 MockStagingService

Manages in-memory staging directory for testing reminder flows without filesystem I/O. Per **LLD-FEATURE-REMINDERS.md §3.3**, suppression uses marker files rather than per-reminder state.

```typescript
export class MockStagingService implements StagingService {
  // In-memory store: Map<hookName, Map<reminderName, StagedReminder>>
  private staged: Map<string, Map<string, StagedReminder>> = new Map();
  // Suppression markers: Set<hookName>
  private suppressed: Set<string> = new Set();
  public operations: StagingOperation[] = [];

  stage(hookName: HookName, reminder: StagedReminder): void {
    this.operations.push({ type: 'stage', hookName, reminder });
    if (!this.staged.has(hookName)) {
      this.staged.set(hookName, new Map());
    }
    this.staged.get(hookName)!.set(reminder.name, reminder);
  }

  consume(hookName: HookName): StagedReminder | null {
    // Check suppression marker first (per LLD-FEATURE-REMINDERS.md §3.3)
    if (this.suppressed.has(hookName)) {
      this.suppressed.delete(hookName);
      this.operations.push({ type: 'suppression-cleared', hookName });
      return null;
    }

    const reminders = this.staged.get(hookName);
    if (!reminders || reminders.size === 0) return null;

    // Find highest priority reminder
    const sorted = [...reminders.values()].sort((a, b) => b.priority - a.priority);
    const consumed = sorted[0];

    this.operations.push({ type: 'consume', hookName, reminder: consumed });

    // Delete if not persistent
    if (!consumed.persistent) {
      reminders.delete(consumed.name);
    }

    return consumed;
  }

  // Create suppression marker for a hook (affects ALL reminders in that hook)
  suppress(hookName: HookName): void {
    this.suppressed.add(hookName);
    this.operations.push({ type: 'suppress', hookName });
  }

  isSuppressed(hookName: HookName): boolean {
    return this.suppressed.has(hookName);
  }

  // Test helper: inspect staged reminders
  getStaged(hookName: HookName): StagedReminder[] {
    return [...(this.staged.get(hookName)?.values() ?? [])];
  }

  clear(): void {
    this.staged.clear();
    this.suppressed.clear();
    this.operations = [];
  }
}

interface StagingOperation {
  type: 'stage' | 'consume' | 'suppress' | 'suppression-cleared';
  hookName: HookName;
  reminder?: StagedReminder;
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

### 4.2 Event Factories

Factory functions for creating `SidekickEvent` variants with sensible defaults.

```typescript
// event.factory.ts
import { EventContext, HookEvent, TranscriptEvent, TranscriptMetrics } from '@sidekick/core';

let eventCounter = 0;

export function createEventContext(overrides: Partial<EventContext> = {}): EventContext {
  return {
    sessionId: `test-session-${eventCounter++}`,
    timestamp: Date.now(),
    scope: 'project',
    ...overrides,
  };
}

export function createHookEvent<H extends HookEvent['hook']>(
  hook: H,
  payload: Partial<Extract<HookEvent, { hook: H }>['payload']> = {},
  context: Partial<EventContext> = {}
): Extract<HookEvent, { hook: H }> {
  const defaults: Record<HookEvent['hook'], unknown> = {
    SessionStart: { startType: 'startup', transcriptPath: '/mock/transcript.jsonl' },
    SessionEnd: { endReason: 'other' },
    UserPromptSubmit: { prompt: 'test prompt', transcriptPath: '/mock/transcript.jsonl', cwd: '/mock', permissionMode: 'default' },
    PreToolUse: { toolName: 'Bash', toolInput: { command: 'ls' } },
    PostToolUse: { toolName: 'Bash', toolInput: { command: 'ls' }, toolResult: { output: 'file.txt' } },
    Stop: { transcriptPath: '/mock/transcript.jsonl', permissionMode: 'default', stopHookActive: true },
    PreCompact: { transcriptPath: '/mock/transcript.jsonl', transcriptSnapshotPath: '/mock/pre-compact.jsonl' },
  };

  return {
    kind: 'hook',
    hook,
    context: createEventContext(context),
    payload: { ...defaults[hook], ...payload },
  } as Extract<HookEvent, { hook: H }>;
}

export function createTranscriptEvent(
  eventType: TranscriptEvent['eventType'],
  overrides: Partial<TranscriptEvent> = {}
): TranscriptEvent {
  return {
    kind: 'transcript',
    eventType,
    context: createEventContext(overrides.context),
    payload: {
      lineNumber: 1,
      entry: {},
      ...overrides.payload,
    },
    metadata: {
      transcriptPath: '/mock/transcript.jsonl',
      metrics: createMetrics(overrides.metadata?.metrics),
    },
  };
}
```

### 4.3 Reminder Factories

Factory functions for creating staged reminder files matching the schema from **LLD-FEATURE-REMINDERS.md §3.3**.

```typescript
// reminder.factory.ts
import { StagedReminder, HookName } from '@sidekick/core';

export function createReminder(overrides: Partial<StagedReminder> = {}): StagedReminder {
  return {
    name: 'TestReminder',
    blocking: false,
    priority: 50,
    persistent: false,
    // Text fields (all optional)
    userMessage: undefined,
    additionalContext: undefined,
    stopReason: undefined,
    ...overrides,
  };
}

// Presets for common reminder types (per LLD-FEATURE-REMINDERS.md §8.1)
export const reminderPresets = {
  userPromptSubmit: () => createReminder({
    name: 'UserPromptSubmitReminder',
    priority: 10,
    persistent: true,
    additionalContext: 'Test user prompt submit context',
  }),
  areYouStuck: () => createReminder({
    name: 'AreYouStuckReminder',
    blocking: true,
    priority: 80,
    additionalContext: 'STOP AND RECONSIDER: You may be stuck.',
    stopReason: 'Agent may be stuck - too many tools this turn',
  }),
  verifyCompletion: () => createReminder({
    name: 'VerifyCompletionReminder',
    blocking: true,
    priority: 50,
    stopReason: 'Verify completion before finishing',
  }),
  timeForUserUpdate: () => createReminder({
    name: 'TimeForUserUpdateReminder',
    blocking: true,
    priority: 70,
    additionalContext: 'Time to update the user on progress.',
    stopReason: 'Time for user update',
  }),
};
```

### 4.4 Metrics Factories

Factory functions for creating `TranscriptMetrics` snapshots.

```typescript
// metrics.factory.ts
import { TranscriptMetrics } from '@sidekick/core';

export function createMetrics(overrides: Partial<TranscriptMetrics> = {}): TranscriptMetrics {
  return {
    turnCount: 1,
    toolCount: 0,
    toolsThisTurn: 0,
    totalTokens: 100,
    ...overrides,
  };
}

// Presets for common test scenarios
export const metricsPresets = {
  sessionStart: () => createMetrics({ turnCount: 0, toolCount: 0, toolsThisTurn: 0, totalTokens: 0 }),
  midSession: () => createMetrics({ turnCount: 3, toolCount: 15, toolsThisTurn: 5, totalTokens: 5000 }),
  stuckThreshold: () => createMetrics({ turnCount: 2, toolCount: 25, toolsThisTurn: 25, totalTokens: 8000 }),
  nearCompact: () => createMetrics({ turnCount: 10, toolCount: 100, toolsThisTurn: 3, totalTokens: 180000 }),
};
```

### 4.5 Snapshot Testing

We use Vitest's snapshot capability for output verification, but we need stable inputs.
- **Deterministic IDs**: Mocks should use seeded randoms or static IDs.
- **Date Freezing**: The `TestEnvironment` setup will automatically freeze time.

## 5. Integration Test Harness

### 5.1 CLITestHarness

Runs the CLI in-process or as a subprocess, capturing stdin/stdout/stderr for assertion.

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

### 5.2 SupervisorTestHarness

Runs the Supervisor for testing async handler execution and IPC communication.

```typescript
export class SupervisorTestHarness {
  private supervisor: ChildProcess | null = null;
  public receivedEvents: SidekickEvent[] = [];
  public stagedReminders: Map<HookName, StagedReminder[]> = new Map();

  constructor(
    private readonly sessionDir: string,
    private readonly options: SupervisorTestOptions = {}
  ) {}

  async start(): Promise<void> {
    // Starts supervisor process with test configuration
    // Sets up IPC channel for event capture
  }

  async stop(): Promise<void> {
    // Gracefully stops supervisor
    // Waits for pending handlers to complete
  }

  // Send event to supervisor (simulates CLI → Supervisor IPC)
  async sendEvent(event: SidekickEvent): Promise<void> {
    this.receivedEvents.push(event);
    // Sends via IPC channel
  }

  // Wait for specific condition (useful for async handler completion)
  async waitFor(
    predicate: (harness: SupervisorTestHarness) => boolean,
    timeoutMs: number = 5000
  ): Promise<void> {
    const start = Date.now();
    while (!predicate(this) && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 50));
    }
    if (!predicate(this)) {
      throw new Error('waitFor timeout');
    }
  }

  // Assert reminder was staged
  expectReminderStaged(hookName: HookName, reminderName: string): void {
    const reminders = this.stagedReminders.get(hookName) ?? [];
    if (!reminders.some(r => r.name === reminderName)) {
      throw new Error(`Expected ${reminderName} to be staged for ${hookName}`);
    }
  }
}

interface SupervisorTestOptions {
  mockLLM?: MockLLMService;
  mockTranscript?: MockTranscriptService;
  config?: Partial<SidekickConfig>;
}
```

### 5.3 StagingHelper

Utilities for seeding and inspecting the staging directory during integration tests. Per **LLD-FEATURE-REMINDERS.md §3.3**, suppression uses marker files.

```typescript
export class StagingHelper {
  constructor(private readonly sessionDir: string) {}

  get stagePath(): string {
    return path.join(this.sessionDir, 'stage');
  }

  // Seed a reminder file for testing CLI consumption
  async seedReminder(hookName: HookName, reminder: StagedReminder): Promise<string> {
    const dir = path.join(this.stagePath, hookName);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${reminder.name}.json`);
    await fs.writeFile(filePath, JSON.stringify(reminder, null, 2));
    return filePath;
  }

  // Read all staged reminders for a hook
  async getReminders(hookName: HookName): Promise<StagedReminder[]> {
    const dir = path.join(this.stagePath, hookName);
    try {
      const files = await fs.readdir(dir);
      const reminders: StagedReminder[] = [];
      for (const file of files.filter(f => f.endsWith('.json'))) {
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        reminders.push(JSON.parse(content));
      }
      return reminders;
    } catch {
      return [];
    }
  }

  // Create suppression marker for a hook (per LLD-FEATURE-REMINDERS.md §3.3)
  async createSuppressionMarker(hookName: HookName): Promise<void> {
    const dir = path.join(this.stagePath, hookName);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, '.suppressed'), '');
  }

  // Check if suppression marker exists
  async isSuppressed(hookName: HookName): Promise<boolean> {
    try {
      await fs.access(path.join(this.stagePath, hookName, '.suppressed'));
      return true;
    } catch {
      return false;
    }
  }

  // Assert suppression state
  async expectSuppressed(hookName: HookName, expected: boolean): Promise<void> {
    const actual = await this.isSuppressed(hookName);
    if (actual !== expected) {
      throw new Error(`Expected ${hookName} suppressed=${expected}, got ${actual}`);
    }
  }

  // Assert reminder exists
  async expectReminderExists(hookName: HookName, reminderName: string): Promise<void> {
    const reminders = await this.getReminders(hookName);
    if (!reminders.some(r => r.name === reminderName)) {
      throw new Error(`Reminder ${reminderName} not found in ${hookName}/`);
    }
  }

  // Clean up staging directory
  async clear(): Promise<void> {
    await fs.rm(this.stagePath, { recursive: true, force: true });
  }
}
```

### 5.4 TestEnvironment

Unified setup for integration tests combining all harnesses.

```typescript
export class TestEnvironment {
  public readonly sessionDir: string;
  public readonly cli: CLITestHarness;
  public readonly supervisor: SupervisorTestHarness;
  public readonly staging: StagingHelper;
  public readonly mockLLM: MockLLMService;
  public readonly mockTranscript: MockTranscriptService;

  static async create(options: TestEnvironmentOptions = {}): Promise<TestEnvironment> {
    const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-test-'));
    return new TestEnvironment(sessionDir, options);
  }

  private constructor(sessionDir: string, options: TestEnvironmentOptions) {
    this.sessionDir = sessionDir;
    this.mockLLM = options.mockLLM ?? new MockLLMService();
    this.mockTranscript = options.mockTranscript ?? new MockTranscriptService();
    this.staging = new StagingHelper(sessionDir);
    this.cli = new CLITestHarness(sessionDir);
    this.supervisor = new SupervisorTestHarness(sessionDir, {
      mockLLM: this.mockLLM,
      mockTranscript: this.mockTranscript,
    });
  }

  async setup(): Promise<void> {
    await fs.mkdir(this.sessionDir, { recursive: true });
    await this.supervisor.start();
    // Freeze time for deterministic tests
    vi.useFakeTimers();
  }

  async teardown(): Promise<void> {
    vi.useRealTimers();
    await this.supervisor.stop();
    await fs.rm(this.sessionDir, { recursive: true, force: true });
  }
}
```

## 6. Open Questions & Proposals

### 6.1 Fixture Location
**Question**: Should we copy `test-data` into this package?
**Decision**: **No**. Keep `test-data` at the repo root as the canonical source for both Python and Node tools. `testing-fixtures` will access it via relative paths or a symlink created during `pnpm install`.

### 6.2 Factory Pattern
**Proposal**: Use a library like `fishery` or simple factory functions?
**Decision**: **Simple Factory Functions**. We want to avoid extra dependencies. Simple functions that take `Partial<T>` and merge with defaults are sufficient. Presets (§4.3, §4.4) provide domain-specific shortcuts without library overhead.

### 6.3 Mocking Library
**Proposal**: Use `vitest` spies vs manual mock classes.
**Decision**: **Hybrid**. Use manual mock classes (like `MockLLMService`, `MockHandlerRegistry`) for complex stateful mocks where a simple spy is too verbose to set up repeatedly. Use `vi.spyOn` for simple method verification.

### 6.4 Handler Testing Strategy
**Proposal**: Test handlers in isolation vs full dispatch chain?
**Decision**: **Both**. Unit tests use `MockHandlerRegistry` to verify handler registration and filter matching. Integration tests use `SupervisorTestHarness` to verify end-to-end event flow (hook → handler → staged reminder → CLI consumption).

### 6.5 Staging Service Abstraction
**Proposal**: Should `MockStagingService` use filesystem or pure in-memory?
**Decision**: **Both available**. `MockStagingService` (§3.5) is pure in-memory for fast unit tests. `StagingHelper` (§5.3) uses real filesystem for integration tests that need to verify CLI reads actual files.
