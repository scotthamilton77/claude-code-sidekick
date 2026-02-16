# Bash File-Change Detection via Daemon-Side Git Status Diffing

**Bead:** sidekick-kqu
**Date:** 2026-02-16

## Problem

The verify-completion (VC) staging handler detects source code modifications by watching for `Write`, `Edit`, and `MultiEdit` tool calls. When the agent uses `Bash` to modify files (`rm`, `mv`, `sed -i`, `echo >`, git operations, etc.), VC never stages and the verification reminder never fires.

## Solution

Detect source code modifications made via Bash by diffing `git status` snapshots. All logic is daemon-side: a UserPromptSubmit hook handler captures the git baseline, a ToolResult transcript handler compares after Bash execution.

**Key insight:** The CLI already relays all hook events to the daemon via `hook.invoke` IPC (`packages/sidekick-cli/src/commands/hook.ts:360`). No new IPC endpoints or CLI changes needed.

## Components

### 1. Shared utility: `getGitFileStatus`

New utility in `packages/sidekick-core/src/git-status.ts`:

```typescript
export async function getGitFileStatus(cwd: string, timeoutMs?: number): Promise<string[]>
```

Returns parsed file paths from `git status --porcelain`. Handles timeout, not-a-repo, and git-not-found gracefully by returning `[]`.

### 2. Daemon handler: `stage-stop-bash-changes.ts`

Single registration function with two handlers sharing closure state:

**Handler A: UserPromptSubmit hook handler (baseline capture)**
- Pattern: same as `unstage-verify-completion.ts` (daemon-side hook handler)
- On UserPromptSubmit: run `getGitFileStatus`, store baseline in closure `Map<sessionId, string[]>`

**Handler B: ToolResult transcript staging handler (Bash detection)**
- Pattern: `createStagingHandler` with `{ kind: 'transcript', eventTypes: ['ToolResult'] }`
- On Bash ToolResult: if VC not staged -> run `getGitFileStatus` -> diff against baseline -> filter through `source_code_patterns` via picomatch -> stage VC if matches found
- Includes same once-per-turn reactivation check as `stage-stop-reminders.ts`

### Git status parsing

`git status --porcelain` outputs lines like:

```
 M src/foo.ts
?? src/new-file.ts
A  src/staged.ts
D  src/deleted.ts
R  old.ts -> new.ts
```

Parse: strip the 2-char status prefix + space, extract file path. For renames (`R  old -> new`), take the new path. Diff = paths in current but not in baseline.

## Edge cases

| Scenario | Behavior |
|----------|----------|
| Git unavailable / not a repo | `getGitFileStatus` returns `[]`, no staging, logged once |
| Timeout (>200ms) | Returns `[]`, skips this check, retries on next Bash |
| No baseline yet (daemon restart mid-turn) | No baseline = no diff, skip. Next UserPromptSubmit restores it |
| Bash doesn't modify files | git status matches baseline, no staging |
| Write/Edit already staged VC | Early exit before git call (factory idempotency) |
| Files in .gitignore | Not in git status output, correctly ignored |

## File changes

| File | Change |
|------|--------|
| `packages/sidekick-core/src/git-status.ts` | New -- `getGitFileStatus()` utility |
| `packages/sidekick-core/src/__tests__/git-status.test.ts` | New -- unit tests |
| `packages/sidekick-core/src/index.ts` | Modify -- export new utility |
| `packages/feature-reminders/src/handlers/staging/stage-stop-bash-changes.ts` | New -- both handlers |
| `packages/feature-reminders/src/handlers/staging/index.ts` | Modify -- register new handler |
| `packages/feature-reminders/src/__tests__/staging-handlers.test.ts` | Modify -- add tests |
