# Configuration System Low-Level Design

## 1. Overview

The Configuration System is the backbone of the Sidekick Node.js runtime. It is responsible for loading, validating, and merging configuration from multiple sources (files, environment variables, defaults) to provide a unified, type-safe configuration object to the rest of the application. It also handles the resolution of static assets (prompts, schemas) across the supported scopes.

## 2. Core Principles

- **Strict Validation**: All configuration is validated against Zod schemas at runtime. Invalid config prevents startup with clear error messages.
- **JSONC Standard**: Configuration files use JSON with Comments (JSONC) to allow for documentation within user configs.
- **Deterministic Cascade**: Configuration is resolved in a specific order, with higher-specificity layers overriding lower ones.
- **Immutability**: Once loaded, the configuration object is immutable.

## 3. Configuration Cascade

The configuration is resolved in a deterministic cascade (lowest to highest priority). Each successive layer completely overrides scalars/arrays defined earlier while objects are deep-merged:

1.  **Internal Defaults**: Hardcoded defaults compiled into `sidekick-core`.
2.  **Environment Variables**: `SIDEKICK_*` values plus `.env` files loaded in order: `~/.sidekick/.env` → project `.env` → `.sidekick/.env.local`. Later sources override earlier ones before configs apply.
3.  **User Global Config**: JSONC files in `~/.sidekick/` (for example `~/.sidekick/config.jsonc`).
4.  **Project Config**: `.sidekick/config.jsonc` (checked into the project repo).
5.  **Project-Local Overrides**: `.sidekick/config.jsonc.local` (or `<name>.jsonc.local` per domain) for untracked, highest-priority overrides.

### 3.1 Merge Strategy

- **Objects**: Deep merged.
- **Arrays**: Replaced (higher priority replaces lower priority).
- **Primitives**: Replaced.

## 4. Data Structures

### 4.1 Configuration Schema (Zod)

```typescript
import { z } from "zod";

export const ConfigSchema = z.object({
  llm: z.object({
    provider: z
      .enum(["anthropic", "openai", "openrouter", "custom"])
      .default("anthropic"),
    model: z.string().optional(),
    temperature: z.number().min(0).max(1).default(0),
    maxTokens: z.number().optional(),
    apiKey: z.string().optional(), // Usually loaded from env, but can be in config
  }),
  features: z.record(
    z.string(),
    z.object({
      enabled: z.boolean().default(true),
      settings: z.record(z.string(), z.unknown()).default({}),
    })
  ),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    format: z.enum(["pretty", "json"]).default("pretty"),
  }),
  paths: z.object({
    assets: z.string().optional(), // Custom assets path
    state: z.string().optional(), // Custom state path
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
```

### 4.2 Asset Resolution

Assets (prompts, schemas, templates) respect the same least-to-most priority cascade, mapped onto filesystem locations:

1.  **Bundled Defaults**: `assets/sidekick/` from the repo/package (baseline).
2.  **User Installed**: Assets delivered with a global/user install (e.g., `~/.claude/hooks/sidekick/assets/`).
3.  **User Persistent**: `~/.sidekick/assets/` for hand-edited overrides that survive reinstall.
4.  **Project Installed**: Project-scoped install artifacts (e.g., `.claude/hooks/sidekick/assets/` or `node_modules/@sidekick/assets/`).
5.  **Project Persistent**: `.sidekick/assets/` committed with the project.
6.  **Project-Local Overrides**: `.sidekick/assets.local/` (untracked) for highest-priority tweaks during development.

## 5. Component Architecture

### 5.1 `ConfigService`

The main entry point for accessing configuration.

```typescript
class ConfigService {
  private config: Config;

  constructor(private options: ConfigOptions) {}

  public async load(): Promise<void> {
    // 1. Load defaults
    // 2. Apply Env Vars
    // 3. Load User Config (if exists)
    // 4. Load Project Config (if exists)
    // 5. Validate and Freeze
  }

  public get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key];
  }
}
```

### 5.2 `AssetResolver`

Handles finding files on disk based on the cascade.

```typescript
class AssetResolver {
  constructor(private config: Config) {}

  public async resolve(assetPath: string): Promise<string> {
    // Check locations in priority order
    // Return absolute path of first match
    // Throw if not found
  }
}
```

## 6. Migration Strategy

A standalone utility `sidekick-migrate` will be provided to convert legacy `.conf` files (bash sourced) to `config.jsonc`.

### 6.1 Logic

1.  Parse legacy `.conf` file (simple key=value pairs).
2.  Map known keys to new JSON structure (e.g., `SIDEKICK_LLM_PROVIDER` -> `llm.provider`).
3.  Generate `config.jsonc` with comments explaining the migration.
4.  Backup original `.conf` file.

## 7. Implementation Plan

1.  **Define Schemas**: Create `packages/sidekick-core/src/config/schema.ts`.
2.  **Add Tests**: Unit tests for merge logic, validation failures, and asset resolution priority.
3.  **Implement Loader**: Create `packages/sidekick-core/src/config/loader.ts` using `cosmiconfig` or similar, or custom JSONC parser.
4.  **Implement Asset Resolver**: Create `packages/sidekick-core/src/assets/resolver.ts`.

## 8. Decisions

- **Feature Settings Merge**: Partial feature settings merge without blowing away nested options. Arrays currently "replace" but some features may need additive behavior - case-by-case basis identified by the developer.
- **Hot Reloading**: Config service watches files for changes.
