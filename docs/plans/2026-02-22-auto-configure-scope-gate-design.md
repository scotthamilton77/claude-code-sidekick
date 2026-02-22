# Auto-Configure Scope Gate

## Problem

Auto-configure relies on the SessionStart hook firing in new projects. Hooks only fire if the plugin is installed at a scope covering that project. With project- or local-scoped plugin installation, the hooks.json is invisible to other projects, so auto-configure silently does nothing.

## Decision

Gate auto-configure on user-scoped plugin installation. Enforce at every entry point where auto-configure can be enabled.

## Changes

### 1. Setup Wizard (`runWizard`) — Step 6 conditional display

Track the plugin scope from earlier steps. If plugin scope is `user`, show Step 6 as-is. If `project` or `local`, skip Step 6, default to `manual`, print info message explaining why.

### 2. Scripted Mode (`runScripted`) — `--auto-config` validation

If `--auto-config=auto` with non-user plugin scope (explicit or detected): log warning, force `autoConfigureProjects: false`. Do not error out.

### 3. Doctor (`runDoctor`) — inconsistent state detection

If `autoConfigureProjects: true` in user status but plugin is project/local scope: flag as warning with suggested fix.

### 4. Docs — USER-GUIDE.md

Add note to auto-configure section: requires user-scoped plugin. Update scripted flags table.

### Out of Scope

- No changes to `SetupStatusService`, `hook-command.ts`, or `plugin-installer.ts`
- No retroactive migration (doctor handles detection)
- No runtime warning for manual `setup-status.json` edits
