# Configuration Externalization Plan

Move configuration defaults from embedded Zod schemas to external YAML files for discoverability, transparency, and surgical overrides.

## Target State

```
assets/sidekick/defaults/
├── README.md                # User documentation
├── core.defaults.yaml       # logging, paths, supervisor, ipc
├── llm.defaults.yaml        # provider, model, temperature, timeout
├── transcript.defaults.yaml # watchDebounceMs, metricsPersistIntervalMs
└── features/
    ├── reminders.defaults.yaml
    ├── statusline.defaults.yaml
    └── session-summary.defaults.yaml
```

**Cascade (lowest → highest priority):**
```
External YAML → Zod fallback → env → user domain YAML → user sidekick.config → project domain YAML → project sidekick.config → project-local
```

Note: At each scope (user/project), `sidekick.config` overrides the domain-specific YAML for quick surgical overrides.

---

## Phase 1: Add `resolveYaml()` to AssetResolver ✅

### Objectives
- [x] Extend `AssetResolver` interface with YAML parsing capability
- [x] Mirror existing `resolveJson()` pattern for consistency

### Tasks
- [x] **1.1** Read and understand existing tests in `packages/sidekick-core/src/__tests__/asset-resolver.test.ts`
- [x] **1.2** Read `packages/sidekick-core/src/assets.ts` to understand current implementation
- [x] **1.3** Write test cases for `resolveYaml()` (TDD: tests first)
  - Test: Returns parsed YAML object for valid file
  - Test: Returns null for missing file
  - Test: Throws on malformed YAML
  - Test: Follows same cascade as other resolve methods
- [x] **1.4** Run tests, verify they fail (red phase)
- [x] **1.5** Implement `resolveYaml()` method
- [x] **1.6** Run tests, verify they pass (green phase)

### Acceptance Criteria
- [x] `pnpm test` passes (asset resolver tests; IPC tests have pre-existing sandbox issues)
- [x] `pnpm lint` passes (zero warnings)
- [x] `pnpm typecheck` passes
- [x] `resolveYaml()` follows same cascade as `resolveJson()`

### Files
| File | Action |
|------|--------|
| `packages/sidekick-core/src/assets.ts` | Add `resolveYaml()` method ✅ |
| `packages/sidekick-core/src/__tests__/asset-resolver.test.ts` | Add tests ✅ |
| `packages/testing-fixtures/src/mocks/MockAssetResolver.ts` | Add `resolveYaml()` to mock ✅ |

---

## Phase 2: Create External Defaults Files ✅

### Objectives
- [x] Create documented YAML defaults files matching current Zod defaults
- [x] Ensure values exactly match existing embedded defaults

### Tasks
- [x] **2.1** Extract current defaults from `packages/sidekick-core/src/config.ts`:
  - `SUPERVISOR_DEFAULTS`, `IPC_DEFAULTS`, `LLM_DEFAULTS`, `TRANSCRIPT_DEFAULTS`
  - Zod `.default()` values in schemas
- [x] **2.2** Create `assets/sidekick/defaults/core.defaults.yaml`
- [x] **2.3** Create `assets/sidekick/defaults/llm.defaults.yaml`
- [x] **2.4** Create `assets/sidekick/defaults/transcript.defaults.yaml`
- [x] **2.5** Extract feature defaults from feature packages
- [x] **2.6** Create `assets/sidekick/defaults/features/statusline.defaults.yaml`
- [x] **2.7** Create `assets/sidekick/defaults/features/reminders.defaults.yaml`
- [x] **2.8** Create `assets/sidekick/defaults/features/session-summary.defaults.yaml`

### Acceptance Criteria
- [x] Each YAML file has comments explaining each option
- [x] Values match existing Zod/constant defaults exactly
- [x] Files are valid YAML (can be parsed without errors)
- [x] `pnpm test` still passes (no behavior change yet; IPC tests have pre-existing sandbox issues)
- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes

### Files
| File | Action |
|------|--------|
| `assets/sidekick/defaults/core.defaults.yaml` | Create ✅ |
| `assets/sidekick/defaults/llm.defaults.yaml` | Create ✅ |
| `assets/sidekick/defaults/transcript.defaults.yaml` | Create ✅ |
| `assets/sidekick/defaults/features/statusline.defaults.yaml` | Create ✅ |
| `assets/sidekick/defaults/features/reminders.defaults.yaml` | Create ✅ |
| `assets/sidekick/defaults/features/session-summary.defaults.yaml` | Create ✅ |

---

## Phase 3: Integrate External Defaults into ConfigService ✅

### Objectives
- [x] ConfigService loads external YAML as Layer 0 of cascade
- [x] Zod defaults remain as fallback when YAML missing
- [x] Existing behavior unchanged when no assets provided

### Tasks
- [x] **3.1** Read and understand `packages/sidekick-core/src/__tests__/config-service.test.ts`
- [x] **3.2** Read `loadDomainConfig()` and cascade logic in `config.ts`
- [x] **3.3** Write test cases for external defaults loading (TDD: tests first)
  - Test: External YAML values used as base layer
  - Test: User/project config overrides external defaults
  - Test: Falls back to Zod defaults when assets not provided
  - Test: Falls back to Zod defaults when YAML file missing
  - Test: Env variables override external defaults
- [x] **3.4** Run tests, verify new tests fail (red phase)
- [x] **3.5** Add `assets?: AssetResolver` to `ConfigServiceOptions`
- [x] **3.6** Create `loadExternalDefaults()` helper function
- [x] **3.7** Modify `loadDomainConfig()` to start with external defaults
- [x] **3.8** Run tests, verify they pass (green phase)

### Acceptance Criteria
- [x] `pnpm test` passes (config-service tests; IPC tests have pre-existing sandbox issues)
- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] Cascade order: External YAML < Zod < env < user domain < user sidekick.config < project domain < project sidekick.config < local
- [x] Tests without `assets` param behave identically to before

### Files
| File | Action |
|------|--------|
| `packages/sidekick-core/src/config.ts` | Add external defaults loading ✅ |
| `packages/sidekick-core/src/__tests__/config-service.test.ts` | Add tests ✅ |

---

## Phase 4: Feature Defaults Integration ✅

### Objectives
- [x] `getFeature<T>()` loads feature-specific defaults from YAML
- [x] Feature defaults merge with user settings correctly

### Tasks
- [x] **4.1** Read current `getFeature()` implementation in `config.ts`
- [x] **4.2** Read feature type definitions (statusline, reminders)
- [x] **4.3** Write test cases for feature defaults loading (TDD: tests first)
  - Test: `getFeature('statusline')` returns YAML defaults when no user config
  - Test: User settings override feature defaults
  - Test: Falls back gracefully when feature YAML missing
  - Test: Deep merges feature settings correctly
- [x] **4.4** Run tests, verify new tests fail (red phase)
- [x] **4.5** Update `getFeature<T>()` to load from `defaults/features/{name}.defaults.yaml`
- [x] **4.6** Store `assets` reference in ConfigService for runtime access
- [x] **4.7** Run tests, verify they pass (green phase)

### Acceptance Criteria
- [x] `pnpm test` passes
- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] Feature defaults load from YAML files
- [x] Deep merge works correctly for nested feature settings

### Files
| File | Action |
|------|--------|
| `packages/sidekick-core/src/config.ts` | Update `getFeature()`, store assets ref ✅ |
| `packages/sidekick-core/src/__tests__/config-service.test.ts` | Add feature tests ✅ |

---

## Phase 5: User Documentation ✅

### Objectives
- [x] Create README explaining the defaults system
- [x] Provide clear examples for common override scenarios

### Tasks
- [x] **5.1** Create `assets/sidekick/defaults/README.md` with:
  - Overview of the defaults directory structure
  - Explanation of each `*.defaults.yaml` file
  - How `sidekick.config` dot-notation works
  - User-level vs project-level override locations
  - Cascade order explanation
  - Common override examples

### Acceptance Criteria
- [x] README is clear and actionable
- [x] Examples are copy-paste ready
- [x] All file references are accurate

### Files
| File | Action |
|------|--------|
| `assets/sidekick/defaults/README.md` | Create ✅ |

---

## Completion Checklist

- [x] All phases complete
- [x] `pnpm test` passes (IPC tests have pre-existing sandbox issues)
- [x] `pnpm lint` passes (zero warnings)
- [x] `pnpm typecheck` passes
- [x] `pnpm build` succeeds
- [ ] Manual verification: Config loads correctly with external defaults

---

## Skills & Agents Reference

| Task Type | Tool |
|-----------|------|
| Understanding existing tests/code | `Explore` agent |
| Writing new tests | `superpowers:test-driven-development` skill |
| Implementation | Direct coding with verification |
| Code review | `superpowers:requesting-code-review` skill |
| Debugging failures | `superpowers:systematic-debugging` skill |
