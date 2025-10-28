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

### Other Components

- **`backlog/commands-to-explore/`**: Experimental command templates under development
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
- **Pluggable LLM Providers**: Support for Claude CLI, OpenAI API, GROQ API, OpenRouter API, and custom providers
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

### Configuration

Sidekick uses a four-level configuration cascade where later sources override earlier ones:

1. **Defaults**: `src/sidekick/config.defaults` (all settings with defaults)
2. **User Global**: `~/.claude/hooks/sidekick/sidekick.conf` (optional, user-wide overrides)
3. **Project Deployed**: `.claude/hooks/sidekick/sidekick.conf` (optional, ephemeral, deleted on uninstall)
4. **Project Versioned**: `.sidekick/sidekick.conf` (optional, **highest priority**, survives install/uninstall, can be committed to git)

**Key Benefits**:
- Team-wide config: Commit `.sidekick/sidekick.conf` to share project-specific settings
- Personal overrides: Use `~/.claude/hooks/sidekick/sidekick.conf` for user preferences
- Minimal configs: Only specify settings you want to override (no need to copy all defaults)

**Example** (`.sidekick/sidekick.conf` with minimal overrides):
```bash
# Disable features we don't use
FEATURE_TOPIC_EXTRACTION=false
FEATURE_CLEANUP=false

# Custom reminder cadence
TRACKING_STATIC_CADENCE=10
```

For all available options, see `src/sidekick/config.defaults`.

### LLM Provider Configuration

Sidekick uses a pluggable LLM provider system for conversation analysis and resume generation. The default is Claude CLI, but you can configure alternative providers:

**Configuration Options**:
```bash
# Provider selection
LLM_PROVIDER=claude-cli  # claude-cli | openai-api | groq | openrouter | custom

# Claude CLI (default)
LLM_CLAUDE_MODEL=haiku

# OpenAI API
LLM_OPENAI_API_KEY=sk-...
LLM_OPENAI_MODEL=gpt-4-turbo

# GROQ API
LLM_GROQ_API_KEY=gsk_...
LLM_GROQ_MODEL=openai/gpt-oss-20b

# OpenRouter API
LLM_OPENROUTER_API_KEY=sk-or-...
LLM_OPENROUTER_MODEL=sao10k/l3-lunaris-8b

# Custom provider with template
LLM_CUSTOM_BIN=/path/to/llm
LLM_CUSTOM_COMMAND={BIN} --model {MODEL} < {PROMPT_FILE}
```

**Key Implementation Details**:
- `llm_invoke()` - Main dispatcher in `lib/llm.sh`
- Provider-specific implementations: `_llm_invoke_claude_cli()`, `_llm_invoke_openai_api()`, `_llm_invoke_groq()`, `_llm_invoke_openrouter()`, `_llm_invoke_custom()`
- Used in: `features/topic-extraction.sh` (topic analysis and resume generation)

See `ARCH.md` LLM Provider System section for complete documentation.

### Circuit Breaker with Fallback Provider

Sidekick implements a **circuit breaker pattern** for LLM provider resilience. When the primary provider fails repeatedly, the circuit breaker automatically switches to a fallback provider and implements exponential backoff before retrying the primary.

**State Machine**:
```
CLOSED (normal operation - use primary)
  ↓ [3 consecutive failures]
OPEN (use fallback, backoff period active)
  ↓ [backoff expires]
HALF_OPEN (test primary with next request)
  ↓ [success] → CLOSED
  ↓ [failure] → OPEN (2x backoff)
```

**Configuration**:
```bash
# Fallback provider configuration
LLM_FALLBACK_PROVIDER=claude-cli      # Provider to use when primary fails
LLM_FALLBACK_MODEL=haiku              # Model for fallback (optional)

# Circuit breaker settings
CIRCUIT_BREAKER_ENABLED=true          # Enable/disable circuit breaker
CIRCUIT_BREAKER_FAILURE_THRESHOLD=3   # Failures before opening circuit
CIRCUIT_BREAKER_BACKOFF_INITIAL=60    # Initial backoff (seconds)
CIRCUIT_BREAKER_BACKOFF_MAX=3600      # Maximum backoff (1 hour)
CIRCUIT_BREAKER_BACKOFF_MULTIPLIER=2  # Exponential growth factor
```

**Behavior**:
1. **CLOSED**: Normal operation - all requests go to primary provider
   - On failure: increment counter, try fallback immediately, stay CLOSED
   - After 3 consecutive failures → transition to OPEN
2. **OPEN**: Circuit is open - all requests go to fallback provider
   - Skips primary provider entirely during backoff period
   - After backoff expires → transition to HALF_OPEN
3. **HALF_OPEN**: Testing primary provider
   - Next request tests the primary provider
   - Success → reset to CLOSED (primary restored)
   - Failure → back to OPEN with doubled backoff (capped at max)

**State Persistence**:
- Circuit state stored in `.sidekick/sessions/<session_id>/circuit-breaker.json`
- State survives across hook invocations within a session
- Independent circuits per session (different sessions don't affect each other)

**Example Use Case**:
```bash
# Primary: OpenRouter (cheap but sometimes flaky)
LLM_PROVIDER=openrouter
LLM_OPENROUTER_MODEL=google/gemma-3n-e4b-it

# Fallback: Claude CLI (reliable but more expensive)
LLM_FALLBACK_PROVIDER=claude-cli
LLM_FALLBACK_MODEL=haiku

# Conservative thresholds
CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
CIRCUIT_BREAKER_BACKOFF_INITIAL=300   # 5 minutes
```

**Testing**:
```bash
# Unit tests (state machine logic)
./scripts/tests/unit/test-circuit-breaker.sh

# Demo (visual walkthrough of state transitions)
./scripts/tests/demo-circuit-breaker.sh
```

**Key Benefits**:
- **Automatic failover**: No manual intervention when primary provider fails
- **Self-healing**: Circuit automatically closes when primary recovers
- **Cost optimization**: Use cheap primary, reliable fallback
- **Exponential backoff**: Prevents hammering a failing provider

### Testing

**Test Architecture:**
- **Unit tests** (10 suites, 77 tests): Use mock LLM binaries - **zero API costs**
- **Integration tests** (7 suites): Use mocked data - **zero API costs by default**
- **LLM provider tests**: Real API calls - **excluded from default test runs** (run explicitly to avoid costs)

```bash
# Run all unit tests (mocked, no API costs)
./scripts/tests/run-unit-tests.sh

# Run all integration tests (mocked, no API costs)
./scripts/tests/run-integration-tests.sh

# Run specific test suite
./scripts/tests/integration/test-session-start.sh

# EXPENSIVE: Run real LLM provider tests (makes actual API calls)
./scripts/tests/integration/test-llm-providers.sh
```

**IMPORTANT**: The expensive `test-llm-providers.sh` is intentionally excluded from `run-integration-tests.sh` to prevent accidental API costs. It auto-skips providers that aren't configured.

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

## Reference Documents

- **AGENTS.md**: Redirect to canonical agent instructions in CLAUDE.md
- **ARCH.md**: Complete architectural specification
- **PLAN.md**: 8-phase implementation checklist with current progress
- **README.md**: User-facing documentation and quick start guide

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

**Plugin Execution Flow**:

Each hook invocation follows this sequence (fresh process each time):

1. **Invocation**: Claude calls `sidekick.sh <command>` with JSON on stdin
   ```bash
   echo '{"session_id":"abc-123"}' | sidekick.sh user-prompt-submit
   ```

2. **Command Routing**: `sidekick.sh` routes to appropriate handler
   ```bash
   case "$command" in
       user-prompt-submit) handle_user_prompt_submit ;;
       session-start) handle_session_start ;;
       statusline) handle_statusline ;;
   esac
   ```

3. **Plugin Discovery & Loading**: Handler calls `plugin_discover_and_load()`
   - **Phase 1 - Discovery**: Scans `features/*.sh`, checks `FEATURE_*` config flags, extracts `PLUGIN_DEPENDS` without sourcing
   - **Phase 2 - Sort**: Topological sort based on dependency graph (Kahn's algorithm)
   - **Phase 3 - Load**: Sources plugins in dependency order, populates `_LOADED_PLUGINS[]` array

4. **Hook Invocation**: Handler calls `plugin_invoke_hook("on_<event>", args...)`
   - Iterates through `_LOADED_PLUGINS[]` in load order
   - For each plugin, checks if hook function exists (e.g., `tracking_on_user_prompt_submit`)
   - If function exists, invokes it with arguments
   - If function doesn't exist, skips that plugin (e.g., reminder has no `on_session_start`)
   - Aggregates stdout from all hooks and returns

**Key Behaviors**:
- **Stateless**: Each invocation is a separate process - no state persists between hooks
- **Partial Implementation**: Plugins can implement subset of hooks (tracking implements both `on_session_start` and `on_user_prompt_submit`, reminder only implements `on_user_prompt_submit`)
- **Dependency Order Applies to Sourcing**: Even if reminder doesn't run during `session-start`, it still gets sourced AFTER tracking so shared functions are available
- **All Enabled Plugins Load**: Every enabled plugin sources on every hook invocation, even if it doesn't implement that specific hook

**Example Execution** (`user-prompt-submit` with tracking+reminder enabled):
```
plugin_discover_and_load()
  → Discovers: cleanup, reminder, resume, statusline, topic-extraction, tracking
  → Dependencies: reminder depends on tracking
  → Sorted: [cleanup, resume, statusline, topic-extraction, tracking, reminder]
  → Sources all in that order

plugin_invoke_hook("on_user_prompt_submit", session_id, transcript_path, project_dir)
  → cleanup: No on_user_prompt_submit function → skip
  → resume: No on_user_prompt_submit function → skip
  → statusline: No on_user_prompt_submit function → skip
  → topic-extraction: Has on_user_prompt_submit → invoke ✓
  → tracking: Has on_user_prompt_submit → invoke ✓ (increments counter)
  → reminder: Has on_user_prompt_submit → invoke ✓ (reads counter via tracking_get())
```

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

- ✅ Infrastructure complete (modular lib/* with 10 namespace files + plugin loader with dependency resolution)
- ✅ All 6 features implemented as self-contained plugins (topic-extraction, resume, statusline, tracking, reminder, cleanup)
- ✅ **Plugin architecture**: Handlers auto-discover, resolve dependencies (topological sort), and invoke features
- ✅ **Dependency system**: Plugins declare dependencies; loader ensures correct execution order
- ✅ Feature split: tracking (counter only) and reminder (output) are now decoupled with explicit dependency
- ✅ Resume feature refactored (async generation, file-based initialization, no LLM blocking at SessionStart)
- ✅ Installation/uninstallation scripts working for both scopes
- ✅ All unit tests passing (8 suites, 64 tests - mocked LLM, zero API costs)
- ✅ All integration tests passing (7 suites - mocked data, test-llm-providers excluded from default runs)
- ✅ Documentation updated (ARCH.md, PLAN.md, README.md, CLAUDE.md, AGENTS.md)
- 🔄 **In Progress**: Manual testing in real Claude sessions

**Reference Documents**:
- `ARCH.md`: Complete architectural specification
- `PLAN.md`: 8-phase implementation checklist (currently at Phase 5.3)
- `src/sidekick/config.defaults`: All configuration options with documentation