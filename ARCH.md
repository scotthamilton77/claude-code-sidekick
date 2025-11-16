# Sidekick Architecture

## Overview

**Sidekick** is a modular, pluggable hooks system for Claude Code that provides conversation intelligence, session continuity, and developer experience enhancements. Built on SOLID principles with DRY extraction of common concerns into a shared library.

### Core Principles

1. **Single Entry Point**: All hooks route through `sidekick.sh <command>`
2. **Shared Library**: Single `lib/common.sh` loaded once per invocation
3. **Feature Independence**: Features are function libraries, independently toggleable
4. **Configuration Cascade**: Versioned Project → Deployed Project → User Persistent → User Installed → Defaults (shell .conf format)
5. **Copy-Based Deployment**: Installation copies files to `.claude/hooks/sidekick/`
6. **No Subprocess Spawning**: Features sourced and called as functions (except intentional background processes)

## Directory Structure

```
claude-config/
├── src/sidekick/                          # Core business logic (source of truth)
│   ├── lib/
│   │   └── common.sh                      # All shared functions (~1000 lines)
│   │
│   ├── sidekick.sh                        # Main entry point & router
│   │
│   ├── config.defaults                    # Core config (features, global)
│   ├── llm-core.defaults                  # LLM infrastructure config
│   ├── llm-providers.defaults             # Provider-specific config
│   ├── features.defaults                  # Feature tuning config
│   │
│   ├── handlers/
│   │   ├── session-start.sh               # SessionStart orchestrator
│   │   └── user-prompt-submit.sh          # UserPromptSubmit orchestrator
│   │
│   ├── features/
│   │   ├── topic-extraction.sh            # LLM-based conversation analysis
│   │   ├── resume.sh                      # Session continuity & snarkification
│   │   ├── statusline.sh                  # Enhanced statusline rendering
│   │   ├── tracking.sh                    # Request counting
│   │   ├── reminder.sh                    # Periodic static reminders
│   │   └── cleanup.sh                     # Session directory garbage collection
│   │
│   ├── prompts/                           # LLM prompt templates (cascadable)
│   │   ├── topic.prompt.txt
│   │   ├── topic.schema.json
│   │   ├── resume.prompt.txt
│   │   └── resume.schema.json
│   │
│   └── reminders/                         # Reminder templates (cascadable)
│       ├── user-prompt-submit-reminder.txt
│       ├── post-tool-use-cadence-reminder.txt
│       ├── post-tool-use-stuck-reminder.txt
│       └── pre-completion-reminder.txt
│
├── scripts/
│   ├── install.sh                         # Install sidekick (--user|--project|--both)
│   ├── uninstall.sh                       # Remove sidekick installation
│   └── tests/
│       ├── unit/                          # Unit tests for lib/common.sh functions
│       └── integration/                   # Integration tests for full workflows
│
├── .claude/hooks/sidekick/                # Deployment target (after install, ephemeral)
│   ├── sidekick.sh                        # Main entry (copied from src/)
│   ├── lib/                               # Shared library (copied)
│   ├── handlers/                          # Handlers (copied)
│   └── features/                          # Features (copied)
│
├── .sidekick/                             # Project-specific state & config
│   ├── sidekick.conf                      # Versioned project config (optional, highest priority)
│   ├── README.md                          # Documentation for this directory
│   ├── sidekick.log                       # Global log file (gitignored)
│   └── sessions/${session_id}/            # Session state (gitignored)
│       ├── sidekick.log                   # Per-session log file
│       ├── topic.json                     # Current topic analysis
│       ├── resume.json                    # Resume message for NEXT session (generated when topic changes)
│       ├── response_count                 # Tracking counter
│       ├── sleeper.pid                    # Sleeper process ID
│       └── analysis.pid                   # Analysis process ID
│
└── ARCH.md, PLAN.md                       # This file and implementation plan
```

## Component Architecture

### 1. Main Entry Point: sidekick.sh

**Purpose**: Route hook events to appropriate handlers

**Execution Flow**:
```bash
sidekick.sh <command> [args...]
  ↓
  1. Source lib/common.sh (loads all shared functions once)
  2. Call config_load() to initialize configuration cascade
  3. Read stdin JSON (for hook events) or parse args
  4. Call log_init() to set up session-specific logging
  5. Route to handler based on command:
     - session-start → handler_session_start()
     - user-prompt-submit → handler_user_prompt_submit()
     - statusline → feature_statusline_render()
```

**Commands**:
- `sidekick.sh session-start` - SessionStart hook
- `sidekick.sh user-prompt-submit` - UserPromptSubmit hook
- `sidekick.sh statusline` - Statusline rendering

**Key Responsibilities**:
- Bootstrap shared library
- Load configuration
- Initialize logging
- Route to handlers
- Handle errors gracefully

### 2. Shared Library: lib/common.sh

**Purpose**: DRY extraction of all shared concerns

**Structure** (organized by namespace):

#### LOGGING
```bash
# Initialize session-specific logging
log_init <session_id>

# Log at various levels (respects LOG_LEVEL config)
log_debug "message"    # Gray, only shown if LOG_LEVEL=debug
log_info "message"     # Green
log_warn "message"     # Yellow
log_error "message"    # Red (ALWAYS visible, bypasses console logging flag)

# Internal helpers
_log_to_file "level" "message"
_log_format_ansi "level" "message"
```

**Two-Tier Console Logging**:
- `log_debug/log_info/log_warn`: Respect `_CONSOLE_LOGGING_ENABLED` flag (can be suppressed)
- `log_error`: ALWAYS outputs to stderr (critical errors bypass flag for visibility)
- File logging: Always enabled regardless of console flag

**Console Logging Control** (precedence, highest to lowest):
1. `--log-to-console` CLI flag (forces true)
2. `SIDEKICK_CONSOLE_LOGGING` environment variable
3. `SIDEKICK_CONSOLE_LOGGING` config file setting
4. Default: false (console logging disabled)

**Hook Integration**: Hook invocation commands (in `settings.json` and `install.sh`) omit console logging flag since default behavior (disabled) is appropriate for JSON output to Claude Code. Use `--log-to-console` flag for debugging when needed.

**Log File Location**: `.sidekick/sessions/${session_id}/sidekick.log`

**ANSI Colors**: Defined as readonly globals (COLOR_RED, COLOR_GREEN, etc.)

#### CONFIGURATION
```bash
# Load config cascade: defaults → user → project
config_load

# Get config value (returns value or empty string)
config_get "KEY_NAME"

# Check if feature enabled (returns 0=true, 1=false)
config_is_feature_enabled "feature_name"

# Validate configuration (called by config_load)
_config_validate
```

**Environment Variable Loading** (`.env` files, sourced first):
0a. Source `~/.sidekick/.env` (optional, user-wide persistent, works in both user-only and project scopes)
0b. Source `$CLAUDE_PROJECT_DIR/.env` (optional, project root, shared with other tools)
0c. Source `$CLAUDE_PROJECT_DIR/.sidekick/.env` (optional, project sidekick-specific, highest priority)

**Configuration Cascade** (modular config files):

**Modular Domains** (loaded in this order at each cascade level):
- `config` - Feature flags, global settings
- `llm-core` - LLM infrastructure (provider, circuit breaker, timeouts, debugging)
- `llm-providers` - Provider-specific configs (API keys, models, endpoints)
- `features` - Feature tuning parameters
- `sidekick` - Legacy single-file override (loads LAST, overrides all domains)

**Cascade Levels** (later overrides earlier):
1. **Defaults**: `src/sidekick/*.defaults` (required, must exist)
2. **User Installed**: `~/.claude/hooks/sidekick/*.conf` (optional, ephemeral)
3. **User Persistent**: `~/.sidekick/*.conf` (optional, survives install/uninstall)
4. **Project Deployed**: `$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick/*.conf` (optional, ephemeral)
5. **Project Versioned**: `$CLAUDE_PROJECT_DIR/.sidekick/*.conf` (optional, **highest priority**, can be committed)

**Loading Order**: At each cascade level, sources: `config.{defaults|conf}` → `llm-core.{defaults|conf}` → `llm-providers.{defaults|conf}` → `features.{defaults|conf}` → `sidekick.conf` (legacy)

**Result**: `.env` files set environment variables (auto-exported via `set -a`), then modular config files cascade. Later sources override earlier ones.

**Templates**: Installation creates `*.conf.template` files in persistent directories by copying `*.defaults` files. Users rename to `*.conf` to activate.

**Key Distinctions**:
- **Installed configs** (`~/.claude/hooks/sidekick/` and `.claude/hooks/sidekick/`): Ephemeral, deleted on uninstall
- **Persistent configs** (`~/.sidekick/` and `.sidekick/`): Survive install/uninstall, can be committed to git
- **Modular overrides**: Domain-specific (e.g., `llm-providers.conf` for LLM settings only)
- **Legacy override**: `sidekick.conf` can override any setting from any domain (single file, loads last)

#### PATH RESOLUTION
```bash
# Detect execution scope (returns "user" or "project")
path_detect_scope

# Get sidekick installation directory
path_get_sidekick_root

# Get session-specific directory (creates if missing)
# Returns: ${CLAUDE_PROJECT_DIR}/.sidekick/sessions/${session_id}/
# Requires: CLAUDE_PROJECT_DIR must be set
path_get_session_dir <session_id>

# Get project directory from JSON input or environment
path_get_project_dir <json_input>

# Resolve file using 4-level cascade (returns first existing file)
path_resolve_cascade <relative_path> [project_dir]
# Example: path_resolve_cascade "prompts/topic.prompt.txt" "$project_dir"
# Cascade: 1. ~/.claude/hooks/sidekick/{path}
#          2. ~/.sidekick/{path}
#          3. ${projectRoot}/.claude/hooks/sidekick/{path}
#          4. ${projectRoot}/.sidekick/{path}
# Returns: absolute path to first existing file, empty if none found
# Exit code: 0 if found, 1 if not found

# Internal helpers
_path_normalize <path>
```

**File Cascade Usage**: Prompts (`prompts/*.prompt.txt`, `prompts/*.schema.json`) and reminders (`reminders/static-reminder.txt`) use `path_resolve_cascade()` to support user and project overrides without modifying installed files. The `.sidekick/` locations survive install/uninstall and are git-committable for team-wide settings.

#### JSON PROCESSING
```bash
# Extract value from JSON using jq
json_get <json_string> <jq_path>
# Example: json_get "$input" ".session_id"

# Convenience extractors
json_get_session_id <json_string>
json_get_transcript_path <json_string>

# Validate JSON syntax
json_validate <json_string>

# Extract JSON from markdown code block
json_extract_from_markdown <text>
```

#### PROCESS MANAGEMENT
```bash
# Launch background process with PID tracking
process_launch_background <session_id> <name> <function> [args...]
# Example: process_launch_background "$sid" "sleeper" sleeper_loop "$transcript"
# Creates: ${session_dir}/${name}.pid
# Logs to: ${session_dir}/${name}.log

# Check if process is running by PID file
process_is_running <pid_file>

# Kill process by PID file (graceful then forceful)
process_kill <pid_file>

# Clean up stale PID files (process no longer running)
process_cleanup_stale_pids <session_dir>
```

#### LLM INVOCATION
```bash
# Find LLM binary for specified provider
llm_find_bin <provider>
# Args: provider name (claude-cli, openai-api, openrouter, custom)
# Returns: path to binary (or "curl" for openai-api/openrouter)
# Checks provider-specific paths and configs

# Invoke LLM with isolation and error handling
llm_invoke <model> <prompt> [timeout_seconds]
# Returns: JSON output (extracted from markdown if needed)
# Creates isolated workspace to prevent hook recursion (for claude-cli)
# Default timeout: 30s

# Extract JSON from LLM output (handles markdown wrapping)
llm_extract_json <llm_output>
```

**Isolation Strategy** (claude-cli only): Creates temporary workspace with disabled hooks:
```json
{
  "hooks": {},
  "statusLine": {"enabled": false}
}
```

#### WORKSPACE MANAGEMENT
```bash
# Create isolated workspace (prevents hook recursion)
workspace_create <session_id>
# Returns: path to workspace
# Creates: /tmp/sidekick-${PID}-${session_id}/

# Cleanup workspace
workspace_cleanup <workspace_path>
```

#### UTILITIES
```bash
# Validate that value is non-negative integer
util_validate_count <value>

# Get file size (cross-platform)
util_get_file_size <file_path>

# Create session directory if missing
util_create_session_dir <session_id>

# Calculate tokens from transcript (rough estimate)
util_calculate_tokens <transcript_path>
```

### 3. Handlers (Generic Plugin Loaders)

**Purpose**: Framework code that discovers and invokes feature plugins

Handlers are **generic and feature-agnostic** - they never need to be edited when adding new features. All feature-specific logic lives in the plugin files themselves.

Handlers are **sourced** by `sidekick.sh`, not executed as subprocesses.

**Plugin Architecture**:
- Handlers auto-discover all `.sh` files in `features/` directory
- Source only those enabled via config (`FEATURE_NAME=true`)
- Invoke standardized hook functions (`{feature}_on_{hook_name}`)
- Aggregate and output any JSON responses

#### handlers/session-start.sh

**Function**: `handler_session_start()`

**Responsibilities**:
1. Create session directory (framework-level task)
2. Discover and load all enabled plugins
3. Invoke `{feature}_on_session_start()` on each plugin

**Implementation**:
```bash
handler_session_start() {
    local session_id="$1"
    local project_dir="$2"

    # Create session directory (framework responsibility)
    util_create_session_dir "$session_id"

    # Discover and load all enabled plugins
    plugin_discover_and_load

    # Invoke on_session_start hook on all loaded plugins
    plugin_invoke_hook "on_session_start" "$session_id" "$project_dir"

    return 0
}
```

**Adding a New Feature**: Just create `features/my-feature.sh` with `my_feature_on_session_start()` - no handler changes needed!

#### handlers/user-prompt-submit.sh

**Function**: `handler_user_prompt_submit()`

**Responsibilities**:
1. Discover and load all enabled plugins
2. Invoke `{feature}_on_user_prompt_submit()` on each plugin
3. Output aggregated JSON responses

**Implementation**:
```bash
handler_user_prompt_submit() {
    local session_id="$1"
    local transcript_path="$2"
    local project_dir="$3"

    # Discover and load all enabled plugins
    plugin_discover_and_load

    # Invoke on_user_prompt_submit hook on all loaded plugins
    local hook_output
    hook_output=$(plugin_invoke_hook "on_user_prompt_submit" "$session_id" "$transcript_path" "$project_dir")

    # Output any JSON returned from plugins
    if [ -n "$hook_output" ]; then
        echo "$hook_output"
    fi

    return 0
}
```

**Adding a New Feature**: Just create `features/my-feature.sh` with `my_feature_on_user_prompt_submit()` - no handler changes needed!

### 3.1 Plugin Discovery and Loading

**Function**: `plugin_discover_and_load()` (in `lib/common.sh`)

**Process**:
1. Scans `features/` directory for all `.sh` files
2. For each file: extracts basename as feature name (e.g., `tracking.sh` → `tracking`)
3. Normalizes feature name for config lookup (replaces hyphens with underscores: `topic-extraction` → `topic_extraction`)
4. Checks `FEATURE_{NAME}=true` in config cascade
5. Sources enabled features in alphabetical order
6. Tracks loaded plugins in `_LOADED_PLUGINS` array

**Feature Name Normalization**:
- **Filenames** may use hyphens: `topic-extraction.sh`
- **Config keys** must use underscores: `FEATURE_TOPIC_EXTRACTION=true`
- **Hook functions** must use underscores: `topic_extraction_on_session_start()`
- Plugin loader automatically converts hyphens to underscores for lookups

### 3.2 Plugin Hook Invocation

**Function**: `plugin_invoke_hook()` (in `lib/common.sh`)

**Process**:
1. Accepts hook name (e.g., `"on_session_start"`) and arguments
2. For each loaded plugin, constructs hook function name: `{feature}_{hook_name}`
3. Normalizes plugin name (hyphens → underscores) for function lookup
4. Checks if function exists using `declare -f`
5. Invokes function with provided arguments
6. Captures stdout output from all hooks
7. Aggregates outputs (concatenated with newlines if multiple)
8. Returns aggregated output to caller

**Hook Function Contract**:
- Name format: `{feature}_on_{hook_name}()`
- Arguments: Hook-specific (documented per hook type below)
- Returns: JSON output to stdout (optional), exit code 0
- Non-fatal failures: Logged but don't stop other plugins

**Available Hook Types**:

**`on_session_start(session_id, project_dir)`**:
- Called once per session initialization
- Used for: counter initialization, background process launch, session state setup
- Example: `tracking_on_session_start()`, `cleanup_on_session_start()`

**`on_user_prompt_submit(session_id, transcript_path, project_dir)`**:
- Called on every user prompt submission
- Used for: counter increments, watchdog processes, reminder checks
- May output JSON for `additionalContext` injection
- Example: `tracking_on_user_prompt_submit()`, `topic_extraction_on_user_prompt_submit()`

### 4. Features (Plugins)

**Purpose**: Self-contained, independently-toggleable functionality modules

Features are **plugins** that export standardized hook functions. Handlers automatically discover and invoke them - no manual registration required.

**Plugin File Structure**:
```bash
#!/bin/bash
# Sidekick Feature: MyFeature
# Description of what this feature does

# Prevent double-sourcing
[[ -n "${_SIDEKICK_FEATURE_MYFEATURE_LOADED:-}" ]] && return 0
readonly _SIDEKICK_FEATURE_MYFEATURE_LOADED=1

# ... internal helper functions ...

#------------------------------------------------------------------------------
# PLUGIN HOOKS (standardized entry points)
#------------------------------------------------------------------------------

# Hook for SessionStart event
myfeature_on_session_start() {
    local session_id="$1"
    local project_dir="$2"

    # Feature logic here...
    # No output needed if just side effects
}

# Hook for UserPromptSubmit event
myfeature_on_user_prompt_submit() {
    local session_id="$1"
    local transcript_path="$2"
    local project_dir="$3"

    # Feature logic here...

    # Optional: output JSON for additionalContext injection
    if [ -n "$some_output" ]; then
        cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "..."
  }
}
JSON
    fi
}
```

**Adding a New Feature**:
1. Create `features/my-feature.sh` with hook functions
2. Add `FEATURE_MY_FEATURE=true` to `config.defaults`
3. Done! Handler automatically discovers and invokes it

**Existing Features**:

#### features/topic-extraction.sh

**Functions**:
- `topic_extraction_analyze()` - Run LLM analysis with preprocessing (extracts `.message`, filters tool messages, strips metadata)
- `topic_extraction_sleeper_start()` - Launch sleeper process
- `topic_extraction_sleeper_loop()` - Sleeper polling loop (runs as background process)
- `resume_generate_async()` - Launch background resume generation when topic changes significantly

**Preprocessing**: Transcript lines are filtered before LLM analysis to reduce token usage:
- Extracts `.message` field from each transcript line
- Filters out `tool_use` and `tool_result` messages (configurable via `TOPIC_FILTER_TOOL_MESSAGES`)
- Strips unnecessary metadata: `.model`, `.id`, `.type`, `.stop_reason`, `.stop_sequence`, `.usage`
- Filters null/empty messages

**Configuration Keys**:
```bash
FEATURE_TOPIC_EXTRACTION=true
TOPIC_EXCERPT_LINES=80              # Transcript lines to analyze (≈3-5 messages)
TOPIC_FILTER_TOOL_MESSAGES=true     # Filter tool_use/tool_result (reduces tokens)

SLEEPER_ENABLED=true
SLEEPER_MAX_DURATION=600            # Maximum inactivity timeout (seconds) - exits after no activity
SLEEPER_MIN_SIZE_CHANGE=500         # Minimum bytes changed to trigger analysis
SLEEPER_MIN_INTERVAL=10             # Minimum seconds between analyses
SLEEPER_MIN_SLEEP=2                 # Minimum dynamic sleep interval (seconds)
SLEEPER_MAX_SLEEP=20                # Maximum dynamic sleep interval (seconds)
                                    # Sleep interval = clarity * 2 (capped between min/max)
```

**Resume Generation Integration**:

When `topic_extraction_analyze()` writes `topic.json`, it checks two conditions:
1. `significant_change: true` (determined by Claude comparing current and previous topic)
2. `clarity_score >= 5` (sufficient understanding to generate meaningful resume)

If both true, triggers `resume_generate_async()` which:
- Launches background process (non-blocking)
- Loads `resume.prompt.txt` prompt template
- Substitutes `{CURRENT_TOPIC}` and `{TRANSCRIPT}` placeholders
- Invokes Claude to generate snarkified resume message for NEXT session
- Writes `resume.json` in current session directory

**Topic Analysis Output Schema**:

All topic extraction prompts now include:
- `significant_change: boolean` - Claude determines if goals/objectives differ meaningfully from previous analysis
- `{PREVIOUS_TOPIC}` placeholder - Previous topic.json content for comparison (if exists)

**Dependencies**: LLM prompt templates loaded via `path_resolve_cascade("prompts/topic.prompt.txt")` and `path_resolve_cascade("prompts/topic.schema.json")`

#### features/resume.sh

**Functions**:
- `resume_snarkify()` - Initialize new session from previous session's resume (refactored from LLM-based generation)

**Architecture**: File-based session initialization (no LLM invocation at SessionStart)

**Workflow**:
1. Called during SessionStart hook
2. Finds most recent session with `resume.json` and `clarity_score >= RESUME_MIN_CLARITY`
3. Reads `resume.json` fields (generated by previous session's topic extraction)
4. Maps resume fields to topic.json schema:
   - `last_task_id` → `task_ids` (converts single ID to expected field)
   - `resume_last_goal_message` → `initial_goal`
   - `last_objective_in_progress` → `current_objective`
   - `snarky_comment` → `snarky_comment`
5. Creates initial `topic.json` in current session directory
6. Sets `resume_from_session: true` flag

**Configuration Keys**:
```bash
FEATURE_RESUME=true
RESUME_MIN_CLARITY=5                # Minimum clarity to use previous session's resume
```

**Input**: Previous session's `resume.json` (created by `resume_generate_async()` in topic-extraction.sh)

**Resume.json Schema**:
```json
{
  "last_task_id": "string or null",
  "resume_last_goal_message": "string (max 60 chars, question format)",
  "last_objective_in_progress": "string (SciFi-themed, max 60 chars)",
  "snarky_comment": "string (witty comment, max 120 chars)"
}
```

**Output**: Creates `${session_dir}/topic.json` initialized from previous resume

**Performance**: Fast (<10ms) - pure file I/O, no LLM calls

**Dependencies**: Resume generation (in `topic-extraction.sh:resume_generate_async()`) loads prompts via `path_resolve_cascade("prompts/resume.prompt.txt")` and `path_resolve_cascade("prompts/resume.schema.json")`

#### features/statusline.sh

**Functions**:
- `feature_statusline_render()` - Render enhanced statusline (refactored statusline.sh)

**Configuration Keys**:
```bash
FEATURE_STATUSLINE=true
STATUSLINE_TOKEN_THRESHOLD=160000   # Token budget threshold
```

**Output**: Formatted statusline string to stdout

#### features/tracking.sh

**Functions**:
- `tracking_init()` - Initialize counter file
- `tracking_increment_turn_count()` - Increment turn counter
- `tracking_increment_tool_count()` - Increment tool counter
- `tracking_increment_tools_this_turn()` - Increment per-turn tool counter
- `tracking_reset_tools_this_turn()` - Reset per-turn tool counter
- `tracking_countdown_decrement()` - Decrement countdown (for cadence checking)
- `tracking_countdown_reset()` - Reset countdown to cadence value

**Configuration**: Auto-enabled (cannot be disabled) - tracking is an infrastructure feature required by other plugins

**State Files**:
- `${session_dir}/turn_count` - Total user prompts
- `${session_dir}/tool_count` - Total tool calls
- `${session_dir}/tools_this_turn` - Tool calls in current turn
- `${session_dir}/turn_countdown` - Countdown for turn-cadence reminders
- `${session_dir}/tool_countdown` - Countdown for tool-cadence reminders

#### features/reminders.sh

**Master switch for all reminder sub-features**

**Functions**:
- `reminder_load_template()` - Load reminder by type (user-prompt-submit, post-tool-use-cadence, post-tool-use-stuck, pre-completion)
- `reminder_check_turn_cadence()` - Check if turn-based reminder is due (uses countdown)
- `reminder_check_tool_cadence()` - Check if tool-based reminder is due (uses countdown)
- `reminder_check_tools_per_turn()` - Check if tools-per-turn threshold exceeded
- `reminder_on_user_prompt_submit()` - UserPromptSubmit hook (checks turn-cadence reminder, resets tools_this_turn)

**Configuration Keys**:
```bash
FEATURE_REMINDERS=true                    # Master switch - gates all reminder sub-features
FEATURE_REMINDER_USER_PROMPT=true         # Turn-cadence reminders (every N user prompts)
FEATURE_REMINDER_TOOL_CADENCE=true        # Tool-cadence reminders (every N total tools)
FEATURE_REMINDER_STUCK_CHECKPOINT=true    # Stuck detection (threshold tools per turn)
FEATURE_REMINDER_PRE_COMPLETION=true      # Pre-completion reminder (before conversation ends after file edits)

USER_PROMPT_CADENCE=4                     # Turn-cadence interval
POST_TOOL_USE_CADENCE=50                  # Tool-cadence interval
POST_TOOL_USE_STUCK_THRESHOLD=20          # Tools per turn threshold
```

**Dependencies**:
- `tracking.sh` - Uses counters and countdowns
- Reminder templates loaded via `path_resolve_cascade("reminders/{type}-reminder.txt", project_dir)`

**Output**: When reminder is due, outputs JSON with `additionalContext`:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "<reminder text content>"
  }
}
```

**Cascade Behavior**: Loads reminder from first existing file (4-level cascade):
1. `~/.claude/hooks/sidekick/reminders/{type}-reminder.txt`
2. `~/.sidekick/reminders/{type}-reminder.txt`
3. `${projectRoot}/.claude/hooks/sidekick/reminders/{type}-reminder.txt`
4. `${projectRoot}/.sidekick/reminders/{type}-reminder.txt`

#### features/post-tool-use.sh

**Auto-enabled when any reminder sub-feature is enabled**

**Functions**:
- `post_tool_use_on_post_tool_use()` - PostToolUse hook (increments tool counters, checks tool-cadence and stuck reminders)

**Configuration**: Auto-enabled when `FEATURE_REMINDER_TOOL_CADENCE`, `FEATURE_REMINDER_STUCK_CHECKPOINT`, or `FEATURE_REMINDER_PRE_COMPLETION` is true

**Dependencies**: `tracking`, `reminders`

#### features/reminder-pre-completion.sh

**Functions**:
- `reminder_pre_completion_on_post_tool_use()` - Sets marker after file edits (Write/Edit/MultiEdit/NotebookEdit)
- `reminder_pre_completion_on_stop()` - Stop hook that injects reminder if marker exists

**Configuration**: Enabled by `FEATURE_REMINDER_PRE_COMPLETION` (gated by `FEATURE_REMINDERS` master switch)

**State Files**: `${session_dir}/.pre-completion-reminder-pending`

**Behavior**: Prevents conversation end without explicit verification after code changes

#### features/cleanup.sh

**Functions**:
- `cleanup_launch()` - Launch garbage collection in background (refactored cleanup-old-sessions.sh)
- `cleanup_run()` - Main cleanup logic (called by background process)

**Configuration Keys**:
```bash
FEATURE_CLEANUP=true
CLEANUP_ENABLED=true
CLEANUP_MIN_COUNT=5                 # Minimum old sessions before cleanup
CLEANUP_AGE_DAYS=2                  # Age threshold in days
CLEANUP_DRY_RUN=false               # Test mode (don't delete)
```

## Configuration Format

**File**: `sidekick.conf` (shell KEY=VALUE format)

**Example**:
```bash
# ============================================================================
# FEATURES - Set to false to disable
# ============================================================================
# Dependency Chain:
#   STATUSLINE (independent, primary UI)
#     └─> TOPIC_EXTRACTION (requires statusline - wasted LLM cost without it)
#           └─> RESUME (requires extracted topics)
#
#   REMINDERS (master switch - gates all reminder sub-features)
#     ├─> REMINDER_USER_PROMPT (turn-cadence)
#     ├─> REMINDER_TOOL_CADENCE (tool-cadence)
#     ├─> REMINDER_STUCK_CHECKPOINT (threshold per turn)
#     └─> REMINDER_PRE_COMPLETION (blocks stop after file edits)
#
# Auto-enabled (cannot be disabled):
#   - TRACKING (infrastructure for counters/countdowns)
#   - POST_TOOL_USE (enabled when any REMINDER_* sub-feature is on)

FEATURE_STATUSLINE=true
FEATURE_TOPIC_EXTRACTION=true
FEATURE_RESUME=true
FEATURE_CLEANUP=true

FEATURE_REMINDERS=true
FEATURE_REMINDER_USER_PROMPT=true
FEATURE_REMINDER_TOOL_CADENCE=true
FEATURE_REMINDER_STUCK_CHECKPOINT=true
FEATURE_REMINDER_PRE_COMPLETION=true

# ============================================================================
# TOPIC EXTRACTION
# ============================================================================
TOPIC_EXCERPT_LINES=80
TOPIC_FILTER_TOOL_MESSAGES=true

# ============================================================================
# SLEEPER
# ============================================================================
SLEEPER_ENABLED=true
SLEEPER_MAX_DURATION=600           # Inactivity timeout (seconds)
SLEEPER_MIN_SIZE_CHANGE=500        # Minimum bytes to trigger analysis
SLEEPER_MIN_INTERVAL=10            # Minimum seconds between analyses
SLEEPER_MIN_SLEEP=2                # Minimum dynamic sleep
SLEEPER_MAX_SLEEP=20               # Maximum dynamic sleep

# ============================================================================
# RESUME
# ============================================================================
RESUME_MIN_CLARITY=5

# ============================================================================
# STATUSLINE
# ============================================================================
STATUSLINE_TOKEN_THRESHOLD=160000

# ============================================================================
# TRACKING
# ============================================================================
TRACKING_STATIC_CADENCE=4

# ============================================================================
# CLEANUP
# ============================================================================
CLEANUP_ENABLED=true
CLEANUP_MIN_COUNT=5
CLEANUP_AGE_DAYS=2
CLEANUP_DRY_RUN=false

# ============================================================================
# GLOBAL
# ============================================================================
LOG_LEVEL=info                      # debug | info | warn | error
CLAUDE_BIN=                         # Override Claude binary path (optional)
```

**Cascade Behavior**:
- `config.defaults` provides all defaults
- User `sidekick.conf` overrides selected keys
- Project `sidekick.conf` overrides user settings

**Loading**: Simple sourcing (bash-native)
```bash
source "$SIDEKICK_ROOT/config.defaults"
[ -f "$HOME/.claude/hooks/sidekick/sidekick.conf" ] && source "$HOME/.claude/hooks/sidekick/sidekick.conf"
[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick/sidekick.conf" ] && source "$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick/sidekick.conf"
```

## LLM Provider System

### Overview

Sidekick uses a pluggable LLM provider architecture to support multiple AI backends for conversation analysis and resume generation. The system abstracts LLM invocation behind a provider interface, allowing drop-in replacement of Claude CLI with OpenAI, OpenRouter, or custom LLM tools.

### Provider Architecture

**Dispatcher**: `llm_invoke(model, prompt, timeout)` - Main entry point
- Reads `LLM_PROVIDER` config to select backend
- Dispatches to provider-specific implementation
- Validates and extracts JSON from response
- Returns structured output or errors

**Provider Implementations**:
- `_llm_invoke_claude_cli()` - Claude Code CLI (default)
  - Preserves workspace isolation to prevent hook recursion
  - Uses isolated .claude/settings.json to disable hooks
- `_llm_invoke_openai_api()` - OpenAI API via curl
  - Direct HTTP calls to OpenAI endpoint
  - Requires API key via config or environment variable
- `_llm_invoke_openrouter()` - OpenRouter API via curl
  - Direct HTTP calls to OpenRouter endpoint
  - Requires API key via config or environment variable
  - OpenAI-compatible API interface
- `_llm_invoke_custom()` - User-defined command template
  - Template substitution: {BIN}, {MODEL}, {PROMPT_FILE}, {TIMEOUT}
  - Maximum flexibility for any LLM tool

### Configuration

**Provider Selection** (config.defaults or sidekick.conf):
```bash
# Select active provider
LLM_PROVIDER=claude-cli  # claude-cli | openai-api | openrouter | custom

# Claude CLI provider
LLM_CLAUDE_BIN=          # Auto-detect: ~/.claude/local/claude or PATH
LLM_CLAUDE_MODEL=haiku   # haiku, sonnet, opus, haiku-4, etc.

# OpenAI API provider
LLM_OPENAI_API_KEY=      # API key (or use OPENAI_API_KEY env var)
LLM_OPENAI_ENDPOINT=https://api.openai.com/v1/chat/completions
LLM_OPENAI_MODEL=gpt-4-turbo

# OpenRouter API provider
LLM_OPENROUTER_API_KEY=  # API key (or use OPENROUTER_API_KEY env var)
LLM_OPENROUTER_ENDPOINT=https://openrouter.ai/api/v1/chat/completions
LLM_OPENROUTER_MODEL=sao10k/l3-lunaris-8b  # sao10k/l3-lunaris-8b, anthropic/claude-3.5-sonnet, etc.

# Custom provider
LLM_CUSTOM_BIN=/path/to/llm-tool
LLM_CUSTOM_MODEL=default
LLM_CUSTOM_COMMAND={BIN} --model {MODEL} < {PROMPT_FILE}
```

### Usage Example

**Topic Extraction** (topic-extraction.sh:256):
```bash
# Get model from provider config
local provider=$(config_get "LLM_PROVIDER")
local model=$(config_get "LLM_CLAUDE_MODEL")  # or LLM_OPENAI_MODEL, etc.

# Invoke LLM
if ! llm_output=$(llm_invoke "$model" "$prompt" 30); then
    log_error "LLM invocation failed"
    return 1
fi
```

**Provider Switching**:
```bash
# Switch to OpenAI in user config (~/.claude/hooks/sidekick/sidekick.conf)
LLM_PROVIDER=openai-api
LLM_OPENAI_API_KEY=sk-...
LLM_OPENAI_MODEL=gpt-4-turbo

# Or use OpenRouter
LLM_PROVIDER=openrouter
LLM_OPENROUTER_API_KEY=sk-or-...
LLM_OPENROUTER_MODEL=sao10k/l3-lunaris-8b

# Or use custom provider
LLM_PROVIDER=custom
LLM_CUSTOM_BIN=/usr/local/bin/ollama
LLM_CUSTOM_MODEL=llama2
LLM_CUSTOM_COMMAND={BIN} run {MODEL} < {PROMPT_FILE}
```

### Error Handling

**Fail-Fast Design**: Single provider per invocation, no fallback chains
- Simpler error paths
- Clearer debugging
- Explicit configuration

**Error Reporting**:
- Binary not found → Exit code 3
- Invalid provider → Exit code 3
- LLM invocation failure → Return code 1 (logged)
- Invalid JSON response → Return code 1 (logged)

## Hook Integration

### Hooks Registration

**User Scope** (`~/.claude/settings.json`):
```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/sidekick/sidekick.sh session-start"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/sidekick/sidekick.sh user-prompt-submit"
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "~/.claude/hooks/sidekick/sidekick.sh statusline"
  }
}
```

**Project Scope** (`.claude/settings.json` or `.claude/settings.local.json`):
```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick/sidekick.sh session-start"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick/sidekick.sh user-prompt-submit"
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick/sidekick.sh statusline"
  }
}
```

### Hook Input/Output

**SessionStart Input** (stdin JSON):
```json
{
  "session_id": "abc-123-...",
  "workspace": {
    "project_dir": "/path/to/project",
    "current_dir": "/path/to/project"
  }
}
```

**UserPromptSubmit Input** (stdin JSON):
```json
{
  "session_id": "abc-123-...",
  "transcript_path": "/path/to/transcript.jsonl",
  "workspace": {
    "project_dir": "/path/to/project"
  }
}
```

**UserPromptSubmit Output** (stdout JSON, optional):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Reminder text to inject into conversation"
  }
}
```

**Statusline Input** (stdin JSON):
```json
{
  "session_id": "abc-123-...",
  "model": {"display_name": "Sonnet 4.5"},
  "workspace": {"current_dir": "/path"},
  "cost": {"total_cost_usd": 1.23},
  "version": "1.2.3"
}
```

**Statusline Output** (stdout plain text):
```
[Sonnet 4.5] | 🪙 125.3K | 78% | 📁 project | ⎇ main | 12.5s | [TASK-123]: Implementing feature X
```

## Execution Patterns

### Pattern 1: Synchronous Hook (session-start)

```
Claude → SessionStart hook
  ↓
sidekick.sh session-start "$CLAUDE_PROJECT_DIR"
  ↓ (reads stdin JSON)
  ↓
handler_session_start()
  ↓
tracking_init() → writes ${session_dir}/response_count
  ↓
cleanup_launch() → process_launch_background → nohup cleanup_run &
  ↓
resume_snarkify() → reads previous resume.json → writes ${session_dir}/topic.json
  ↓
sidekick.sh exits (<10ms) - FAST: no LLM calls
```

### Pattern 2: Cadence Hook with Optional Output (user-prompt-submit)

```
Claude → UserPromptSubmit hook
  ↓
sidekick.sh user-prompt-submit "$CLAUDE_PROJECT_DIR"
  ↓ (reads stdin JSON)
  ↓
handler_user_prompt_submit()
  ↓
count = tracking_increment() → updates ${session_dir}/response_count
  ↓
if count == 1: topic_extraction_sleeper_start() → process_launch_background
  ↓
if count % cadence == 0: topic_extraction_analyze() (async via process_launch_background)
  ↓
if count % 4 == 0: output static reminder JSON
  ↓
sidekick.sh exits (<10ms)
```

### Pattern 3: Statusline Rendering

```
Claude → Statusline request
  ↓
sidekick.sh statusline
  ↓ (reads stdin JSON)
  ↓
feature_statusline_render()
  ↓
read ${session_dir}/topic.json
  ↓
calculate tokens, format output
  ↓
echo formatted statusline
  ↓
sidekick.sh exits (<50ms)
```

### Pattern 4: Background Process (sleeper)

```
handler_user_prompt_submit()
  ↓
topic_extraction_sleeper_start()
  ↓
process_launch_background "sleeper" topic_extraction_sleeper_loop
  ↓
nohup bash -c "topic_extraction_sleeper_loop" &
  ↓ (writes PID to ${session_dir}/sleeper.pid)
  ↓
[Sleeper runs independently]
  while true:
    if inactive_duration > max_duration: exit  # Exit after inactivity timeout
    if transcript changed significantly:
      topic_extraction_analyze()
      update last_activity_time  # Reset inactivity timer
    sleep $dynamic_interval  # Based on clarity * 2 (capped 2-20s)
```

### Pattern 5: Async Resume Generation (triggered by topic change)

```
topic_extraction_analyze()
  ↓
writes ${session_dir}/topic.json
  ↓
checks: significant_change == true && clarity >= 5
  ↓ (if both true)
resume_generate_async()
  ↓
nohup bash -c "generate resume in background" &
  ↓ (doesn't block main flow)
  ↓
[Background process]
  reads ${session_dir}/topic.json (current topic)
  ↓
  extracts transcript excerpt (last ~3-5 messages)
  ↓
  loads features/prompts/resume.prompt.txt
  ↓
  substitutes {CURRENT_TOPIC} and {TRANSCRIPT}
  ↓
  llm_invoke <model> prompt 30s
  ↓
  extracts JSON output
  ↓
  writes ${session_dir}/resume.json
  ↓
  [NEXT session's SessionStart will use this resume.json]
```

**Key Benefits**:
- SessionStart fast (<10ms) - no LLM blocking
- Resume generated from stable/mature topic understanding (end of session)
- Claude determines significance (smarter than hardcoded thresholds)
- Natural first-session handling (no resume.json = graceful skip)

## Function Naming Convention

**Namespace Prefixes**:
- `log_*` - Logging functions
- `config_*` - Configuration functions
- `path_*` - Path resolution functions
- `json_*` - JSON processing functions
- `process_*` - Process management functions
- `claude_*` - Claude invocation functions
- `workspace_*` - Workspace management functions
- `util_*` - Utility functions
- `handler_*` - Hook handlers
- `feature_*` - Feature entry points (direct calls from sidekick.sh)
- `{feature}_*` - Feature-specific functions (e.g., `tracking_init`, `resume_snarkify`)
- `_*` - Internal/private functions (not meant to be called externally)

**Examples**:
- Public API: `log_info()`, `config_get()`, `tracking_increment()`
- Internal helpers: `_log_to_file()`, `_config_validate()`

## Error Handling

**Strategy**: Fail fast with clear error messages

**set -euo pipefail**: Applied in `sidekick.sh` and all sourced files

**Error Traps**: Capture line number and log errors
```bash
error_trap() {
    log_error "Failed at line $1 with exit code $?"
}
trap 'error_trap $LINENO' ERR
```

**Graceful Degradation**:
- If feature disabled: skip silently
- If config missing: use defaults
- If LLM fails: log error, don't crash hook
- If background process fails: log to PID-specific log, don't affect main flow

**Exit Codes**:
- `0` - Success
- `1` - General error (logged)
- `2` - Configuration error
- `3` - Dependency missing (jq, claude, etc.)

## Testing Strategy

### Unit Tests

**Location**: `scripts/tests/unit/`

**Approach**: Test individual functions from `lib/common.sh`

**Example**:
```bash
#!/bin/bash
# Test logging functions

source "$(dirname "$0")/../../src/sidekick/lib/common.sh"

test_log_debug_respects_level() {
    LOG_LEVEL=info
    output=$(log_debug "test" 2>&1)
    [ -z "$output" ] # Should be empty
}

test_log_info_outputs() {
    LOG_LEVEL=info
    output=$(log_info "test" 2>&1)
    [[ "$output" == *"test"* ]]
}

# Run tests
test_log_debug_respects_level
test_log_info_outputs
echo "All tests passed"
```

**Coverage**: All public functions in `lib/common.sh`

### Integration Tests

**Location**: `scripts/tests/integration/`

**Approach**: Test full hook workflows with mocked Claude CLI

**Example**:
```bash
#!/bin/bash
# Test session-start workflow

# Create test environment
TEST_DIR=$(mktemp -d)
export CLAUDE_PROJECT_DIR="$TEST_DIR"
export CLAUDE_BIN="$TEST_DIR/mock-claude"

# Create mock Claude CLI
cat > "$CLAUDE_BIN" <<'EOF'
#!/bin/bash
echo '{"session_id":"test","initial_goal":"Test","clarity_score":8}'
EOF
chmod +x "$CLAUDE_BIN"

# Run session-start
echo '{"session_id":"test-123"}' | ./src/sidekick/sidekick.sh session-start "$TEST_DIR"

# Verify outputs
[ -f "$TEST_DIR/.sidekick/sessions/test-123/response_count" ]
[ -f "$TEST_DIR/.sidekick/sessions/test-123/topic.json" ]

# Cleanup
rm -rf "$TEST_DIR"
echo "Integration test passed"
```

**Coverage**: All hook commands, feature toggles, configuration cascade

### Manual Testing

**Checklist**:
1. Install to user scope → verify files copied
2. Install to project scope → verify files copied
3. Trigger SessionStart → verify logs, topic file
4. Trigger UserPromptSubmit 10x → verify counter, sleeper, analysis
5. Check statusline → verify rendering with topic
6. Toggle features off → verify skipped
7. Override config at project level → verify cascade
8. Uninstall → verify cleanup

## Performance Targets

**Hook Execution Times**:
- SessionStart: <100ms (includes resume LLM call)
- UserPromptSubmit: <10ms (background processes don't count)
- Statusline: <50ms

**Memory Usage**:
- Sourcing `common.sh`: ~2MB
- Background processes: <10MB each

**Disk Usage**:
- Installation: ~100KB (scripts + prompts)
- Runtime state: ~1MB per session (logs + JSON)

## Security Considerations

**Isolation**:
- Hooks run in Claude's security context
- LLM invocations use isolated workspace (prevents recursion)
- No network calls except Claude CLI
- No sudo/elevated permissions

**Input Validation**:
- Session IDs validated (UUID format)
- JSON parsed with jq (safe)
- File paths normalized (prevent traversal)
- Config values validated on load

**Secrets**:
- No API keys stored
- Claude CLI handles authentication
- Logs may contain conversation content (gitignored)

## Migration from Reminders

**Breaking Changes**:
- Directory rename: `.claude/hooks/reminders/` → `.claude/hooks/sidekick/`
- Hook commands change: `response-tracker.sh` → `sidekick.sh`
- Config format change: env vars → `sidekick.conf`
- Log consolidation: multiple logs → `sidekick.log`

**Migration Path**:
1. Install sidekick (keeps reminders intact)
2. Test sidekick functionality
3. Uninstall reminders (manual `uninstall.sh`)
4. Remove `.claude/hooks/reminders/` directory

**Compatibility**: None (clean break)

## Future Extensions

**Potential Features**:
- Git change tracking
- Code metrics extraction
- Custom reminder templates
- Analytics dashboard
- Multi-session topic correlation

**Architecture Support**:
- New features added as `features/{name}.sh`
- Handlers source new features
- Config keys namespaced by feature
- Zero changes to `lib/common.sh` required (ideally)
