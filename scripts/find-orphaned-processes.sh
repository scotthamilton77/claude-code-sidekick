#!/bin/bash
# ============================================================================
# Find Orphaned Sidekick Processes
# ============================================================================
# Detects background processes created by Sidekick that no longer have
# corresponding PID files (orphaned due to session cleanup).
#
# Usage: ./scripts/find-orphaned-processes.sh [--verbose]
#
# This script does NOT kill processes - it only reports them.
# ============================================================================

set -euo pipefail

VERBOSE=false
if [[ "${1:-}" == "--verbose" ]]; then
    VERBOSE=true
fi

# Color codes for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

log_debug() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[DEBUG]${NC} $*"
    fi
}

# ============================================================================
# STEP 1: Find all tracked PIDs in .sidekick/sessions/
# ============================================================================

log_info "Collecting tracked PIDs from .sidekick/sessions/..."

# Find all .sidekick/sessions directories (project and user scope)
TRACKED_PIDS=()
SESSION_DIRS=()

# Project scope
if [ -d ".sidekick/sessions" ]; then
    SESSION_DIRS+=(.sidekick/sessions/*)
fi

# User scope
if [ -d "$HOME/.sidekick/sessions" ]; then
    SESSION_DIRS+=("$HOME/.sidekick/sessions/"*)
fi

# Collect PIDs from all .pid files
PID_FILES_COUNT=0
for session_dir in "${SESSION_DIRS[@]}"; do
    if [ ! -d "$session_dir" ]; then
        continue
    fi

    log_debug "Scanning: $session_dir"

    # Find all .pid files in this session
    while IFS= read -r pid_file; do
        if [ -f "$pid_file" ]; then
            pid=$(cat "$pid_file" 2>/dev/null || echo "")
            if [ -n "$pid" ] && [[ "$pid" =~ ^[0-9]+$ ]]; then
                TRACKED_PIDS+=("$pid")
                PID_FILES_COUNT=$((PID_FILES_COUNT + 1))
                log_debug "  Found tracked PID: $pid ($(basename "$pid_file"))"
            fi
        fi
    done < <(find "$session_dir" -maxdepth 1 -name "*.pid" 2>/dev/null)
done

log_info "Found $PID_FILES_COUNT PID files tracking ${#TRACKED_PIDS[@]} processes"

# ============================================================================
# STEP 2: Find all Sidekick-related bash processes
# ============================================================================

log_info "Searching for Sidekick-related processes..."

# Search for processes matching Sidekick patterns
# Looking for:
# - bash processes containing "sidekick" in command
# - bash processes with "lib/common.sh" (Sidekick library)
# - bash processes with "cleanup_run"

SIDEKICK_PROCESSES=()

# Use ps to find all bash processes with full command line
while IFS= read -r line; do
    # Parse PID and command
    pid=$(echo "$line" | awk '{print $1}')
    cmd=$(echo "$line" | cut -d' ' -f2-)

    # Check if command contains Sidekick indicators
    if echo "$cmd" | grep -Eq "(sidekick|lib/common\.sh|cleanup_run)"; then
        SIDEKICK_PROCESSES+=("$pid|$cmd")
        log_debug "Found Sidekick process: PID=$pid CMD=$cmd"
    fi
done < <(ps -eo pid,args | grep -E 'bash|sh' | grep -v grep | grep -v "$0")

log_info "Found ${#SIDEKICK_PROCESSES[@]} Sidekick-related processes"

# ============================================================================
# STEP 3: Identify orphaned processes
# ============================================================================

log_info "Identifying orphaned processes..."

ORPHANED_COUNT=0
ORPHANED_PROCESSES=()

for proc in "${SIDEKICK_PROCESSES[@]}"; do
    pid=$(echo "$proc" | cut -d'|' -f1)
    cmd=$(echo "$proc" | cut -d'|' -f2-)

    # Check if this PID is in the tracked list
    is_tracked=false
    for tracked_pid in "${TRACKED_PIDS[@]}"; do
        if [ "$pid" = "$tracked_pid" ]; then
            is_tracked=true
            break
        fi
    done

    if [ "$is_tracked" = false ]; then
        ORPHANED_PROCESSES+=("$proc")
        ORPHANED_COUNT=$((ORPHANED_COUNT + 1))
    fi
done

# ============================================================================
# STEP 4: Report findings
# ============================================================================

echo ""
echo "========================================================================"
echo "  ORPHANED SIDEKICK PROCESSES REPORT"
echo "========================================================================"
echo ""

if [ $ORPHANED_COUNT -eq 0 ]; then
    log_info "No orphaned processes found! ✓"
    echo ""
    log_info "All ${#SIDEKICK_PROCESSES[@]} Sidekick processes are properly tracked."
else
    log_warn "Found $ORPHANED_COUNT orphaned process(es):"
    echo ""

    for proc in "${ORPHANED_PROCESSES[@]}"; do
        pid=$(echo "$proc" | cut -d'|' -f1)
        cmd=$(echo "$proc" | cut -d'|' -f2-)

        # Get process details
        start_time=$(ps -o lstart= -p "$pid" 2>/dev/null || echo "Unknown")
        cpu_time=$(ps -o time= -p "$pid" 2>/dev/null || echo "Unknown")

        echo "----------------------------------------"
        echo -e "${YELLOW}PID:${NC}        $pid"
        echo -e "${YELLOW}Started:${NC}    $start_time"
        echo -e "${YELLOW}CPU Time:${NC}   $cpu_time"
        echo -e "${YELLOW}Command:${NC}    $cmd"
        echo ""
    done

    echo "========================================================================"
    echo ""
    log_warn "To kill these processes manually, run:"
    echo ""
    for proc in "${ORPHANED_PROCESSES[@]}"; do
        pid=$(echo "$proc" | cut -d'|' -f1)
        echo "  kill $pid"
    done
    echo ""
    log_warn "Or to force kill all at once:"
    orphaned_pids=$(printf "%s\n" "${ORPHANED_PROCESSES[@]}" | cut -d'|' -f1 | tr '\n' ' ')
    echo "  kill $orphaned_pids"
    echo ""
fi

# Summary statistics
echo "========================================================================"
echo "  SUMMARY"
echo "========================================================================"
echo "  Total Sidekick processes:    ${#SIDEKICK_PROCESSES[@]}"
echo "  Tracked (with PID files):    $((${#SIDEKICK_PROCESSES[@]} - ORPHANED_COUNT))"
echo "  Orphaned (no PID file):      $ORPHANED_COUNT"
echo "========================================================================"
echo ""

exit 0
