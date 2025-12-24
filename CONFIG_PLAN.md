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
External YAML → Zod fallback → env → user config → project config → project-local
```

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

## Phase 2: Create External Defaults Files

### Objectives
- [ ] Create documented YAML defaults files matching current Zod defaults
- [ ] Ensure values exactly match existing embedded defaults

### Tasks
- [ ] **2.1** Extract current defaults from `packages/sidekick-core/src/config.ts`:
  - `SUPERVISOR_DEFAULTS`, `IPC_DEFAULTS`, `LLM_DEFAULTS`, `TRANSCRIPT_DEFAULTS`
  - Zod `.default()` values in schemas
- [ ] **2.2** Create `assets/sidekick/defaults/core.defaults.yaml`
- [ ] **2.3** Create `assets/sidekick/defaults/llm.defaults.yaml`
- [ ] **2.4** Create `assets/sidekick/defaults/transcript.defaults.yaml`
- [ ] **2.5** Extract feature defaults from feature packages
- [ ] **2.6** Create `assets/sidekick/defaults/features/statusline.defaults.yaml`
- [ ] **2.7** Create `assets/sidekick/defaults/features/reminders.defaults.yaml`
- [ ] **2.8** Create `assets/sidekick/defaults/features/session-summary.defaults.yaml`

### Acceptance Criteria
- [ ] Each YAML file has comments explaining each option
- [ ] Values match existing Zod/constant defaults exactly
- [ ] Files are valid YAML (can be parsed without errors)
- [ ] `pnpm test` still passes (no behavior change yet)
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes

### Files
| File | Action |
|------|--------|
| `assets/sidekick/defaults/core.defaults.yaml` | Create |
| `assets/sidekick/defaults/llm.defaults.yaml` | Create |
| `assets/sidekick/defaults/transcript.defaults.yaml` | Create |
| `assets/sidekick/defaults/features/statusline.defaults.yaml` | Create |
| `assets/sidekick/defaults/features/reminders.defaults.yaml` | Create |
| `assets/sidekick/defaults/features/session-summary.defaults.yaml` | Create |

---

## Phase 3: Integrate External Defaults into ConfigService

### Objectives
- [ ] ConfigService loads external YAML as Layer 0 of cascade
- [ ] Zod defaults remain as fallback when YAML missing
- [ ] Existing behavior unchanged when no assets provided

### Tasks
- [ ] **3.1** Read and understand `packages/sidekick-core/src/__tests__/config-service.test.ts`
- [ ] **3.2** Read `loadDomainConfig()` and cascade logic in `config.ts`
- [ ] **3.3** Write test cases for external defaults loading (TDD: tests first)
  - Test: External YAML values used as base layer
  - Test: User/project config overrides external defaults
  - Test: Falls back to Zod defaults when assets not provided
  - Test: Falls back to Zod defaults when YAML file missing
- [ ] **3.4** Run tests, verify new tests fail (red phase)
- [ ] **3.5** Add `assets?: AssetResolver` to `ConfigServiceOptions`
- [ ] **3.6** Create `loadExternalDefaults()` helper function
- [ ] **3.7** Modify `loadDomainConfig()` to start with external defaults
- [ ] **3.8** Run tests, verify they pass (green phase)

### Acceptance Criteria
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] Cascade order: External YAML < Zod < env < user < project < local
- [ ] Tests without `assets` param behave identically to before

### Files
| File | Action |
|------|--------|
| `packages/sidekick-core/src/config.ts` | Add external defaults loading |
| `packages/sidekick-core/src/__tests__/config-service.test.ts` | Add tests |

---

## Phase 4: Feature Defaults Integration

### Objectives
- [ ] `getFeature<T>()` loads feature-specific defaults from YAML
- [ ] Feature defaults merge with user settings correctly

### Tasks
- [ ] **4.1** Read current `getFeature()` implementation in `config.ts`
- [ ] **4.2** Read feature type definitions (statusline, reminders)
- [ ] **4.3** Write test cases for feature defaults loading (TDD: tests first)
  - Test: `getFeature('statusline')` returns YAML defaults when no user config
  - Test: User settings override feature defaults
  - Test: Falls back gracefully when feature YAML missing
- [ ] **4.4** Run tests, verify new tests fail (red phase)
- [ ] **4.5** Update `getFeature<T>()` to load from `defaults/features/{name}.defaults.yaml`
- [ ] **4.6** Store `assets` reference in ConfigService for runtime access
- [ ] **4.7** Run tests, verify they pass (green phase)

### Acceptance Criteria
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] Feature defaults load from YAML files
- [ ] Deep merge works correctly for nested feature settings

### Files
| File | Action |
|------|--------|
| `packages/sidekick-core/src/config.ts` | Update `getFeature()`, store assets ref |
| `packages/sidekick-core/src/__tests__/config-service.test.ts` | Add feature tests |

---

## Phase 5: User Documentation

### Objectives
- [ ] Create README explaining the defaults system
- [ ] Provide clear examples for common override scenarios

### Tasks
- [ ] **5.1** Create `assets/sidekick/defaults/README.md` with:
  - Overview of the defaults directory structure
  - Explanation of each `*.defaults.yaml` file
  - How `sidekick.config` dot-notation works
  - User-level vs project-level override locations
  - Cascade order explanation
  - Common override examples

### Acceptance Criteria
- [ ] README is clear and actionable
- [ ] Examples are copy-paste ready
- [ ] All file references are accurate

### Files
| File | Action |
|------|--------|
| `assets/sidekick/defaults/README.md` | Create |

---

## Completion Checklist

- [ ] All phases complete
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes (zero warnings)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds
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
