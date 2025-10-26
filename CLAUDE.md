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

### Adding a New Feature (Plugin)

**The plugin architecture means you NEVER need to edit handlers when adding features!**

1. **Create** `src/sidekick/features/my-feature.sh` with standardized hook functions:
   - `myfeature_on_session_start(session_id, project_dir)` - optional
   - `myfeature_on_user_prompt_submit(session_id, transcript_path, project_dir)` - optional
   - **Optional**: Add `readonly PLUGIN_DEPENDS="other-feature"` if your feature depends on another plugin
2. **Add** `FEATURE_MY_FEATURE=true` to `src/sidekick/config.defaults`
3. **Test** using unit and integration test suites
4. **Install** to project scope: `./scripts/install.sh --project`
5. **RESTART CLAUDE** - `claude --continue` to load new settings
6. **Verify** functionality in real Claude sessions
7. **Deploy** to user scope: `./scripts/install.sh --user`
8. **RESTART CLAUDE** - `claude --continue` again
9. **Sync** to user global config: `./scripts/sync-to-user.sh`

**That's it!** Handlers auto-discover, resolve dependencies, and invoke your feature in the correct order.

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

### Plugin Architecture

**Handlers are framework code** - they automatically discover and invoke feature plugins. You never edit them.

**Key Concepts**:
- **Auto-discovery**: Handlers scan `features/*.sh` and source enabled ones
- **Dependency resolution**: Plugins declare dependencies via `PLUGIN_DEPENDS`; topological sort ensures correct load order
- **Standardized hooks**: Features export `{name}_on_{event}()` functions
- **Name normalization**: Filenames may use hyphens (`topic-extraction.sh`), but config keys and functions use underscores (`FEATURE_TOPIC_EXTRACTION`, `topic_extraction_on_session_start()`)
- **Output aggregation**: Multiple plugins can output JSON; handlers concatenate and return

**Plugin Template**:
```bash
#!/bin/bash
# Prevent double-sourcing
[[ -n "${_SIDEKICK_FEATURE_MYFEATURE_LOADED:-}" ]] && return 0
readonly _SIDEKICK_FEATURE_MYFEATURE_LOADED=1

# Optional: Declare dependencies (space-separated list)
readonly PLUGIN_DEPENDS="tracking other-plugin"

# ... helper functions ...

#------------------------------------------------------------------------------
# PLUGIN HOOKS
#------------------------------------------------------------------------------

myfeature_on_session_start() {
    local session_id="$1"
    local project_dir="$2"
    # Your logic here
}

myfeature_on_user_prompt_submit() {
    local session_id="$1"
    local transcript_path="$2"
    local project_dir="$3"

    # Optional: output JSON for additionalContext
    if [ -n "$output" ]; then
        cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "$output"
  }
}
JSON
    fi
}
```

**Dependency System**:
- Declare dependencies with `readonly PLUGIN_DEPENDS="dep1 dep2"`
- Plugin loader performs topological sort (Kahn's algorithm)
- Circular dependencies are detected and reported as errors
- Missing dependencies cause load failure with clear error messages
- Dependencies can use hyphens or underscores (normalized automatically)

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

**Sidekick Implementation**: ✅ Complete with Plugin Architecture + Dependency Resolution (tests passing, docs updated)

- ✅ Infrastructure complete (lib/common.sh with 8 namespaces: added PLUGIN LOADER with dependency resolution)
- ✅ All 6 features implemented as self-contained plugins (topic-extraction, resume, statusline, tracking, reminder, cleanup)
- ✅ **Plugin architecture**: Handlers auto-discover, resolve dependencies (topological sort), and invoke features
- ✅ **Dependency system**: Plugins declare dependencies; loader ensures correct execution order
- ✅ Feature split: tracking (counter only) and reminder (output) are now decoupled with explicit dependency
- ✅ Resume feature refactored (async generation, file-based initialization, no LLM blocking at SessionStart)
- ✅ Installation/uninstallation scripts working for both scopes
- ✅ All unit tests passing (8/8 suites - added plugin dependency tests)
- ✅ All integration tests passing (7/7 suites - added reminder independence test)
- ✅ Documentation updated (ARCH.md, PLAN.md, README.md, CLAUDE.md)
- 🔄 **In Progress**: Manual testing in real Claude sessions

**Reference Documents**:
- `ARCH.md`: Complete architectural specification
- `PLAN.md`: 8-phase implementation checklist (currently at Phase 5.3)
- `src/sidekick/config.defaults`: All configuration options with documentation