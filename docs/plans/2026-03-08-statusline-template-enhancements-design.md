# Statusline Template Enhancements

**Issue**: sidekick-4nwc
**Date**: 2026-03-08
**Status**: Approved

## Problem

The statusline has three UX issues:

1. **Rigid truncation**: cwd is hardcoded to 20 chars with a naive algorithm that chops mid-word without indicating truncation. No truncation on branch at all.
2. **Poor worktree display**: In worktrees, cwd shows `.claude/worktrees/statusline-debug` — the project name is invisible.
3. **Session title color clash**: Title renders in the same color as `feat/*` branches (both blue).
4. **Line overflow**: Long statuslines get truncated or omitted entirely by Claude Code's terminal.

## Design

### New Placeholder Attributes (all tokens)

| Attribute | Type | Description |
|-----------|------|-------------|
| `maxLength` | number | Max visible character width (ANSI-stripped) |
| `truncateStyle` | `suffix\|prefix\|path` | How to truncate when exceeding maxLength. Default: `suffix` |
| `wrapAt` | number | Visible line width threshold for responsive wrapping |
| `wrapPrefix` | string | Prefix used instead of `prefix` when line would exceed `wrapAt` |
| `wrapSuffix` | string | Suffix used instead of `suffix` when line would exceed `wrapAt` |

Existing attributes (`prefix`, `suffix`) unchanged.

### Truncation Styles

**`suffix`** (default): Right-truncate with trailing ellipsis.
- `claude-code-sidekick` → `claude-code-sideki…` (maxLength=20)

**`prefix`**: Left-truncate with leading ellipsis.
- `~/src/projects/claude-code-sidekick` → `…ects/claude-code-sidekick` (maxLength=27)

**`path`**: Path-aware truncation in three steps:
1. If the untruncated string fits, use it as-is.
2. If there are only two path segments (`first/second`), left-truncate until it fits.
3. If 3+ segments: `first/…/last`. Left-truncate `first` if still too long.

Examples (maxLength=30):
- `claude-code-sidekick` → `claude-code-sidekick` (fits)
- `claude-code-sidekick/src` → `claude-code-sidekick/src` (fits)
- `claude-code-sidekick/packages/feature-statusline/src` → `claude-code-sidekick/…/src`

### Responsive Line Wrapping

The `wrapAt` attribute controls responsive prefix/suffix selection based on visible line width.

When a token has `wrapAt=N`, the formatter checks the visible character width of the current line (from start or last newline). If appending the token with its normal `prefix` would exceed `N` characters, `wrapPrefix` is used instead (and similarly `wrapSuffix` for suffix).

Example:
```
{title,wrapAt=80,prefix=' | ',wrapPrefix='\n'}
```
If the line is at 75 visible chars and the title is 10 chars, `' | '` + title = 88 → exceeds 80 → use `'\n'` prefix instead.

### Line Width Measurement

All width calculations (maxLength, wrapAt) strip ANSI escape codes and measure visible characters only.

### New Tokens

| Token | Value | Normal Session | Worktree Session |
|-------|-------|----------------|-------------------|
| `{projectDirShort}` | Basename of project root | `claude-code-sidekick` | `claude-code-sidekick` |
| `{projectDirFull}` | Home-shortened project root | `~/src/projects/claude-code-sidekick` | `~/src/projects/claude-code-sidekick` |
| `{worktreeName}` | Worktree name or empty | *(empty)* | `statusline-debug` |
| `{worktreeOrBranch}` | Worktree name if in worktree, else branch name (raw) | `main` | `statusline-debug` |

Project root derivation: `worktree.original_cwd` when in a worktree, else `workspace.project_dir` from hook input.

### Changed Tokens

- **`{branch}`**: Now raw value (no icon). Use `{branch,prefix='∗ '}` to add icon via template.
- **`{cwd}`**: Now full home-shortened path. Use `{cwd,maxLength=40,truncateStyle=path}` for truncation.

### Session Title Color

Default `colors.title` changes from `blue` to `cyan` — distinct from all branch pattern colors (green, blue, red, magenta).

### Default Format String

```
{personaName,prefix='[',suffix='] | '}{model,prefix='[',suffix='] | '}{contextBar} {tokenPercentageActual} | {logs} | {cwd,maxLength=40,truncateStyle=path}{branch,prefix=' ∗ ',maxLength=40} | {title,wrapAt=80,prefix=' | ',wrapPrefix='\n'}\n{summary}
```

### Data Sources

Investigation of Claude Code hook input in worktree context revealed:

- `cwd`: Points to worktree directory (e.g. `.../.claude/worktrees/statusline-debug`)
- `workspace.project_dir`: Same as cwd in worktrees
- `CLAUDE_PROJECT_DIR` (env var / `--project-dir` flag): Original repo root
- `worktree` object (present only in worktrees):
  - `name`: Worktree name
  - `path`: Full worktree path
  - `branch`: Worktree branch name
  - `original_cwd`: Original repo root
  - `original_branch`: Branch the worktree was created from

### Files Affected

- `packages/feature-statusline/src/formatter.ts` — Template parsing, truncation logic, new tokens
- `packages/feature-statusline/src/types.ts` — Config schema, view model types, defaults
- `packages/feature-statusline/src/statusline-service.ts` — Pass worktree data to formatter, build new token values
- `packages/sidekick-cli/src/commands/statusline.ts` — Pass worktree data from hook input
- `assets/sidekick/defaults/features/statusline.defaults.yaml` — Updated default format string and token docs
- `packages/feature-statusline/src/__tests__/statusline.test.ts` — Tests for all new behavior
