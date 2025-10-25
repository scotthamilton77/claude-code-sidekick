#!/bin/bash
# test-process.sh - Unit tests for process management functions
#
# Tests the PROCESS MANAGEMENT namespace from lib/common.sh

set -euo pipefail

# Colors for test output
readonly GREEN='\033[0;32m'
readonly RED='\033[0;31m'
readonly RESET='\033[0m'

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Setup test environment
setup() {
    TEST_DIR=$(mktemp -d)

    # Mock path functions for testing
    path_get_sidekick_root() {
        echo "${TEST_DIR}"
    }
    export -f path_get_sidekick_root

    path_get_session_dir() {
        local session_id="$1"
        local session_dir="${TEST_DIR}/sessions/${session_id}"
        mkdir -p "$session_dir"
        echo "$session_dir"
    }
    export -f path_get_session_dir

    # Source common.sh
    # shellcheck disable=SC1091
    source "$(dirname "$0")/../../../src/sidekick/lib/common.sh" 2>/dev/null || true
}

# Teardown test environment
teardown() {
    # Kill any test processes
    find "$TEST_DIR" -name "*.pid" -type f 2>/dev/null | while read -r pid_file; do
        if [ -f "$pid_file" ]; then
            local pid
            pid=$(cat "$pid_file" 2>/dev/null || echo "")
            if [ -n "$pid" ]; then
                kill -KILL "$pid" 2>/dev/null || true
            fi
        fi
    done

    rm -rf "$TEST_DIR"
}

# Test helper
run_test() {
    local test_name="$1"
    TESTS_RUN=$((TESTS_RUN + 1))

    if "$test_name"; then
        echo -e "${GREEN}✓${RESET} ${test_name}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "${RED}✗${RESET} ${test_name}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# Dummy function for background process testing
test_dummy_function() {
    local sleep_time="${1:-1}"
    echo "Background process running"
    sleep "$sleep_time"
    echo "Background process complete"
}
export -f test_dummy_function

# Test: process_launch_background creates PID file
test_process_launch_background_creates_pid() {
    local session_id="test-pid-$$"

    process_launch_background "$session_id" "testproc" test_dummy_function 1

    local pid_file="${TEST_DIR}/sessions/${session_id}/testproc.pid"
    [ -f "$pid_file" ]

    # Cleanup
    process_kill "$pid_file"
}

# Test: process_launch_background creates log file
test_process_launch_background_creates_log() {
    local session_id="test-log-$$"

    process_launch_background "$session_id" "testproc" test_dummy_function 1

    local log_file="${TEST_DIR}/sessions/${session_id}/testproc.log"
    sleep 0.5  # Give it a moment to start

    [ -f "$log_file" ]

    # Cleanup
    local pid_file="${TEST_DIR}/tmp/${session_id}/testproc.pid"
    process_kill "$pid_file"
}

# Test: process_launch_background doesn't launch if already running
test_process_launch_background_prevents_duplicate() {
    local session_id="test-dup-$$"

    # Launch first process
    process_launch_background "$session_id" "testproc" test_dummy_function 5

    local pid_file="${TEST_DIR}/sessions/${session_id}/testproc.pid"
    local pid1
    pid1=$(cat "$pid_file")

    # Try to launch again
    process_launch_background "$session_id" "testproc" test_dummy_function 5

    local pid2
    pid2=$(cat "$pid_file")

    # PID should be the same (didn't launch new process)
    [ "$pid1" = "$pid2" ]

    # Cleanup
    process_kill "$pid_file"
}

# Test: process_is_running returns 0 for running process
test_process_is_running_true() {
    local session_id="test-running-$$"

    process_launch_background "$session_id" "testproc" test_dummy_function 5

    local pid_file="${TEST_DIR}/sessions/${session_id}/testproc.pid"
    sleep 0.5  # Give it a moment to start

    process_is_running "$pid_file"

    # Cleanup
    process_kill "$pid_file"
}

# Test: process_is_running returns 1 for non-existent file
test_process_is_running_no_file() {
    local pid_file="${TEST_DIR}/nonexistent.pid"

    ! process_is_running "$pid_file"
}

# Test: process_is_running returns 1 for dead process
test_process_is_running_dead_process() {
    local session_id="test-dead-$$"
    local pid_file="${TEST_DIR}/sessions/${session_id}/testproc.pid"

    mkdir -p "${TEST_DIR}/sessions/${session_id}"

    # Create PID file with non-existent PID
    echo "999999" > "$pid_file"

    ! process_is_running "$pid_file"
}

# Test: process_kill stops running process
test_process_kill_stops_process() {
    local session_id="test-kill-$$"

    process_launch_background "$session_id" "testproc" test_dummy_function 60

    local pid_file="${TEST_DIR}/sessions/${session_id}/testproc.pid"
    sleep 0.5  # Let it start

    # Verify it's running
    process_is_running "$pid_file"

    # Kill it
    process_kill "$pid_file"

    # Should no longer be running
    ! process_is_running "$pid_file"

    # PID file should be removed
    [ ! -f "$pid_file" ]
}

# Test: process_kill removes PID file
test_process_kill_removes_pid_file() {
    local session_id="test-kill-pid-$$"

    process_launch_background "$session_id" "testproc" test_dummy_function 5

    local pid_file="${TEST_DIR}/sessions/${session_id}/testproc.pid"
    sleep 0.5

    process_kill "$pid_file"

    [ ! -f "$pid_file" ]
}

# Test: process_cleanup_stale_pids removes stale PIDs
test_process_cleanup_stale_pids() {
    local session_id="test-cleanup-$$"
    local session_dir="${TEST_DIR}/sessions/${session_id}"
    mkdir -p "$session_dir"

    # Create stale PID file
    echo "999999" > "${session_dir}/stale.pid"

    # Create active process
    process_launch_background "$session_id" "active" test_dummy_function 5
    sleep 0.5

    # Cleanup stale PIDs
    process_cleanup_stale_pids "$session_dir"

    # Stale PID should be removed
    [ ! -f "${session_dir}/stale.pid" ]

    # Active PID should remain
    [ -f "${session_dir}/active.pid" ]

    # Cleanup
    process_kill "${session_dir}/active.pid"
}

# Test: process_cleanup_stale_pids handles empty directory
test_process_cleanup_stale_pids_empty_dir() {
    local session_dir="${TEST_DIR}/sessions/empty-$$"
    mkdir -p "$session_dir"

    # Should not error on empty directory
    process_cleanup_stale_pids "$session_dir"
}

# Test: process_cleanup_stale_pids handles non-existent directory
test_process_cleanup_stale_pids_nonexistent() {
    local session_dir="${TEST_DIR}/nonexistent-$$"

    # Should not error on non-existent directory
    process_cleanup_stale_pids "$session_dir"
}

# Main test execution
main() {
    echo "Running process management namespace tests..."
    echo

    setup

    # Run all tests
    run_test test_process_launch_background_creates_pid
    run_test test_process_launch_background_creates_log
    run_test test_process_launch_background_prevents_duplicate
    run_test test_process_is_running_true
    run_test test_process_is_running_no_file
    run_test test_process_is_running_dead_process
    run_test test_process_kill_stops_process
    run_test test_process_kill_removes_pid_file
    run_test test_process_cleanup_stale_pids
    run_test test_process_cleanup_stale_pids_empty_dir
    run_test test_process_cleanup_stale_pids_nonexistent

    teardown

    # Print summary
    echo
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Tests run:    ${TESTS_RUN}"
    echo -e "Tests passed: ${GREEN}${TESTS_PASSED}${RESET}"
    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "Tests failed: ${RED}${TESTS_FAILED}${RESET}"
        exit 1
    else
        echo -e "${GREEN}All tests passed!${RESET}"
        exit 0
    fi
}

main "$@"
