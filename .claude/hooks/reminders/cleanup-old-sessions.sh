#!/bin/bash
# Cleanup old session directories from tmp/
# This script performs garbage collection on session directories, removing old sessions
# when the count of old sessions exceeds a threshold. Age is measured by the newest file
# in each session directory.
#
# Usage: cleanup-old-sessions.sh <output_base_dir> [--verbose]
#   output_base_dir: Parent directory of tmp/ (e.g., /project/.claude/hooks/reminders)
#   --verbose, -v: Enable detailed logging
#
# Configuration via environment variables:
#   CLAUDE_TMP_CLEANUP_ENABLED (default: true) - Enable/disable cleanup
#   CLAUDE_TMP_CLEANUP_MIN_COUNT (default: 5) - Minimum old sessions before cleanup triggers
#   CLAUDE_TMP_CLEANUP_AGE_DAYS (default: 2) - Age threshold in days
#   CLAUDE_TMP_CLEANUP_DRY_RUN (default: false) - Test mode, don't actually delete
#   VERBOSE (default: false) - Enable detailed logging
#
# This script is designed to run as a detached background process (via nohup) from
# response-tracker.sh during session initialization.

# Strict error handling (but allow grep to fail gracefully)
set -euo pipefail

# Parse command line arguments
VERBOSE=${VERBOSE:-false}

# First argument is required (output_base_dir)
if [ $# -lt 1 ]; then
    echo "[CleanupSessions] ERROR: Missing required argument: output_base_dir" >&2
    exit 1
fi

output_base_dir="$1"
shift  # Remove output_base_dir from args

# Parse remaining flags
while [[ $# -gt 0 ]]; do
    case "$1" in
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        *)
            echo "[CleanupSessions] WARNING: Unknown option: $1" >&2
            shift
            ;;
    esac
done

# Export VERBOSE so child processes inherit it
export VERBOSE

tmp_dir="${output_base_dir}/tmp"

# Configuration
CLEANUP_ENABLED=${CLAUDE_TMP_CLEANUP_ENABLED:-true}
MIN_COUNT=${CLAUDE_TMP_CLEANUP_MIN_COUNT:-5}
AGE_DAYS=${CLAUDE_TMP_CLEANUP_AGE_DAYS:-2}
DRY_RUN=${CLAUDE_TMP_CLEANUP_DRY_RUN:-false}
SKIP_SAFETY=${CLAUDE_TMP_CLEANUP_SKIP_SAFETY:-false}  # For testing only

# Logging helpers
# NOTE: log_debug must return 0 even when VERBOSE=false to avoid triggering set -e
log_debug() {
    [ "$VERBOSE" = true ] && echo "[CleanupSessions] DEBUG: $1" >&2 || true
}

log_info() {
    echo "[CleanupSessions] INFO: $1" >&2
}

log_warning() {
    echo "[CleanupSessions] WARNING: $1" >&2
}

log_error() {
    echo "[CleanupSessions] ERROR: $1" >&2
}

# Early exit if disabled
if [ "$CLEANUP_ENABLED" != true ]; then
    log_debug "Cleanup disabled (CLAUDE_TMP_CLEANUP_ENABLED=$CLEANUP_ENABLED)"
    exit 0
fi

log_debug "Starting cleanup: tmp_dir=$tmp_dir, min_count=$MIN_COUNT, age_days=$AGE_DAYS, dry_run=$DRY_RUN"

# Verify tmp directory exists
if [ ! -d "$tmp_dir" ]; then
    log_debug "No tmp directory found at: $tmp_dir"
    exit 0
fi

# Verify path safety (must be under .claude/hooks/reminders/tmp)
# Can be skipped for testing with CLAUDE_TMP_CLEANUP_SKIP_SAFETY=true
if [ "$SKIP_SAFETY" != true ]; then
    if [[ ! "$tmp_dir" =~ /.claude/hooks/reminders/tmp$ ]]; then
        log_error "Invalid tmp_dir path (safety check failed): $tmp_dir"
        exit 1
    fi
fi

# Find all session directories matching UUID pattern
# UUID format: 8-4-4-4-12 hex digits
uuid_pattern="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
session_dirs=()

while IFS= read -r -d '' dir; do
    basename=$(basename "$dir")
    # Validate UUID pattern for safety
    if [[ "$basename" =~ ^$uuid_pattern$ ]]; then
        session_dirs+=("$dir")
    else
        log_warning "Skipping non-UUID directory: $basename"
    fi
done < <(find "$tmp_dir" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null || true)

total_count=${#session_dirs[@]}
log_debug "Found $total_count session directories"

if [ $total_count -eq 0 ]; then
    log_debug "No session directories to process"
    exit 0
fi

# Calculate age for each session directory
# Age is based on the newest file in the directory
current_time=$(date +%s)
age_threshold_seconds=$((AGE_DAYS * 24 * 60 * 60))

declare -A session_ages  # session_dir -> age_in_seconds
old_sessions=()

for session_dir in "${session_dirs[@]}"; do
    # Find newest file in session directory
    # Using -printf '%T@' to get modification time as Unix timestamp
    newest_file_time=$(find "$session_dir" -type f -printf '%T@\n' 2>/dev/null | sort -nr | head -1)

    if [ -z "$newest_file_time" ]; then
        # Empty directory or no files - use directory mtime
        newest_file_time=$(stat -c '%Y' "$session_dir" 2>/dev/null || echo "$current_time")
    fi

    # Convert to integer (truncate fractional seconds)
    newest_file_time=${newest_file_time%.*}

    # Calculate age in seconds
    age=$((current_time - newest_file_time))
    session_ages["$session_dir"]=$age

    # Filter sessions older than threshold
    if [ $age -ge $age_threshold_seconds ]; then
        old_sessions+=("$session_dir")
        age_days=$((age / 86400))
        log_debug "Old session: $(basename "$session_dir") (${age_days} days old)"
    fi
done

old_count=${#old_sessions[@]}
log_info "Found $old_count old sessions (>$AGE_DAYS days) out of $total_count total"

# Only cleanup if we exceed the minimum count threshold
if [ $old_count -le $MIN_COUNT ]; then
    log_info "Old session count ($old_count) <= threshold ($MIN_COUNT), no cleanup needed"
    exit 0
fi

# Sort old sessions by age (oldest first) for deletion
# We'll remove sessions to bring the old count down to the threshold
sessions_to_remove=$((old_count - MIN_COUNT))
log_info "Will remove $sessions_to_remove oldest sessions to reach threshold of $MIN_COUNT"

# Create array of [age session_dir] for sorting
age_dir_pairs=()
for session_dir in "${old_sessions[@]}"; do
    age=${session_ages["$session_dir"]}
    age_dir_pairs+=("$age $session_dir")
done

# Sort by age (descending) and extract session directories
IFS=$'\n' sorted_pairs=($(sort -rn <<<"${age_dir_pairs[*]}"))
unset IFS

# Remove the oldest sessions
removed_count=0
for i in $(seq 0 $((sessions_to_remove - 1))); do
    pair="${sorted_pairs[$i]}"
    session_dir="${pair#* }"  # Extract session_dir from "age session_dir"
    age=${session_ages["$session_dir"]}
    age_days=$((age / 86400))
    session_id=$(basename "$session_dir")

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Would remove: $session_id (${age_days} days old)"
    else
        log_info "Removing: $session_id (${age_days} days old)"
        if rm -rf "$session_dir" 2>/dev/null; then
            removed_count=$((removed_count + 1))
        else
            log_error "Failed to remove: $session_dir"
        fi
    fi
done

if [ "$DRY_RUN" = true ]; then
    log_info "Dry-run complete: would have removed $sessions_to_remove sessions"
else
    log_info "Cleanup complete: removed $removed_count of $sessions_to_remove sessions"
fi

exit 0
