# Sidekick Architecture

## Overview

**Sidekick** is a modular, pluggable hooks system for Claude Code that provides conversation intelligence, session continuity, and developer experience enhancements. Built on SOLID principles with DRY extraction of common concerns into a shared library.

### Core Principles

1. **Single Entry Point**: All hooks route through `sidekick.sh <command>`
2. **Shared Library**: Single `lib/common.sh` loaded once per invocation
3. **Feature Independence**: Features are function libraries, independently toggleable
4. **Configuration Cascade**: Project → User → Defaults (shell .conf format)
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
│   ├── config.defaults                    # Default configuration
│   │
│   ├── handlers/
│   │   ├── session-start.sh               # SessionStart orchestrator
│   │   └── user-prompt-submit.sh          # UserPromptSubmit orchestrator
│   │
│   └── features/
│       ├── topic-extraction.sh            # LLM-based conversation analysis
│       ├── resume.sh                      # Session continuity & snarkification
│       ├── statusline.sh                  # Enhanced statusline rendering
│       ├── tracking.sh                    # Request counting
│       ├── cleanup.sh                     # Session directory garbage collection
│       └── prompts/                       # LLM prompt templates
│           ├── topic-only.txt
│           ├── incremental.txt
│           ├── full-analytics.txt
│           └── new-session-topic.txt
│
├── scripts/
│   ├── install.sh                         # Install sidekick (--user|--project|--both)
│   ├── uninstall.sh                       # Remove sidekick installation
│   └── tests/
│       ├── unit/                          # Unit tests for lib/common.sh functions
│       └── integration/                   # Integration tests for full workflows
│
├── .claude/hooks/sidekick/                # Deployment target (after install)
│   ├── sidekick.sh                        # Main entry (copied from src/)
│   ├── sidekick.conf                      # Runtime config (created from defaults)
│   ├── lib/                               # Shared library (copied)
│   ├── handlers/                          # Handlers (copied)
│   └── features/                          # Features (copied)
│
├── .sidekick/sessions/${session_id}/      # Session state (gitignored)
│   ├── sidekick.log                       # Unified log file
│   ├── topic.json                         # Current topic analysis
│   ├── response_count                     # Tracking counter
│   ├── sleeper.pid                        # Sleeper process ID
│   └── analysis.pid                       # Analysis process ID
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
log_error "message"    # Red

# Internal helpers
_log_to_file "level" "message"
_log_format_ansi "level" "message"
```

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

**Configuration Cascade**:
1. Source `src/sidekick/config.defaults`
2. Source `~/.claude/hooks/sidekick/sidekick.conf` (if exists)
3. Source `$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick/sidekick.conf` (if exists)

**Result**: Later sources override earlier ones

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

# Internal helpers
_path_normalize <path>
```

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

#### CLAUDE INVOCATION
```bash
# Find Claude CLI binary
claude_find_bin
# Returns: path to claude binary
# Checks: CLAUDE_BIN env, ~/.claude/local/claude, PATH

# Invoke Claude with isolation and error handling
claude_invoke <model> <prompt> [timeout_seconds]
# Returns: JSON output (extracted from markdown if needed)
# Creates isolated workspace to prevent hook recursion
# Default timeout: 30s

# Extract JSON from Claude output (handles markdown wrapping)
claude_extract_json <claude_output>
```

**Isolation Strategy**: Creates temporary workspace with disabled hooks:
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

### 3. Handlers

**Purpose**: Orchestrate features for specific hook events

Handlers are **sourced** by `sidekick.sh`, not executed as subprocesses.

#### handlers/session-start.sh

**Function**: `handler_session_start()`

**Responsibilities**:
1. Source required feature files
2. Create session directory
3. Initialize tracking counter (if enabled)
4. Launch cleanup in background (if enabled)
5. Generate resume topic from previous session (if enabled)

**Pseudo-code**:
```bash
handler_session_start() {
    local session_id="$1"
    local project_dir="$2"

    # Source features
    source "$SIDEKICK_ROOT/features/tracking.sh"
    config_is_feature_enabled "cleanup" && source "$SIDEKICK_ROOT/features/cleanup.sh"
    config_is_feature_enabled "resume" && source "$SIDEKICK_ROOT/features/resume.sh"

    # Initialize session
    util_create_session_dir "$session_id"

    # Initialize tracking
    config_is_feature_enabled "tracking" && tracking_init "$session_id"

    # Launch cleanup
    config_is_feature_enabled "cleanup" && cleanup_launch "$project_dir"

    # Generate resume topic
    config_is_feature_enabled "resume" && resume_snarkify "$session_id" "$project_dir"
}
```

#### handlers/user-prompt-submit.sh

**Function**: `handler_user_prompt_submit()`

**Responsibilities**:
1. Increment tracking counter
2. Check if sleeper should be launched (first call, topic-extraction enabled)
3. Check if cadence-based analysis is due
4. Check if static reminder is due
5. Output hook JSON if additional context needed

**Pseudo-code**:
```bash
handler_user_prompt_submit() {
    local session_id="$1"
    local transcript_path="$2"
    local project_dir="$3"

    # Source features
    source "$SIDEKICK_ROOT/features/tracking.sh"
    config_is_feature_enabled "topic_extraction" && source "$SIDEKICK_ROOT/features/topic-extraction.sh"

    # Increment counter
    local count=$(tracking_increment "$session_id")

    # Launch sleeper on first call
    if [ "$count" -eq 1 ] && config_is_feature_enabled "topic_extraction"; then
        topic_extraction_sleeper_start "$session_id" "$transcript_path" "$project_dir"
    fi

    # Cadence-based analysis (fallback)
    if config_is_feature_enabled "topic_extraction"; then
        topic_extraction_check_cadence "$session_id" "$transcript_path" "$project_dir" "$count"
    fi

    # Static reminder injection
    local reminder=$(tracking_check_reminder "$count")
    if [ -n "$reminder" ]; then
        json_output_additional_context "$reminder"
    fi
}
```

### 4. Features

**Purpose**: Self-contained, toggleable functionality

Features are **function libraries** - they define functions that are called by handlers.

#### features/topic-extraction.sh

**Functions**:
- `topic_extraction_analyze()` - Run LLM analysis (refactored analyze-transcript.sh)
- `topic_extraction_sleeper_start()` - Launch sleeper process
- `topic_extraction_sleeper_loop()` - Sleeper polling loop (runs as background process)
- `topic_extraction_check_cadence()` - Cadence-based analysis fallback

**Configuration Keys**:
```bash
FEATURE_TOPIC_EXTRACTION=true
TOPIC_MODE=topic-only              # topic-only | incremental | full-analytics
TOPIC_MODEL=haiku-4.5
TOPIC_CADENCE_HIGH=10               # High clarity cadence (responses)
TOPIC_CADENCE_LOW=1                 # Low clarity cadence (responses)
TOPIC_CLARITY_THRESHOLD=7           # Threshold for high/low (1-10)

SLEEPER_ENABLED=true
SLEEPER_INTERVAL_ACTIVE=2           # Polling interval when active (seconds)
SLEEPER_INTERVAL_IDLE=5             # Polling interval when idle (seconds)
SLEEPER_MAX_DURATION=600            # Maximum runtime (seconds)
SLEEPER_CLARITY_EXIT=7              # Clarity score to exit sleeper
SLEEPER_MIN_SIZE_CHANGE=500         # Minimum bytes changed to trigger analysis
SLEEPER_MIN_INTERVAL=10             # Minimum seconds between analyses
```

**Dependencies**: LLM prompt templates in `features/prompts/`

#### features/resume.sh

**Functions**:
- `resume_snarkify()` - Generate resume topic from previous session (refactored snarkify-last-session.sh)

**Configuration Keys**:
```bash
FEATURE_RESUME=true
RESUME_MODEL=haiku-4.5
RESUME_MIN_CLARITY=5                # Minimum clarity to use previous session
```

**Output**: Creates `${session_dir}/topic.json` with resume message

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
- `tracking_increment()` - Increment and return count
- `tracking_check_reminder()` - Check if static reminder is due

**Configuration Keys**:
```bash
FEATURE_TRACKING=true
TRACKING_STATIC_CADENCE=4           # Reminder cadence (responses)
```

**State Files**: `${session_dir}/response_count`

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
FEATURE_TOPIC_EXTRACTION=true
FEATURE_RESUME=true
FEATURE_STATUSLINE=true
FEATURE_TRACKING=true
FEATURE_CLEANUP=true

# ============================================================================
# TOPIC EXTRACTION
# ============================================================================
TOPIC_MODE=topic-only
TOPIC_MODEL=haiku-4.5
TOPIC_CADENCE_HIGH=10
TOPIC_CADENCE_LOW=1
TOPIC_CLARITY_THRESHOLD=7

# ============================================================================
# SLEEPER
# ============================================================================
SLEEPER_ENABLED=true
SLEEPER_INTERVAL_ACTIVE=2
SLEEPER_INTERVAL_IDLE=5
SLEEPER_MAX_DURATION=600
SLEEPER_CLARITY_EXIT=7
SLEEPER_MIN_SIZE_CHANGE=500
SLEEPER_MIN_INTERVAL=10

# ============================================================================
# RESUME
# ============================================================================
RESUME_MODEL=haiku-4.5
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

## Claude Integration

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
            "command": "~/.claude/hooks/sidekick/sidekick.sh session-start \"$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/sidekick/sidekick.sh user-prompt-submit \"$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "~/.claude/hooks/sidekick/sidekick.sh statusline --project-dir \"$CLAUDE_PROJECT_DIR\""
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
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick/sidekick.sh session-start \"$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick/sidekick.sh user-prompt-submit \"$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick/sidekick.sh statusline --project-dir \"$CLAUDE_PROJECT_DIR\""
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
resume_snarkify() → claude_invoke → writes ${session_dir}/topic.json
  ↓
sidekick.sh exits (<100ms)
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
sidekick.sh statusline --project-dir "$CLAUDE_PROJECT_DIR"
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
    sleep $interval
    if transcript changed significantly:
      topic_extraction_analyze()
      if clarity >= threshold: exit
    if elapsed > max_duration: exit
```

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
