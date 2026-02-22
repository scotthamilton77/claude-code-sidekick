# Shell Alias for Sidekick CLI

**Bead:** sidekick-amt0
**Date:** 2026-02-22
**Status:** Approved

## Problem

Users must type `npx @scotthamilton77/sidekick <command>` for CLI usage. This is verbose and unfriendly. A `sidekick` alias would let users type `sidekick doctor`, `sidekick persona list`, etc.

## Decision

Shell alias approach over `npm install -g` because:
- No permission issues (no sudo, no global node_modules)
- Works regardless of how Node.js was installed (nvm, volta, system)
- Plugin-first users never need to run npm install

Hooks remain `npx --yes @scotthamilton77/sidekick` — no hook changes in this feature.

## Design

### Alias Format

Comment-bracketed block for surgical add/remove:

```bash
# >>> sidekick alias >>>
alias sidekick='npx @scotthamilton77/sidekick'
# <<< sidekick alias <<<
```

### Setup Integration

During `sidekick setup`, after existing steps:

1. Detect shell from `$SHELL` env var
2. Check if marker block already exists in rc file
3. If not present, ask: "Add a `sidekick` shell alias? (y/n)"
4. If yes, append marker block to `~/.zshrc` (zsh) or `~/.bashrc` (bash)
5. Print: "Alias added to ~/.zshrc. Run `source ~/.zshrc` or open a new terminal to activate."

### Doctor Checks

Two-level detection:

1. **Config file check** — grep for `# >>> sidekick alias >>>` in rc file
2. **Active shell check** — `command -v sidekick` to detect if command resolves

Status outputs:
- `Shell alias: configured (active)` — marker in rc file AND command resolves
- `Shell alias: configured (inactive)` — marker present, command not found. Suggest sourcing rc file.
- `Shell alias: not configured` — no marker in rc file
- `Shell alias: not configured (sidekick available via other means)` — no marker but command resolves (global install or user-managed alias)

### Uninstall

`sidekick uninstall-alias` subcommand:

1. Read rc file, remove lines between (and including) `# >>> sidekick alias >>>` and `# <<< sidekick alias <<<`
2. Write file back
3. Print: "Alias removed. Run `unalias sidekick` or open a new terminal to deactivate."

Cannot `unalias` in parent shell from subprocess — user must do it manually or restart terminal.

### Scope

- **Supported shells:** zsh, bash
- **Out of scope:** fish, nushell, other shells
- **Out of scope:** Hook performance optimization (hooks stay as npx)
- **Out of scope:** npm global install mechanism
