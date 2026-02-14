# Setup Wizard: Automate Marketplace & Plugin Installation

**Date**: 2026-02-14
**Issue**: sidekick-easl
**Status**: Approved

## Problem

Users must manually run `claude plugin marketplace add` and `claude plugin install` commands before sidekick works. The setup wizard should automate this.

## Design

### New Module

`packages/sidekick-cli/src/commands/setup/plugin-installer.ts`

Handles marketplace and plugin detection, scope selection, and installation.

### Wizard Flow

Step 1 becomes plugin installation (existing steps renumber to 2-5):

1. **Marketplace scope** — user (default), project, local
2. **Marketplace detection & installation**
   - User scope: `claude plugin marketplace add github:scotthamilton77/claude-code-sidekick`
   - Project scope: Write `extraKnownMarketplaces` + `enabledPlugins` to `.claude/settings.json`
   - Local scope: Write same to `.claude/settings.local.json`
   - Detection: `claude plugin marketplace list --json` for user; parse settings files for project/local
3. **Plugin scope** — constrained to equal or narrower than marketplace scope
   - Marketplace=user → user/project/local allowed
   - Marketplace=project → project/local allowed
   - Marketplace=local → local only (auto-selected, no question)
4. **Plugin detection & installation** — `claude plugin install sidekick -s <scope>`

### Force Mode

Both default to user scope. No prompts.

### Scripted Mode

New CLI flags: `--marketplace-scope=user|project|local`, `--plugin-scope=user|project|local`

Validation rejects plugin scope broader than marketplace scope.

### Interface

```typescript
type InstallScope = 'user' | 'project' | 'local'

interface PluginInstallerResult {
  marketplaceScope: InstallScope
  pluginScope: InstallScope
  marketplaceAction: 'already-installed' | 'installed' | 'skipped' | 'failed'
  pluginAction: 'already-installed' | 'installed' | 'skipped' | 'failed'
  error?: string
}
```

### Settings JSON Structure (project/local marketplace)

```json
{
  "extraKnownMarketplaces": [
    {
      "name": "claude-code-sidekick",
      "source": "github:scotthamilton77/claude-code-sidekick"
    }
  ],
  "enabledPlugins": [
    "sidekick@claude-code-sidekick"
  ]
}
```

### Error Handling

- Claude CLI not found → manual instructions, non-fatal
- Marketplace/plugin install fails → show error, offer to continue
- Settings JSON write fails → show error with file path

### Files

- **New**: `plugin-installer.ts`, `plugin-installer.test.ts`
- **Edit**: `setup/index.ts` (call as Step 1, renumber), `cli.ts` (parse flags), `SetupCommandOptions` (new fields)
