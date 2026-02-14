# Dev-Mode Setup Bootstrap & Uninstall Guard

**Date:** 2026-02-14
**Beads:** sidekick-7r8g, sidekick-xg58
**Approach:** Inline changes to existing command handlers

## Problem

Dev-mode enable requires a separate `pnpm sidekick setup` step before hooks and statusline work. Uninstall blindly deletes dev-mode-managed files, breaking the dev environment.

## Design Decisions

- **API key detection:** Reuse doctor's `detectAllApiKeys()` rather than hardcoding statuses
- **Disable safety:** Check for active plugin before removing gitignore on dev-mode disable
- **Uninstall statusline:** Leave dev-mode's settings.local.json statusline untouched when dev-mode is active

## Feature 1: Dev-Mode Enable Bootstrap (sidekick-7r8g)

### Enable (`doEnable()`)

Before hook registration, add:

1. Call `installGitignoreSection(projectDir)` — idempotent, logs result
2. Create/update setup-status.json:
   - If missing: `{ version: 1, statusline: 'local', devMode: true, autoConfigured: false }`
   - If exists: set `devMode: true`, `statusline: 'local'`
   - Run `detectAllApiKeys()` for each provider key to populate actual statuses
   - Set `gitignore: 'installed'`

### Disable (`doDisable()`)

After existing hook removal:

1. Call `detectPluginInstallation()` to check for active plugin
2. If plugin detected: log skip message, leave gitignore
3. If no plugin: call `removeGitignoreSection(projectDir)`
4. Existing `setDevMode(false)` stays

## Feature 2: Uninstall Dev-Mode Guard (sidekick-xg58)

### Detection

Read `getProjectStatus()?.devMode === true` early in uninstall flow.

### When dev-mode active, SKIP:

- `.sidekick/setup-status.json` deletion (log: "managed by dev-mode")
- Gitignore section removal (log: "managed by dev-mode")
- Settings.local.json statusline removal (dev-mode owns it)

### When dev-mode active, ALLOW:

- User-scope cleanup (`~/.sidekick/setup-status.json`, user settings)
- Plugin uninstall (user/project scope entries)
- Daemon kill
- Transient data removal (logs, sessions, state)
- `.env` file handling (prompt as usual)

### Non-dev-mode

Completely unchanged.

## Testing

- Unit tests for enable: gitignore installed, setup-status created with correct fields, API key detection runs
- Unit tests for disable: plugin detection check, conditional gitignore removal
- Unit tests for uninstall: dev-mode guard skips correct operations, allows others, non-dev-mode path unchanged

## Files Modified

- `packages/sidekick-cli/src/commands/dev-mode.ts` — enable/disable changes
- `packages/sidekick-cli/src/commands/uninstall.ts` — dev-mode guard
- `packages/sidekick-cli/src/commands/dev-mode.test.ts` — new tests
- `packages/sidekick-cli/src/commands/uninstall.test.ts` — new tests
