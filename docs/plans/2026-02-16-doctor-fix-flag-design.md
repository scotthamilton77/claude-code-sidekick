# Design: `--fix` flag for `sidekick doctor`

**Date**: 2026-02-16
**Bead**: sidekick-wh8d

## Problem

`sidekick doctor` reports configuration issues but cannot resolve them. Users must manually run `sidekick setup` to fix detected problems.

## Solution

Add a `--fix` flag to `sidekick doctor` that automatically resolves fixable issues using sensible defaults, without prompting.

## How it works

1. `sidekick doctor --fix` runs all normal doctor checks, displaying results as usual.
2. After checks complete, a `runDoctorFixes()` function examines results and applies targeted fixes for each unhealthy item.
3. After fixes, re-runs affected checks to confirm resolution and displays updated status.

### Fix actions per check

| Doctor finding | Fix action |
|---|---|
| `userSetupExists === false` | Run `setup --force` to create user setup status file with defaults |
| `statusline === 'none'` | Call `configureStatusline()` at user scope |
| `gitignore !== 'installed'` | Call `installGitignoreSection()` |
| `plugin === 'none'` | Call `ensurePluginInstalled()` with user scope, force mode |
| API key unhealthy | Skip (requires user input) -- print guidance |
| Plugin liveness inactive | Skip (resolved by restarting Claude Code) -- print guidance |

### Unfixable items

Print actionable advice instead of silently skipping:
- API key: "Run 'sidekick setup' to configure API keys interactively."
- Liveness: "Restart Claude Code to activate hooks: claude --continue"

## CLI changes

### Argument parsing

Add `fix` to the boolean CLI options in `cli.ts`. Pass `parsed.fix` through to the doctor command handler.

### Doctor command routing

In `cli.ts`, the `doctor` command block passes a new `fix` option:

```typescript
if (parsed.command === 'doctor') {
  const result = await handleSetupCommand(projectDir, runtime.logger, stdout, {
    checkOnly: true,
    fix: parsed.fix,
    only: parsed.only,
  })
}
```

### SetupCommandOptions

Add `fix?: boolean` to `SetupCommandOptions`.

### runDoctor changes

1. Accept `fix` in options.
2. After all checks and the overall summary, if `fix` is true and the system is unhealthy, call `runDoctorFixes()`.
3. `runDoctorFixes()` applies the targeted fixes listed above, then re-runs checks to verify.

### Unhealthy suggestion (without --fix)

When doctor runs without `--fix` and finds unhealthy items, the existing message changes from:

```
Run 'sidekick setup' to configure.
```

to:

```
Run 'sidekick doctor --fix' to auto-fix, or 'sidekick setup' to configure interactively.
```

## Combinable with `--only`

`sidekick doctor --fix --only=gitignore` fixes only gitignore. The `--only` filter applies to both the check phase and the fix phase.

## Exit code

- 0 if all issues resolved (or already healthy)
- 1 if any unfixable issues remain after fixes

## Non-goals

- No interactive prompting during `--fix`
- No attempt to fix API key issues (requires user-provided key)
- No attempt to fix liveness issues (requires Claude Code restart)
