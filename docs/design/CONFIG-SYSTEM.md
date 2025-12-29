# Configuration System Low-Level Design

## 1. Overview

The Configuration System loads, validates, and merges configuration from multiple sources (files, environment variables, defaults) to provide type-safe configuration objects to the Sidekick runtime. It uses domain-based configuration files for logical separation of concerns.

## 2. Core Principles

- **Strict Validation**: All configuration validated against Zod schemas at runtime. Invalid config prevents startup with clear error messages.
- **YAML Standard**: Domain-specific configuration files use YAML for human-readable, comment-friendly configuration.
- **Unified Override**: A bash-style `sidekick.config` provides quick overrides using dot-notation (lower priority than domain files).
- **Deterministic Cascade**: Configuration resolved in a specific order; higher-specificity layers override lower ones.
- **Domain Separation**: Configuration split by functional domain (LLM, features, logging, etc.).
- **Immutability**: Once loaded, configuration objects are frozen. (Hot-reloaded configs do atomic replacement; consumers of config objects must cache neither values nor references.)

## 3. Configuration Domains

Configuration is organized into logical domains, each with its own file and schema:

| Domain       | Filename          | Purpose                                   |
| ------------ | ----------------- | ----------------------------------------- |
| `core`       | `config.yaml`     | Paths, logging, general settings          |
| `llm`        | `llm.yaml`        | LLM provider settings, model selection    |
| `transcript` | `transcript.yaml` | Transcript processing, metrics            |
| `features`   | `features.yaml`   | Feature flags and feature-specific config |

**Note**: Feature-specific configuration schemas (e.g., reminders thresholds, templates) are defined in their respective feature LLDs (see `docs/design/FEATURE-REMINDERS.md` Section 8).

### 3.1 Domain File Resolution

Each domain file is resolved independently through the cascade (Section 4). The final configuration is the union of all domain configs after merge.

## 4. Configuration Cascade

Configuration is resolved in this order (lowest to highest priority):

1. **Internal Defaults**: Hardcoded defaults in `sidekick-core`.
2. **Environment Variables**: `SIDEKICK_*` values plus `.env` files: `~/.sidekick/.env` → `.sidekick/.env` → `.sidekick/.env.local`.
3. **User Unified Config**: `~/.sidekick/sidekick.config` (bash-style, dot-notation).
4. **User Domain Config**: `~/.sidekick/{domain}.yaml`.
5. **Project Unified Config**: `.sidekick/sidekick.config` (bash-style, dot-notation).
6. **Project Domain Config**: `.sidekick/{domain}.yaml` (committed to repo).
7. **Project-Local Overrides**: `.sidekick/{domain}.yaml.local` (untracked, highest priority).

### 4.1 Merge Strategy

- **Objects**: Deep merged.
- **Arrays**: Replaced (higher priority replaces lower priority).
- **Primitives**: Replaced.

### 4.2 Unified Config Format (`sidekick.config`)

The `sidekick.config` file provides a convenience layer for quick overrides without editing multiple YAML files:

```bash
# ~/.sidekick/sidekick.config
# Bash-style key=value with hash comments
# Dot-notation maps to nested objects

llm.provider=openai
llm.model=gpt-4o
llm.temperature=0.1

logging.level=debug

features.reminders.enabled=true
features.reminders.settings.turn_cadence=6
```

**Parsing Rules**:
- Lines starting with `#` are comments
- Format: `domain.path.to.key=value`
- Values are coerced to appropriate types (number, boolean, string)
- Arrays use JSON syntax: `some.array=["a","b","c"]`
- Domain-specific YAML files always take precedence over unified config at the same scope level

## 5. Data Structures

### 5.1 Core Config Schema

```typescript
import { z } from "zod";

export const CoreConfigSchema = z.object({
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    format: z.enum(["pretty", "json"]).default("pretty"),
    consoleEnabled: z.boolean().default(false),  // Enable console output (in addition to file)
  }),
  paths: z.object({
    state: z.string().default(".sidekick"),  // Base path for session state
    assets: z.string().optional(),            // Custom assets path override
  }),
  supervisor: z.object({
    idleTimeoutMs: z.number().default(300000),      // Auto-shutdown after 5 min idle
    shutdownTimeoutMs: z.number().default(30000),   // Grace period for in-flight tasks
  }).optional(),
});

export type CoreConfig = z.infer<typeof CoreConfigSchema>;
```

**Note**: Supervisor settings are optional; defaults apply when supervisor is spawned. See `docs/design/CLI.md §7` and `docs/design/SUPERVISOR.md §2` for lifecycle details.

### 5.2 LLM Config Schema

```typescript
export const LlmConfigSchema = z.object({
  // Primary provider settings
  provider: z
    .enum(["claude-cli", "openai", "openrouter", "custom"])
    .default("claude-cli"),
  model: z.string().optional(),
  temperature: z.number().min(0).max(1).default(0),
  maxTokens: z.number().optional(),

  // Fallback provider (used when primary fails after retries)
  fallbackProvider: z.enum(["claude-cli", "openai", "openrouter", "custom"]).optional(),
  fallbackModel: z.string().optional(),

  // Resilience settings
  timeout: z.number().min(1).max(300).default(30),        // Request timeout in seconds
  timeoutMaxRetries: z.number().min(0).max(10).default(3), // Retries before fallback

  // Debugging
  debugDumpEnabled: z.boolean().default(false),  // Dump LLM request/response to logs

  // API keys should come from .env files, not config
});

export type LlmConfig = z.infer<typeof LlmConfigSchema>;
```

**Note**: Fallback and resilience settings support Phase 4 LLM provider implementation. See `docs/design/LLM-PROVIDERS.md §5` for retry/fallback policy details.

### 5.3 Transcript Config Schema

```typescript
export const TranscriptConfigSchema = z.object({
  // File watching settings
  watchDebounceMs: z.number().min(0).default(100),  // Debounce for file change events

  // Metrics persistence
  metricsPersistIntervalMs: z.number().default(5000),  // How often to persist metrics
});

export type TranscriptConfig = z.infer<typeof TranscriptConfigSchema>;
```

**Note**: Token metrics are extracted from native transcript metadata (the `usage` object in Claude Code responses). This is always enabled and not configurable. See **docs/design/TRANSCRIPT-PROCESSING.md §3.4** for extraction details.

See **docs/design/TRANSCRIPT-PROCESSING.md** for TranscriptService specification.

### 5.4 Features Config Schema

```typescript
export const FeatureConfigSchema = z.object({
  enabled: z.boolean().default(true),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export const FeaturesConfigSchema = z.record(z.string(), FeatureConfigSchema);

export type FeatureConfig = z.infer<typeof FeatureConfigSchema>;
export type FeaturesConfig = z.infer<typeof FeaturesConfigSchema>;
```

**Note**: Each feature uses the standardized `{ enabled, settings }` structure:
- `enabled`: Boolean flag to enable/disable the feature
- `settings`: Feature-specific configuration (opaque to the config system)

Features define their own `settings` schema in their feature LLD. The config system treats `settings` as opaque `Record<string, unknown>` and passes it to the feature for validation. Use `configService.getFeature<T>(name)` for type-safe access to feature settings.

### 5.5 Unified Config Type

```typescript
export interface SidekickConfig {
  core: CoreConfig;
  llm: LlmConfig;
  transcript: TranscriptConfig;
  features: FeaturesConfig;
}
```

## 6. Derived Paths

Certain paths are derived from configuration, not directly configurable:

| Path                                                     | Derivation                 | Purpose               |
| -------------------------------------------------------- | -------------------------- | --------------------- |
| `{paths.state}/sessions/{session_id}/`                   | Derived from `paths.state` | Session state root    |
| `{paths.state}/sessions/{session_id}/stage/`             | Hardcoded subfolder        | Reminder staging area |
| `{paths.state}/sessions/{session_id}/stage/{hook_name}/` | Per docs/design/flow.md Section 2.2| Hook-specific staging |

**Example**: If `paths.state = ".sidekick"` and session ID is `abc123`:
- Session root: `.sidekick/sessions/abc123/`
- Staging root: `.sidekick/sessions/abc123/stage/`
- UserPromptSubmit staging: `.sidekick/sessions/abc123/stage/UserPromptSubmit/`

## 7. Asset Resolution

Assets (prompts, schemas, templates) follow a separate cascade for file discovery:

1. **Bundled Defaults**: `assets/sidekick/` from the installed package.
2. **User Persistent**: `~/.sidekick/assets/` (survives reinstall).
3. **Project Persistent**: `.sidekick/assets/` (committed with project).
4. **Project-Local Overrides**: `.sidekick/assets.local/` (untracked).

The `AssetResolver` finds the first matching file traversing from highest to lowest priority. Features reference assets by relative path (e.g., `prompts/are-you-stuck.md`).

## 8. Component Architecture

### 8.1 `ConfigService`

Main entry point for loading and accessing configuration.

```typescript
class ConfigService {
  private config: SidekickConfig;

  constructor(private options: ConfigOptions) {}

  public async load(): Promise<void> {
    // For each domain:
    // 1. Load internal defaults
    // 2. Apply environment variables
    // 3. Parse and apply user unified config (sidekick.config)
    // 4. Load and merge user domain config ({domain}.yaml)
    // 5. Parse and apply project unified config (sidekick.config)
    // 6. Load and merge project domain config ({domain}.yaml)
    // 7. Load and merge project-local config ({domain}.yaml.local)
    // 8. Validate against schema
    // 9. Freeze
  }

  public get core(): CoreConfig { return this.config.core; }
  public get llm(): LlmConfig { return this.config.llm; }
  public get transcript(): TranscriptConfig { return this.config.transcript; }
  public get features(): FeaturesConfig { return this.config.features; }

  public getFeature<T>(name: string): FeatureConfig & { settings: T } {
    return this.config.features[name] as FeatureConfig & { settings: T };
  }

  /** Derived path helpers - see Section 6 */
  public get paths(): DerivedPaths { return this.derivedPaths; }

  /** Config sources loaded (for debugging) */
  public get sources(): string[] { return this.loadedSources; }
}
```

**Feature Access Pattern**: Use `getFeature<T>()` for type-safe access to feature configuration:

```typescript
// Define feature settings type
interface RemindersSettings {
  turn_cadence: number;
  tool_cadence: number;
  pause_and_reflect_threshold: number;
}

// Access feature config with type safety
const reminders = configService.getFeature<RemindersSettings>('reminders');
if (reminders.enabled) {
  const threshold = reminders.settings.pause_and_reflect_threshold;
  // ...
}
```

### 8.2 `AssetResolver`

Resolves asset paths through the cascade.

```typescript
class AssetResolver {
  constructor(private config: CoreConfig) {}

  public async resolve(assetPath: string): Promise<string> {
    // Check locations in reverse priority order (highest first)
    // Return absolute path of first match
    // Throw if not found in any location
  }
}
```

## 9. Example Configuration Files

### 9.1 `~/.sidekick/sidekick.config` (User Unified)

```bash
# Quick user-level overrides
llm.provider=openai
llm.model=gpt-4o
logging.level=debug
```

### 9.2 `.sidekick/config.yaml` (Project Core)

```yaml
# Core Sidekick configuration
logging:
  level: info
  format: pretty

paths:
  state: .sidekick

# Supervisor settings (optional - defaults shown)
supervisor:
  idleTimeoutMs: 300000     # 5 minutes
  shutdownTimeoutMs: 30000  # 30 seconds
```

### 9.3 `.sidekick/llm.yaml` (Project LLM)

```yaml
# LLM provider configuration
# API keys should be in .env files, not here
provider: openai
model: gpt-4o
temperature: 0.1
```

### 9.4 `.sidekick/features.yaml` (Project Features)

```yaml
# Feature flags and settings
reminders:
  enabled: true
  settings:
    turn_cadence: 4
    tool_cadence: 50
    stuck_threshold: 20

session_summary:
  enabled: true
  settings:
    snarky_mode: true
```

## 10. Configuration Logging

The configuration system provides diagnostic logging to help troubleshoot configuration issues.

### 10.1 Load-Time Logging

When configuration is loaded via `createConfigService()`, the following is logged:

| Level | Condition | Message |
|-------|-----------|---------|
| `warn` | Malformed line in `sidekick.config` | `Config parse warning` with line number and issue (missing `=`, invalid key format) |
| `info` | User config overrides found | `User config overrides loaded` with source path and key-value pairs |
| `info` | Project config overrides found | `Project config overrides loaded` with source path and key-value pairs |

**Example warnings:**
```
warn: Config parse warning { warning: "sidekick.config:18: malformed line (missing '='): features.reminders.threshold: 4" }
warn: Config parse warning { warning: "sidekick.config:5: invalid key format (need domain.key): single" }
```

**Example info:**
```
info: Project config overrides loaded { source: ".sidekick/sidekick.config", overrides: [{ key: "features.reminders.enabled", value: true }] }
```

### 10.2 Hot-Reload Logging

When configuration files change and the supervisor reloads config, the following is logged:

| Level | Condition | Message |
|-------|-----------|---------|
| `info` | File change detected | `Configuration change detected` with filename and event type |
| `info` | Values changed | `Configuration values changed` with array of `{ path, old, new }` diffs |
| `info` | Reload complete | `Configuration reloaded successfully` |
| `error` | Reload failed | `Failed to reload configuration` with error message |

**Example:**
```
info: Configuration change detected { file: "sidekick.config", eventType: "change" }
info: Configuration values changed { changes: [{ path: "features.reminders.settings.pause_and_reflect_threshold", old: 15, new: 4 }] }
info: Configuration reloaded successfully
```

### 10.3 Enabling Config Logging

To see config logging, pass a logger to `createConfigService()`:

```typescript
const configService = createConfigService({
  projectRoot: process.cwd(),
  logger: myLogger,  // Optional - enables load-time logging
});
```

Hot-reload logging uses the supervisor's logger automatically.

## 11. Internal Implementation Details

The following are internal implementation concerns, not exposed via configuration:

- **Handler execution priorities**: Hardcoded in handler registration (see docs/design/flow.md Section 2.3).
- **Staging directory structure**: Fixed at `{paths.state}/sessions/{session_id}/stage/{hook_name}/`.
- **Event schema**: Defined in code, not configurable (see docs/design/flow.md Section 3.2).

## 12. Decisions

- **Domain-based files**: Configuration split by functional domain for clarity and independent override.
- **Unified config convenience**: `sidekick.config` provides quick bash-style overrides without editing multiple files.
- **Feature-specific schemas in feature LLDs**: Feature settings schemas live in their respective feature docs, not here.
- **Derived vs. configurable paths**: Session/staging paths derived from `paths.state`; internal structure is not configurable.
- **Supervisor in core domain**: Supervisor settings (`idleTimeoutMs`, `shutdownTimeoutMs`) live in CoreConfig as they are operational/runtime concerns alongside logging and paths.
- **Hot reloading**: ConfigService watches domain files and `sidekick.config` for changes. On file change, the entire config is reloaded and atomically replaced. Consumers must not cache config values or references—always access via `configService.{domain}` accessors. File watching uses chokidar with debouncing to avoid thrashing on rapid edits.
