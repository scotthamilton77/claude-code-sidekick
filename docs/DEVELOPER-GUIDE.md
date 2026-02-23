# Sidekick Developer Guide

Practical reference for developing, testing, and extending the Sidekick monorepo.

For the executive architectural overview, see [ARCHITECTURE.md](./ARCHITECTURE.md). For detailed design documents, see [docs/design/](./design/).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Getting Started](#getting-started)
3. [Package Dependency Graph](#package-dependency-graph)
4. [How Hooks Work](#how-hooks-work)
5. [Development Workflow](#development-workflow)
6. [Testing Strategy](#testing-strategy)
7. [Configuration System](#configuration-system)
8. [Cross-Package Conventions](#cross-package-conventions)
9. [Adding a New Package](#adding-a-new-package)
10. [Distribution and Publishing](#distribution-and-publishing)

---

## Architecture Overview

Sidekick is a **Claude Code hooks companion** that enhances Claude Code sessions with session tracking, reminders, personas, and a status line. It is implemented as a **pnpm monorepo** of TypeScript packages under `packages/`.

### Packages and Their Roles

| Package | Scope Name | Role |
|---------|-----------|------|
| `types` | `@sidekick/types` | Shared TypeScript types and Zod schemas. Zero runtime dependencies beyond Zod. Leaf node in the dependency graph. |
| `sidekick-core` | `@sidekick/core` | Core runtime library: config cascade, transcript service, structured logging (pino), scope resolution, asset resolver, IPC client. |
| `shared-providers` | `@sidekick/shared-providers` | LLM provider abstractions (OpenRouter, OpenAI) with retry logic and fallback chains. |
| `testing-fixtures` | `@sidekick/testing-fixtures` | Shared test infrastructure: mock factories (`MockLLMService`, `MockHandlerRegistry`, etc.), event builders, and test harnesses. |
| `feature-reminders` | `@sidekick/feature-reminders` | Reminder staging, consumption, and cross-reminder coordination via `ReminderOrchestrator`. |
| `feature-session-summary` | `@sidekick/feature-session-summary` | LLM-based conversation analysis, persona selection, snarky/resume message generation. |
| `feature-statusline` | `@sidekick/feature-statusline` | Token tracking, context bar, git branch display, persona indicator. |
| `sidekick-daemon` | `@sidekick/daemon` | Background Node.js process for async work: LLM calls, transcript analysis, state management. Communicates via IPC (Unix domain sockets). |
| `sidekick-cli` | `@sidekick/cli` | CLI entrypoint and hook dispatcher. Synchronous responses to Claude Code, reads staged files from the daemon. |
| `sidekick-dist` | `@scotthamilton77/sidekick` | esbuild bundle for npm distribution. The published package that `npx` invokes. |
| `sidekick-plugin` | (not on npm) | Claude Code plugin definition: `hooks.json`, skills, and `plugin.json`. |
| `sidekick-ui` | `@sidekick/ui` | React SPA monitoring UI for time-travel debugging (Vite + Tailwind). |

### High-Level Data Flow

```
Claude Code
    |
    | (hook events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, etc.)
    v
sidekick-cli  ----IPC (fire-and-forget)----> sidekick-daemon
    |                                              |
    | reads staged files                           | writes staged files
    | (sync response to Claude Code)               | (async LLM calls, transcript analysis)
    v                                              v
.sidekick/sessions/{id}/stage/              .sidekick/sessions/{id}/state/
```

---

## Getting Started

### Prerequisites

| Tool | Version | Install (macOS) |
|------|---------|-----------------|
| Homebrew | Latest | [brew.sh](https://brew.sh) (macOS built-in, Linux: linuxbrew) |
| Node.js | >=20.x | `brew install node` |
| pnpm | 9.12.2 | `corepack enable && corepack prepare pnpm@9.12.2 --activate` |
| Git | >=2.x | `brew install git` |
| Claude Code CLI | Latest | [Install guide](https://docs.claude.com/en/docs/claude-code) |
| beads (`bd`) | Latest | `brew install beads` — issue tracking for multi-session work |

### Claude Code Plugins

The development workflow requires several Claude Code plugins. Install them from the marketplace:

```bash
# Official plugins (code review, code simplifier, context7, etc.)
claude plugin marketplace add https://github.com/anthropics/claude-plugins-official.git
claude plugin install code-review@claude-plugins-official
claude plugin install code-simplifier@claude-plugins-official
claude plugin install context7@claude-plugins-official
claude plugin install superpowers@claude-plugins-official

# Beads issue tracking plugin
claude plugin marketplace add steveyegge/beads
claude plugin install beads
```

> **Tip**: The [devcontainer](#dev-container-recommended) installs all of the above automatically — it's the fastest path to a working environment.

### Clone and Build

```bash
git clone https://github.com/scotthamilton77/claude-code-sidekick.git
cd claude-code-sidekick
pnpm install
pnpm build
```

### Verify the Build

```bash
pnpm typecheck   # Type-check all packages (including test files)
pnpm test        # Run all unit tests (mocked LLM, zero API costs)
pnpm lint        # ESLint all packages
```

### Dev Container (Recommended)

A `.devcontainer/` configuration is provided for VS Code Remote Containers / GitHub Codespaces. It's the recommended path for new contributors — everything is installed automatically via `post-create.sh`:

- **Homebrew** (package manager)
- **agents-config** (optional — maintainer's Claude Code skills and personas)
- **beads** (`bd` CLI for issue tracking)
- **Claude Code plugins**: code-review, code-simplifier, context7, frontend-design, playwright, superpowers, typescript-lsp (from `claude-plugins-official`), and beads (from `steveyegge/beads`)
- **pnpm** and project dependencies

API keys are forwarded from host environment variables.

---

## Package Dependency Graph

Arrows point from **dependent** to **dependency** (i.e., "depends on"):

```
@sidekick/types                         (leaf -- zero workspace deps)
       ^
       |
@sidekick/shared-providers              (depends on: types)
       ^
       |
@sidekick/core                          (depends on: types, shared-providers)
       ^
       |
@sidekick/testing-fixtures              (depends on: types; devDep on core)
       ^
       |
  +----+----+----------------------------+
  |         |                            |
feature-    feature-session-summary      feature-statusline
reminders   (types, core,               (types, core,
(types,      shared-providers)           feature-session-summary)
 core)       |
             |
  +----------+---+
  |               |
@sidekick/daemon                        (core, types, shared-providers,
  ^                                      feature-reminders, feature-session-summary)
  |
@sidekick/cli                           (core, types, feature-reminders,
  ^                                      feature-statusline)
  |
@scotthamilton77/sidekick (sidekick-dist)
  (esbuild bundle of cli -- published to npm)
```

**Import order rule**: `@sidekick/types` -> `@sidekick/core` -> feature packages. This prevents circular dependencies.

All runtime packages use **CommonJS output** (`"type": "commonjs"`) for Claude Code hook compatibility. The exception is `sidekick-ui`, which uses ESM (`"type": "module"`) as a Vite-based React SPA.

---

## How Hooks Work

### The Plugin System

Claude Code's hook system allows external commands to run at specific conversation lifecycle events. Sidekick registers hooks via a `hooks.json` file in the plugin package (`packages/sidekick-plugin/hooks/hooks.json`).

Each hook entry invokes the Sidekick CLI:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{ "type": "command", "command": "npx @scotthamilton77/sidekick hook session-start --project-dir=$CLAUDE_PROJECT_DIR" }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{ "type": "command", "command": "npx @scotthamilton77/sidekick hook user-prompt-submit --project-dir=$CLAUDE_PROJECT_DIR" }]
    }]
  },
  "statusLine": {
    "type": "command",
    "command": "npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR"
  }
}
```

### Hook Lifecycle Events

| Event | When It Fires | Sidekick Behavior |
|-------|--------------|-------------------|
| `SessionStart` | New conversation begins | Daemon startup, session initialization |
| `UserPromptSubmit` | User sends a prompt | Stage reminders, update transcript metrics |
| `PreToolUse` | Before a tool is invoked | Cadence-based "pause and reflect" reminders |
| `PostToolUse` | After a tool completes | Transcript metrics update |
| `Stop` | Assistant finishes responding | "Verify completion" reminders after modifications |
| `PreCompact` | Before context compaction | Snapshot transcript state for UI time-travel |
| `SessionEnd` | Conversation ends | Cleanup, daemon shutdown |

### CLI/Daemon Split

The CLI must respond **synchronously** to Claude Code (hooks block the conversation). Expensive work (LLM calls, transcript analysis) runs in the **daemon** asynchronously.

1. Claude Code fires a hook event.
2. The **CLI** receives it, reads any staged files from `.sidekick/sessions/{id}/stage/`, and returns a response (e.g., a reminder message or empty).
3. The CLI also sends the event to the **daemon** via IPC (fire-and-forget over Unix domain socket at `.sidekick/sidekickd.sock`).
4. The daemon processes the event asynchronously: runs LLM calls, updates session state, stages files for future CLI reads.

### Dev-Mode vs Plugin

In **dev-mode**, hook scripts under `scripts/dev-sidekick/` invoke the local CLI build directly (`node packages/sidekick-cli/dist/bin.js`). This bypasses npm and is used for rapid iteration within this project.

In **plugin mode**, `hooks.json` uses `npx @scotthamilton77/sidekick` which fetches the published npm package. This is how end users consume Sidekick.

---

## Development Workflow

### Getting Started with Dev-Mode

Dev-mode is the contributor workflow for testing local changes within this project. It registers hook scripts in `.claude/settings.local.json` that point at your local build instead of the npm package.

```bash
# 1. Build the monorepo
pnpm build

# 2. Enable dev-mode (installs local hook scripts)
pnpm sidekick dev-mode enable

# 3. Verify dev-mode is active
pnpm sidekick dev-mode status
```

After enabling, the Sidekick statusline and persona should appear in your Claude Code session. If hooks are not firing, check `pnpm sidekick dev-mode status` to verify the hook scripts exist and point to the correct local build paths.

### Iterating on Code

1. Make changes to source files under `packages/`.

2. Rebuild:
   ```bash
   pnpm build
   ```

Claude Code picks up hook changes automatically — no restart required. Changes to daemon code require a daemon restart (`pnpm sidekick daemon kill && pnpm sidekick daemon start`).

### Troubleshooting Dev-Mode

**Hooks not firing**: Run `pnpm sidekick dev-mode status` to check hook script paths. If they point to stale locations, run `pnpm sidekick dev-mode disable && pnpm sidekick dev-mode enable` to re-register.

**Plugin and dev-mode conflict**: If both the marketplace plugin and dev-mode are active, `pnpm sidekick doctor` reports a `both` status. THIS SHOULD NOT BE A PROBLEM (sidekick is engineered to run safely in this configuration, favoring the dev-mode hooks), but if you suspect it is causing issues, disable one — typically disable the plugin when developing:
```bash
claude plugin uninstall sidekick
```

**Daemon not picking up changes**: The daemon is a long-running process. If you changed daemon code, you must restart it:
```bash
pnpm sidekick daemon kill
pnpm sidekick daemon start
```

**Full reset of transient state**: Use `clean` or `clean-all` to wipe transient state:
```bash
pnpm sidekick dev-mode clean       # Truncate logs, kill daemon(s)
pnpm sidekick dev-mode clean-all   # Also removes sessions, sockets, state
```

### Verification Checklist

Before considering any change complete:

```bash
pnpm build       # Build all packages
pnpm typecheck   # Type-check (includes test files)
pnpm lint        # ESLint
pnpm test        # Unit tests
```

### Issue Tracking with Beads

Development work is tracked with **beads** (`bd`), a git-backed issue tracker that lives in `.beads/` and syncs via git. GitHub Issues are for user-facing bug reports; beads is for developer task tracking.

**Finding work:**

```bash
bd ready                        # Show issues with no blockers
bd list --status=open           # All open issues
bd show <id>                    # Full details, dependencies, acceptance criteria
```

**Working on an issue:**

All work happens on **branches** — never commit directly to `main`.

```bash
bd update <id> --status=in_progress   # Claim the issue
git checkout -b feat/short-description # Branch from main

# ... do the work ...

git push -u origin feat/short-description
gh pr create                          # Open a PR against main
bd close <id>                         # After PR is merged
```

**Discovered work while developing:**

```bash
# Found a bug? Create a bead — don't fix it inline
bd create --title="Fix edge case in config cascade" --type=bug --priority=2
```

### Session Completion

When ending a work session, sync beads and push to remote:

```bash
bd sync          # Commit and sync issue tracking state
git push         # Push code and beads changes to remote
git status       # Verify working tree is clean and up to date
```

### Useful CLI Commands

```bash
# Session management
pnpm sidekick sessions --format=table

# Daemon lifecycle
pnpm sidekick daemon status
pnpm sidekick daemon start
pnpm sidekick daemon stop
pnpm sidekick daemon kill

# Dev-mode management
pnpm sidekick dev-mode status
pnpm sidekick dev-mode enable
pnpm sidekick dev-mode disable
pnpm sidekick dev-mode clean       # Truncate logs, kill daemon
pnpm sidekick dev-mode clean-all   # Full cleanup including sessions

# Personas
pnpm sidekick persona list --format=table
pnpm sidekick persona test marvin --session-id=abc --type=snarky

# Monitoring UI
pnpm sidekick ui
```

### Logs

Sidekick writes structured logs (pino JSON) to `.sidekick/sidekick.log`:

```bash
tail -f .sidekick/sidekick.log

# Enable debug logging
# Option 1: Environment variable
SIDEKICK_LOG_LEVEL=debug pnpm sidekick daemon start

# Option 2: Config file (.sidekick/sidekick.config)
core.logging.level=debug
```

---

## Testing Strategy

### Test Framework

All packages use **Vitest** with coverage enabled by default (v8 provider). The workspace is defined in `vitest.workspace.ts` at the repo root. Each package writes text, HTML, and LCOV coverage reports to its own `packages/<name>/coverage/` directory (gitignored).

### Running Tests

```bash
# All tests (default -- mocked LLM, zero API costs)
pnpm test

# Single package
pnpm --filter @sidekick/core test

# Single test file
pnpm --filter @sidekick/core test -- src/config/config-service.test.ts

# With coverage report
pnpm test:coverage
```

### IPC Test Exclusions (Sandbox)

IPC tests use Unix domain sockets, which fail inside the Claude Code sandbox (`EPERM` on socket operations). When running tests from within a Claude Code session:

```bash
# Exclude IPC-related test files
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
```

Outside the sandbox (normal terminal), all tests pass without exclusions.

### Integration Tests

LLM provider tests make real API calls and are **excluded from default runs** to prevent charges. Enable them explicitly:

```bash
INTEGRATION_TESTS=1 pnpm test
```

Full integration coverage including IPC:

```bash
INTEGRATION_TESTS=1 pnpm test
```

### Known Warning: Zod Peer Dependency

`pnpm install` emits `openai@4.x` → `zod@^3.23.8` peer complaints because we intentionally run `zod@^4.1.13` across the workspace for improved schema tooling. The OpenAI SDK still functions with zod 4, so the warning is ignored until we adopt OpenAI 6.x (which officially supports newer zod) or migrate to the Responses API.

### Test Infrastructure

The `@sidekick/testing-fixtures` package provides shared test utilities:

- **Mock services**: `MockLLMService`, `MockHandlerRegistry`, `MockTranscriptService`, `MockStagingService`
- **Factories**: Event builders, reminder builders, metrics builders
- **Harnesses**: CLI and daemon test harnesses for end-to-end hook testing

Import test utilities from the fixtures package:

```typescript
import { createMockRuntimeContext, buildHookEvent } from '@sidekick/testing-fixtures';
```

---

## Configuration System

Sidekick uses **YAML-based configuration** with a cascade that merges settings from multiple layers. Later layers override earlier ones.

### Cascade Order (lowest to highest priority)

1. **Bundled defaults**: `assets/sidekick/defaults/*.yaml`
2. **User domain YAML**: `~/.sidekick/*.yaml`
3. **User unified config**: `~/.sidekick/sidekick.config`
4. **Project domain YAML**: `.sidekick/*.yaml`
5. **Project unified config**: `.sidekick/sidekick.config`
6. **Environment variables**: `SIDEKICK_*` prefixed

### Configuration Domains

| File | Contents |
|------|----------|
| `core.yaml` | Logging level, paths, daemon settings |
| `llm.yaml` | LLM provider (openrouter, openai), model name, API key reference |
| `transcript.yaml` | Transcript processing thresholds |
| `features.yaml` | Feature flags and tuning parameters |

### Quick Overrides

The `sidekick.config` file uses dot-notation for rapid overrides without editing YAML:

```bash
# .sidekick/sidekick.config
core.logging.level=debug
llm.provider=openrouter
features.statusline.enabled=true
```

Access configuration programmatically via `ConfigService` from `@sidekick/core`. Never import `dotenv` directly.

---

## Cross-Package Conventions

These patterns are enforced by code review and documented in `packages/AGENTS.md`:

| Concern | Convention |
|---------|-----------|
| **Logging** | Always via `pino` from `@sidekick/core`. Never `console.log`. |
| **Configuration** | Via `ConfigService` from `@sidekick/core`. Never import `dotenv` directly. |
| **Types** | Shared interfaces live in `@sidekick/types`. |
| **Testing** | Use mocks/factories from `@sidekick/testing-fixtures`. |
| **LLM calls** | Always via `@sidekick/shared-providers`. Never call LLM SDKs directly. |
| **File limits** | 500 lines per file, 20 lines per method (enforced by code review). |
| **Module format** | CommonJS (`"type": "commonjs"`) for all runtime packages. |
| **Build** | `tsc -b` (project references) for each package. |
| **Exports** | From `src/index.ts` with explicit type exports. |

---

## Adding a New Package

1. Create a directory under `packages/` (e.g., `packages/feature-foo/`).

2. Create `package.json` with the `@sidekick/` scope:
   ```json
   {
     "name": "@sidekick/feature-foo",
     "version": "0.1.0",
     "type": "commonjs",
     "main": "dist/index.js",
     "types": "dist/index.d.ts",
     "scripts": {
       "build": "tsc -b",
       "test": "vitest run"
     },
     "dependencies": {
       "@sidekick/types": "workspace:*",
       "@sidekick/core": "workspace:*"
     },
     "devDependencies": {
       "@sidekick/testing-fixtures": "workspace:*",
       "typescript": "^5.6.3",
       "vitest": "^4.0.18"
     }
   }
   ```

3. The package is auto-discovered by `pnpm-workspace.yaml` (which includes `packages/*`).

4. Add the package to `vitest.workspace.ts` if it has tests.

5. Create `tsconfig.json` with project references to dependencies.

6. Export from `src/index.ts` with explicit type exports.

7. Run `pnpm install` to link the workspace dependency, then `pnpm build` to verify.

---

## Distribution and Publishing

### Publishing with publish-dist (Preferred)

The `publish-dist` script handles version bumping, building, publishing, committing, and tagging in one step:

```bash
pnpm run publish:dist            # Bump patch (0.1.0 -> 0.1.1) and publish
pnpm run publish:dist minor      # Bump minor (0.1.1 -> 0.2.0) and publish
pnpm run publish:dist major      # Bump major (0.2.0 -> 1.0.0) and publish
pnpm run publish:dist --no-bump  # Publish current version as-is
```

The script will:
1. Check for uncommitted changes (fail if dirty)
2. Bump version in `packages/sidekick-dist/package.json` and sync to plugin metadata
3. Build all packages
4. Publish to npm
5. Commit the version bump and create a `v{version}` git tag

After publishing, push the commit and tag: `git push && git push --tags`

### How the npm Package is Built

The `sidekick-dist` package uses **esbuild** to bundle the entire CLI into a single file (`dist/bin.js`). This is what gets published to npm as `@scotthamilton77/sidekick`.

```bash
# Build the monorepo first
pnpm build

# Bundle for distribution (runs automatically on publish via prepublishOnly)
cd packages/sidekick-dist
pnpm run bundle
```

### Publishing to npm

```bash
# 1. Verify you are logged in
npm whoami

# 2. Check current published versions
npm view @scotthamilton77/sidekick versions

# 3. Bump version in packages/sidekick-dist/package.json

# 4. Publish (prepublishOnly triggers the bundle)
cd packages/sidekick-dist
npm publish --access public --tag latest

# 5. Verify
npm view @scotthamilton77/sidekick dist-tags
```

### Testing the Published Package in Another Project

```bash
cd /path/to/other/project
claude --plugin-dir=/path/to/claude-code-sidekick/packages/sidekick-plugin
```

The plugin's `hooks.json` calls `npx @scotthamilton77/sidekick`, which fetches from npm (not the local build).

### Dev-Mode vs Plugin Testing

| Aspect | Dev-Mode | Plugin Testing |
|--------|----------|----------------|
| **Where** | This project only | Any project |
| **CLI source** | Local build (`packages/sidekick-cli/dist/`) | npm (`npx @scotthamilton77/sidekick`) |
| **Setup** | `pnpm sidekick dev-mode enable` | `npm publish` + `--plugin-dir` |
| **Hook scripts** | `scripts/dev-sidekick/*` | `packages/sidekick-plugin/hooks/hooks.json` |
| **Use case** | Rapid iteration | End-to-end / integration testing |

---

## Further Reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) -- Executive architectural overview and LLD reference index
- [docs/design/flow.md](./design/flow.md) -- Event model, hook flows, handler registration
- [docs/design/CORE-RUNTIME.md](./design/CORE-RUNTIME.md) -- RuntimeContext, services, bootstrap
- [docs/design/CLI.md](./design/CLI.md) -- CLI framework and hook dispatcher
- [docs/design/DAEMON.md](./design/DAEMON.md) -- Background daemon, IPC, state management
- [docs/design/CONFIG-SYSTEM.md](./design/CONFIG-SYSTEM.md) -- Configuration cascade details
- [docs/design/LLM-PROVIDERS.md](./design/LLM-PROVIDERS.md) -- Provider adapters and retry logic
- [docs/design/TEST-FIXTURES.md](./design/TEST-FIXTURES.md) -- Test mocks, factories, harnesses
- [packages/AGENTS.md](../packages/AGENTS.md) -- Monorepo conventions and cross-package patterns
