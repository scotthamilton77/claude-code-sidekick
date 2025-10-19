#!/bin/bash
# Async LLM-based transcript analysis
# Analyzes conversation transcripts using Haiku models to extract topic, intent, and analytics
# Runs in detached background process to avoid blocking main conversation hooks

set -euo pipefail

# Script metadata
readonly SCRIPT_VERSION="1.0.0"
readonly SCRIPT_NAME="$(basename "$0")"

# Error trap for debugging
error_trap() {
    local exit_code=$?
    local line_no=$1
    echo "[$(date -Iseconds)] [FATAL] Script failed at line $line_no with exit code $exit_code" >> "${LOG_FILE:-/tmp/claude-analysis-error.log}" 2>&1 || true
}
trap 'error_trap $LINENO' ERR

# Parse command-line arguments
usage() {
    cat <<EOF
Usage: $SCRIPT_NAME <session_id> <transcript_path> <mode> [output_base_dir]

Arguments:
  session_id       UUID of the conversation session
  transcript_path  Path to JSONL transcript file
  mode             Analysis mode: topic-only|incremental|full-analytics
  output_base_dir  Base directory for output (default: <script_dir>)

Environment Variables:
  CLAUDE_ANALYSIS_MODEL    Model to use (default: haiku-4.5)
  CLAUDE_BIN               Path to Claude CLI binary (default: ~/.claude/local/claude)
  VERBOSE                  Enable verbose logging (default: false)

Output:
  Analysis files written to: <output_base_dir>/tmp/ or <output_base_dir>/analytics/

Example:
  $SCRIPT_NAME "abc-123" "/path/to/transcript.jsonl" "topic-only"
  $SCRIPT_NAME "abc-123" "/path/to/transcript.jsonl" "topic-only" "/project/.claude/hooks/reminders"
EOF
    exit 1
}

# Validate arguments
[ $# -ge 3 ] || usage

session_id="$1"
transcript_path="$2"
mode="$3"
output_base_dir="${4:-}"  # Optional 4th parameter

# Configuration
CLAUDE_MODEL="${CLAUDE_ANALYSIS_MODEL:-haiku}"
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
    if [ "$VERBOSE" = true ]; then
        echo -e "${COLOR_GREEN}[AnalyzeTranscript]${COLOR_RESET} $*" >&2
    fi
    return 0
}

log_error() {
    echo "[$(date -Iseconds)] [ERROR] $*" >> "$LOG_FILE"
    echo -e "${COLOR_RED}[AnalyzeTranscript] ERROR:${COLOR_RESET} $*" >&2
    return 0
}

log_warn() {
    echo "[$(date -Iseconds)] [WARN] $*" >> "$LOG_FILE"
    if [ "$VERBOSE" = true ]; then
        echo -e "${COLOR_YELLOW}[AnalyzeTranscript] WARN:${COLOR_RESET} $*" >&2
    fi
    return 0
}

log_debug() {
    if [ "$VERBOSE" = true ]; then
        echo "[$(date -Iseconds)] [DEBUG] $*" >> "$LOG_FILE"
        echo -e "${COLOR_GRAY}[AnalyzeTranscript] DEBUG:${COLOR_RESET} $*" >&2
    fi
    return 0
}

# Cleanup function - called on exit
cleanup() {
    local exit_code=$?
    log_debug "Cleanup: removing workspace ${workspace_dir:-<unset>} and temp files"
    [ -n "${workspace_dir:-}" ] && [ -d "$workspace_dir" ] && rm -rf "$workspace_dir"
    [ -n "${simplified_transcript:-}" ] && [ -f "$simplified_transcript" ] && rm -f "$simplified_transcript"

    # Remove PID tracking file
    if [ -f "$PID_FILE" ]; then
        rm -f "$PID_FILE"
        log_debug "Removed PID file: $PID_FILE"
    fi

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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_DIR="${SCRIPT_DIR}/analysis-prompts"

# Determine base directory for output files
# If output_base_dir provided, use it; otherwise use SCRIPT_DIR
BASE_DIR="${output_base_dir:-$SCRIPT_DIR}"

# Choose output directory based on analysis mode
# topic-only and incremental → tmp/ (ephemeral, frequently overwritten)
# full-analytics → analytics/ (persistent, detailed analysis)
if [ "$mode" = "full-analytics" ]; then
    OUTPUT_DIR="${BASE_DIR}/analytics"
else
    OUTPUT_DIR="${BASE_DIR}/tmp"
fi

PID_FILE="${BASE_DIR}/tmp/${session_id}_analysis.pid"

if [ ! -d "$PROMPT_DIR" ]; then
    log_error "Prompt template directory not found: $PROMPT_DIR"
    exit 1
fi

# Ensure output directory exists
if [ ! -d "$OUTPUT_DIR" ]; then
    log_debug "Creating output directory: $OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR" || {
        log_error "Failed to create output directory: $OUTPUT_DIR"
        exit 1
    }
fi

# Pre-process transcript to extract only message objects
# Converts raw JSONL format to simplified message-only JSONL
# Input: path to transcript file
# Output: path to simplified transcript file
preprocess_transcript() {
    local transcript_path="$1"
    local output_path="$2"

    log_debug "Pre-processing transcript: $transcript_path → $output_path"

    # Extract just the message object from each line
    # - Filter out null messages (lines without .message field)
    # - Filter out tool messages (where content[0].type is "tool_use" or "tool_result")
    # - Remove model, id, and type attributes to reduce size
    # - Write as compact single-line JSON
    jq -c '.message | select(. != null) | select((.content | if type == "array" then (.[0].type != "tool_use" and .[0].type != "tool_result") else true end)) | del(.model, .id, .type)' "$transcript_path" > "$output_path" || {
        log_error "Failed to pre-process transcript"
        return 1
    }

    local line_count=$(wc -l < "$output_path")
    log_debug "Pre-processed $line_count message objects"

    return 0
}

# Extract relevant portion of transcript based on mode
# Now operates on pre-processed message-only transcript
extract_transcript_excerpt() {
    local mode="$1"
    local transcript_path="$2"

    case "$mode" in
        topic-only)
            # Last 3 messages (approximately 500-1000 tokens)
            tail -n 80 "$transcript_path" | jq -s '.'
            ;;
        incremental)
            # Last 20 messages (approximately 2000-5000 tokens)
            tail -n 150 "$transcript_path" | jq -s '.'
            ;;
        full-analytics)
            # Full transcript
            jq -s '.' "$transcript_path"
            ;;
    esac
}

# Pre-process transcript to simplified format (extract message objects only)
simplified_transcript="/tmp/claude-messages-$$-${session_id}.jsonl"
log_debug "Pre-processing transcript to simplified format"
preprocess_transcript "$transcript_path" "$simplified_transcript" || {
    log_error "Failed to pre-process transcript"
    exit 1
}

log_debug "Extracting transcript excerpt for mode: $mode"
transcript_excerpt=$(extract_transcript_excerpt "$mode" "$simplified_transcript") || {
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

# Determine Claude CLI path (handle alias or PATH-based installation)
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

if [ ! -x "$CLAUDE_BIN" ]; then
    log_error "Claude CLI not found. Set CLAUDE_BIN environment variable or ensure claude is in PATH"
    exit 1
fi

log_debug "Using Claude binary: $CLAUDE_BIN"

# Run claude -p (project mode) with JSON output format
# Use timeout to prevent hanging (30s should be plenty for topic-only)
# Exit code 124 = timeout, others = claude errors
# Temporarily disable set -e to capture exit code
set +e
timeout 30s "$CLAUDE_BIN" -p --model "$CLAUDE_MODEL" --setting-sources project <<EOF > "$claude_output" 2> "$claude_errors"
$analysis_prompt
EOF

exit_code=$?
set -e

if [ $exit_code -ne 0 ]; then
    if [ $exit_code -eq 124 ]; then
        log_error "Claude execution timed out after 30 seconds"
    else
        log_error "Claude execution failed (exit code: $exit_code)"
    fi

    # Log both stdout and stderr for debugging
    if [ -s "$claude_errors" ]; then
        log_error "=== Claude stderr ==="
        log_error "$(cat "$claude_errors")"
    fi
    if [ -s "$claude_output" ]; then
        log_error "=== Claude stdout (first 50 lines) ==="
        log_error "$(head -50 "$claude_output")"
    fi

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

# Write output files to tmp directory based on mode
output_file="${OUTPUT_DIR}/${session_id}_topic.json"

# Always write topic file
echo "$json_output" | jq '.' > "$output_file" || {
    log_error "Failed to write topic file: $output_file"
    rm -f "$claude_output" "$claude_errors"
    exit 1
}

log "Wrote topic analysis: $output_file"

# For full analytics mode, also write separate analytics file
if [ "$mode" = "full-analytics" ]; then
    analytics_file="${OUTPUT_DIR}/${session_id}_analytics.json"
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
