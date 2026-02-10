# Uninstall Command Design

**Bead**: sidekick-9m4
**Date**: 2026-02-09

## Invocation

```
pnpm sidekick uninstall [--scope=user|project] [--force] [--dry-run]
```

- **No flags**: Auto-detect both scopes, interactive confirmation per artifact group
- **`--scope=user|project`**: Limit uninstall to one scope
- **`--force`**: Skip confirmation prompts (for scripting)
- **`--dry-run`**: Show what would be removed without acting

## Execution Order

1. **Detect & uninstall Claude Code plugin** — `claude plugin list --json` → find `sidekick@*` → `claude plugin uninstall sidekick --scope={scope}`
2. **Kill daemons** — kill project-local daemon (if running) + clean daemon registry entry in `~/.sidekick/daemons/`
3. **Remove hooks/statusline** — surgically remove sidekick entries from `settings.json` / `settings.local.json` (catches anything plugin uninstall missed, plus dev-mode entries)
4. **Remove config files** — `setup-status.json`, `features.yaml`
5. **Prompt about .env** — show masked key names, ask whether to delete (always delete if `--force`)
6. **Remove transient data** — `logs/`, `sessions/`, `state/`, sockets
7. **Clean gitignore** — remove the `# >>> sidekick` / `# <<< sidekick` section
8. **Report** — summary table of what was removed vs skipped vs not found

## Scope Detection

Auto-detect by checking for existence of:
- **User scope**: `~/.sidekick/setup-status.json` OR sidekick statusline in `~/.claude/settings.json` OR `sidekick@*` in `claude plugin list`
- **Project scope**: `.sidekick/setup-status.json` OR sidekick entries in `.claude/settings.local.json`

If `--scope` provided, only process that scope. Otherwise process both (with per-scope confirmation).

## Plugin Uninstall

The Claude Code plugin registers hooks via `hooks.json` managed by `claude plugin install`. The plugin ID follows the pattern `sidekick@{marketplace-name}` (e.g. `sidekick@claude-code-sidekick`).

Detection:
1. Run `claude plugin list --json`
2. Find entry where `id` starts with `sidekick@`
3. Note its `scope` (user or project)

Removal:
- `claude plugin uninstall sidekick --scope={scope}`
- Must happen before settings.json surgery — plugin uninstall may do its own hook cleanup

If `claude` CLI is not available, warn and skip (user running outside Claude Code context).

## Settings.json Surgery

### Statusline
Remove `statusLine` key only if its `command` string contains `sidekick`. Leave non-sidekick statuslines untouched.

### Hooks (dev-mode entries in settings.local.json)
- Remove hook entries whose `command` contains `sidekick` or `dev-sidekick`
- If a hook event has other non-sidekick hooks, keep those
- If after removal an event has no hooks left, remove the event key
- If `hooks` object is empty, remove it
- If the file is empty (`{}`), delete the file

## Artifacts by Scope

### User Scope (`~/.claude/`, `~/.sidekick/`)

| Artifact | Path | Action |
|----------|------|--------|
| Plugin | `claude plugin list` | `claude plugin uninstall` |
| Statusline | `~/.claude/settings.json` → `statusLine` | Surgical remove |
| Setup status | `~/.sidekick/setup-status.json` | Delete file |
| API keys | `~/.sidekick/.env` | Prompt, then delete |
| Feature config | `~/.sidekick/features.yaml` | Delete file |
| Daemon registry | `~/.sidekick/daemons/` | Delete directory |
| State | `~/.sidekick/state/` | Delete directory |

### Project Scope (`.claude/`, `.sidekick/`)

| Artifact | Path | Action |
|----------|------|--------|
| Statusline | `.claude/settings.local.json` → `statusLine` | Surgical remove |
| Hooks | `.claude/settings.local.json` → `hooks` | Surgical remove |
| Setup status | `.sidekick/setup-status.json` | Delete file |
| API keys | `.sidekick/.env` | Prompt, then delete |
| Daemon process | `.sidekick/sidekickd.pid` | Kill process, delete PID/token/lock |
| Transient data | `.sidekick/{logs,sessions,state}/` | Delete directories |
| Unix socket | `/tmp/sidekick-{hash}.sock` | Delete file |
| Gitignore section | `.gitignore` | Remove `>>> sidekick` block |

## File Changes

### New Files
- `packages/sidekick-cli/src/commands/uninstall.ts` — command handler
- `packages/sidekick-cli/src/commands/__tests__/uninstall.test.ts` — tests

### Modified Files
- `packages/sidekick-cli/src/cli.ts` — add `uninstall` command routing
- `packages/sidekick-cli/src/commands/setup/gitignore.ts` — add `removeGitignoreSection()` export

## Reused Services

- `SetupStatusService` — read setup status, devMode detection
- `DaemonClient` — daemon kill
- `getSocketPath()` / `getPidFilePath()` / `getTokenFilePath()` / `getLockFilePath()` from transport utils
- `gitignore.ts` — existing `installGitignoreSection()` pattern, new `removeGitignoreSection()`

## Not Building

- No backup/restore — run setup again to reinstall
- No partial uninstall within a scope — all or nothing per scope
- No npx cache cleanup — npm's responsibility
- No marketplace uninstall — only the plugin itself
