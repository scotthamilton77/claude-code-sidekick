# Setup Dev-Mode Scope Filter

**Bead**: sidekick-993d
**Date**: 2026-02-14
**Status**: Approved

## Problem

When dev-mode is enabled, running `sidekick setup` with project or local scope creates conflicting hooks and statusline configurations. Dev-mode already manages hooks at the project level via `settings.local.json`, so setup should not install competing configuration at the same scope.

## Decision

**Approach A: Early detection + scope filtering.**

Check `getDevMode()` once at the top of `handleSetupCommand`, thread the boolean through to wizard, scripted, and force modes. Each mode restricts scope options to `user` only when dev-mode is active.

## Design

### Detection

```typescript
// At top of handleSetupCommand, before dispatch
const setupService = new SetupStatusService(projectDir, { homeDir, logger })
const isDevMode = await setupService.getDevMode()
```

### Interactive Wizard

1. Show banner after wizard header: "Dev-mode is active - only user-scope available for plugin and statusline."
2. Step 1 (Plugin): Pass `isDevMode` to `ensurePluginInstalled`. Auto-select `user` scope, skip scope prompts.
3. Step 2 (Statusline): Auto-select `user` scope, skip scope prompt. Existing `configureStatusline` guard handles the rest.
4. Steps 3-5: Unchanged.

### Scripted Mode

Reject `--marketplace-scope`, `--plugin-scope`, `--statusline-scope` when set to `project` or `local` during dev-mode. Exit code 1 with clear error message.

### Force Mode

Override scope to `user` when dev-mode is active.

### Data Flow

```
handleSetupCommand(projectDir, logger, stdout, options)
  isDevMode = setupService.getDevMode()
  if doctor  -> runDoctor (unchanged)
  if scripted -> runScripted(..., isDevMode)
  else       -> runWizard(..., isDevMode)
```

### Files Changed

- `packages/sidekick-cli/src/commands/setup/index.ts` - Main setup command
- `packages/sidekick-cli/src/commands/setup/plugin-installer.ts` - Add `isDevMode` param to `ensurePluginInstalled`
- `packages/sidekick-cli/src/commands/setup/__tests__/` - Tests for dev-mode scope filtering

### Testing

- Wizard auto-selects user scope when dev-mode active
- Scripted rejects project/local scope flags with exit code 1
- Force mode overrides to user scope
- Steps 3-5 unaffected by dev-mode
- Doctor mode unaffected by dev-mode
