#!/bin/bash
# Async LLM-based transcript analysis
# Analyzes conversation transcripts using Haiku models to extract topic, intent, and analytics
# Runs in detached background process to avoid blocking main conversation hooks

set -euo pipefail

# Script metadata
readonly SCRIPT_VERSION="1.0.0"
readonly SCRIPT_NAME="$(basename "$0")"

# Parse command-line arguments
usage() {
    cat <<EOF
Usage: $SCRIPT_NAME <session_id> <transcript_path> <mode> <output_dir>

Arguments:
  session_id       UUID of the conversation session
  transcript_path  Path to JSONL transcript file
  mode             Analysis mode: topic-only|incremental|full-analytics
  output_dir       Directory to write JSON output files

Environment Variables:
  CLAUDE_ANALYSIS_MODEL    Model to use (default: haiku-4.5)
  VERBOSE                  Enable verbose logging (default: false)

Example:
  $SCRIPT_NAME "abc-123" "/path/to/transcript.jsonl" "topic-only" "/tmp/analytics"
EOF
    exit 1
}

# Validate arguments
[ $# -eq 4 ] || usage

session_id="$1"
transcript_path="$2"
mode="$3"
output_dir="$4"

# Configuration
CLAUDE_MODEL="${CLAUDE_ANALYSIS_MODEL:-haiku-4.5}"
VERBOSE="${VERBOSE:-false}"
LOG_FILE="/tmp/claude-analysis-${session_id}.log"

# ANSI color codes for terminal output
readonly COLOR_RESET='\033[0m'
readonly COLOR_RED='\033[0;31m'
readonly COLOR_YELLOW='\033[0;33m'
readonly COLOR_BLUE='\033[0;34m'
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_GRAY='\033[0;90m'

# Logging functions
log() {
    echo "[$(date -Iseconds)] [INFO] $*" >> "$LOG_FILE"
    [ "$VERBOSE" = true ] && echo -e "${COLOR_GREEN}[AnalyzeTranscript]${COLOR_RESET} $*" >&2
}

log_error() {
    echo "[$(date -Iseconds)] [ERROR] $*" >> "$LOG_FILE"
    echo -e "${COLOR_RED}[AnalyzeTranscript] ERROR:${COLOR_RESET} $*" >&2
}

log_warn() {
    echo "[$(date -Iseconds)] [WARN] $*" >> "$LOG_FILE"
    [ "$VERBOSE" = true ] && echo -e "${COLOR_YELLOW}[AnalyzeTranscript] WARN:${COLOR_RESET} $*" >&2
}

log_debug() {
    [ "$VERBOSE" = true ] && echo "[$(date -Iseconds)] [DEBUG] $*" >> "$LOG_FILE"
    [ "$VERBOSE" = true ] && echo -e "${COLOR_GRAY}[AnalyzeTranscript] DEBUG:${COLOR_RESET} $*" >&2
}

# Cleanup function - called on exit
cleanup() {
    local exit_code=$?
    log_debug "Cleanup: removing workspace $workspace_dir"
    [ -n "${workspace_dir:-}" ] && [ -d "$workspace_dir" ] && rm -rf "$workspace_dir"
    log "Analysis completed with exit code: $exit_code"
    exit $exit_code
}
trap cleanup EXIT

# Validation
log "Starting analysis: session=$session_id, mode=$mode, model=$CLAUDE_MODEL"

if [ ! -f "$transcript_path" ]; then
    log_error "Transcript file not found: $transcript_path"
    exit 1
fi

if [ ! -d "$output_dir" ]; then
    log_debug "Creating output directory: $output_dir"
    mkdir -p "$output_dir" || {
        log_error "Failed to create output directory: $output_dir"
        exit 1
    }
fi

# Validate mode
case "$mode" in
    topic-only|incremental|full-analytics)
        log_debug "Valid mode: $mode"
        ;;
    *)
        log_error "Invalid mode: $mode (must be topic-only, incremental, or full-analytics)"
        exit 1
        ;;
esac

# Determine script directory for locating prompt templates
# Support both project scope (.claude/hooks/reminders/) and user scope (~/.claude/hooks/reminders/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_DIR="${SCRIPT_DIR}/analysis-prompts"

if [ ! -d "$PROMPT_DIR" ]; then
    log_error "Prompt template directory not found: $PROMPT_DIR"
    exit 1
fi

# Extract relevant portion of transcript based on mode
extract_transcript_excerpt() {
    local mode="$1"
    local transcript_path="$2"

    case "$mode" in
        topic-only)
            # Last 3 messages (approximately 500-1000 tokens)
            tail -n 6 "$transcript_path" | jq -s '.'
            ;;
        incremental)
            # Last 20 messages (approximately 2000-5000 tokens)
            tail -n 40 "$transcript_path" | jq -s '.'
            ;;
        full-analytics)
            # Full transcript
            jq -s '.' "$transcript_path"
            ;;
    esac
}

log_debug "Extracting transcript excerpt for mode: $mode"
transcript_excerpt=$(extract_transcript_excerpt "$mode" "$transcript_path") || {
    log_error "Failed to extract transcript excerpt"
    exit 1
}

# Load prompt template
prompt_file="${PROMPT_DIR}/${mode}.txt"
if [ ! -f "$prompt_file" ]; then
    log_error "Prompt template not found: $prompt_file"
    exit 1
fi

log_debug "Loading prompt template: $prompt_file"
prompt_template=$(cat "$prompt_file")

# Substitute transcript excerpt into prompt
analysis_prompt="${prompt_template/\{TRANSCRIPT\}/$transcript_excerpt}"

# Create isolated workspace with empty hooks configuration
# This function ensures Claude runs without any hooks that could cause recursion
create_isolated_workspace() {
    local workspace_dir="$1"

    log_debug "Creating isolated workspace: $workspace_dir"

    mkdir -p "$workspace_dir/.claude" || {
        log_error "Failed to create workspace directory: $workspace_dir"
        return 1
    }

    # Write minimal settings.json with empty hooks object to prevent recursion
    # Also disable any other settings that might interfere
    cat > "$workspace_dir/.claude/settings.json" <<'EOF'
{
  "hooks": {},
  "statusline": {
    "enabled": false
  }
}
EOF

    log_debug "Workspace initialized with isolated settings"
    return 0
}

workspace_dir="/tmp/claude-analysis-$$-${session_id}"
create_isolated_workspace "$workspace_dir" || exit 1

# Execute claude -p with Haiku model in isolated workspace
log "Invoking Claude with model: $CLAUDE_MODEL"

cd "$workspace_dir" || {
    log_error "Failed to change to workspace directory"
    exit 1
}

# Capture both stdout and stderr
claude_output=$(mktemp)
claude_errors=$(mktemp)

# Run claude -p (project mode) with JSON output format
# Use timeout to prevent hanging (30s should be plenty for topic-only)
# Exit code 124 = timeout, others = claude errors
timeout 30s claude -p --model "$CLAUDE_MODEL" --settings-source project <<EOF > "$claude_output" 2> "$claude_errors"
$analysis_prompt
EOF

exit_code=$?

if [ $exit_code -ne 0 ]; then
    if [ $exit_code -eq 124 ]; then
        log_error "Claude execution timed out after 30 seconds"
    else
        log_error "Claude execution failed (exit code: $exit_code)"
    fi
    [ -s "$claude_errors" ] && log_error "Stderr: $(cat "$claude_errors")"
    rm -f "$claude_output" "$claude_errors"
    exit 1
fi

# Check for stderr warnings/errors
if [ -s "$claude_errors" ]; then
    log_warn "Claude stderr: $(cat "$claude_errors")"
fi

# Log raw Claude response before parsing
log_debug "Raw Claude response:"
log_debug "$(cat "$claude_output")"

# Extract JSON from Claude output
# Claude may return markdown-wrapped JSON, so extract code block if present
log_debug "Parsing Claude output for JSON"

# Try to extract JSON from markdown code block first
json_output=$(sed -n '/```json/,/```/p' "$claude_output" | sed '1d;$d')

# If no markdown block, assume raw JSON
if [ -z "$json_output" ]; then
    json_output=$(cat "$claude_output")
fi

# Validate JSON
if ! echo "$json_output" | jq empty 2>/dev/null; then
    log_error "Invalid JSON output from Claude"
    log_error "Raw output: $(cat "$claude_output")"
    rm -f "$claude_output" "$claude_errors"
    exit 1
fi

log "Successfully parsed JSON output"

# Write output files based on mode
output_file="${output_dir}/${session_id}_topic.json"

# Always write topic file
echo "$json_output" | jq '.' > "$output_file" || {
    log_error "Failed to write topic file: $output_file"
    rm -f "$claude_output" "$claude_errors"
    exit 1
}

log "Wrote topic analysis: $output_file"

# For full analytics mode, also write separate analytics file
if [ "$mode" = "full-analytics" ]; then
    analytics_file="${output_dir}/${session_id}_analytics.json"
    echo "$json_output" | jq '.' > "$analytics_file" || {
        log_error "Failed to write analytics file: $analytics_file"
        rm -f "$claude_output" "$claude_errors"
        exit 1
    }
    log "Wrote full analytics: $analytics_file"
fi

# Cleanup temp files
rm -f "$claude_output" "$claude_errors"

# Extract key metrics for logging
primary_topic=$(echo "$json_output" | jq -r '.primary_topic // "unknown"')
clarity_score=$(echo "$json_output" | jq -r '.clarity_score // 0')
log "Analysis complete: topic='$primary_topic', clarity=$clarity_score"

exit 0
