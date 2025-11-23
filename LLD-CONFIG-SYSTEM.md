# Configuration System Low-Level Design

## 1. Overview

The Configuration System is the backbone of the Sidekick Node.js runtime. It is responsible for loading, validating, and merging configuration from multiple sources (files, environment variables, defaults) to provide a unified, type-safe configuration object to the rest of the application. It also handles the resolution of static assets (prompts, schemas) across the supported scopes.

## 2. Core Principles

- **Strict Validation**: All configuration is validated against Zod schemas at runtime. Invalid config prevents startup with clear error messages.
- **JSONC Standard**: Configuration files use JSON with Comments (JSONC) to allow for documentation within user configs.
- **Deterministic Cascade**: Configuration is resolved in a specific order, with higher-specificity layers overriding lower ones.
- **Immutability**: Once loaded, the configuration object is immutable.

## 3. Configuration Cascade

The configuration is resolved in the following order (lowest to highest priority):

1.  **Internal Defaults**: Hardcoded defaults within `sidekick-core`.
2.  **Environment Variables**: `SIDEKICK_*` variables (Runtime overrides).
3.  **User Global Config**: `~/.sidekick/config.jsonc` (User preferences).
4.  **Project Config**: `.sidekick/config.jsonc` (Project-specific settings).

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

Assets (prompts, schemas) are resolved using a similar cascade but with specific directory lookups, (lowest to highest priority):

1.  **Bundled Defaults**: `assets/sidekick/` (from the package itself).
2.  **User Installed**: Global node_modules or bundled assets.
3.  **User Persistent**: `~/.sidekick/assets/`
4.  **Project Installed**: `node_modules/@sidekick/assets/` (if applicable)
5.  **Project Persistent**: `.sidekick/assets/`

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

## 8. Outstanding Questions / Concerns

- **Cascade Order Drift**: `TARGET-ARCHITECTURE.md §2.3` defines priority as User Installed → User Persistent → Project Installed → Project Persistent → Bundled Assets. Document currently lists bundled defaults first; pick one canonical order and codify tests for it.
- **Environment Source Clarification**: Need to specify where `.env` files are loaded (project root vs `.sidekick/`) and precedence relative to JSONC configs.
- **Feature Settings Merge**: Clarify how partial feature settings merge without blowing away nested options. Arrays currently "replace" but some features may need additive behavior.
- **Hot Reloading**: Decide if the config service watches files for changes or if restart is required; affects supervisor + CLI coordination.
