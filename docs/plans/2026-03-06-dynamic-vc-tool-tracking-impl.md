# Dynamic VC Tool-Use Tracking — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the monolithic verify-completion reminder with per-tool verification reminders (build, typecheck, test, lint) that intelligently stage on file edits and unstage when verification commands are observed.

**Architecture:** Daemon-side transcript handler watches ToolCall events, tracking file edits (Write/Edit/MultiEdit) and Bash commands. Per-tool state machine (STAGED/VERIFIED/COOLDOWN) with configurable thresholds. Each tool gets its own staged reminder file; existing multi-reminder composition handles assembly.

**Tech Stack:** TypeScript, Vitest, picomatch, Zod, YAML assets

**Design doc:** `docs/plans/2026-03-05-dynamic-vc-tool-tracking-design.md`

---

## Pre-Implementation: Research Existing VC Staging Rules

> **IMPORTANT**: The design doc flags open research on how existing orchestrator rules interact with per-tool VC. This must be resolved before Task 1.

**Read these files and understand the coordination:**
- `packages/feature-reminders/src/orchestrator.ts` — Rule 1: P&R staged → unstage VC. The orchestrator deletes `verify-completion` by name. With per-tool reminders, it must delete ALL `vc-*` reminders AND the wrapper.
- `packages/feature-reminders/src/handlers/staging/unstage-verify-completion.ts` — Re-stages VC on UserPromptSubmit if unverified changes exist. Must be adapted to re-stage per-tool reminders based on verification-tools state.
- `packages/feature-reminders/src/handlers/consumption/inject-stop.ts` — Sets `vc-unverified` state. The wrapper reminder retains `verify-completion` ID, so the custom `buildResponse` logic should still trigger. Verify this.

**Decisions to confirm:**
1. Orchestrator Rule 1 (P&R staged → unstage VC): Should unstage wrapper + all vc-tool reminders. Update `onReminderStaged()`.
2. `unstage-verify-completion.ts`: On UserPromptSubmit, read verification-tools state. If any tools are still in STAGED state, re-stage those + wrapper. If all verified, delete all.
3. `inject-stop.ts`: The wrapper (`verify-completion`) is primary. Its custom `buildResponse` runs completion classification. Per-tool reminders contribute `additionalContext` as secondaries. No changes needed to inject-stop.ts itself.
4. `vc-unverified` state: May need to become per-tool or remain as-is (wrapper-level). If the wrapper is consumed and classified as non-blocking, all per-tool reminders were consumed too. Re-staging on next UserPromptSubmit should re-stage based on verification-tools state, not vc-unverified. **Consider removing vc-unverified in favor of verification-tools state.**

---

## Task 1: Add Types and Configuration Schema

**Files:**
- Modify: `packages/feature-reminders/src/types.ts`
- Modify: `assets/sidekick/defaults/features/reminders.defaults.yaml`
- Test: `packages/feature-reminders/src/__tests__/types.test.ts` (if exists, or create)

**Step 1: Write the failing test**

Create `packages/feature-reminders/src/__tests__/verification-tool-config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { VerificationToolConfigSchema, DEFAULT_VERIFICATION_TOOLS } from '../types.js'

describe('VerificationToolConfig', () => {
  it('validates a well-formed tool config', () => {
    const config = {
      enabled: true,
      patterns: ['pnpm build'],
      clearing_threshold: 3,
      clearing_patterns: ['**/*.ts'],
    }
    const result = VerificationToolConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  it('rejects config missing required fields', () => {
    const result = VerificationToolConfigSchema.safeParse({ enabled: true })
    expect(result.success).toBe(false)
  })

  it('provides sensible defaults for all tool categories', () => {
    expect(DEFAULT_VERIFICATION_TOOLS).toHaveProperty('build')
    expect(DEFAULT_VERIFICATION_TOOLS).toHaveProperty('typecheck')
    expect(DEFAULT_VERIFICATION_TOOLS).toHaveProperty('test')
    expect(DEFAULT_VERIFICATION_TOOLS).toHaveProperty('lint')
    expect(DEFAULT_VERIFICATION_TOOLS.build.patterns.length).toBeGreaterThan(0)
    expect(DEFAULT_VERIFICATION_TOOLS.build.clearing_threshold).toBeGreaterThan(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/verification-tool-config.test.ts`
Expected: FAIL — imports don't exist yet

**Step 3: Implement types**

In `packages/feature-reminders/src/types.ts`, add:

```typescript
import { z } from 'zod'

// Zod schema for a single verification tool config
export const VerificationToolConfigSchema = z.object({
  enabled: z.boolean(),
  patterns: z.array(z.string()).min(1),
  clearing_threshold: z.number().int().positive(),
  clearing_patterns: z.array(z.string()).min(1),
})

export type VerificationToolConfig = z.infer<typeof VerificationToolConfigSchema>

// Zod schema for the full verification_tools map
export const VerificationToolsMapSchema = z.record(z.string(), VerificationToolConfigSchema)

export type VerificationToolsMap = z.infer<typeof VerificationToolsMapSchema>

// Per-tool runtime state
export interface VerificationToolStatus {
  status: 'staged' | 'verified' | 'cooldown'
  editsSinceVerified: number
  lastVerifiedAt: number | null
  lastStagedAt: number | null
}

export type VerificationToolsState = Record<string, VerificationToolStatus>

// Default verification tools (fat defaults for all ecosystems)
export const DEFAULT_VERIFICATION_TOOLS: VerificationToolsMap = {
  build: {
    enabled: true,
    patterns: [
      'pnpm build', 'npm run build', 'yarn build', 'tsc', 'esbuild',
      'python setup.py build', 'pip install', 'poetry build',
      'mvn compile', 'mvn package', 'gradle build', 'gradlew build',
      'go build', 'cargo build', 'make build', 'cmake --build', 'docker build',
    ],
    clearing_threshold: 3,
    clearing_patterns: [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py',
      '**/*.java', '**/*.kt', '**/*.go', '**/*.rs', '**/*.c', '**/*.cpp', '**/*.cs',
    ],
  },
  typecheck: {
    enabled: true,
    patterns: ['pnpm typecheck', 'tsc --noEmit', 'mypy', 'pyright', 'pytype', 'go vet'],
    clearing_threshold: 3,
    clearing_patterns: ['**/*.ts', '**/*.tsx', '**/*.py', '**/*.go'],
  },
  test: {
    enabled: true,
    patterns: [
      'pnpm test', 'npm test', 'yarn test', 'vitest', 'jest',
      'pytest', 'python -m pytest', 'go test', 'cargo test',
      'mvn test', 'gradle test', 'gradlew test', 'dotnet test', 'make test',
    ],
    clearing_threshold: 3,
    clearing_patterns: [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py',
      '**/*.java', '**/*.kt', '**/*.go', '**/*.rs',
      '**/*.test.*', '**/*.spec.*', '**/test_*',
    ],
  },
  lint: {
    enabled: true,
    patterns: [
      'pnpm lint', 'npm run lint', 'yarn lint', 'eslint',
      'ruff check', 'flake8', 'pylint', 'golangci-lint', 'cargo clippy', 'ktlint', 'dotnet format',
    ],
    clearing_threshold: 5,
    clearing_patterns: [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py',
      '**/*.java', '**/*.kt', '**/*.go', '**/*.rs',
    ],
  },
}
```

Add `verification_tools` to `RemindersSettings`:

```typescript
export interface RemindersSettings {
  pause_and_reflect_threshold: number
  source_code_patterns: string[]
  completion_detection?: CompletionDetectionSettings
  max_verification_cycles?: number
  verification_tools?: VerificationToolsMap
}
```

Update `DEFAULT_REMINDERS_SETTINGS`:

```typescript
export const DEFAULT_REMINDERS_SETTINGS: RemindersSettings = {
  pause_and_reflect_threshold: 60,
  source_code_patterns: DEFAULT_SOURCE_CODE_PATTERNS,
  max_verification_cycles: -1,
  verification_tools: DEFAULT_VERIFICATION_TOOLS,
}
```

Add new ReminderIds:

```typescript
export const ReminderIds = {
  USER_PROMPT_SUBMIT: 'user-prompt-submit',
  PAUSE_AND_REFLECT: 'pause-and-reflect',
  VERIFY_COMPLETION: 'verify-completion',
  VC_BUILD: 'vc-build',
  VC_TYPECHECK: 'vc-typecheck',
  VC_TEST: 'vc-test',
  VC_LINT: 'vc-lint',
  REMEMBER_YOUR_PERSONA: 'remember-your-persona',
  PERSONA_CHANGED: 'persona-changed',
  USER_PROFILE: 'user-profile',
} as const
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/verification-tool-config.test.ts`
Expected: PASS

**Step 5: Update reminders.defaults.yaml**

Add the `verification_tools` section to `assets/sidekick/defaults/features/reminders.defaults.yaml` under `settings:`, matching the DEFAULT_VERIFICATION_TOOLS structure.

**Step 6: Commit**

```bash
git add packages/feature-reminders/src/types.ts packages/feature-reminders/src/__tests__/verification-tool-config.test.ts assets/sidekick/defaults/features/reminders.defaults.yaml
git commit -m "feat(reminders): add verification tool types, config schema, and defaults"
```

---

## Task 2: Add Verification Tools State Accessor

**Files:**
- Modify: `packages/feature-reminders/src/state.ts`
- Modify: `packages/types/src/services/state.ts` (add Zod schema for VerificationToolsState)
- Test: `packages/feature-reminders/src/__tests__/state.test.ts` (if exists)

**Step 1: Write the failing test**

Create or extend state tests:

```typescript
import { describe, it, expect } from 'vitest'
import { createRemindersState } from '../state.js'

describe('createRemindersState', () => {
  it('includes verificationTools accessor', () => {
    const mockStateService = { /* minimal mock */ }
    const state = createRemindersState(mockStateService as any)
    expect(state).toHaveProperty('verificationTools')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/state.test.ts`
Expected: FAIL — `verificationTools` not in state accessors

**Step 3: Implement state accessor**

In `packages/types/src/services/state.ts`, add Zod schema:

```typescript
export const VerificationToolStatusSchema = z.object({
  status: z.enum(['staged', 'verified', 'cooldown']),
  editsSinceVerified: z.number(),
  lastVerifiedAt: z.number().nullable(),
  lastStagedAt: z.number().nullable(),
})

export const VerificationToolsStateSchema = z.record(z.string(), VerificationToolStatusSchema)

export type VerificationToolsState = z.infer<typeof VerificationToolsStateSchema>
```

In `packages/feature-reminders/src/state.ts`, add:

```typescript
const VerificationToolsDescriptor = sessionState('verification-tools.json', VerificationToolsStateSchema, {
  defaultValue: {},
  trackHistory: false,
})
```

Add to `RemindersStateAccessors` and `createRemindersState()`:

```typescript
export interface RemindersStateAccessors {
  prBaseline: SessionStateAccessor<PRBaselineState, null>
  vcUnverified: SessionStateAccessor<VCUnverifiedState, null>
  verificationTools: SessionStateAccessor<VerificationToolsState, Record<string, never>>
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git commit -m "feat(reminders): add verification-tools state accessor"
```

---

## Task 3: Create Per-Tool Reminder YAML Assets

**Files:**
- Create: `assets/sidekick/reminders/vc-build.yaml`
- Create: `assets/sidekick/reminders/vc-typecheck.yaml`
- Create: `assets/sidekick/reminders/vc-test.yaml`
- Create: `assets/sidekick/reminders/vc-lint.yaml`
- Modify: `assets/sidekick/reminders/verify-completion.yaml` (becomes wrapper)

**Step 1: Create vc-build.yaml**

```yaml
id: vc-build
blocking: true
priority: 50
persistent: false

additionalContext: |
  <vc-build>
  You have modified source files but have not run a build step.
  Run the project's build command before claiming completion.
  </vc-build>

userMessage: "Verification needed: build not run since last code changes"
reason: "Source files modified without subsequent build verification"
```

**Step 2: Create vc-typecheck.yaml, vc-test.yaml, vc-lint.yaml** (same structure, different messages)

**Step 3: Modify verify-completion.yaml to become wrapper**

```yaml
id: verify-completion
blocking: true
priority: 51
persistent: false

additionalContext: |
  <completion-verification-required>
  Evidence before assertions. Don't claim success without verification.

  You can skip this verification only if:
  - The user has explicitly instructed you to skip verification.
  - The verification evidence is done just before this reminder was triggered.
  - You're not claiming "done" but stopping to give an update or ask for more info.

  Otherwise, this step is mandatory. The following verification steps are outstanding:
  </completion-verification-required>

userMessage: "Asking the agent to verify completion before stopping..."
reason: "Verify completion before stopping - outstanding verification steps detected"
```

Note: priority bumped to 51 so wrapper is always primary. The `additionalContext` acts as a header; per-tool reminders append their specific checklists.

**Step 4: Verify reminder resolution works**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run` (relevant reminder resolution tests)

**Step 5: Commit**

```bash
git commit -m "feat(reminders): add per-tool VC reminder YAMLs and convert verify-completion to wrapper"
```

---

## Task 4: Implement `track-verification-tools.ts` Handler

This is the core handler. It replaces the file-edit detection in `stage-stop-reminders.ts` and adds verification command detection.

**Files:**
- Create: `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts`
- Test: `packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts`

**Step 1: Write the failing tests**

Test cases:
1. File edit to `.ts` file within project_dir stages all matching vc-tool reminders + wrapper
2. File edit outside project_dir is ignored
3. File edit to non-matching pattern (e.g., `.md`) is ignored
4. Bash command matching `build` pattern unstages `vc-build` and transitions to VERIFIED
5. Chained command `pnpm build && pnpm test` unstages both `vc-build` and `vc-test`
6. After VERIFIED, first edit increments counter but doesn't re-stage (COOLDOWN)
7. After VERIFIED, Nth edit (meeting threshold) re-stages
8. Wrapper is unstaged when all per-tool reminders are unstaged
9. Bulk processing events are skipped (existing behavior from createStagingHandler)

**Step 2: Run tests to verify they fail**

**Step 3: Implement the handler**

Key implementation notes:
- Register for `ToolCall` transcript events, priority 60 (same as current stage-stop-reminders)
- Use `context.paths.projectDir` for path scoping
- Use `picomatch.isMatch()` for clearing_patterns (already a dependency)
- Read/write verification-tools state via `createRemindersState().verificationTools`
- For staging: use `createStagingHandler` pattern OR direct `daemonCtx.staging.stageReminder()` calls (since we need to stage multiple reminders per event, direct calls may be cleaner)
- For unstaging: use `daemonCtx.staging.deleteReminder()`

**Step 4: Run tests to verify they pass**

**Step 5: Commit**

```bash
git commit -m "feat(reminders): implement track-verification-tools handler"
```

---

## Task 5: Refactor `stage-stop-reminders.ts`

Remove the file-edit VC staging logic that is now handled by `track-verification-tools.ts`.

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/stage-stop-reminders.ts`
- Modify: existing tests for stage-stop-reminders

**Step 1: Update tests to reflect new behavior**

The handler should no longer stage `verify-completion` on file edits. That's now handled by `track-verification-tools`. Either:
- Remove this handler entirely if it has no other responsibilities, OR
- Keep it if there are other staging triggers, but remove the file-edit → VC logic

**Step 2: Run tests**

**Step 3: Refactor**

**Step 4: Commit**

```bash
git commit -m "refactor(reminders): remove file-edit VC staging from stage-stop-reminders (moved to track-verification-tools)"
```

---

## Task 6: Update `unstage-verify-completion.ts` for Per-Tool Reminders

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/unstage-verify-completion.ts`
- Test: existing tests + new cases

**Step 1: Understand current behavior and write new tests**

Current: On UserPromptSubmit, checks `vc-unverified` state. If unverified changes exist, re-stages `verify-completion`. Otherwise deletes it.

New: On UserPromptSubmit, read `verification-tools` state. For each tool in STAGED state, the staged reminder already exists — leave it. For tools in VERIFIED/COOLDOWN, their reminders are already unstaged — leave them. Delete the wrapper if no per-tool reminders remain staged.

**Key insight**: The verification-tools state machine handles staging/unstaging reactively (on file edits and verification commands). The UserPromptSubmit handler's main job becomes:
- Check if any vc-tool reminders are currently staged
- If none staged, ensure wrapper is also not staged
- The `vc-unverified` re-staging logic may be replaced by the verification-tools state machine (see pre-implementation research)

**Step 2: Implement changes**

**Step 3: Run tests**

**Step 4: Commit**

```bash
git commit -m "refactor(reminders): update unstage-verify-completion for per-tool VC reminders"
```

---

## Task 7: Update Orchestrator Rules

**Files:**
- Modify: `packages/feature-reminders/src/orchestrator.ts`
- Test: existing orchestrator tests

**Step 1: Write tests for updated rules**

Rule 1 (P&R staged → unstage VC): Must now delete wrapper + all vc-tool reminders.

```typescript
it('unstages wrapper and all vc-tool reminders when P&R staged', async () => {
  await orchestrator.onReminderStaged({ name: ReminderIds.PAUSE_AND_REFLECT, hook: 'PreToolUse' }, sessionId)
  expect(mockStaging.deleteReminder).toHaveBeenCalledWith('Stop', ReminderIds.VERIFY_COMPLETION)
  expect(mockStaging.deleteReminder).toHaveBeenCalledWith('Stop', ReminderIds.VC_BUILD)
  expect(mockStaging.deleteReminder).toHaveBeenCalledWith('Stop', ReminderIds.VC_TYPECHECK)
  expect(mockStaging.deleteReminder).toHaveBeenCalledWith('Stop', ReminderIds.VC_TEST)
  expect(mockStaging.deleteReminder).toHaveBeenCalledWith('Stop', ReminderIds.VC_LINT)
})
```

Rule 3/4 (VC consumed → reset P&R baseline, unstage P&R): Unchanged — wrapper retains `verify-completion` ID.

**Step 2: Implement**

In `onReminderStaged`, when P&R is staged, delete all VC-related reminders:

```typescript
const VC_REMINDER_IDS = [
  ReminderIds.VERIFY_COMPLETION,
  ReminderIds.VC_BUILD,
  ReminderIds.VC_TYPECHECK,
  ReminderIds.VC_TEST,
  ReminderIds.VC_LINT,
]
```

**Step 3: Run tests**

**Step 4: Commit**

```bash
git commit -m "fix(reminders): update orchestrator to handle per-tool VC reminders"
```

---

## Task 8: Register New Handler and Integration Test

**Files:**
- Modify: handler registration file (wherever `registerStageStopReminders` is called)
- Create: integration test

**Step 1: Register `track-verification-tools` handler**

Find where handlers are registered (likely a feature setup/init file) and add `registerTrackVerificationTools(context)`.

**Step 2: Write integration test**

Full cycle test with mocked transcript events:
1. Simulate file edit → verify per-tool reminders staged
2. Simulate `pnpm build` command → verify vc-build unstaged
3. Simulate 2 more file edits → verify still in cooldown (threshold=3)
4. Simulate 3rd file edit → verify vc-build re-staged
5. Simulate Stop hook → verify composed response includes only outstanding tools

**Step 3: Run full test suite**

Run: `pnpm --filter @sidekick/feature-reminders test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`

**Step 4: Commit**

```bash
git commit -m "feat(reminders): register track-verification-tools handler and add integration test"
```

---

## Task 9: Quality Gates

**Step 1: Build**

Run: `pnpm build`

**Step 2: Typecheck**

Run: `pnpm typecheck`

**Step 3: Lint**

Run: `pnpm lint`

**Step 4: Full test suite (excluding IPC)**

Run: `pnpm --filter @sidekick/feature-reminders test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`

**Step 5: Fix any issues**

**Step 6: Final commit if needed, then present for review**

---

## Task Summary

| Task | Description | Dependencies |
|------|-------------|--------------|
| Pre  | Research existing VC staging rules | None |
| 1    | Types, config schema, defaults | None |
| 2    | Verification tools state accessor | Task 1 |
| 3    | Per-tool reminder YAML assets | Task 1 (ReminderIds) |
| 4    | `track-verification-tools.ts` handler | Tasks 1, 2, 3 |
| 5    | Refactor `stage-stop-reminders.ts` | Task 4 |
| 6    | Update `unstage-verify-completion.ts` | Tasks 2, 4 |
| 7    | Update orchestrator rules | Task 1 (ReminderIds) |
| 8    | Register handler + integration test | Tasks 4, 5, 6, 7 |
| 9    | Quality gates | Task 8 |

**Parallelizable:** Tasks 1-3 have minimal dependencies and can proceed together. Tasks 5, 6, 7 are independent of each other (all depend on Task 4). Task 8 integrates everything.
