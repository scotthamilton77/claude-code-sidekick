# Statusline Branch/Worktree Visual Distinction

**Issue:** claude-code-sidekick-1k3
**Date:** 2026-03-22

## Problem

The statusline does not visually distinguish between branch and worktree contexts. Users cannot tell at a glance whether they are in a worktree session.

## Design

### 1. New `branchWT` token

A new template token `{branchWT}` renders the branch name with a conditional worktree indicator:

- **In worktree:** `feat/auth [wt]` — branch name in pattern-based color, `[wt]` suffix in dim/gray
- **Not in worktree:** `feat/auth` — identical to `{branch}`

The `[wt]` suffix uses a new theme color `worktreeIndicator` (default: `dim`), visually distinct from the branch color.

### 2. Remove `worktreeOrBranch` token

The `{worktreeOrBranch}` token is removed entirely. Users who want worktree-aware display compose from `{branch}`, `{branchWT}`, and `{worktreeName}` directly.

### 3. Default format update

The default format template changes:
- **Before:** `{branch,prefix=' ∗ ',maxLength=40}` (types.ts) / `{worktreeOrBranch,prefix=' ∗ ',maxLength=40}` (YAML)
- **After:** `{branchWT,prefix=' | ',maxLength=40}` (both)

The asterisk prefix is replaced with a pipe for consistency with other statusline separators. Both the `DEFAULT_STATUSLINE_CONFIG` test fixture (types.ts) and the production YAML default are updated to the same token.

## Files Impacted

| File | Changes |
|---|---|
| `packages/feature-statusline/src/types.ts` | Add `branchWT` to `StatuslineViewModel`. Remove `worktreeOrBranch`. Update `DEFAULT_STATUSLINE_CONFIG` format string. |
| `packages/feature-statusline/src/statusline-service.ts` | Compute `branchWT` in `buildViewModel()`. Remove `worktreeOrBranch` assignment. Update `EMPTY_STATUSLINE_VIEWMODEL` constant. |
| `packages/feature-statusline/src/formatter.ts` | Add `branchWT` to `rawTokens` map with split colorization. Remove `worktreeOrBranch` from token map and colorize switch. |
| `assets/sidekick/defaults/features/statusline.defaults.yaml` | Update format string and placeholder documentation. Remove `worktreeOrBranch` references. Add `branchWT` documentation. Add `worktreeIndicator` color example. |
| `docs/plans/2026-03-08-statusline-template-enhancements-design.md` | Remove `worktreeOrBranch` references. |
| `docs/plans/2026-03-08-statusline-template-enhancements.md` | Remove `worktreeOrBranch` references. |
| Tests | Update all references to `worktreeOrBranch`. Add test cases for `branchWT` in both worktree and non-worktree contexts. |

## Behavior Matrix

| Context | `{branch}` | `{branchWT}` | `{worktreeName}` |
|---|---|---|---|
| Normal repo on `main` | `main` (green) | `main` (green) | *(empty)* |
| Normal repo on `feat/auth` | `feat/auth` (blue) | `feat/auth` (blue) | *(empty)* |
| Worktree on `feat/auth` | `feat/auth` (blue) | `feat/auth` (blue) `[wt]` (dim) | worktree name |
| No git repo | *(empty)* | *(empty)* | *(empty)* |
| Detached HEAD in worktree | `a1b2c3d` (magenta) | `a1b2c3d` (magenta) `[wt]` (dim) | worktree name |
| Worktree with empty name | branch (colored) | branch (colored) — no `[wt]` | *(empty)* |

The `[wt]` suffix is appended only when `viewModel.worktreeName` is a non-empty string.

## Colorization Detail

The `branchWT` token requires split colorization — a single token rendered with two different colors. This follows the precedent set by `contextBar`, which already pre-formats multi-color output.

**Implementation approach:** Store only the branch name in `rawTokens['branchWT']` (identical to `rawTokens['branch']`). In `colorizeToken`, for the `branchWT` case, colorize the branch value with `branchColor`, then conditionally append ` [wt]` colorized with `worktreeIndicator` color. The `colorizeToken` closure already has access to `viewModel` and can check `viewModel.worktreeName`.

This approach means:
1. **Truncation applies to the branch name only** — `maxLength=40` truncates the branch, then `[wt]` is appended unconditionally. The `[wt]` indicator is never clipped.
2. **No parsing required** — the colorizer knows the raw value is just the branch; it appends the suffix itself.
3. Branch name portion: uses `theme.colors.branch` override if set, otherwise pattern-based `branchColor`
4. `[wt]` suffix: uses `theme.colors.worktreeIndicator`, default `dim`

### `worktreeIndicator` theme color

Follows the same pattern as `persona` — accessed via cast (`this.theme.colors as Record<string, string>`) rather than a Zod schema entry. This is consistent with other optional, non-critical theme colors and avoids a schema migration.

## Acceptance Criteria

- Build passes
- Typecheck passes
- Tests pass
- `{branchWT}` renders branch-only when not in worktree
- `{branchWT}` renders branch + dim `[wt]` when in worktree
- `{branchWT}` truncation applies to branch portion only; `[wt]` is never clipped
- `{worktreeOrBranch}` is fully removed (no references in code or docs)
- Default format uses `{branchWT,prefix=' | '}` instead of the previous branch/worktreeOrBranch token
