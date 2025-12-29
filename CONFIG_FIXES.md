# Plan: Standardize Feature Configuration System

## Problem Summary

The feature configuration system has several inconsistencies:

1. **YAML structure doesn't match schema** - YAML files are flat (`enabled: true`, `threshold: 20`), but `FeatureConfigSchema` expects nested (`{ enabled, settings: {threshold: 20} }`)
2. **Hidden auto-wrapping** - `loadFeatureDefaults()` silently transforms flat YAML into nested structure
3. **`sidekick.config` confusion** - Users must write `features.reminders.settings.threshold=4` but YAML uses flat structure
4. **Session-summary bypasses cascade** - Uses hardcoded `DEFAULT_SESSION_SUMMARY_CONFIG`, ignores config files entirely
5. **Wrong access pattern** - Features use `context.config.getAll()` instead of `service.getFeature()`

## Proposed Solution: Standardize on Nested Structure

Make YAML files explicitly use the nested `settings` structure to match the schema. Remove auto-wrapping magic.

### Benefits
- No hidden transformations
- YAML structure matches what users write in `sidekick.config`
- Explicit is better than implicit
- Easier to debug configuration issues

---

## Implementation Tasks

### Phase 1: Update YAML Defaults to Nested Structure

**Files to modify:**
- `assets/sidekick/defaults/features/reminders.defaults.yaml`
- `assets/sidekick/defaults/features/statusline.defaults.yaml`
- `assets/sidekick/defaults/features/session-summary.defaults.yaml`

**Before:**
```yaml
enabled: true
pause_and_reflect_threshold: 20
```

**After:**
```yaml
enabled: true
settings:
  pause_and_reflect_threshold: 20
```

### Phase 2: Remove Auto-Wrapping from `loadFeatureDefaults()`

**File:** `packages/sidekick-core/src/config.ts`

**Current code (lines 812-833):**
```typescript
function loadFeatureDefaults(...) {
  const { enabled, ...settings } = defaults  // Auto-wrapping
  return { enabled, settings }
}
```

**New code:**
```typescript
function loadFeatureDefaults(...) {
  // Expect YAML to already have { enabled, settings } structure
  const validated = FeatureEntrySchema.parse(defaults)
  return validated
}
```

### Phase 3: Wire Session-Summary to Config Cascade

**File:** `packages/feature-session-summary/src/handlers/update-summary.ts`

**Current (line 153):**
```typescript
const config = DEFAULT_SESSION_SUMMARY_CONFIG
```

**New:**
```typescript
const allConfig = context.config.getAll() as { features: FeaturesConfig }
const featureConfig = allConfig.features['session-summary'] ?? { enabled: true, settings: {} }
const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, ...(featureConfig.settings as Partial<SessionSummaryConfig>) }
```

This matches the pattern already used by reminders.

### Phase 4: Standardize Feature Access Pattern

Features should use `getFeature()` instead of `getAll()`.

**Current pattern (reminders):**
```typescript
const allConfig = context.config.getAll() as { features: FeaturesConfig }
const featureConfig = allConfig.features['reminders'] ?? { enabled: true, settings: {} }
```

**Cleaner pattern:**
```typescript
const featureConfig = context.config.getFeature('reminders')
```

This requires `RuntimeContext` to expose `getFeature()` method on the config adapter.

### Phase 5: Update Tests

- Update config tests that expect old YAML structure
- Add tests for nested YAML structure
- Verify getFeature() still works correctly

### Phase 6: Update Documentation

- Update `docs/design/CONFIG-SYSTEM.md` example YAML files
- Update `docs/design/FEATURE-REMINDERS.md` config examples
- Update `assets/sidekick/defaults/README.md`

### Phase 7: Accept `:` Delimiter in `sidekick.config` Parser

**File:** `packages/sidekick-core/src/config.ts`

Update `parseUnifiedConfig()` to accept both `=` and `:` as delimiters:

```typescript
// Find delimiter (= or :)
const eqIndex = trimmed.indexOf('=')
const colonIndex = trimmed.indexOf(':')

// Use whichever comes first, preferring = if both present
let delimIndex: number
if (eqIndex === -1 && colonIndex === -1) {
  warnings.push(`${sourceLabel}:${lineNum + 1}: malformed line (missing '=' or ':'): ${trimmed}`)
  continue
}
delimIndex = eqIndex === -1 ? colonIndex : (colonIndex === -1 ? eqIndex : Math.min(eqIndex, colonIndex))
```

### Phase 8: Wire Statusline to Config Cascade

**Files:**
- `packages/feature-statusline/src/statusline-service.ts` - Read from cascade instead of constructor injection
- Callers of `createStatuslineService()` - Pass config adapter instead of raw config

**Or** create a `register()` pattern for statusline similar to other features.

### Phase 9: Add `getFeature()` to Runtime Context Config Adapter

**Files:**
- `packages/types/src/services/config.ts` - Add `getFeature()` to `MinimalConfigService` interface
- `ConfigService` in `sidekick-core` already implements `getFeature()` (line 931)

**Current `MinimalConfigService` (types package):**
```typescript
export interface MinimalConfigService {
  readonly core: { readonly logging: { readonly level: string } }
  readonly llm: { readonly provider: string }
  getAll(): unknown
}
```

**Updated:**
```typescript
export interface MinimalConfigService {
  readonly core: { readonly logging: { readonly level: string } }
  readonly llm: { readonly provider: string }
  getAll(): unknown
  getFeature<T = Record<string, unknown>>(name: string): { enabled: boolean; settings: T }
}
```

Update features to use the cleaner pattern:
```typescript
// Before
const allConfig = context.config.getAll() as { features: FeaturesConfig }
const featureConfig = allConfig.features['reminders'] ?? { enabled: true, settings: {} }

// After
const featureConfig = context.config.getFeature<ReminderConfig>('reminders')
```

---

## Final Files List

| File | Change |
|------|--------|
| `assets/sidekick/defaults/features/reminders.defaults.yaml` | Add `settings:` wrapper |
| `assets/sidekick/defaults/features/statusline.defaults.yaml` | Add `settings:` wrapper |
| `assets/sidekick/defaults/features/session-summary.defaults.yaml` | Add `settings:` wrapper |
| `packages/sidekick-core/src/config.ts` | Remove auto-wrap in `loadFeatureDefaults()`, accept `:` delimiter in `parseUnifiedConfig()` |
| `packages/types/src/services/config.ts` | Add `getFeature()` to `MinimalConfigService` |
| `packages/sidekick-core/src/__tests__/config-service.test.ts` | Update tests for nested YAML structure |
| `packages/feature-reminders/src/handlers/staging/stage-pause-and-reflect.ts` | Use `context.config.getFeature()` |
| `packages/feature-session-summary/src/handlers/update-summary.ts` | Wire to cascade, use `context.config.getFeature()` |
| `packages/feature-statusline/src/statusline-service.ts` | Wire to cascade |
| `docs/design/CONFIG-SYSTEM.md` | Update YAML examples to show nested structure |

---

## Execution Order

1. **YAML defaults** - Update all 3 feature YAML files to nested structure
2. **Config service** - Remove auto-wrap, accept `:` delimiter
3. **Types** - Add `getFeature()` to `MinimalConfigService`
4. **Tests** - Update config tests
5. **Features** - Update reminders, session-summary, statusline to use new pattern
6. **Docs** - Update CONFIG-SYSTEM.md examples
