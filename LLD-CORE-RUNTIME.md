# Core Runtime Library (`sidekick-core`)

## 1. Overview

The `sidekick-core` package is the foundation of the Sidekick Node.js runtime. It provides the essential infrastructure for the CLI, Supervisor, and Feature plugins. It enforces architectural principles like configuration cascading, structured logging, and strict type safety while maintaining a minimal footprint.

## 2. Architecture

The runtime follows a **Layered Architecture**:

1.  **Infrastructure Layer**: Low-level utilities (FileSystem, Process, Env).
2.  **Service Layer**: Core capabilities (Config, Logging, Assets, LLM).
3.  **Feature Layer**: Pluggable modules that implement business logic.
4.  **Application Layer**: The entry points (CLI, Supervisor) that orchestrate the runtime.

### 2.1 Dependency Injection Strategy

To maintain simplicity and testability without the overhead of a complex DI container (like Inversify), we use a **Typed Context Pattern**.

-   **`RuntimeContext`**: A central object containing initialized instances of core services.
-   **Propagation**: This context is passed to all Features during registration and to all Command handlers.
-   **Testing**: Easy to mock the entire context or individual services for unit tests.

## 3. Core Components

### 3.1 Bootstrap & Lifecycle (`Runtime`)

The `Runtime` class orchestrates the startup sequence.

**Phases:**
1.  **Environment Analysis**:
    -   Parse CLI arguments (`--hook-script-path`, `--project-dir`).
    -   Determine `Scope` (User vs. Project).
    -   Initialize `Paths` (config dirs, asset dirs).
2.  **Configuration Load**:
    -   Instantiate `ConfigService`.
    -   Load and validate configuration hierarchy.
3.  **Telemetry Initialization**:
    -   Configure `Logger` (Pino) based on config (level, transport).
    -   Set up global error handlers (uncaughtException, unhandledRejection).
4.  **Service Instantiation**:
    -   Create `AssetResolver`, `LLMService`, `SupervisorClient`.
    -   Construct the `RuntimeContext`.
5.  **Feature Loading**:
    -   Load feature modules.
    -   Validate Dependency Graph (DAG).
    -   Execute `registerHooks()` for each feature in topological order.

### 3.2 Configuration Service (`ConfigService`)

Responsible for loading, merging, and validating configuration.

-   **Sources** (in priority order):
    1.  Internal Defaults
    2.  Environment Variables (`SIDEKICK_*`)
    3.  User Config (`~/.sidekick/config.jsonc`)
    4.  Project Config (`.sidekick/config.jsonc`)
    5.  Local Overrides (`.sidekick/config.jsonc.local`)
-   **Validation**: Uses Zod schemas. Invalid config prevents startup (fail-fast).
-   **Access**: `config.get('key')` or typed accessors `config.llm.temperature`.

### 3.3 Asset Resolver (`AssetResolver`)

Abstracts file system paths to support the dual-scope architecture.

-   **Capabilities**:
    -   `resolvePrompt(name)`: Finds `.prompt.txt` files.
    -   `resolveSchema(name)`: Finds `.json` schemas.
    -   `resolveTemplate(name)`: Finds generic templates.
-   **Cascade Logic**: Checks paths in order:
    1.  Project Local (`.sidekick/assets.local/`)
    2.  Project Persistent (`.sidekick/assets/`)
    3.  Project Installed (`.claude/hooks/sidekick/assets/`)
    4.  User Persistent (`~/.sidekick/assets/`)
    5.  User Installed (`~/.claude/hooks/sidekick/assets/`)
    6.  Bundled Defaults (`assets/sidekick/`)

### 3.4 Feature Registry (`FeatureRegistry`)

Manages the lifecycle of features.

-   **Definition**: Features export a `manifest` and a `register` function.
-   **DAG Validation**: Ensures all dependencies declared in `manifest.needs` are present.
-   **Registration**: Calls `register(context)` to allow features to bind commands, hooks, and event listeners.

### 3.5 LLM Service (`LLMService`)

A unified interface for LLM interactions.

-   **Provider Agnostic**: Adapters for Claude, OpenAI, etc.
-   **Configuration**: Reads provider, model, and temperature from `ConfigService`.
-   **Observability**: Automatically logs prompts, completions, and token usage.
-   **Resilience**: Built-in retries and circuit breakers (via `shared-providers`).

## 4. Interfaces

```typescript
// The core context passed to everything
export interface RuntimeContext {
  config: ConfigService;
  logger: Logger;
  assets: AssetResolver;
  llm: LLMService;
  supervisor: SupervisorClient;
  paths: RuntimePaths;
}

// Feature definition
export interface FeatureManifest {
  id: string;
  version: string;
  description?: string;
  needs?: string[]; // Dependency IDs
}

export interface Feature {
  manifest: FeatureManifest;
  register: (context: RuntimeContext) => void | Promise<void>;
}

// Configuration Schema (Zod)
export const ConfigSchema = z.object({
  llm: z.object({
    provider: z.enum(['claude', 'openai', 'openrouter']),
    model: z.string(),
    temperature: z.number().min(0).max(1).default(0),
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    pretty: z.boolean().default(false),
  }),
  // ... feature specific configs
});
```

## 5. Error Handling Strategy

-   **Typed Errors**: Use custom error classes (`ConfigError`, `DependencyError`, `LLMError`) to categorize failures.
-   **Exit Codes**: Map error types to specific process exit codes.
    -   `1`: Generic/Unknown error.
    -   `2`: Configuration error (user fixable).
    -   `3`: Dependency/Environment error.
-   **User Feedback**:
    -   **Console**: Print friendly, actionable error messages to stderr.
    -   **Logs**: Write full stack traces and context to the structured log file.
-   **Graceful Shutdown**: Ensure `logger.flush()` is called before process exit.

## 6. Open Questions & Proposals

### 6.1 Dependency Injection
**Question**: Should we use a library or manual injection?
**Proposal**: Use **Manual Injection via Context**.
**Reasoning**:
-   Keeps the runtime zero-dependency (runtime-wise).
-   Explicit data flow is easier to debug than magic containers.
-   The number of core services is small (<10), making manual construction manageable.

### 6.2 Feature Graph Syntax
**Question**: How do features declare dependencies?
**Proposal**: Add a `manifest` property to the feature export.
**Reasoning**:
-   Static analysis: We can read the manifest without executing the register function.
-   Simple validation: The registry can build the graph before initializing any feature.

### 6.3 Lifecycle Hooks
**Question**: Do we need `onStop` or `onReload`?
**Proposal**:
-   **CLI**: No. CLI commands are ephemeral. `register` is sufficient.
-   **Supervisor**: Yes. Long-running services need `start()` and `stop()` methods to handle reloads/shutdowns cleanly.
**Decision**: The `Feature` interface for Supervisor will extend the base interface to include `start(ctx)` and `stop()`. CLI features only need `register(ctx)`.

### 6.4 Bootstrap Stages
**Proposal**:
1.  **Pre-flight**: Check Node version, permissions.
2.  **Config**: Load settings.
3.  **Logging**: Init logger.
4.  **Core**: Init services.
5.  **Features**: Load plugins.
6.  **Run**: Execute command.
