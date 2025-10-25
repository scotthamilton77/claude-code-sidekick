# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### Other Components

- **`backlog/commands-to-explore/`**: Experimental command templates under development
- **`scripts/`**: Installation, testing, and sync infrastructure

## Sidekick Hook System

**Status**: ✅ Production-ready (all unit & integration tests passing)

### Architecture

See `ARCH.md` for complete design documentation. Key features:

- **Single Entry Point**: All hooks route through `sidekick.sh <command>`
- **Shared Library**: `lib/common.sh` provides namespaced utilities (LOGGING, CONFIGURATION, PATH RESOLUTION, JSON PROCESSING, PROCESS MANAGEMENT, CLAUDE INVOCATION, WORKSPACE MANAGEMENT)
- **Pluggable Features**: Independently toggleable via `sidekick.conf`
- **Configuration Cascade**: Project → User → Defaults (shell .conf format)
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

Sidekick provides five independently configurable features:

1. **Topic Extraction**: LLM-based conversation analysis with adaptive sleeper process
   - Triggers async resume generation when topic changes significantly (significant_change=true AND clarity>=5)
2. **Resume**: Session continuity with snarkified resume messages
   - **Architecture**: Async generation during topic extraction (no LLM blocking at SessionStart)
   - Resume generated in background when topic changes, used by next session for fast initialization
   - Field schema: last_task_id, resume_last_goal_message, last_objective_in_progress, snarky_comment
3. **Statusline**: Enhanced status display with topic, tokens, git branch
4. **Tracking**: Request counting with periodic reminders
5. **Cleanup**: Automatic garbage collection of old session directories

Configure via `sidekick.conf` (see `src/sidekick/config.defaults` for all options).

### Testing

```bash
# Run all unit tests
./scripts/tests/run-unit-tests.sh

# Run all integration tests
./scripts/tests/run-integration-tests.sh

# Run specific test suite
./scripts/tests/integration/test-session-start.sh
```

## Development Workflow

1. **Develop** new features in `src/sidekick/features/`
2. **Test** using unit and integration test suites
3. **Install** to project scope for manual testing: `./scripts/install.sh --project`
4. **RESTART CLAUDE** - After any installation or update to `.claude/settings.json`, you **MUST** restart Claude with `claude --continue` to load the new settings
5. **Verify** functionality in real Claude sessions
6. **Deploy** to user scope: `./scripts/install.sh --user`
7. **RESTART CLAUDE** - After deploying to user scope, restart Claude again with `claude --continue`
8. **Sync** to user global config (for deployment): `./scripts/sync-to-user.sh`

### Critical Testing Requirement

**⚠️ ALWAYS ask the user to restart Claude after:**
- Running `./scripts/install.sh` (any scope)
- Running `./scripts/uninstall.sh` (any scope)
- Manually editing `.claude/settings.json` or `~/.claude/settings.json`
- Updating hook scripts in deployed locations

**Restart command**: `claude --continue` (to resume the current session with new settings)

## MCP Server Configuration

The repository uses several MCP (Model Context Protocol) servers:
- **context7**: External SSE server for enhanced context
- **sequential-thinking**: NPX-based thinking assistance
- **zen**: Local Python-based server for specialized functionality  
- **memory**: NPX-based memory management

## Development Patterns

### Dual-Scope Compatibility
All scripts must support both deployment contexts:
- **Project scope**: Paths relative to `$CLAUDE_PROJECT_DIR/.claude/`
- **User scope**: Paths relative to `~/.claude/`

Use environment variables and dynamic path resolution. See `src/sidekick/lib/common.sh` PATH RESOLUTION namespace for implementation patterns.

### Command Template Structure
Markdown-based specifications in `backlog/` include:
- Purpose/requirements sections
- Process flows (often with Mermaid diagrams)
- Bash code blocks for execution
- Atlas MCP integration (where applicable)

## Critical Constraints

- **Never modify files outside project directory** without explicit authorization
- **All hooks must be permission-approved** in `settings.json` before execution
- **Dual-scope testing required** before deploying to `~/.claude`
- **Timestamp preservation** critical for sync correctness
- **NEVER** perform an install or uninstall to either user or project scope without the user's explicit authorization

## Current Status

**Sidekick Implementation**: ✅ Complete through Phase 5.3 (tests passing, docs updated)

- ✅ Infrastructure complete (lib/common.sh with 7 namespaces)
- ✅ All 5 features implemented (topic-extraction, resume, statusline, tracking, cleanup)
- ✅ Resume feature refactored (async generation, file-based initialization, no LLM blocking at SessionStart)
- ✅ Installation/uninstallation scripts working for both scopes
- ✅ All unit tests passing (7/7 suites)
- ✅ All integration tests passing (6/6 suites)
- ✅ Documentation updated (ARCH.md, PLAN.md, README.md, CLAUDE.md)
- 🔄 **In Progress**: Phase 5.3 - Manual testing in real Claude sessions

**Reference Documents**:
- `ARCH.md`: Complete architectural specification
- `PLAN.md`: 8-phase implementation checklist (currently at Phase 5.3)
- `src/sidekick/config.defaults`: All configuration options with documentation