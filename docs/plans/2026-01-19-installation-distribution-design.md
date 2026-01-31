# Installation & Distribution Design

**Date:** 2026-01-19
**Status:** Draft
**Phase:** 11 (Installation & Distribution Hardening)

## Overview

This document describes the installation and distribution architecture for Sidekick, covering:
- npm package distribution
- Claude Code plugin integration
- Dev-mode for local development
- Conflict resolution between installations

## Goals

1. Simple installation via Claude Code plugin system
2. npm package for CLI access and programmatic use
3. Clean dev-mode that doesn't conflict with production installs
4. No dual-execution when multiple installations exist

## Architecture

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| npm package | `@scotthamilton77/sidekick` on npm | Bundled CLI binary, hook execution, daemon, config |
| Distribution bundle | `packages/sidekick-dist/` | esbuild bundle of all packages for npm publishing |
| Claude Code plugin | `packages/sidekick-plugin/` | hooks.json, skills, invokes CLI via npx |
| Dev hooks | `scripts/dev-sidekick/` | Development-only hook wrappers |

### Distribution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Installation                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Option A: Plugin (recommended)                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  /plugin install sidekick                                 │   │
│  │       ↓                                                   │   │
│  │  Plugin enabled at user or project scope                  │   │
│  │       ↓                                                   │   │
│  │  Hooks invoke: npx @scotthamilton77/sidekick hook <name> │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Option B: Direct npm (advanced users)                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  npm i -g @scotthamilton77/sidekick                       │   │
│  │       ↓                                                   │
│  │  CLI available globally                                   │   │
│  │       ↓                                                   │
│  │  User configures hooks manually in settings.json          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Plugin Structure

```
packages/sidekick-plugin/
├── .claude-plugin/
│   └── plugin.json              # Plugin metadata
├── hooks/
│   └── hooks.json               # Hook registrations
├── skills/
│   └── sidekick-config/
│       └── SKILL.md             # Configuration skill
└── README.md                    # User documentation
```

### plugin.json

```json
{
  "name": "sidekick",
  "version": "1.0.0",
  "description": "AI pair programming assistant with personas, session tracking, and smart prompts",
  "author": {
    "name": "Scott Hamilton"
  },
  "repository": "https://github.com/scotthamilton77/claude-config",
  "license": "MIT",
  "keywords": ["claude", "hooks", "personas", "productivity"]
}
```

### hooks.json

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{ "type": "command", "command": "npx @scotthamilton77/sidekick hook session-start --project-dir=$CLAUDE_PROJECT_DIR" }]
    }],
    "SessionEnd": [{
      "hooks": [{ "type": "command", "command": "npx @scotthamilton77/sidekick hook session-end --project-dir=$CLAUDE_PROJECT_DIR" }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{ "type": "command", "command": "npx @scotthamilton77/sidekick hook user-prompt-submit --project-dir=$CLAUDE_PROJECT_DIR" }]
    }],
    "PreToolUse": [{
      "hooks": [{ "type": "command", "command": "npx @scotthamilton77/sidekick hook pre-tool-use --project-dir=$CLAUDE_PROJECT_DIR" }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "npx @scotthamilton77/sidekick hook post-tool-use --project-dir=$CLAUDE_PROJECT_DIR" }]
    }],
    "Stop": [{
      "hooks": [{ "type": "command", "command": "npx @scotthamilton77/sidekick hook stop --project-dir=$CLAUDE_PROJECT_DIR" }]
    }],
    "PreCompact": [{
      "hooks": [{ "type": "command", "command": "npx @scotthamilton77/sidekick hook pre-compact --project-dir=$CLAUDE_PROJECT_DIR" }]
    }]
  },
  "statusLine": {
    "type": "command",
    "command": "npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR"
  }
}
```

## CLI Hook Command

New command: `sidekick hook <hook-name>`

### Responsibilities

1. Accept Claude Code hook input via stdin (JSON)
2. Execute hook logic (existing implementation)
3. Translate internal `HookResponse` to Claude Code's expected output format
4. Output Claude Code-compatible JSON to stdout

### Implementation

Replaces the bash+jq translation layer in current dev-sidekick:

```typescript
// packages/sidekick-cli/src/commands/hook.ts

export async function handleHookCommand(
  hookName: string,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream
): Promise<void> {
  // 1. Read Claude Code input from stdin
  const input = await readStdin(stdin)

  // 2. Execute hook logic (existing handlers)
  const internalResponse = await executeHook(hookName, input)

  // 3. Translate to Claude Code format
  const claudeResponse = translateToClaudeFormat(hookName, internalResponse)

  // 4. Output
  stdout.write(JSON.stringify(claudeResponse))
}
```

### Format Translation

| Internal Field | Claude Code Field |
|----------------|-------------------|
| `blocking: true` | `continue: false` (SessionStart) or `decision: "block"` (others) |
| `reason` | `stopReason` or `reason` |
| `userMessage` | `systemMessage` |
| `additionalContext` | `hookSpecificOutput.additionalContext` |

## Runtime Behavior

### No Scope at Runtime

Hooks do not need a `--scope` flag. At runtime:

1. Hook receives `$CLAUDE_PROJECT_DIR` from Claude Code
2. Uses `.sidekick/` under project dir for:
   - Daemon (PID, socket, token)
   - Session state
   - Logs
3. Reads config via cascade:
   - Bundled defaults (in npm package)
   - `~/.sidekick/*.yaml` (user overrides)
   - `.sidekick/*.yaml` (project overrides)

### Config Cascade

```
┌─────────────────────────────────────────┐
│  .sidekick/*.yaml (project)             │  ← Highest priority
├─────────────────────────────────────────┤
│  ~/.sidekick/*.yaml (user)              │
├─────────────────────────────────────────┤
│  Bundled defaults (npm package)         │  ← Lowest priority
└─────────────────────────────────────────┘
```

## Dev-Mode

Dev-mode is **separate from the plugin system**. It's used only for local development of sidekick itself.

### Current Behavior (preserved)

- Registers hooks in `.claude/settings.local.json`
- Hooks point to `$CLAUDE_PROJECT_DIR/scripts/dev-sidekick/*`
- Dev-hooks invoke locally-built CLI: `node packages/sidekick-cli/dist/bin.js`

### Enhanced: User Plugin Conflict Resolution

When dev-mode detects a user-scope sidekick plugin:

```
$ pnpm sidekick dev-mode enable

[WARN] Sidekick plugin detected at user scope.
       Running both may cause duplicate hook execution.

Disable user-scope sidekick plugin? [y/N]: y

[INFO] User plugin disabled. Will prompt to re-enable on dev-mode disable.
[INFO] Dev-mode hooks enabled in .claude/settings.local.json
```

On disable:

```
$ pnpm sidekick dev-mode disable

[INFO] Dev-mode hooks removed.
[INFO] User-scope sidekick plugin was previously disabled.

Re-enable user-scope sidekick plugin? [Y/n]: y

[INFO] User plugin re-enabled.
```

### Implementation

```typescript
// In dev-mode enable:
async function checkUserPlugin(): Promise<boolean> {
  // Check ~/.claude/settings.json for enabled sidekick plugin
  // Return true if found
}

async function disableUserPlugin(): Promise<void> {
  // Use Claude Code's plugin disable mechanism
  // Or modify settings.json to disable the plugin
  // Store marker so we know to prompt on disable
}
```

## Installation Scenarios

### Scenario 1: New User (Plugin)

```bash
# In Claude Code session:
/plugin install sidekick
/plugin enable sidekick --user

# Sidekick now active for all projects
```

### Scenario 2: Project-Specific

```bash
# In Claude Code session:
/plugin install sidekick
/plugin enable sidekick --project

# Sidekick active only for this project
```

### Scenario 3: Developer Contributing to Sidekick

```bash
# Clone repo
git clone https://github.com/scotthamilton77/claude-config
cd claude-config

# Build
pnpm install && pnpm build

# Enable dev-mode (will prompt about user plugin if present)
pnpm sidekick dev-mode enable

# Restart Claude Code
claude --continue
```

### Scenario 4: Advanced User (Manual Hooks)

```bash
# Install CLI globally
npm i -g @scotthamilton77/sidekick

# Manually add to ~/.claude/settings.json:
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{ "type": "command", "command": "sidekick hook session-start" }]
    }]
    // ... other hooks
  }
}
```

## Legacy Cleanup

The legacy bash implementation is deleted as part of this work. No backward compatibility or migration tooling required.

### Files to Delete

- `scripts/install.sh` — Legacy installer
- `scripts/uninstall.sh` — Legacy uninstaller
- `src/sidekick/` — Legacy bash implementation
- Any `.conf` file support — Only YAML config cascade is supported

## Future Work

### Multi-Installation Coordination (claude-config-26h)

When sidekick is installed at multiple scopes (user + project plugin, or plugin + manual hooks), hooks execute multiple times. Future solution:
- First hook sets environment marker
- Subsequent hooks detect marker and skip
- Single execution per hook event

### CLI Customization Tools (claude-config-w40)

Deterministic CLI commands to complement sidekick-config skill:
- `sidekick config show <domain>`
- `sidekick persona copy <id> [--user|--project]`
- `sidekick prompt copy <name> [--user|--project]`

## Implementation Tasks

### Phase 11.1: Installer Implementation (revised)

- [ ] Create `packages/sidekick-plugin/` structure
- [ ] Implement `sidekick hook` command with format translation
- [ ] Update dev-mode to detect/disable user plugin
- [ ] Test plugin with `claude --plugin-dir ./packages/sidekick-plugin`

### Phase 11.3: Distribution

- [ ] Configure npm package publishing for `@scotthamilton77/sidekick`
- [ ] Submit plugin to Claude Code marketplace (or document manual install)
- [ ] Update README with installation instructions

### Deprecation

- [ ] Mark `scripts/install.sh` as deprecated
- [ ] Mark `src/sidekick/` (legacy bash) as deprecated
- [ ] Document migration path
