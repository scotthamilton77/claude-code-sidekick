#!/bin/bash
# Test suite for cleanup-old-sessions.sh
# Validates cleanup logic with controlled test scenarios

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test setup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLEANUP_SCRIPT="$PROJECT_ROOT/.claude/hooks/reminders/cleanup-old-sessions.sh"

# Create temporary test directory
TEST_TMP_DIR=$(mktemp -d)
TEST_OUTPUT_BASE="$TEST_TMP_DIR/test-reminders"
TEST_TMP="$TEST_OUTPUT_BASE/tmp"

cleanup_test_env() {
    rm -rf "$TEST_TMP_DIR"
}

trap cleanup_test_env EXIT

# Logging helpers
log_test() {
    echo -e "${YELLOW}[TEST]${NC} $1"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

log_info() {
    echo -e "       $1"
}

# Test assertion helpers
assert_dir_exists() {
    local dir="$1"
    local msg="$2"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ -d "$dir" ]; then
        log_pass "$msg"
        return 0
    else
        log_fail "$msg"
        log_info "Expected directory to exist: $dir"
        return 1
    fi
}

assert_dir_not_exists() {
    local dir="$1"
    local msg="$2"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ ! -d "$dir" ]; then
        log_pass "$msg"
        return 0
    else
        log_fail "$msg"
        log_info "Expected directory to NOT exist: $dir"
        return 1
    fi
}

assert_count_equals() {
    local actual="$1"
    local expected="$2"
    local msg="$3"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ "$actual" -eq "$expected" ]; then
        log_pass "$msg (actual=$actual, expected=$expected)"
        return 0
    else
        log_fail "$msg (actual=$actual, expected=$expected)"
        return 1
    fi
}

# Helper to create a session directory with controlled age
# Args: session_id, age_in_days
create_session() {
    local session_id="$1"
    local age_days="$2"
    local session_dir="$TEST_TMP/$session_id"

    mkdir -p "$session_dir"

    # Create some typical files
    echo "test" > "$session_dir/response_count"
    echo '{"test": true}' > "$session_dir/topic.json"
    echo "log" > "$session_dir/analysis.log"

    # Set file modification times to simulate age
    local date_str="${age_days} days ago"
    touch -d "$date_str" "$session_dir/response_count"
    touch -d "$date_str" "$session_dir/topic.json"
    # Make analysis.log the newest file (to test newest-file logic)
    touch -d "$((age_days - 1)) days ago" "$session_dir/analysis.log" 2>/dev/null || touch -d "$date_str" "$session_dir/analysis.log"
}

# Helper to count session directories
count_sessions() {
    find "$TEST_TMP" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l
}

# Helper to run cleanup script
run_cleanup() {
    local env_vars="$1"
    # Always skip safety check in tests (allows tmp dirs outside .claude/)
    env CLAUDE_TMP_CLEANUP_SKIP_SAFETY=true $env_vars "$CLEANUP_SCRIPT" "$TEST_OUTPUT_BASE" 2>&1 | grep -E '\[(INFO|WARNING|ERROR)\]' || true
}

# Test 1: Cleanup disabled
test_cleanup_disabled() {
    log_test "Test 1: Cleanup disabled"

    mkdir -p "$TEST_TMP"
    create_session "aaaaaaaa-bbbb-cccc-dddd-000000000001" 5
    create_session "aaaaaaaa-bbbb-cccc-dddd-000000000002" 5

    run_cleanup "CLAUDE_TMP_CLEANUP_ENABLED=false"

    # All sessions should still exist
    assert_count_equals $(count_sessions) 2 "Cleanup disabled: all sessions remain"
}

# Test 2: No cleanup when old_count <= threshold
test_below_threshold() {
    log_test "Test 2: No cleanup when old_count <= threshold"

    rm -rf "$TEST_TMP"
    mkdir -p "$TEST_TMP"

    # Create exactly MIN_COUNT old sessions
    for i in {1..5}; do
        create_session "aaaaaaaa-bbbb-cccc-dddd-00000000000$i" 5
    done

    run_cleanup "CLAUDE_TMP_CLEANUP_MIN_COUNT=5 CLAUDE_TMP_CLEANUP_AGE_DAYS=2"

    # All sessions should remain (5 old <= threshold 5)
    assert_count_equals $(count_sessions) 5 "Old count <= threshold: no cleanup"
}

# Test 3: Cleanup triggers when old_count > threshold
test_above_threshold() {
    log_test "Test 3: Cleanup triggers when old_count > threshold"

    rm -rf "$TEST_TMP"
    mkdir -p "$TEST_TMP"

    # Create 8 old sessions (exceeds threshold of 5)
    for i in {1..8}; do
        create_session "aaaaaaaa-bbbb-cccc-dddd-00000000000$i" 5
    done

    run_cleanup "CLAUDE_TMP_CLEANUP_MIN_COUNT=5 CLAUDE_TMP_CLEANUP_AGE_DAYS=2"

    # Should remove 3 sessions (8 - 5 = 3), leaving 5
    assert_count_equals $(count_sessions) 5 "Old count > threshold: removes excess sessions"
}

# Test 4: Oldest sessions removed first
test_oldest_first() {
    log_test "Test 4: Oldest sessions removed first"

    rm -rf "$TEST_TMP"
    mkdir -p "$TEST_TMP"

    # Create sessions with varying ages
    create_session "aaaaaaaa-bbbb-cccc-dddd-000000000001" 10  # Oldest
    create_session "aaaaaaaa-bbbb-cccc-dddd-000000000002" 8
    create_session "aaaaaaaa-bbbb-cccc-dddd-000000000003" 6
    create_session "aaaaaaaa-bbbb-cccc-dddd-000000000004" 5
    create_session "aaaaaaaa-bbbb-cccc-dddd-000000000005" 4
    create_session "aaaaaaaa-bbbb-cccc-dddd-000000000006" 3   # Youngest old

    run_cleanup "CLAUDE_TMP_CLEANUP_MIN_COUNT=5 CLAUDE_TMP_CLEANUP_AGE_DAYS=2"

    # Should remove oldest session (10 days old)
    assert_dir_not_exists "$TEST_TMP/aaaaaaaa-bbbb-cccc-dddd-000000000001" "Oldest session removed"
    assert_dir_exists "$TEST_TMP/aaaaaaaa-bbbb-cccc-dddd-000000000006" "Youngest old session remains"
}

# Test 5: Recent sessions not removed
test_recent_sessions() {
    log_test "Test 5: Recent sessions not removed"

    rm -rf "$TEST_TMP"
    mkdir -p "$TEST_TMP"

    # Create mix of old and recent sessions
    for i in {1..6}; do
        create_session "aaaaaaaa-bbbb-cccc-dddd-00000000000$i" 5  # Old
    done
    create_session "aaaaaaaa-bbbb-cccc-dddd-000000000007" 1  # Recent
    create_session "aaaaaaaa-bbbb-cccc-dddd-000000000008" 0  # Today

    run_cleanup "CLAUDE_TMP_CLEANUP_MIN_COUNT=5 CLAUDE_TMP_CLEANUP_AGE_DAYS=2"

    # Recent sessions should always remain
    assert_dir_exists "$TEST_TMP/aaaaaaaa-bbbb-cccc-dddd-000000000007" "Recent session (1 day) remains"
    assert_dir_exists "$TEST_TMP/aaaaaaaa-bbbb-cccc-dddd-000000000008" "Today's session remains"

    # Should still have removed 1 old session (6 old - 5 threshold)
    assert_count_equals $(count_sessions) 7 "Correct total after cleanup"
}

# Test 6: Dry-run mode doesn't delete
test_dry_run() {
    log_test "Test 6: Dry-run mode doesn't delete"

    rm -rf "$TEST_TMP"
    mkdir -p "$TEST_TMP"

    # Create 8 old sessions
    for i in {1..8}; do
        create_session "aaaaaaaa-bbbb-cccc-dddd-00000000000$i" 5
    done

    run_cleanup "CLAUDE_TMP_CLEANUP_MIN_COUNT=5 CLAUDE_TMP_CLEANUP_AGE_DAYS=2 CLAUDE_TMP_CLEANUP_DRY_RUN=true"

    # All sessions should remain in dry-run mode
    assert_count_equals $(count_sessions) 8 "Dry-run mode: no sessions deleted"
}

# Test 7: Invalid directory names ignored
test_invalid_dirs() {
    log_test "Test 7: Invalid directory names ignored"

    rm -rf "$TEST_TMP"
    mkdir -p "$TEST_TMP"

    # Create valid UUID sessions
    create_session "aaaaaaaa-bbbb-cccc-dddd-000000000001" 5
    create_session "aaaaaaaa-bbbb-cccc-dddd-000000000002" 5

    # Create invalid directories (non-UUID patterns)
    mkdir -p "$TEST_TMP/not-a-uuid"
    mkdir -p "$TEST_TMP/12345"
    mkdir -p "$TEST_TMP/test-session"
    echo "test" > "$TEST_TMP/not-a-uuid/file.txt"

    run_cleanup "CLAUDE_TMP_CLEANUP_MIN_COUNT=1 CLAUDE_TMP_CLEANUP_AGE_DAYS=2"

    # Invalid directories should be ignored and remain
    assert_dir_exists "$TEST_TMP/not-a-uuid" "Invalid dir ignored (not-a-uuid)"
    assert_dir_exists "$TEST_TMP/12345" "Invalid dir ignored (12345)"
    assert_dir_exists "$TEST_TMP/test-session" "Invalid dir ignored (test-session)"

    # Only 1 valid old session should be removed (2 old - 1 threshold)
    local valid_sessions=$(find "$TEST_TMP" -mindepth 1 -maxdepth 1 -type d -name "*-*-*-*-*" | wc -l)
    assert_count_equals "$valid_sessions" 1 "Only valid UUID sessions processed"
}

# Test 8: Empty directories handled correctly
test_empty_dirs() {
    log_test "Test 8: Empty directories handled correctly"

    rm -rf "$TEST_TMP"
    mkdir -p "$TEST_TMP"

    # Create empty session directories
    for i in {1..6}; do
        local session_id="aaaaaaaa-bbbb-cccc-dddd-00000000000$i"
        mkdir -p "$TEST_TMP/$session_id"
        # Set directory mtime to simulate age
        touch -d "5 days ago" "$TEST_TMP/$session_id"
    done

    run_cleanup "CLAUDE_TMP_CLEANUP_MIN_COUNT=5 CLAUDE_TMP_CLEANUP_AGE_DAYS=2"

    # Should handle empty dirs and remove 1 (6 - 5 threshold)
    assert_count_equals $(count_sessions) 5 "Empty directories handled correctly"
}

# Test 9: No tmp directory (edge case)
test_no_tmp_dir() {
    log_test "Test 9: No tmp directory (edge case)"

    rm -rf "$TEST_TMP"

    # Should not error, just exit cleanly
    run_cleanup "CLAUDE_TMP_CLEANUP_MIN_COUNT=5"

    # Should not create tmp directory
    assert_dir_not_exists "$TEST_TMP" "No tmp dir: exits cleanly"
}

# Test 10: Age based on newest file (not oldest)
test_newest_file_age() {
    log_test "Test 10: Age based on newest file"

    rm -rf "$TEST_TMP"
    mkdir -p "$TEST_TMP"

    local session_id="aaaaaaaa-bbbb-cccc-dddd-000000000001"
    local session_dir="$TEST_TMP/$session_id"
    mkdir -p "$session_dir"

    # Create old file
    echo "old" > "$session_dir/old_file.txt"
    touch -d "10 days ago" "$session_dir/old_file.txt"

    # Create recent file (makes session "recent")
    echo "recent" > "$session_dir/recent_file.txt"
    touch -d "1 day ago" "$session_dir/recent_file.txt"

    # Create more old sessions to exceed threshold
    for i in {2..7}; do
        create_session "aaaaaaaa-bbbb-cccc-dddd-00000000000$i" 5
    done

    run_cleanup "CLAUDE_TMP_CLEANUP_MIN_COUNT=5 CLAUDE_TMP_CLEANUP_AGE_DAYS=2"

    # Session 1 should NOT be removed (has recent file)
    assert_dir_exists "$TEST_TMP/aaaaaaaa-bbbb-cccc-dddd-000000000001" "Session with recent file remains"

    # Others should be cleaned up (6 old - 5 threshold = 1 removed)
    assert_count_equals $(count_sessions) 6 "Cleanup respects newest file age"
}

# Main test runner
main() {
    echo ""
    echo "========================================"
    echo "  Cleanup Old Sessions Test Suite"
    echo "========================================"
    echo ""
    echo "Script: $CLEANUP_SCRIPT"
    echo "Test tmp: $TEST_TMP"
    echo ""

    # Verify cleanup script exists
    if [ ! -f "$CLEANUP_SCRIPT" ]; then
        echo -e "${RED}ERROR: Cleanup script not found: $CLEANUP_SCRIPT${NC}"
        exit 1
    fi

    # Make sure script is executable
    chmod +x "$CLEANUP_SCRIPT"

    # Run all tests
    test_cleanup_disabled
    echo ""
    test_below_threshold
    echo ""
    test_above_threshold
    echo ""
    test_oldest_first
    echo ""
    test_recent_sessions
    echo ""
    test_dry_run
    echo ""
    test_invalid_dirs
    echo ""
    test_empty_dirs
    echo ""
    test_no_tmp_dir
    echo ""
    test_newest_file_age
    echo ""

    # Summary
    echo "========================================"
    echo "  Test Results"
    echo "========================================"
    echo "Total tests: $TESTS_RUN"
    echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "${RED}Failed: $TESTS_FAILED${NC}"
    echo ""

    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}✓ All tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}✗ Some tests failed${NC}"
        exit 1
    fi
}

main
