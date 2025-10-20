#!/bin/bash
# Sleeper analysis process - monitors transcript and runs adaptive analysis
# Polls transcript file periodically, analyzing when size changes significantly
# Exits when clarity threshold met or maximum duration exceeded

set -euo pipefail

# Script metadata
readonly SCRIPT_VERSION="1.0.0"
readonly SCRIPT_NAME="$(basename "$0")"

# Parse command-line arguments
usage() {
    cat <<EOF
Usage: $SCRIPT_NAME <session_id> <transcript_path> <output_base_dir>

Arguments:
  session_id       UUID of the conversation session
  transcript_path  Path to JSONL transcript file
  output_base_dir  Base directory for output (parent of tmp/)

Environment Variables:
  CLAUDE_SLEEPER_INTERVAL_ACTIVE      Sleep interval when activity detected (default: 2s)
  CLAUDE_SLEEPER_INTERVAL_IDLE        Sleep interval when idle (default: 5s)
  CLAUDE_SLEEPER_MAX_DURATION         Maximum runtime before exit (default: 600s)
  CLAUDE_SLEEPER_CLARITY_EXIT         Clarity threshold for exit (default: 5)
  CLAUDE_SLEEPER_MIN_SIZE_CHANGE      Minimum bytes changed to trigger analysis (default: 10)
  CLAUDE_SLEEPER_MIN_INTERVAL         Minimum seconds between analyses (default: 2)
  CLAUDE_ANALYSIS_MODE                Analysis mode to use (default: topic-only)
  VERBOSE                             Enable verbose logging (default: false)

Example:
  $SCRIPT_NAME "abc-123" "/path/to/transcript.jsonl" "/project/.claude/hooks/reminders"
EOF
    exit 1
}

# Handle --help flag
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    usage
fi

# Validate arguments
if [ $# -ne 3 ]; then
    usage
fi

session_id="$1"
transcript_path="$2"
output_base_dir="$3"

# Configuration with defaults
SLEEP_ACTIVE=${CLAUDE_SLEEPER_INTERVAL_ACTIVE:-2}
SLEEP_IDLE=${CLAUDE_SLEEPER_INTERVAL_IDLE:-5}
MAX_DURATION=${CLAUDE_SLEEPER_MAX_DURATION:-600}
CLARITY_EXIT=${CLAUDE_SLEEPER_CLARITY_EXIT:-5}
MIN_SIZE_CHANGE=${CLAUDE_SLEEPER_MIN_SIZE_CHANGE:-10}
MIN_ANALYSIS_INTERVAL=${CLAUDE_SLEEPER_MIN_INTERVAL:-2}
ANALYSIS_MODE=${CLAUDE_ANALYSIS_MODE:-topic-only}
VERBOSE="${VERBOSE:-false}"

# Paths
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cache_dir="${output_base_dir}/tmp"

# Create session-specific directory for logs and PID files
session_dir="${cache_dir}/${session_id}"
mkdir -p "$session_dir" 2>/dev/null || true

pid_file="${session_dir}/sleeper.pid"
LOG_FILE="${session_dir}/sleeper.log"

# ANSI color codes for terminal output
readonly COLOR_RESET='\033[0m'
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_YELLOW='\033[0;33m'
readonly COLOR_GRAY='\033[0;90m'

# Logging functions
log() {
    echo "[$(date -Iseconds)] [INFO] $*" >> "$LOG_FILE"
    if [ "$VERBOSE" = true ]; then
        echo -e "${COLOR_GREEN}[SleeperAnalysis]${COLOR_RESET} $*" >&2
    fi
    return 0
}

log_warn() {
    echo "[$(date -Iseconds)] [WARN] $*" >> "$LOG_FILE"
    if [ "$VERBOSE" = true ]; then
        echo -e "${COLOR_YELLOW}[SleeperAnalysis] WARN:${COLOR_RESET} $*" >&2
    fi
    return 0
}

log_debug() {
    if [ "$VERBOSE" = true ]; then
        echo "[$(date -Iseconds)] [DEBUG] $*" >> "$LOG_FILE"
        echo -e "${COLOR_GRAY}[SleeperAnalysis] DEBUG:${COLOR_RESET} $*" >&2
    fi
    return 0
}

# Cleanup on exit
cleanup() {
    local exit_code=$?
    log_debug "Cleanup: removing PID file ${pid_file}"
    rm -f "$pid_file"
    log "Sleeper exited with code: $exit_code"
    exit $exit_code
}
trap cleanup EXIT

# Validate inputs
if [ ! -f "$transcript_path" ]; then
    log_warn "Transcript file not found at start: $transcript_path (will wait for it)"
fi

mkdir -p "$cache_dir" || {
    echo "[SleeperAnalysis] ERROR: Failed to create cache directory: $cache_dir" >&2
    exit 1
}

# Write PID file
echo $$ > "$pid_file"
log "Sleeper started: PID=$$, max_duration=${MAX_DURATION}s, clarity_exit=${CLARITY_EXIT}"

# State tracking
last_size=0
last_analysis_time=0
start_time=$(date +%s)
sleep_interval=$SLEEP_IDLE

# Get file size (cross-platform)
get_file_size() {
    local file="$1"
    if [ ! -f "$file" ]; then
        echo "0"
        return
    fi
    # Try macOS stat first, then Linux stat
    stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "0"
}

# Get clarity score from most recent analysis
get_clarity() {
    local topic_file="${session_dir}/topic.json"
    if [ ! -f "$topic_file" ]; then
        echo "0"
        return
    fi
    jq -r '.clarity_score // 0' "$topic_file" 2>/dev/null || echo "0"
}

# Main polling loop
log_debug "Starting polling loop: active_interval=${SLEEP_ACTIVE}s, idle_interval=${SLEEP_IDLE}s"

while true; do
    current_time=$(date +%s)
    elapsed=$((current_time - start_time))

    # Exit if max duration exceeded
    if [ "$elapsed" -ge "$MAX_DURATION" ]; then
        log "Max duration ${MAX_DURATION}s exceeded, exiting"
        exit 0
    fi

    # Check if transcript exists and get size
    if [ -f "$transcript_path" ]; then
        current_size=$(get_file_size "$transcript_path")
        size_delta=$((current_size - last_size))
        time_since_analysis=$((current_time - last_analysis_time))

        log_debug "Poll: size=${current_size}, delta=${size_delta}, time_since_analysis=${time_since_analysis}s"

        # Decide if we should analyze
        should_analyze=false
        if [ "$size_delta" -ge "$MIN_SIZE_CHANGE" ] && [ "$time_since_analysis" -ge "$MIN_ANALYSIS_INTERVAL" ]; then
            should_analyze=true
        fi

        if [ "$should_analyze" = true ]; then
            log "Transcript grew by ${size_delta} bytes, launching analysis (mode=${ANALYSIS_MODE})"

            # Run analysis synchronously (this is already a background process)
            if "${SCRIPT_DIR}/analyze-transcript.sh" \
                "$session_id" \
                "$transcript_path" \
                "$ANALYSIS_MODE" \
                "$output_base_dir" \
                &>>"$LOG_FILE"; then

                log_debug "Analysis completed successfully"

                # Check clarity from result
                clarity=$(get_clarity)
                log "Analysis complete: clarity_score=${clarity}"

                # Exit if clarity threshold met
                if [ "$clarity" -ge "$CLARITY_EXIT" ]; then
                    log "Clarity threshold met (${clarity} >= ${CLARITY_EXIT}), exiting"
                    exit 0
                fi

                # Update state
                last_size=$current_size
                last_analysis_time=$current_time
                sleep_interval=$SLEEP_ACTIVE  # Active mode - faster polling

            else
                log_warn "Analysis failed, will retry on next poll"
                # Don't update last_analysis_time so we'll retry soon
                sleep_interval=$SLEEP_IDLE  # Back to idle mode
            fi
        else
            # No significant change, return to idle if no recent activity
            if [ "$time_since_analysis" -ge "$((MIN_ANALYSIS_INTERVAL * 2))" ]; then
                sleep_interval=$SLEEP_IDLE
                log_debug "No recent activity, switching to idle polling (${SLEEP_IDLE}s)"
            fi
        fi
    else
        log_debug "Transcript file not yet available: $transcript_path"
        sleep_interval=$SLEEP_IDLE
    fi

    # Sleep before next check
    log_debug "Sleeping for ${sleep_interval}s (next check at $(date -d "+${sleep_interval} seconds" -Iseconds 2>/dev/null || date -v+${sleep_interval}S -Iseconds 2>/dev/null))"
    sleep "$sleep_interval"
done
