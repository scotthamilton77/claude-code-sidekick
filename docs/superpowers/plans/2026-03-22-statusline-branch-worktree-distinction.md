# Statusline Branch/Worktree Visual Distinction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `{branchWT}` statusline token that appends a dim `[wt]` indicator when in a git worktree, and remove the `{worktreeOrBranch}` token.

**Architecture:** The statusline uses a template token system: `StatuslineViewModel` holds pre-computed values, `buildViewModel()` populates them from git/hook data, and `Formatter.format()` expands tokens with colorization. We add `branchWT` to this pipeline and remove `worktreeOrBranch`. The `branchWT` token stores only the branch name as its raw value; the `[wt]` suffix is appended during colorization so that `maxLength` truncation applies only to the branch portion.

**Tech Stack:** TypeScript, Vitest, YAML config

**Spec:** `docs/superpowers/specs/2026-03-22-statusline-branch-worktree-distinction-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/feature-statusline/src/types.ts` | Modify | Add `branchWT` to `StatuslineViewModel`, remove `worktreeOrBranch`, update `DEFAULT_STATUSLINE_CONFIG` format |
| `packages/feature-statusline/src/statusline-service.ts` | Modify | Add `branchWT` to `buildViewModel()` and `EMPTY_STATUSLINE_VIEWMODEL`, remove `worktreeOrBranch` |
| `packages/feature-statusline/src/formatter.ts` | Modify | Add `branchWT` to `rawTokens` and `colorizeToken` with split colorization, remove `worktreeOrBranch` |
| `packages/feature-statusline/src/__tests__/statusline.test.ts` | Modify | Replace all `worktreeOrBranch` with `branchWT` in view model fixtures, add worktree-specific tests |
| `assets/sidekick/defaults/features/statusline.defaults.yaml` | Modify | Update format, docs, remove `worktreeOrBranch`, add `branchWT` |
| `docs/plans/2026-03-08-statusline-template-enhancements-design.md` | Modify | Remove `worktreeOrBranch` references |
| `docs/plans/2026-03-08-statusline-template-enhancements.md` | Modify | Remove `worktreeOrBranch` references |

---

### Task 1: Write failing tests for `branchWT`

**Files:**
- Modify: `packages/feature-statusline/src/__tests__/statusline.test.ts`

Tests are written first — they will fail until the implementation tasks complete.

- [ ] **Step 1: Replace all `worktreeOrBranch` in test view model fixtures**

Every test fixture that builds a `StatuslineViewModel` contains `worktreeOrBranch: 'main'` (or similar). Replace all with `branchWT: 'main'` (or the appropriate branch value).

Do a find-and-replace across `statusline.test.ts`:
- `worktreeOrBranch: 'main'` → `branchWT: 'main'`
- `worktreeOrBranch: ''` → `branchWT: ''`
- Any other `worktreeOrBranch` values → equivalent `branchWT` values

There are 17 occurrences. Also update the `makeViewModel()` helper (line ~993) which has `worktreeOrBranch: 'main'`.

- [ ] **Step 2: Add test for `{branchWT}` without worktree**

Add in the "Formatter with colors enabled" describe block:

```typescript
it('formats branchWT without worktree indicator when not in worktree', () => {
  const formatter = createFormatter({
    theme: DEFAULT_STATUSLINE_CONFIG.theme,
    useColors: true,
  })
  const viewModel = makeViewModel({
    branch: 'feat/auth',
    branchWT: 'feat/auth',
    branchColor: 'blue',
    worktreeName: '',
  })
  const result = formatter.format('{branchWT}', viewModel)
  expect(result).toBe(`${ANSI.blue}feat/auth${ANSI.reset}`)
})
```

- [ ] **Step 3: Add test for `{branchWT}` with worktree**

```typescript
it('formats branchWT with dim [wt] indicator when in worktree', () => {
  const formatter = createFormatter({
    theme: DEFAULT_STATUSLINE_CONFIG.theme,
    useColors: true,
  })
  const viewModel = makeViewModel({
    branch: 'feat/auth',
    branchWT: 'feat/auth',
    branchColor: 'blue',
    worktreeName: 'auth-worktree',
  })
  const result = formatter.format('{branchWT}', viewModel)
  expect(result).toBe(`${ANSI.blue}feat/auth${ANSI.reset} ${ANSI.dim}[wt]${ANSI.reset}`)
})
```

- [ ] **Step 4: Add test for `{branchWT}` with maxLength truncation**

Verify truncation applies only to the branch portion, not the `[wt]` suffix:

```typescript
it('truncates only branch portion of branchWT, preserving [wt] suffix', () => {
  const formatter = createFormatter({
    theme: DEFAULT_STATUSLINE_CONFIG.theme,
    useColors: true,
  })
  const viewModel = makeViewModel({
    branch: 'feat/very-long-branch-name-that-exceeds-limit',
    branchWT: 'feat/very-long-branch-name-that-exceeds-limit',
    branchColor: 'blue',
    worktreeName: 'some-worktree',
  })
  const result = formatter.format('{branchWT,maxLength=10}', viewModel)
  // Branch truncated to 10 chars, then [wt] appended
  expect(result).toContain('[wt]')
  expect(result).toContain('feat/very')
})
```

- [ ] **Step 5: Run tests — expect failures**

Run: `pnpm --filter feature-statusline test`

Expected: Type errors (branchWT not in StatuslineViewModel yet) and test failures. This confirms our tests target the right behavior.

- [ ] **Step 6: Commit failing tests**

```bash
git add packages/feature-statusline/src/__tests__/statusline.test.ts
git commit -m "test(statusline): add branchWT tests, replace worktreeOrBranch (red phase)"
```

---

### Task 2: Update `StatuslineViewModel` type and defaults

**Files:**
- Modify: `packages/feature-statusline/src/types.ts:207-260` (StatuslineViewModel interface)
- Modify: `packages/feature-statusline/src/types.ts:125-146` (DEFAULT_STATUSLINE_CONFIG)

- [ ] **Step 1: Add `branchWT` and remove `worktreeOrBranch` from `StatuslineViewModel`**

In `types.ts`, in the `StatuslineViewModel` interface (line ~207):

1. Add after line 233 (`branchColor`):
```typescript
  /** Branch name + [wt] indicator when in worktree (branch-only otherwise) */
  branchWT: string
```

2. Remove lines 240-241:
```typescript
  /** Worktree name if in worktree, else raw branch name */
  worktreeOrBranch: string
```

- [ ] **Step 2: Update `DEFAULT_STATUSLINE_CONFIG` format string**

In `types.ts` line 128, replace:
```typescript
"{personaName,prefix='[',suffix='] | '}{model,prefix='[',suffix='] | '}{contextBar} {tokenPercentageActual} | {logs} | {cwd,maxLength=40,truncateStyle='path'}{branch,prefix=' ∗ ',maxLength=40}{title,wrapAt=80,prefix=' | ',wrapPrefix='\\n'}\n{summary}",
```
with:
```typescript
"{personaName,prefix='[',suffix='] | '}{model,prefix='[',suffix='] | '}{contextBar} {tokenPercentageActual} | {logs} | {cwd,maxLength=40,truncateStyle='path'}{branchWT,prefix=' | ',maxLength=40}{title,wrapAt=80,prefix=' | ',wrapPrefix='\\n'}\n{summary}",
```

- [ ] **Step 3: Commit**

```bash
git add packages/feature-statusline/src/types.ts
git commit -m "feat(statusline): add branchWT to StatuslineViewModel, remove worktreeOrBranch"
```

---

### Task 3: Update `statusline-service.ts`

**Files:**
- Modify: `packages/feature-statusline/src/statusline-service.ts:73-97` (EMPTY_STATUSLINE_VIEWMODEL)
- Modify: `packages/feature-statusline/src/statusline-service.ts:878-909` (buildViewModel return)

- [ ] **Step 1: Update `EMPTY_STATUSLINE_VIEWMODEL`**

At line 92, replace:
```typescript
  worktreeOrBranch: '',
```
with:
```typescript
  branchWT: '',
```

- [ ] **Step 2: Update `buildViewModel()` return object**

At line ~898-899, replace:
```typescript
      worktreeName: worktree?.name ?? '',
      worktreeOrBranch: worktree?.name ?? branch,
```
with:
```typescript
      worktreeName: worktree?.name ?? '',
      branchWT: formatBranch(branch),
```

Note: `branchWT` stores only the formatted branch name — identical to `branch`. The `[wt]` suffix is appended by the formatter during colorization, not here. This ensures `maxLength` truncation applies to the branch only.

- [ ] **Step 3: Commit**

```bash
git add packages/feature-statusline/src/statusline-service.ts
git commit -m "feat(statusline): compute branchWT in buildViewModel, remove worktreeOrBranch"
```

---

### Task 4: Update `formatter.ts` with split colorization

**Files:**
- Modify: `packages/feature-statusline/src/formatter.ts:204-265` (rawTokens map and colorizeToken)

- [ ] **Step 1: Update `rawTokens` map**

In `formatter.ts`, in the `rawTokens` object (line ~204):

1. Add after the `branch` entry (line 214):
```typescript
      branchWT: viewModel.branchWT,
```

2. Remove line 218:
```typescript
      worktreeOrBranch: viewModel.worktreeOrBranch,
```

- [ ] **Step 2: Update `colorizeToken` switch for `branchWT`**

In the `colorizeToken` function (line ~229), replace the branch/worktree cases:

Replace:
```typescript
        case 'branch':
        case 'worktreeOrBranch':
        case 'worktreeName':
          return this.colorize(value, branchColor)
```

With:
```typescript
        case 'branch':
        case 'worktreeName':
          return this.colorize(value, branchColor)
        case 'branchWT': {
          const coloredBranch = this.colorize(value, branchColor)
          if (!viewModel.worktreeName) return coloredBranch
          const wtColor = (this.theme.colors as Record<string, string>).worktreeIndicator ?? 'dim'
          return `${coloredBranch} ${this.colorize('[wt]', wtColor)}`
        }
```

This is the split colorization: the branch portion gets `branchColor`, the `[wt]` suffix gets the `worktreeIndicator` theme color (default `dim`). The `viewModel` is accessible from the closure scope of the `format()` method.

- [ ] **Step 3: Run tests — expect green**

Run: `pnpm --filter feature-statusline test`

Expected: All tests pass. The branchWT tests from Task 1 should now be green.

- [ ] **Step 4: Commit**

```bash
git add packages/feature-statusline/src/formatter.ts
git commit -m "feat(statusline): add branchWT split colorization, remove worktreeOrBranch"
```

---

### Task 5: Update YAML defaults and documentation

**Files:**
- Modify: `assets/sidekick/defaults/features/statusline.defaults.yaml`
- Modify: `docs/plans/2026-03-08-statusline-template-enhancements-design.md`
- Modify: `docs/plans/2026-03-08-statusline-template-enhancements.md`

- [ ] **Step 1: Update YAML defaults**

In `statusline.defaults.yaml`:

1. In the placeholder documentation comments (lines 26-33), replace:
```yaml
  #   {branch}                  - Git branch name (raw, use prefix for icon)
  ...
  #   {worktreeName}            - Worktree name (empty if not in worktree)
  #   {worktreeOrBranch}        - Worktree name if in worktree, else branch name
```
with:
```yaml
  #   {branch}                  - Git branch name (raw, no decoration)
  #   {branchWT}                - Branch name + [wt] indicator when in worktree
  #   {worktreeName}            - Worktree name (empty if not in worktree)
```

2. In the example configurations (lines 60-62), replace:
```yaml
  #   Worktree-aware: "{worktreeOrBranch,prefix=' ∗ '}"                → " ∗ my-worktree" or " ∗ main"
```
with:
```yaml
  #   Worktree-aware: "{branchWT,prefix=' | '}"                        → " | main" or " | feat/auth [wt]"
```

3. Remove the worktree badge example (line 62) since users can still compose with `{worktreeName}` directly.

4. Update the format string (line 64), replacing `{worktreeOrBranch,prefix=' ∗ ',maxLength=40}` with `{branchWT,prefix=' | ',maxLength=40}`.

5. In theme colors section (line 107+), add a comment:
```yaml
      # worktreeIndicator: dim  # Optional: color for [wt] suffix in branchWT (default: dim)
```

- [ ] **Step 2: Update docs/plans design doc**

In `docs/plans/2026-03-08-statusline-template-enhancements-design.md`, find line 71 with the `worktreeOrBranch` token row and replace with `branchWT`:
```markdown
| `{branchWT}` | Branch name + `[wt]` indicator when in worktree | `main` | `feat/auth [wt]` |
```

- [ ] **Step 3: Update docs/plans implementation plan**

In `docs/plans/2026-03-08-statusline-template-enhancements.md`, update references to `worktreeOrBranch` to reflect the removal. These are in historical commit messages and documentation sections — update the documentation sections, leave git commit message references as historical record.

- [ ] **Step 4: Commit**

```bash
git add assets/sidekick/defaults/features/statusline.defaults.yaml
git add docs/plans/2026-03-08-statusline-template-enhancements-design.md
git add docs/plans/2026-03-08-statusline-template-enhancements.md
git commit -m "docs(statusline): update defaults and docs for branchWT, remove worktreeOrBranch"
```

---

### Task 6: Build verification and final check

- [ ] **Step 1: Full build**

Run: `pnpm build`

Expected: Clean build, no errors.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`

Expected: No type errors.

- [ ] **Step 3: Lint**

Run: `pnpm lint`

Expected: No lint errors.

- [ ] **Step 4: Run all non-IPC tests**

Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Run: `pnpm --filter feature-statusline test`

Expected: All pass.

- [ ] **Step 5: Grep for stale references**

Run: `grep -r 'worktreeOrBranch' --include='*.ts' --include='*.yaml' --include='*.yml' packages/ assets/`

Expected: Zero matches.

- [ ] **Step 6: Final commit if any cleanup needed, then push**

```bash
git push origin HEAD
```
