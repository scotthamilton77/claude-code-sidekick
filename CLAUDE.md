# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

| Need | Command/Location |
|------|------------------|
| **Install Sidekick** | `./scripts/install.sh --user` → `claude --continue` |
| **Run tests** | `./scripts/tests/run-unit-tests.sh` (mocked, free) |
| **Add plugin** | Create `src/sidekick/features/my-feature.sh` + enable in `config.defaults` |
| **Config options** | `src/sidekick/config.defaults` (all settings documented) |
| **Architecture deep-dive** | `ARCH.md` (design), `PLAN.md` (progress) |
| **Benchmark (Bash)** | `scripts/benchmark/` (production, 3K LOC) |
| **Benchmark (TypeScript)** | `benchmark-next/` (greenfield rewrite) |

## Project Purpose

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

| Track | Status | Purpose | Stack |
|-------|--------|---------|-------|
| **1: `scripts/benchmark/`** | 🚧 Production (3K LOC Bash) | Rapid iteration on scoring algorithms | Bash + jq + Sidekick libs |
| **2: `benchmark-next/`** | 🏗️ Greenfield rewrite | Long-term maintainability, type safety | TypeScript + Node + Vitest |

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
- **Configuration Cascade**: Versioned Project → Deployed Project → User → Defaults (shell .conf format)
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

| Feature | Purpose | Key Behavior |
|---------|---------|--------------|
| **Topic Extraction** | LLM-based conversation analysis | Triggers async resume on significant topic change |
| **Resume** | Session continuity | Generated async in background, no LLM blocking at SessionStart |
| **Statusline** | Enhanced status display | Shows topic, tokens, git branch |
| **Tracking** | Request counting | Enables periodic reminders |
| **Cleanup** | Garbage collection | Removes old session directories |

All features independently toggleable via `FEATURE_*` flags in `sidekick.conf`.

### Configuration

Four-level cascade (later overrides earlier):

1. `src/sidekick/config.defaults` - Baseline settings
2. `~/.claude/hooks/sidekick/sidekick.conf` - User-wide overrides
3. `.claude/hooks/sidekick/sidekick.conf` - Project ephemeral (deleted on uninstall)
4. `.sidekick/sidekick.conf` - **Highest priority**, survives install/uninstall, git-committable

**Pattern**: Only specify overrides (minimal configs). Commit #4 for team-wide settings, use #2 for personal preferences.

See `src/sidekick/config.defaults` for all available options.

### LLM Provider Configuration

Sidekick uses a pluggable LLM provider system for conversation analysis and resume generation.

**Supported Providers**: Claude CLI (default), OpenAI API, OpenRouter API, custom shell commands

**Key Settings** (see `src/sidekick/config.defaults` for complete list):
- `LLM_PROVIDER` - Provider selection (claude-cli | openai-api | openrouter | custom)
- `LLM_TIMEOUT_SECONDS` - Global timeout (default: 10s), with retry support
- `LLM_DEBUG_DUMP_ENABLED` - Save API calls to `/tmp/sidekick-llm-debug/` for troubleshooting

**Implementation**: `llm_invoke()` in `lib/llm.sh` dispatches to provider-specific handlers. See `ARCH.md` LLM Provider System for complete documentation.

### Circuit Breaker with Fallback Provider

Automatic resilience for flaky LLM providers: CLOSED (use primary) → 3 failures → OPEN (use fallback + exponential backoff) → HALF_OPEN (test primary) → CLOSED.

**Use Case**: Cheap-but-flaky primary (OpenRouter) with reliable fallback (Claude CLI). State persists per-session in `.sidekick/sessions/<session_id>/circuit-breaker.json`.

**Config**: `CIRCUIT_BREAKER_ENABLED`, `LLM_FALLBACK_PROVIDER`, `CIRCUIT_BREAKER_FAILURE_THRESHOLD` (see `config.defaults`)
**Testing**: `./scripts/tests/unit/test-circuit-breaker.sh` and `./scripts/tests/demo-circuit-breaker.sh`

### Testing

| Test Type | Suites | Cost | Command |
|-----------|--------|------|---------|
| **Unit** | 10 suites, 77 tests | Free (mocked LLM) | `./scripts/tests/run-unit-tests.sh` |
| **Integration** | 7 suites | Free (mocked data) | `./scripts/tests/run-integration-tests.sh` |
| **LLM Providers** | Real API calls | 💰 **EXPENSIVE** | `./scripts/tests/integration/test-llm-providers.sh` |

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

| Doc | Purpose |
|-----|---------|
| **ARCH.md** | Complete architectural specification |
| **PLAN.md** | 8-phase implementation checklist with current progress |
| **README.md** | User-facing documentation and quick start guide |

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

| Component | Status | Details |
|-----------|--------|---------|
| **Infrastructure** | ✅ | 10 namespace libs + plugin loader with dependency resolution |
| **Features** | ✅ | 6 plugins (topic-extraction, resume, statusline, tracking, reminder, cleanup) |
| **Testing** | ✅ | 10 unit suites (77 tests), 7 integration suites, all passing |
| **Documentation** | ✅ | ARCH.md, PLAN.md, README.md updated |
| **Manual Testing** | 🔄 | In progress (real Claude sessions) |

See `PLAN.md` (Phase 5.3) and `src/sidekick/config.defaults` for details.