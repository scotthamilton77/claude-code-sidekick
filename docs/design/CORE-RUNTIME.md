# Core Runtime Library (`sidekick-core`)

## 1. Overview

The `sidekick-core` package is the foundation of the Sidekick Node.js runtime. It provides the essential infrastructure for the CLI, Daemon, and Feature plugins. It enforces architectural principles like configuration cascading, structured logging, and strict type safety while maintaining a minimal footprint.

### 1.1 Related Documents

- **docs/design/flow.md**: Event model, hook flows, handler registration (source of truth for runtime behavior)
- **docs/design/TRANSCRIPT-PROCESSING.md**: TranscriptService as metrics owner, event emission, compaction history
- **docs/design/CONFIG-SYSTEM.md**: Configuration schemas and cascade logic
- **docs/design/STRUCTURED-LOGGING.md**: Event schema (`SidekickEvent`), logging architecture
- **docs/design/SCHEMA-CONTRACTS.md**: Cross-language schema contracts (Zod → JSON Schema)

## 2. Architecture

The runtime follows a **Layered Architecture**:

1.  **Infrastructure Layer**: Low-level utilities (FileSystem, Process, Env).
2.  **Service Layer**: Core capabilities (Config, Logging, Assets, LLM).
3.  **Feature Layer**: Pluggable modules that register handlers for hooks.
4.  **Application Layer**: The entry points (CLI, Daemon) that orchestrate the runtime.

### 2.1 Dependency Injection Strategy

To maintain simplicity and testability without the overhead of a complex DI container (like Inversify), we use a **Typed Context Pattern**.

- **`RuntimeContext`**: A base object containing shared service instances.
- **Role-Specific Extensions**: CLI and Daemon extend the base context with role-specific services.
- **Propagation**: Context is passed to Features during registration and to handler callbacks.
- **Testing**: Easy to mock the entire context or individual services for unit tests.

### 2.2 CLI/Daemon Relationship

Per **docs/design/flow.md §2.1**, CLI and Daemon operate as separate processes with distinct responsibilities:

- **CLI**: Handles synchronous hook responses to Claude Code. Reads staged files, logs events locally.
- **Daemon**: Performs async background work (LLM calls, transcript analysis). Stages files for CLI consumption.
- **Communication**: CLI sends events to Daemon via IPC. Daemon "responds" by staging files that CLI reads on subsequent hook invocations.
- **Log Separation**: Each maintains its own log file; Monitoring UI aggregates both.

## 3. Core Components

### 3.1 Bootstrap & Lifecycle (`Runtime`)

The `Runtime` class orchestrates the startup sequence.

**Phases:**

1.  **Environment Analysis**:
    - Parse CLI arguments (`--hook-script-path`, `--project-dir`).
    - Determine `Scope` (User vs. Project).
    - Initialize `Paths` (config dirs, asset dirs).
2.  **Configuration Load**:
    - Instantiate `ConfigService`.
    - Load and validate configuration hierarchy.
3.  **Telemetry Initialization**:
    - Configure `Logger` (Pino) based on config (level, transport).
    - Set up global error handlers (uncaughtException, unhandledRejection).
4.  **Service Instantiation**:
    - Create `AssetResolver`, `HandlerRegistry`.
    - Role-specific: CLI creates `DaemonClient`; Daemon creates `LLMService`, `StagingService`.
    - Construct the role-specific context (`CLIContext` or `DaemonContext`).
5.  **Feature Loading**:
    - Load feature modules.
    - Validate Dependency Graph (DAG).
    - Execute `register(context)` for each feature in topological order.

### 3.2 Configuration Service (`ConfigService`)

Responsible for loading, merging, and validating configuration.

- **Sources** (in priority order):
  1.  Internal Defaults
  2.  Environment Variables (`SIDEKICK_*`)
  3.  User Config (`~/.sidekick/config.yaml`)
  4.  Project Config (`.sidekick/config.yaml`)
  5.  Local Overrides (`.sidekick/config.yaml.local`)
- **Validation**: Uses Zod schemas. Invalid config prevents startup (fail-fast).
- **Access**: `config.get('key')` or typed accessors `config.llm.temperature`.

### 3.3 Asset Resolver (`AssetResolver`)

Abstracts file system paths to support the dual-scope architecture.

- **Capabilities**:
  - `resolvePrompt(name)`: Finds `.prompt.txt` files.
  - `resolveSchema(name)`: Finds `.json` schemas.
  - `resolveTemplate(name)`: Finds generic templates.
- **Cascade Logic**: Checks paths in order:
  1.  Project Local (`.sidekick/assets.local/`)
  2.  Project Persistent (`.sidekick/assets/`)
  3.  Project Installed (`.claude/hooks/sidekick/assets/`)
  4.  User Persistent (`~/.sidekick/assets/`)
  5.  User Installed (`~/.claude/hooks/sidekick/assets/`)
  6.  Bundled Defaults (`assets/sidekick/`)

### 3.4 Feature Registry (`FeatureRegistry`)

Manages the lifecycle of features.

- **Definition**: Features export a `manifest` and a `register` function.
- **DAG Validation**: Ensures all dependencies declared in `manifest.needs` are present.
- **Registration**: Calls `register(context)` which allows features to register handlers via `HandlerRegistry`.

### 3.5 Handler Registry (`HandlerRegistry`)

Per **docs/design/flow.md §2.3**, the unified HandlerRegistry processes both CLI hook events and transcript file-change events through a single registration API with discriminated filters.

- **Unified Event Queue**: Handlers register for hook events, transcript events, or both via filter patterns.
- **Execution Priority**: Determines handler invocation order (higher priority runs first).
- **Error Isolation**: Handlers implement internal try/catch. Unhandled exceptions are logged; execution continues to next handler.
- **Concurrency Model**: Hook events processed sequentially (synchronous response required); transcript events are concurrent within each event (handlers run via `Promise.all`) but serialized across events (each line fully settles before the next starts).
- **Role Separation**: CLI handles hook dispatch; Daemon handles transcript events and async work.

**Handler Signature**:

```typescript
type SidekickEvent = HookEvent | TranscriptEvent // Discriminated union (see docs/design/flow.md §3.2)

type EventHandler = (event: SidekickEvent, context: RuntimeContext) => Promise<HandlerResult | void>

interface HandlerResult {
  response?: HookResponse // For hook events only
  stop?: boolean // If true, skip remaining handlers
}
```

**Registration Example**:

```typescript
// Hook event handler - register for specific hooks
context.handlers.register({
  id: 'reminders:stuck-detector',
  priority: 70,
  filter: { kind: 'hook', hooks: ['PostToolUse'] },
  handler: async (event, ctx) => {
    if (event.kind !== 'hook') return
    const metrics = ctx.transcript.getMetrics()
    if (metrics.toolsThisTurn >= ctx.config.features.reminders.settings.stuck_threshold) {
      await ctx.staging.stageReminder('PreToolUse', 'AreYouStuckReminder')
    }
  },
})

// Transcript event handler - register for specific transcript events
context.handlers.register({
  id: 'session-summary:turn-tracker',
  priority: 50,
  filter: { kind: 'transcript', eventTypes: ['UserPrompt'] },
  handler: async (event, ctx) => {
    if (event.kind !== 'transcript') return
    // React to new user prompt in transcript
    await checkSummaryCadence(ctx)
  },
})
```

### 3.6 LLM Service (`LLMService`)

A unified interface for LLM interactions.

- **Provider Agnostic**: Adapters for Claude, OpenAI, etc.
- **Configuration**: Reads provider, model, and temperature from `ConfigService`.
- **Observability**: Automatically logs prompts, completions, and token usage.
- **Resilience**: Built-in retries and circuit breakers (via `shared-providers`).

### 3.7 Transcript Service (`TranscriptService`)

Per **docs/design/TRANSCRIPT-PROCESSING.md**, TranscriptService is the canonical owner of transcript-derived metrics and the source of truth for session state.

- **Metrics Ownership**: Owns turn count, tool count, tokens, message count. Features consume metrics via `getMetrics()`.
- **File Watching**: Watches transcript file for changes, emits `TranscriptEvent` entries to HandlerRegistry.
- **Incremental Processing**: Maintains watermark (`lastProcessedLine`), processes only new entries.
- **Compaction Support**: Detects transcript shortening (compaction), triggers full recompute, manages compaction history.
- **Observable**: Features subscribe to metric changes or threshold alerts.

**API**:

```typescript
interface TranscriptService {
  getMetrics(): TranscriptMetrics // Sync getter
  onMetricsChange(callback: (metrics: TranscriptMetrics) => void): Unsubscribe
  onThreshold(metric: keyof TranscriptMetrics, value: number, callback: () => void): Unsubscribe
  capturePreCompactState(snapshotPath: string): Promise<void> // Called by PreCompact handler
}
```

**Integration with HandlerRegistry**: TranscriptService emits events to the unified queue. Features register handlers filtered to transcript event types rather than directly subscribing to TranscriptService.

## 4. Interfaces

### 4.1 Runtime Context

The runtime context is a **discriminated union** enabling type-safe role detection:

```typescript
// Base context shared by CLI and Daemon
interface BaseContext {
  config: ConfigService
  logger: Logger
  assets: AssetResolver
  paths: RuntimePaths
  handlers: HandlerRegistry
}

// CLI extends base with role discriminant and Daemon communication
export interface CLIContext extends BaseContext {
  role: 'cli' // Discriminant for type narrowing
  daemon: DaemonClient // IPC client to Daemon
}

// Daemon extends base with role discriminant, LLM, staging, and transcript capabilities
export interface DaemonContext extends BaseContext {
  role: 'daemon' // Discriminant for type narrowing
  llm: LLMService
  staging: StagingService // Writes reminder files for CLI consumption
  transcript: TranscriptService // Metrics owner, file watcher, event emitter
}

// Discriminated union - TypeScript narrows on context.role
export type RuntimeContext = CLIContext | DaemonContext

// Type guards for explicit checks
export function isCLIContext(ctx: RuntimeContext): ctx is CLIContext {
  return ctx.role === 'cli'
}

export function isDaemonContext(ctx: RuntimeContext): ctx is DaemonContext {
  return ctx.role === 'daemon'
}
```

**Usage in feature registration** (see §6.10 for pattern selection):

```typescript
export function register(context: RuntimeContext): void {
  if (context.role === 'daemon') {
    // TypeScript narrows to DaemonContext - ctx.llm, ctx.staging available
    context.handlers.register({
      /* Daemon-specific handlers */
    })
  }
  // Common or CLI-specific handlers
}
```

### 4.2 Feature Definition

```typescript
export interface FeatureManifest {
  id: string
  version: string
  description?: string
  needs?: string[] // Dependency IDs
}

export interface Feature {
  manifest: FeatureManifest
  register: (context: RuntimeContext) => void | Promise<void>
}

// Daemon features may need lifecycle hooks for long-running services
export interface DaemonFeature extends Feature {
  start?: (context: DaemonContext) => Promise<void>
  stop?: () => Promise<void>
}
```

### 4.3 Handler Registration

Per **docs/design/flow.md §2.3**, handlers register with a filter to specify which events they process.

```typescript
type HookName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'PreCompact'
  | 'SessionEnd'
type TranscriptEventType = 'UserPrompt' | 'AssistantMessage' | 'ToolCall' | 'ToolResult' | 'Compact'

type HandlerFilter =
  | { kind: 'hook'; hooks: HookName[] }
  | { kind: 'transcript'; eventTypes: TranscriptEventType[] }
  | { kind: 'all' }

interface HandlerRegistration {
  id: string // Unique identifier (e.g., 'reminders:stuck-detector')
  priority: number // Execution order (higher = earlier)
  filter: HandlerFilter // Which events to receive
  handler: EventHandler
}

type EventHandler<T extends RuntimeContext = RuntimeContext> = (
  event: SidekickEvent,
  context: T
) => Promise<HandlerResult | void>

interface HandlerRegistry {
  register(options: HandlerRegistration): void
  invokeHook(hook: HookName, event: HookEvent): Promise<HookResponse> // Sequential, returns response
  emitTranscriptEvent(eventType: TranscriptEventType, entry: TranscriptEntry, lineNumber: number): Promise<void> // Handlers run concurrently within event; callers serialize across events
}
```

### 4.4 Configuration

Configuration schemas are defined in **docs/design/CONFIG-SYSTEM.md**. Key types:

```typescript
// Re-exported from types
import type { SidekickConfig, CoreConfig, LlmConfig, RemindersConfig } from '@sidekick/types'
```

## 5. Error Handling Strategy

- **Typed Errors**: Use custom error classes (`ConfigError`, `DependencyError`, `LLMError`) to categorize failures.
- **Exit Codes**: Map error types to specific process exit codes.
  - `1`: Generic/Unknown error.
  - `2`: Configuration error (user fixable).
  - `3`: Dependency/Environment error.
- **User Feedback**:
  - **Console**: Print friendly, actionable error messages to stderr.
  - **Logs**: Write full stack traces and context to the structured log file.
- **Graceful Shutdown**: Ensure `logger.flush()` is called before process exit.

## 6. Decisions & Resolved Questions

### 6.1 Dependency Injection ✓

**Decision**: Use **Manual Injection via Context**.

- Keeps the runtime zero-dependency (runtime-wise).
- Explicit data flow is easier to debug than magic containers.
- The number of core services is small (<10), making manual construction manageable.

### 6.2 Feature Graph Syntax ✓

**Decision**: Features export a `manifest` property with dependency declarations.

- Static analysis: We can read the manifest without executing the register function.
- Simple validation: The registry can build the graph before initializing any feature.

### 6.3 Lifecycle Hooks ✓

**Decision**: Per §4.2, Daemon features extend the base interface with `start(ctx)` and `stop()`. CLI features only need `register(ctx)`.

### 6.4 Feature/Handler Relationship ✓

**Decision**: Features contain multiple handlers.

- Features call `context.handlers.register()` during their `register()` lifecycle.
- Handlers are hook-specific callbacks with explicit priority ordering.
- See **docs/design/flow.md §2.3** for handler registration semantics.

### 6.5 RuntimeContext Architecture ✓

**Decision**: Shared base context (`RuntimeContext`) with role-specific extensions (`CLIContext`, `DaemonContext`).

- CLI adds `DaemonClient` for IPC communication.
- Daemon adds `LLMService` and `StagingService` for async work.

### 6.6 Event Schema Location ✓

**Decision**: `SidekickEvent` is defined in **docs/design/flow.md §3.2** (source of truth) and implemented in **docs/design/STRUCTURED-LOGGING.md**.

### 6.7 Unified Event Model ✓

**Decision**: Use discriminated union (`HookEvent | TranscriptEvent`) with filter-based handler registration.

- **HookEvent**: Fired by Claude Code hooks, processed sequentially for synchronous response.
- **TranscriptEvent**: Fired by TranscriptService on file changes, processed concurrently.
- **Single Registry**: HandlerRegistry supports filters for hook events, transcript events, or both.
- **Rationale**: Eliminates duplicate event definitions, simplifies feature implementation, enables features to react to either source.

### 6.8 TranscriptService as Metrics Owner ✓

**Decision**: TranscriptService owns all transcript-derived metrics (turn count, tool count, tokens).

- **Single Source of Truth**: Metrics derived from transcript content, not from hook events.
- **Feature Decoupling**: Features consume metrics via `getMetrics()` rather than maintaining their own counters.
- **Compaction Handling**: TranscriptService manages compaction history for Monitoring UI timeline.
- **See**: **docs/design/TRANSCRIPT-PROCESSING.md** for full specification.

### 6.9 Bootstrap Stages

**Proposal**:

1.  **Pre-flight**: Check Node version, permissions.
2.  **Config**: Load settings.
3.  **Logging**: Init logger.
4.  **Core**: Init services.
5.  **Features**: Load plugins (register handlers).
6.  **Run**: Execute command.

### 6.10 Dual-Registration Patterns ✓

**Decision**: Two patterns for features needing role-specific handlers.

**Pattern 1: Role Discriminant** (same event type, different role logic)

Use when a feature needs different behavior for CLI vs Daemon when processing the _same_ event type (e.g., both receive `SessionStart`, but only Daemon should do LLM analysis).

```typescript
export function register(context: RuntimeContext): void {
  if (context.role === 'daemon') {
    // TypeScript narrows to DaemonContext
    context.handlers.register({
      id: 'session-summary:init',
      filter: { kind: 'hook', hooks: ['SessionStart'] },
      handler: createFirstSessionSummary, // Uses ctx.llm
    })
  }
  // CLI-specific or common handlers
}
```

- `CLIContext.role = 'cli'`
- `DaemonContext.role = 'daemon'`
- `RuntimeContext = CLIContext | DaemonContext`

**Pattern 2: Event Routing** (different event types naturally separate roles)

Use when feature concerns naturally align with event types. No explicit role check needed; the handler registry routes events to the appropriate process:

- `{ kind: 'transcript', ... }` → Daemon (TranscriptService owner)
- `{ kind: 'hook', ... }` → CLI (synchronous hook responder)

```typescript
export function register(context: RuntimeContext): void {
  // Staging: transcript events → Daemon
  context.handlers.register({
    id: 'reminders:stage-stuck',
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    handler: stageAreYouStuckReminder,
  })

  // Consumption: hook events → CLI
  context.handlers.register({
    id: 'reminders:inject-pre-tool',
    filter: { kind: 'hook', hooks: ['PreToolUse'] },
    handler: injectPreToolUseReminders,
  })
}
```

**Pattern Selection**:

| Scenario                          | Pattern                               |
| --------------------------------- | ------------------------------------- |
| Same event, different role logic  | Role Discriminant                     |
| Different events, different roles | Event Routing                         |
| CLI-only feature                  | Neither (just register hook handlers) |
| Daemon-only feature           | Role Discriminant (guard at top)      |

**Rationale**: Type-safe discrimination via `context.role` avoids fragile duck-typing (`'llm' in context`) while maintaining a single `register()` export. Event routing leverages the existing handler filter system for natural role separation.
