# LLM Profile Configuration System

## Overview

Replace hardcoded LLM values throughout the codebase with a named profile system where:
- **Profiles** are complete, standalone LLM configurations (provider, model, temperature, maxTokens, timeout, timeoutMaxRetries)
- **Features reference profiles by ID** - no inline overrides allowed
- **One profile is marked as default** via `defaultProfile: <name>`
- **Fallback profiles** live in a separate section and cannot have fallbacks themselves (prevents cycles)
- **Config loader validates all references** at startup (no dangling profile IDs)

---

## Why

### Current Problems

1. **Daemon ignores config**: `daemon.ts` hardcodes `google/gemini-2.0-flash-lite-001`, ignoring `llm.yaml`
2. **Features hardcode LLM params**: temperature/maxTokens embedded in handler code, not configurable
3. **FallbackProvider unused**: Exists in `shared-providers/src/fallback.ts` but never wired up
4. **Design docs specify models we don't use**: `FEATURE-SESSION-SUMMARY.md` specifies `qwen/qwen3-235b-a22b-2507` for creative tasks, but code uses different models

### Benefits

- **DRY**: Change provider for all "creative" tasks in one place
- **Separation of concerns**: Features declare *what* they need (profile ID), not *how* (provider details)
- **Maintainability**: No hunting through handler code for hardcoded values
- **Safety**: Validated config means no runtime surprises from typos
- **Flexibility**: Easy to swap providers/models without code changes
- **Runtime tunability**: Provider reads config at call time, no restart needed

---

## Success Criteria

1. `pnpm build && pnpm typecheck` passes
2. `pnpm test` passes (excluding sandbox-blocked IPC tests)
3. No hardcoded LLM values remain outside `*.defaults.yaml` files
4. Profile reference validation catches invalid profile IDs at config load time (startup failure)
5. Features use profiles from config instead of hardcoded values

---

## Design Decisions

### 1. Runtime Config Resolution
- Provider holds profile ID reference, not cached values
- At `complete()` time, provider looks up current profile from `ConfigService`
- Allows runtime tuning without restart

### 2. Provider Caching
**No caching** - create provider per-call based on current profile config.

Rationale:
- Provider creation is cheap (object instantiation + API key lookup)
- Enables true runtime tunability
- Avoids cache invalidation complexity

### 3. FallbackProvider Behavior
Current `FallbackProvider` (in `shared-providers/src/fallback.ts`) triggers on ANY error:
- Timeout, HTTP errors, rate limits, auth errors
- No selective filtering based on `retryable` flag
- Sequential fallback through array, returns on first success

This behavior is acceptable for now.

### 4. Handler Provider Access (Hybrid Approach)
- `ctx.llm` provides default profile provider (for simple cases)
- Handlers create their own provider via `ProfileProviderFactory` for sub-feature-specific profiles
- Example: session-summary has 3 sub-features (sessionSummary, snarkyComment, resumeMessage) each using different profiles

### 5. LLMRequest Simplification
- Remove `temperature` and `maxTokens` from `LLMRequest` interface
- Provider looks these up from its configured profile internally
- Callers only provide `messages`, `system`, `jsonSchema` - no per-call overrides

---

## YAML Structure

### `assets/sidekick/defaults/llm.defaults.yaml`

```yaml
defaultProfile: fast-lite

profiles:
  fast-lite:
    provider: openrouter
    model: google/gemini-2.0-flash-lite-001
    temperature: 0
    maxTokens: 1000
    timeout: 15
    timeoutMaxRetries: 2

  creative:
    provider: openrouter
    model: qwen/qwen3-235b-a22b-2507
    temperature: 1.2
    maxTokens: 100
    timeout: 10
    timeoutMaxRetries: 2

  creative-long:
    provider: openrouter
    model: qwen/qwen3-235b-a22b-2507
    temperature: 1.2
    maxTokens: 500
    timeout: 20
    timeoutMaxRetries: 2

fallbacks:
  cheap-fallback:
    provider: openrouter
    model: google/gemini-2.5-flash-lite
    temperature: 0
    maxTokens: 1000
    timeout: 30
    timeoutMaxRetries: 3

global:
  debugDumpEnabled: false
```

### Feature-to-Profile Binding

Features declare profile per sub-feature under `settings.llm`:

```yaml
# assets/sidekick/defaults/features/session-summary.defaults.yaml
enabled: true
settings:
  llm:
    sessionSummary:
      profile: fast-lite
      fallbackProfile: cheap-fallback
    snarkyComment:
      profile: creative
      fallbackProfile: cheap-fallback
    resumeMessage:
      profile: creative-long
      fallbackProfile: cheap-fallback
  excerptLines: 80
  filterToolMessages: true
```

---

## Implementation Steps

### Step 1: Update LLM Schema

**File**: `packages/sidekick-core/src/config.ts`

Replace flat LLM config with profile-based structure:

```typescript
const LlmProfileSchema = z.object({
  provider: LlmProviderSchema,
  model: z.string(),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().positive(),
  timeout: z.number().min(1).max(300),
  timeoutMaxRetries: z.number().min(0).max(10),
})

const LlmConfigSchema = z.object({
  defaultProfile: z.string(),
  profiles: z.record(z.string(), LlmProfileSchema),
  fallbacks: z.record(z.string(), LlmProfileSchema).optional().default({}),
  global: z.object({
    debugDumpEnabled: z.boolean().default(false),
    emulatedProvider: EmulatedProviderSchema.optional(),
  }).optional(),
}).superRefine((data, ctx) => {
  // Validate defaultProfile references an existing profile
  if (!data.profiles[data.defaultProfile]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `defaultProfile "${data.defaultProfile}" not found in profiles`,
      path: ['defaultProfile'],
    })
  }
})
```

### Step 2: Add Profile Reference Validation

**File**: `packages/sidekick-core/src/config.ts`

Add validation function called after Zod parsing, before `deepFreeze()` (integration point: `loadConfig()` line ~748):

```typescript
function validateProfileReferences(config: SidekickConfig): void {
  const validProfiles = new Set(Object.keys(config.llm.profiles))
  const validFallbacks = new Set(Object.keys(config.llm.fallbacks ?? {}))
  const errors: string[] = []

  for (const [featureName, featureConfig] of Object.entries(config.features)) {
    const llmConfig = featureConfig.settings?.llm
    if (!llmConfig || typeof llmConfig !== 'object') continue

    for (const [subFeature, subConfig] of Object.entries(llmConfig)) {
      if (typeof subConfig !== 'object' || subConfig === null) continue
      const sub = subConfig as Record<string, unknown>

      // profile must reference a primary profile (not a fallback)
      if (typeof sub.profile === 'string') {
        if (!validProfiles.has(sub.profile)) {
          errors.push(`features.${featureName}.settings.llm.${subFeature}.profile: Unknown profile "${sub.profile}"`)
        }
        if (validFallbacks.has(sub.profile)) {
          errors.push(`features.${featureName}.settings.llm.${subFeature}.profile: "${sub.profile}" is a fallback profile, not a primary profile`)
        }
      }

      // fallbackProfile must reference a fallback profile
      if (typeof sub.fallbackProfile === 'string' && !validFallbacks.has(sub.fallbackProfile)) {
        errors.push(`features.${featureName}.settings.llm.${subFeature}.fallbackProfile: Unknown fallback "${sub.fallbackProfile}"`)
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid profile references:\n${errors.join('\n')}`)
  }
}
```

### Step 3: Create ProfileProviderFactory

**File**: `packages/shared-providers/src/profile-factory.ts` (NEW)

```typescript
import { Logger } from '@sidekick/types'
import { ConfigService, LlmProfile } from '@sidekick/core'
import { ProviderFactory } from './factory'
import { FallbackProvider } from './fallback'
import { LLMProvider } from './types'

export class ProfileProviderFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: Logger
  ) {}

  /**
   * Creates a provider for a profile, reading config at call time.
   * Wraps with FallbackProvider if fallbackProfile specified.
   */
  createForProfile(profileId: string, fallbackProfileId?: string): LLMProvider {
    const profile = this.configService.llm.profiles[profileId]
    if (!profile) {
      throw new Error(`Profile "${profileId}" not found`)
    }

    const primary = this.createProvider(profile)

    if (!fallbackProfileId) return primary

    const fallback = this.configService.llm.fallbacks?.[fallbackProfileId]
    if (!fallback) {
      throw new Error(`Fallback profile "${fallbackProfileId}" not found`)
    }

    return new FallbackProvider(primary, [this.createProvider(fallback)], this.logger)
  }

  /**
   * Creates provider for the default profile.
   */
  createDefault(): LLMProvider {
    const { defaultProfile } = this.configService.llm
    return this.createForProfile(defaultProfile)
  }

  private createProvider(profile: LlmProfile): LLMProvider {
    const factory = new ProviderFactory({
      provider: profile.provider,
      model: profile.model,
      timeout: profile.timeout * 1000, // seconds to ms
      maxRetries: profile.timeoutMaxRetries,
    }, this.logger)
    return factory.create()
  }
}
```

**Also update**: `packages/shared-providers/src/index.ts` - add export

### Step 4: Update YAML Defaults

**Files**:
- `assets/sidekick/defaults/llm.defaults.yaml` - new profile structure (see YAML Structure section above)
- `assets/sidekick/defaults/features/session-summary.defaults.yaml` - add `settings.llm` section

### Step 5: Update Daemon

**File**: `packages/sidekick-daemon/src/daemon.ts`

Replace hardcoded provider creation at lines ~610 and ~751:

```typescript
// Before (hardcoded)
const factory = new ProviderFactory({
  provider: 'openrouter',
  model: 'google/gemini-2.0-flash-lite-001',
  timeout: 30000,
  maxRetries: 2,
}, this.logger)
this.llmProvider = factory.create()

// After (profile-based)
const profileFactory = new ProfileProviderFactory(this.configService, this.logger)
this.llmProvider = profileFactory.createDefault()
```

### Step 6: Update Feature Handlers

**Files**:
- `packages/feature-session-summary/src/handlers/update-summary.ts`

**Hybrid approach**: `ctx.llm` provides default profile provider, handlers create their own for sub-feature-specific profiles.

```typescript
// Simple case - use default profile via ctx.llm
const response = await ctx.llm.complete({
  messages: [...],
  jsonSchema,
})

// Sub-feature case - create provider for specific profile
const featureConfig = ctx.config.getFeature<SessionSummaryConfig>('session-summary')
const { profile: profileId, fallbackProfile } = featureConfig.settings.llm.snarkyComment

const provider = ctx.profileFactory.createForProfile(profileId, fallbackProfile)

const response = await provider.complete({
  messages: [...],
})
```

### Step 7: Update Types

**Files**:
- `packages/types/src/features/session-summary.ts`

```typescript
export interface LlmSubFeatureConfig {
  profile: string
  fallbackProfile?: string
}

export interface SessionSummarySettings {
  llm: {
    sessionSummary: LlmSubFeatureConfig
    snarkyComment: LlmSubFeatureConfig
    resumeMessage: LlmSubFeatureConfig
  }
  excerptLines: number
  filterToolMessages: boolean
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/types/src/llm.ts` | Remove `temperature`, `maxTokens` from `LLMRequest` |
| `packages/sidekick-core/src/config.ts` | New profile schemas, `validateProfileReferences()` |
| `packages/shared-providers/src/profile-factory.ts` | **NEW** - ProfileProviderFactory |
| `packages/shared-providers/src/index.ts` | Export ProfileProviderFactory |
| `packages/sidekick-daemon/src/daemon.ts` | Use ProfileProviderFactory, wire `ctx.llm` and `ctx.profileFactory` |
| `packages/feature-session-summary/src/handlers/update-summary.ts` | Use profiles via `ctx.profileFactory` |
| `packages/types/src/features/session-summary.ts` | Add LlmSubFeatureConfig types |
| `assets/sidekick/defaults/llm.defaults.yaml` | New profile structure |
| `assets/sidekick/defaults/features/session-summary.defaults.yaml` | Add `settings.llm` section |

---

## Hardcoded Values to Remove

Make sure to capture these in the actual profiles configuration.

| Location | Current Value | Target Profile |
|----------|---------------|----------------|
| `daemon.ts:610` | `google/gemini-2.0-flash-lite-001` | `fast-lite` (default) |
| `daemon.ts:751` | `google/gemini-2.0-flash-lite-001` | `fast-lite` (default) |
| `update-summary.ts:240` | `temperature: 0, maxTokens: 1000` | `fast-lite` |
| `update-summary.ts:421` | `temperature: 1.2, maxTokens: 100` | `creative` |
| `update-summary.ts:531` | `temperature: 1.2, maxTokens: 500` | `creative-long` |

---

## Validation Summary

1. **Schema validation**: Zod validates profile completeness (all required fields)
2. **Default reference**: `superRefine` ensures `defaultProfile` references an existing profile
3. **Reference validation**: `validateProfileReferences()` checks all feature profile references exist
4. **Namespace separation**: Primary profiles in `profiles`, fallbacks in `fallbacks` - `profile` cannot reference a fallback
5. **Startup failure**: Invalid config throws descriptive error, prevents app from starting

---

## Verification Checklist

1. `pnpm build && pnpm typecheck` - no type errors
2. `pnpm test` (excluding sandbox-blocked IPC tests) - all pass
3. `grep -r "temperature:" packages/` - only in tests/types, not handler code
4. Test invalid profile reference in YAML - should fail at startup with clear error message
5. Test runtime config change - modify profile in YAML, next LLM call uses new values (Config hot-reloading via file watcher)

---

## Out of Scope (Future Enhancements)

- FallbackProvider respecting `retryable` flag on errors
- Provider connection pooling
- Per-profile rate limiting
