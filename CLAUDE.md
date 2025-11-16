# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

| Need                       | Command/Location                                                           |
| -------------------------- | -------------------------------------------------------------------------- |
| **Install Sidekick**       | `./scripts/install.sh --user` → `claude --continue`                        |
| **Run tests**              | `./scripts/tests/run-unit-tests.sh` (mocked, free)                         |
| **Add plugin**             | Create `src/sidekick/features/my-feature.sh` + enable in `config.defaults` |
| **Config options**         | `src/sidekick/*.defaults` (4 modular files: config, llm-core, llm-providers, features) |
| **Architecture deep-dive** | `ARCH.md` (design), `PLAN.md` (progress)                                   |
| **Benchmark (Bash)**       | `scripts/benchmark/` (production, 3K LOC)                                  |
| **Benchmark (TypeScript)** | `benchmark-next/` (greenfield rewrite)                                     |

## Project Purpose

NOTE: This project is in development; there are no other users of the project other than this user. **There is no need to maintain backward compatibility!**

This repository serves as the **experimental proving ground** for Claude Code configuration development. It enables testing and debugging of commands, hooks, agents, skills, and other Claude Code capabilities in a project-scoped environment before deploying them to the user's global `~/.claude` directory.

**Critical Design Principle**: All scripts and capabilities must operate identically whether invoked from:

- **Project scope**: `.claude/` directory within this repository
- **User scope**: `~/.claude/` global configuration directory

This dual-scope requirement ensures configurations can be tested locally before global deployment.

## Architecture Overview

The repository is organized into source components and deployment targets:

### Source Components (`src/`)

- **`src/sidekick/`**: Modular hooks system for conversation intelligence

  - **Implementation Status**: ✅ Complete (all tests passing)
  - **Architecture**: Single entry point, shared library, pluggable features
  - **See**: `ARCH.md` for complete design, `PLAN.md` for implementation status

- **`src/.claude/`**: Source templates for future component install system
  - agents/ - Custom agent definitions
  - skills/ - Claude Code skills
  - CLAUDE.md - Project instructions template
  - settings.json - Permission configuration template

### Deployment Targets

- **`.claude/hooks/sidekick/`**: Installed Sidekick system (after running `scripts/install.sh`)
- **`~/.claude/hooks/sidekick/`**: User-global Sidekick installation

### Test Data & Benchmarking (`test-data/`)

- **`test-data/transcripts/`**: Curated transcript collection for LLM benchmarking (497 transcripts)

  - **`metadata.json`**: Master index with 497 transcripts classified by length (short/medium/long)
  - **`golden-set.json`**: 15 hand-picked transcripts (5 short, 5 medium, 5 long) for reference generation
  - **`*.jsonl`**: Actual transcript files copied from original sessions
  - **Distribution**: 36% short (179), 22% medium (110), 42% long (208)
  - **Task ID Coverage**: Golden set includes 6 transcripts with task IDs (T###) for testing extraction

- **`test-data/projects/`**: Original source transcripts from `~/.claude/projects/*/transcript.jsonl`

  - Organized by project directory structure
  - Source of truth before processing into test-data/transcripts/

- **`test-data/sessions/`**: Sidekick analysis results (`.sidekick/sessions/*/topic.json`)

  - Contains LLM-generated topic extractions for transcripts
  - Used by collect-test-data.sh to enrich metadata

- **`test-data/references/`**: High-quality reference outputs for benchmarking (generated in Phase 2)
  - Golden set analyzed by 3 premium models (Grok-4, Gemini 2.5 Pro, GPT-5)
  - Consensus outputs used as ground truth for scoring

### Benchmarking Systems (Dual-Track Development)

Two parallel implementations with shared `test-data/`:

| Track                       | Status                      | Purpose                                | Stack                      |
| --------------------------- | --------------------------- | -------------------------------------- | -------------------------- |
| **1: `scripts/benchmark/`** | 🚧 Production (3K LOC Bash) | Rapid iteration on scoring algorithms  | Bash + jq + Sidekick libs  |
| **2: `benchmark-next/`**    | 🏗️ Greenfield rewrite       | Long-term maintainability, type safety | TypeScript + Node + Vitest |

**Development Pattern**: Improve Track 1 → extract functional requirements → implement idiomatically in Track 2 → validate with shared test data.

**Details**: See `docs/benchmark-migration.md` for sync process and `benchmark-next/CLAUDE.md` for migration checklist.

### Other Components

- **`scripts/`**: Installation, testing, and sync infrastructure
  - **`collect-test-data.sh`**: AI-powered transcript collection and classification
  - **`bulk-topic-extraction.sh`**: Batch topic analysis for all transcripts

## Sidekick Hook System

**Status**: ✅ Production-ready (all unit & integration tests passing)

### Architecture

See `ARCH.md` for complete design documentation. Key features:

- **Single Entry Point**: All hooks route through `sidekick.sh <command>`
- **Modular Libraries**: `lib/common.sh` loader + 9 focused namespace files (config.sh, json.sh, llm.sh, logging.sh, paths.sh, plugin.sh, process.sh, utils.sh, workspace.sh)
- **Pluggable Features**: Independently toggleable via `sidekick.conf`
- **Pluggable LLM Providers**: Support for Claude CLI, OpenAI API, OpenRouter API, and custom providers
- **Configuration Cascade**: Versioned Project → Deployed Project → User Persistent → User Installed → Defaults (shell .conf format)
- **Dual-Scope Deployment**: Works identically in project (.claude/) and user (~/.claude/) contexts

### Installation

```bash
# Install to user scope (recommended)
./scripts/install.sh --user

# Install to project scope (for testing)
./scripts/install.sh --project

# Install to both
./scripts/install.sh --both
```

### Features

| Feature              | Purpose                         | Key Behavior                                                                                                   |
| -------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Topic Extraction** | LLM-based conversation analysis | Triggers async resume on significant topic change                                                              |
| **Resume**           | Session continuity              | Generated async in background, no LLM blocking at SessionStart                                                 |
| **Statusline**       | Enhanced status display         | Shows topic, tokens, git branch                                                                                |
| **Tracking**         | Request counting                | Enables periodic reminders                                                                                     |
| **Reminder**         | Turn-cadence and stop reminders | Turn-cadence (every N turns), Stop (blocks conversation end after file edits)                                  |
| **Post-Tool-Use**    | Tool-based reminders            | Tool-cadence (every N tools), stuck detection (threshold per turn), sets stop reminder marker after file edits |
| **Cleanup**          | Garbage collection              | Removes old session directories                                                                                |

All features independently toggleable via `FEATURE_*` flags in `sidekick.conf`.

### Configuration

**Environment Variables** (`.env` files, loaded first):

0a. `~/.sidekick/.env` - User-wide persistent (works in both user-only and project scopes)
0b. `$CLAUDE_PROJECT_DIR/.env` - Project root (shared with docker-compose, etc.)
0c. `$CLAUDE_PROJECT_DIR/.sidekick/.env` - Project sidekick-specific (highest priority)

Environment variables are auto-exported via `set -a` during `config_load()`. Example: `OPENROUTER_API_KEY=sk-or-v1-...`

**Best Practice**: Store global API keys in `~/.sidekick/.env` (never commit), project-specific keys in `.sidekick/.env` (git-committable with encryption/secrets management).

**Config Files** (modular architecture with five-level cascade):

**Modular Domains** (defaults layer):
- `config.defaults` - Feature flags, global settings (LOG_LEVEL, SIDEKICK_CONSOLE_LOGGING)
- `llm-core.defaults` - LLM infrastructure (LLM_PROVIDER, circuit breaker, timeouts, debugging)
- `llm-providers.defaults` - Provider-specific configs (API keys, models, endpoints)
- `features.defaults` - Feature tuning (SLEEPER_MAX_DURATION, TOPIC_EXCERPT_LINES, etc.)

**Cascade Levels** (later overrides earlier):
1. **Defaults**: `src/sidekick/*.defaults` (required, modular)
2. **User installed**: `~/.claude/hooks/sidekick/*.conf` (optional, ephemeral)
3. **User persistent**: `~/.sidekick/*.conf` (optional, survives install/uninstall)
4. **Project deployed**: `.claude/hooks/sidekick/*.conf` (optional, deleted on uninstall)
5. **Project versioned**: `.sidekick/*.conf` (optional, highest priority, git-committable)

**Loading Order** (at each cascade level):
- Modular files: `config.conf` → `llm-core.conf` → `llm-providers.conf` → `features.conf`
- Legacy file: `sidekick.conf` (loads LAST, overrides all modular files for backward compatibility)

**Override Strategies**:
- **Modular**: Create domain-specific .conf files (e.g., `llm-providers.conf` to override just LLM settings)
- **Simple**: Use `sidekick.conf` to override any setting from any domain (single file, loads last)

**Pattern**: Use `.env` for API keys (never commit), modular `.conf` for domain-specific overrides, or `sidekick.conf` for simple single-file overrides. Commit project versioned (#5) for team-wide settings, use user persistent (#3) for personal preferences.

See `src/sidekick/*.defaults` for all available options in each domain.

### File Cascade (Prompts & Reminders)

Prompts (`*.prompt.txt`, `*.schema.json`) and reminders (`*-reminder.txt`) use 4-level cascade via `path_resolve_cascade()`:

1. `~/.claude/hooks/sidekick/{prompts,reminders}/` - Installed user-wide (ephemeral)
2. `~/.sidekick/{prompts,reminders}/` - User-wide persistent (survives install/uninstall)
3. `${projectRoot}/.claude/hooks/sidekick/{prompts,reminders}/` - Installed project (ephemeral)
4. `${projectRoot}/.sidekick/{prompts,reminders}/` - Project persistent (git-committable)

**Reminder Types**:

- `user-prompt-submit-reminder.txt` - Every N user prompts
- `post-tool-use-cadence-reminder.txt` - Every N total tool calls
- `post-tool-use-stuck-reminder.txt` - When single turn exceeds threshold
- `pre-completion-reminder.txt` - When conversation stops after file modifications (Write/Edit/MultiEdit/NotebookEdit)

First existing file wins. Override default prompts/reminders without modifying installed files.

### LLM Provider Configuration

Sidekick uses a pluggable LLM provider system for conversation analysis and resume generation.

**Supported Providers**: Claude CLI (default), OpenAI API, OpenRouter API, custom shell commands

**Key Settings** (see `src/sidekick/llm-core.defaults` and `llm-providers.defaults` for complete list):

- `LLM_PROVIDER` - Provider selection (claude-cli | openai-api | openrouter | custom)
- `LLM_TIMEOUT_SECONDS` - Global timeout (default: 10s), with retry support
- `LLM_DEBUG_DUMP_ENABLED` - Save API calls to `/tmp/sidekick-llm-debug/` for troubleshooting

**Implementation**: `llm_invoke()` in `lib/llm.sh` dispatches to provider-specific handlers. See `ARCH.md` LLM Provider System for complete documentation.

### Circuit Breaker with Fallback Provider

Automatic resilience for flaky LLM providers: CLOSED (use primary) → 3 failures → OPEN (use fallback + exponential backoff) → HALF_OPEN (test primary) → CLOSED.

**Use Case**: Cheap-but-flaky primary (OpenRouter) with reliable fallback (Claude CLI). State persists per-session in `.sidekick/sessions/<session_id>/circuit-breaker.json`.

**Config**: `CIRCUIT_BREAKER_ENABLED`, `LLM_FALLBACK_PROVIDER`, `CIRCUIT_BREAKER_FAILURE_THRESHOLD` (see `llm-core.defaults`)
**Testing**: `./scripts/tests/unit/test-circuit-breaker.sh` and `./scripts/tests/demo-circuit-breaker.sh`

### Logging & Troubleshooting

**Two-Tier Console Logging System**:

- `log_debug/log_info/log_warn`: Respect `--log-to-console` flag (can be enabled)
- `log_error`: ALWAYS outputs to stderr (critical errors bypass flag for visibility)
- File logging: ALWAYS enabled regardless of console flag

**Console Logging Control** (precedence, highest to lowest):

1. `--log-to-console` CLI flag (forces on)
2. `SIDEKICK_CONSOLE_LOGGING` environment variable
3. `SIDEKICK_CONSOLE_LOGGING` config file setting
4. Default: `false` (console logging disabled)

**Hook Integration**: Hook invocations omit console logging flag since default behavior (disabled) is appropriate for JSON output to Claude Code. Use `--log-to-console` flag for debugging when needed.

**Log File Locations**:

- Session logs: `.sidekick/sessions/<session_id>/sidekick.log`
- Global log: `.sidekick/sidekick.log`

**Troubleshooting**: See README.md "Troubleshooting" section for viewing logs and enabling console output for debugging.

### Testing

| Test Type         | Suites              | Cost               | Command                                             |
| ----------------- | ------------------- | ------------------ | --------------------------------------------------- |
| **Unit**          | 10 suites, 81 tests | Free (mocked LLM)  | `./scripts/tests/run-unit-tests.sh`                 |
| **Integration**   | 7 suites            | Free (mocked data) | `./scripts/tests/run-integration-tests.sh`          |
| **LLM Providers** | Real API calls      | 💰 **EXPENSIVE**   | `./scripts/tests/integration/test-llm-providers.sh` |

**IMPORTANT**: LLM provider tests intentionally excluded from default runs to prevent accidental API costs. They auto-skip unconfigured providers.

## Development Workflow

### Adding a New Feature (Plugin)

**Plugin architecture = zero handler edits**

1. Create `src/sidekick/features/my-feature.sh` with hook functions (`myfeature_on_{event}`)
2. Add `FEATURE_MY_FEATURE=true` to `src/sidekick/config.defaults`
3. Test: `./scripts/tests/run-unit-tests.sh`
4. Install project: `./scripts/install.sh --project` → `claude --continue` (restart)
5. Verify in real Claude session
6. Install user: `./scripts/install.sh --user` → `claude --continue` (restart)
7. Sync: `./scripts/sync-to-user.sh`

Handlers auto-discover, resolve dependencies, and invoke in correct order.

### Critical Testing Requirement

**⚠️ ALWAYS restart Claude (`claude --continue`) after:**

- Installing/uninstalling Sidekick (any scope)
- Editing `settings.json` or deployed hook scripts

## Reference Documents

| Doc           | Purpose                                                |
| ------------- | ------------------------------------------------------ |
| **ARCH.md**   | Complete architectural specification                   |
| **PLAN.md**   | 8-phase implementation checklist with current progress |
| **README.md** | User-facing documentation and quick start guide        |

## MCP Servers

context7 (SSE), sequential-thinking (NPX), memory (NPX)

## Development Patterns

### Plugin Architecture

**Handlers are framework code** - they automatically discover and invoke feature plugins. You never edit them.

**Key Concepts**:

- **Auto-discovery**: Handlers scan `features/*.sh` and source enabled ones
- **Dependency resolution**: Plugins declare `PLUGIN_DEPENDS`; topological sort ensures correct load order
- **Standardized hooks**: Export `{name}_on_{event}()` functions
- **Name normalization**: Hyphens in filenames → underscores in config/functions (`topic-extraction.sh` → `FEATURE_TOPIC_EXTRACTION`)
- **Output aggregation**: Multiple plugins output JSON; handlers concatenate

**Plugin Structure**:

```bash
#!/bin/bash
[[ -n "${_SIDEKICK_FEATURE_MYFEATURE_LOADED:-}" ]] && return 0
readonly _SIDEKICK_FEATURE_MYFEATURE_LOADED=1
readonly PLUGIN_DEPENDS="tracking other-plugin"  # Optional

myfeature_on_session_start() { ... }           # Optional
myfeature_on_user_prompt_submit() { ... }      # Optional
```

**Dependency System**: Kahn's algorithm topological sort, detects circular dependencies, validates missing dependencies.

**Plugin Execution Flow** (each hook invocation runs fresh process):

1. `sidekick.sh <command>` → routes to handler → `plugin_discover_and_load()`
2. Discovery: Scan `features/*.sh`, extract `PLUGIN_DEPENDS`, topological sort (Kahn's algorithm)
3. Load: Source plugins in dependency order, populate `_LOADED_PLUGINS[]`
4. Invoke: Call `{plugin}_on_{event}()` for each plugin that implements the hook

**Key Behaviors**: Stateless processes, partial hook implementation allowed, dependency order enforced at source time.

**See**: `ARCH.md` Plugin Architecture section for detailed execution traces and examples.

### Dual-Scope Compatibility

Scripts must work in both project (`.claude/`) and user (`~/.claude/`) contexts. Use dynamic path resolution—see `src/sidekick/lib/common.sh` PATH RESOLUTION.

## Critical Constraints

- Never modify files outside project directory without authorization
- Hooks require permission in `settings.json` before execution
- Dual-scope testing required before deploying to `~/.claude`
- Timestamp preservation critical for sync correctness
- **NEVER install/uninstall without explicit user authorization**

## Current Status

**Sidekick**: ✅ Complete (plugin architecture, tests passing, docs updated)

| Component          | Status | Details                                                                                      |
| ------------------ | ------ | -------------------------------------------------------------------------------------------- |
| **Infrastructure** | ✅     | 10 namespace libs + plugin loader with dependency resolution                                 |
| **Features**       | ✅     | 7 plugins (topic-extraction, resume, statusline, tracking, reminder, post-tool-use, cleanup) |
| **Testing**        | ✅     | 10 unit suites (77 tests), 7 integration suites, all passing                                 |
| **Documentation**  | ✅     | ARCH.md, PLAN.md, README.md updated                                                          |
| **Manual Testing** | 🔄     | In progress (real Claude sessions)                                                           |

See `PLAN.md` (Phase 5.3) and `src/sidekick/config.defaults` for details.
