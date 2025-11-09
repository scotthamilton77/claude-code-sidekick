#!/bin/bash
# kill-sidekick-processes.sh - Clean up running sidekick processes
#
# Scans .sidekick/**/*.pid files and terminates associated processes.
# Removes PID files after successful termination.
#
# Usage:
#   ./scripts/kill-sidekick-processes.sh [--force]
#
# Options:
#   --force    Use SIGKILL instead of SIGTERM

set -euo pipefail

# Parse arguments
SIGNAL="TERM"
if [[ "${1:-}" == "--force" ]]; then
    SIGNAL="KILL"
fi

# Determine project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SIDEKICK_DIR="$PROJECT_ROOT/.sidekick"

# Check if .sidekick directory exists
if [[ ! -d "$SIDEKICK_DIR" ]]; then
    echo "No .sidekick directory found at: $SIDEKICK_DIR"
    exit 0
fi

# Find all PID files
mapfile -t pid_files < <(find "$SIDEKICK_DIR" -type f -name "*.pid" 2>/dev/null || true)

if [[ ${#pid_files[@]} -eq 0 ]]; then
    echo "No PID files found in $SIDEKICK_DIR"
    exit 0
fi

echo "Found ${#pid_files[@]} PID file(s)"
echo "Using signal: SIG${SIGNAL}"
echo ""

killed_count=0
not_running_count=0
error_count=0

for pid_file in "${pid_files[@]}"; do
    # Read PID from file
    if [[ ! -f "$pid_file" ]]; then
        continue
    fi

    pid=$(cat "$pid_file" 2>/dev/null || echo "")

    if [[ -z "$pid" ]]; then
        echo "WARNING: Empty PID file: $pid_file"
        rm -f "$pid_file"
        ((error_count++))
        continue
    fi

    # Validate PID is a number
    if ! [[ "$pid" =~ ^[0-9]+$ ]]; then
        echo "WARNING: Invalid PID in $pid_file: $pid"
        rm -f "$pid_file"
        ((error_count++))
        continue
    fi

    # Check if process is running
    if ! ps -p "$pid" >/dev/null 2>&1; then
        echo "Process $pid not running (stale PID file: ${pid_file##*/})"
        rm -f "$pid_file"
        ((not_running_count++))
        continue
    fi

    # Get process command for logging
    process_cmd=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")

    # Kill the process
    echo "Killing process $pid ($process_cmd) with SIG${SIGNAL}"
    if kill -s "$SIGNAL" "$pid" 2>/dev/null; then
        # Wait briefly for process to die
        sleep 0.2

        # Verify it's dead
        if ps -p "$pid" >/dev/null 2>&1; then
            echo "  WARNING: Process $pid still running after SIG${SIGNAL}"
            ((error_count++))
        else
            echo "  Process $pid terminated"
            rm -f "$pid_file"
            ((killed_count++))
        fi
    else
        # Kill command failed - check if process is still running
        if ps -p "$pid" >/dev/null 2>&1; then
            echo "  ERROR: Failed to kill process $pid (still running, possible permission issue)"
            echo "  PID file preserved: $pid_file"
            ((error_count++))
        else
            echo "  Process $pid already exited"
            rm -f "$pid_file"
            ((not_running_count++))
        fi
    fi
done

echo ""
echo "Summary:"
echo "  Killed: $killed_count"
echo "  Not running (stale): $not_running_count"
echo "  Errors: $error_count"
echo "  Total processed: ${#pid_files[@]}"

exit 0
