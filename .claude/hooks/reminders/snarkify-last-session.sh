#!/bin/bash
# Snarkify last session - creates resume statusline from previous session
# Runs on SessionStart to proactively generate resume message with personality
# Finds last topic file with good clarity and generates snarky resume comment

set -euo pipefail

# Script metadata
readonly SCRIPT_VERSION="1.0.0"
readonly SCRIPT_NAME="$(basename "$0")"

# Parse command-line arguments
usage() {
    cat <<EOF
Usage: $SCRIPT_NAME [project_dir]

Arguments:
  project_dir  (Optional) Project root directory for .claude/hooks/reminders/tmp
               Falls back to CLAUDE_PROJECT_DIR environment variable if not provided

Reads JSON from stdin with format: {"session_id":"..."}

Example:
  echo '{"session_id":"abc-123"}' | $SCRIPT_NAME /path/to/project
  echo '{"session_id":"abc-123"}' | CLAUDE_PROJECT_DIR=/path/to/project $SCRIPT_NAME
EOF
    exit 1
}

# Handle --help flag
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    usage
fi

# Configuration
VERBOSE="${VERBOSE:-false}"
DRY_RUN="${CLAUDE_SNARK_DRY_RUN:-false}"
SNARK_MODEL="${CLAUDE_SNARK_MODEL:-haiku}"

# Paths
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve Claude binary path (aliases not available in non-interactive shells)
CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.claude/local/claude}"
if [ ! -x "$CLAUDE_BIN" ]; then
    # Fallback: try to find in common locations
    for path in "$HOME/.claude/local/claude" "$(command -v claude 2>/dev/null)"; do
        if [ -x "$path" ]; then
            CLAUDE_BIN="$path"
            break
        fi
    done
fi

# ANSI color codes
readonly COLOR_RESET='\033[0m'
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_YELLOW='\033[0;33m'
readonly COLOR_GRAY='\033[0;90m'

# Logging functions
log() {
    echo "[$(date -Iseconds)] [INFO] $*" >> "$LOG_FILE"
    if [ "$VERBOSE" = true ]; then
        echo -e "${COLOR_GREEN}[Snarkify]${COLOR_RESET} $*" >&2
    fi
    return 0
}

log_warn() {
    echo "[$(date -Iseconds)] [WARN] $*" >> "$LOG_FILE"
    if [ "$VERBOSE" = true ]; then
        echo -e "${COLOR_YELLOW}[Snarkify] WARN:${COLOR_RESET} $*" >&2
    fi
    return 0
}

log_debug() {
    if [ "$VERBOSE" = true ]; then
        echo "[$(date -Iseconds)] [DEBUG] $*" >> "$LOG_FILE"
        echo -e "${COLOR_GRAY}[Snarkify] DEBUG:${COLOR_RESET} $*" >&2
    fi
    return 0
}

# Get project directory from parameter (preferred) or environment variable (fallback)
project_dir="${1:-${CLAUDE_PROJECT_DIR:-}}"

if [ -z "$project_dir" ]; then
    echo "[$(date -Iseconds)] [WARN] No project directory provided (parameter or CLAUDE_PROJECT_DIR), cannot locate cache directory" >&2
    exit 0
fi

# Set log file to project-local tmp directory
LOG_FILE="${project_dir}/.claude/hooks/reminders/tmp/snarkify-last-session.log"

# Read session_id from stdin JSON (SessionStart hook input)
input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id' 2>/dev/null || echo "")

if [ -z "$session_id" ]; then
    log_warn "No session_id found in input, exiting"
    exit 0
fi

log "Starting snarkify for session: $session_id"

# Determine cache directory
cache_dir="${project_dir}/.claude/hooks/reminders/tmp"
current_topic="${cache_dir}/${session_id}_topic.json"

log_debug "Cache directory: $cache_dir"
log_debug "Current topic file: $current_topic"

# Skip if current topic already exists
if [ -f "$current_topic" ]; then
    log_debug "Current session topic already exists, skipping"
    exit 0
fi

# Ensure cache directory exists
mkdir -p "$cache_dir" || {
    log_warn "Failed to create cache directory: $cache_dir"
    exit 1
}

# Find most recent topic file with clarity > 5
# Use jq to filter and sort, output: timestamp|filename
last_topic=$(find "$cache_dir" -name "*_topic.json" -type f 2>/dev/null | \
    while read -r file; do
        clarity=$(jq -r '.clarity_score // 0' "$file" 2>/dev/null || echo "0")
        timestamp=$(jq -r '.timestamp // ""' "$file" 2>/dev/null || echo "")
        if [ "$clarity" -gt 5 ] && [ -n "$timestamp" ]; then
            echo "${timestamp}|${file}"
        fi
    done | sort -r | head -1 | cut -d'|' -f2)

if [ -z "$last_topic" ] || [ ! -f "$last_topic" ]; then
    log_debug "No previous session found with clarity > 5"
    exit 0
fi

log "Found previous session topic: $last_topic"

# Load prompt template
prompt_template="${SCRIPT_DIR}/analysis-prompts/new-session-topic.txt"
if [ ! -f "$prompt_template" ]; then
    log_warn "Prompt template not found: $prompt_template, using fallback"
    # Fallback to manual construction
    last_goal=$(jq -r '.current_objective // .initial_goal // "previous work"' "$last_topic" 2>/dev/null || echo "previous work")
    cat > "$current_topic" <<EOF
{
  "session_id": "${session_id}",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "task_ids": [],
  "initial_goal": "Shall we resume ${last_goal}?",
  "current_objective": "Navigate the space-time continuum of code",
  "intent_category": "development",
  "clarity_score": 6,
  "confidence": 0.7,
  "high_clarity_snarky_comment": null,
  "low_clarity_snarky_comment": "Back to work, because apparently we weren't done the first time",
  "resume_from_session": true
}
EOF
    log "Created resume topic file (fallback): $current_topic"
    exit 0
fi

# Build analysis prompt by combining template and previous topic JSON
# Use here-doc to properly handle multi-line JSON
analysis_prompt=$(cat "$prompt_template")
analysis_prompt="${analysis_prompt/\{PREVIOUS_TOPIC\}/$(cat "$last_topic")}"

log_debug "Generating resume topic with model: $SNARK_MODEL (dry_run=$DRY_RUN)"

# Create isolated workspace to prevent hook recursion
create_isolated_workspace() {
    local workspace_dir="$1"

    mkdir -p "$workspace_dir/.claude" || {
        log_warn "Failed to create workspace directory: $workspace_dir"
        return 1
    }

    # Disable hooks and statusline to prevent recursion
    cat > "$workspace_dir/.claude/settings.json" <<'EOF'
{
  "hooks": {},
  "statusLine": null
}
EOF
    return 0
}

workspace_dir="/tmp/claude-snarkify-$$-${session_id}"
create_isolated_workspace "$workspace_dir" || {
    log_warn "Failed to create isolated workspace, using dry-run fallback"
    DRY_RUN="true"
}

# Call Claude for analysis (or use dry-run fallback)
if [ "$DRY_RUN" = "true" ]; then
    # Dry-run fallback
    last_goal=$(jq -r '.current_objective // .initial_goal // "previous work"' "$last_topic" 2>/dev/null || echo "previous work")
    initial_goal="Shall we resume ${last_goal}?"
    current_objective="Navigate the space-time continuum of code"
    snark="[DRY-RUN] Back to ${last_goal}, because apparently we weren't done the first time"
    log "Using dry-run values"
else
    # Call LLM with prompt in isolated workspace to prevent hook recursion
    llm_output=$(cd "$workspace_dir" && echo "$analysis_prompt" | "$CLAUDE_BIN" -p --model "$SNARK_MODEL" --setting-sources project 2>>"$LOG_FILE")

    log_debug "Raw LLM output: $llm_output"

    # Extract JSON (try markdown code block first, then raw JSON)
    llm_json=$(echo "$llm_output" | sed -n '/```json/,/```/p' | sed '1d;$d')
    if [ -z "$llm_json" ]; then
        # Fallback: try extracting raw JSON
        llm_json=$(echo "$llm_output" | sed -n '/^{/,/^}/p')
    fi

    log_debug "Extracted JSON: $llm_json"

    if [ -z "$llm_json" ] || ! echo "$llm_json" | jq empty 2>/dev/null; then
        log_warn "LLM returned no valid JSON, using fallback"
        last_goal=$(jq -r '.current_objective // .initial_goal // "previous work"' "$last_topic" 2>/dev/null || echo "previous work")
        initial_goal="Shall we resume ${last_goal}?"
        current_objective="Navigate the space-time continuum of code"
        snark="Ah yes, picking up where we left off. What could possibly go wrong?"
    else
        # Extract fields from LLM response
        initial_goal=$(echo "$llm_json" | jq -r '.initial_goal // ""')
        current_objective=$(echo "$llm_json" | jq -r '.current_objective // ""')
        snark=$(echo "$llm_json" | jq -r '.snarky_comment // ""')

        # Validate we got values
        if [ -z "$initial_goal" ] || [ -z "$current_objective" ] || [ -z "$snark" ]; then
            log_warn "LLM response missing required fields, using fallback"
            last_goal=$(jq -r '.current_objective // .initial_goal // "previous work"' "$last_topic" 2>/dev/null || echo "previous work")
            initial_goal="Shall we resume ${last_goal}?"
            current_objective="Navigate the space-time continuum of code"
            snark="Ah yes, picking up where we left off. What could possibly go wrong?"
        else
            log "Extracted from LLM: initial_goal='$initial_goal', current_objective='$current_objective'"
        fi
    fi
fi

# Build full JSON structure with extracted values
cat > "$current_topic" <<EOF
{
  "session_id": "${session_id}",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "task_ids": null,
  "initial_goal": "${initial_goal}",
  "current_objective": "${current_objective}",
  "intent_category": "development",
  "clarity_score": 0,
  "confidence": 0.7,
  "high_clarity_snarky_comment": null,
  "low_clarity_snarky_comment": "${snark}",
  "resume_from_session": true
}
EOF

log "Created resume topic file: $current_topic"

log_debug "Resume topic content: $(cat "$current_topic")"

# Cleanup isolated workspace
rm -rf "$workspace_dir" 2>/dev/null || true

exit 0
