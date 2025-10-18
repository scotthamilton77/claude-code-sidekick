#!/bin/bash
# Test script for response-tracker.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="${SCRIPT_DIR}/test-artifacts"
TRACKER="${SCRIPT_DIR}/response-tracker.sh"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Cleanup function
cleanup() {
    rm -rf "$TEST_DIR"
}

# Setup test environment
setup() {
    cleanup
    mkdir -p "$TEST_DIR/session"
    mkdir -p "$TEST_DIR/user-hooks"
}

# Create test JSON input
create_test_input() {
    local session_id="$1"
    cat <<EOF
{
  "session_id": "$session_id",
  "transcript_path": "$TEST_DIR/session/${session_id}_transcript.jsonl"
}
EOF
}

# Test helper
run_test() {
    local test_name="$1"
    local session_id="test-session-123"
    local verbose="$2"

    [ "$verbose" != "silent" ] && echo -e "${YELLOW}Testing: $test_name${NC}" >&2

    # Initialize session
    create_test_input "$session_id" | TEST_USER_REMINDER_FILE="$TEST_DIR/user-hooks/static-reminder.txt" \
        "$TRACKER" init > /dev/null 2>&1

    # Set topic to non-default so we test static reminder path
    echo "Test topic" > "$TEST_DIR/session/${session_id}_topic"

    # Run track operation 4 times to trigger the static reminder (at count=4, 4%4=0)
    for i in {1..4}; do
        result=$(create_test_input "$session_id" | TEST_USER_REMINDER_FILE="$TEST_DIR/user-hooks/static-reminder.txt" \
            "$TRACKER" track 2>&1)
    done

    echo "$result"
}

# Test helper with verbose mode
run_test_verbose() {
    local test_name="$1"
    local session_id="test-session-verbose"

    echo -e "${YELLOW}Testing: $test_name${NC}"

    # Initialize session
    create_test_input "$session_id" | TEST_USER_REMINDER_FILE="$TEST_DIR/user-hooks/static-reminder.txt" \
        "$TRACKER" init --verbose 2>&1

    # Set topic to non-default so we test static reminder path
    echo "Test topic" > "$TEST_DIR/session/${session_id}_topic"

    # Run track operation 4 times to trigger static reminder
    for i in {1..4}; do
        result=$(create_test_input "$session_id" | TEST_USER_REMINDER_FILE="$TEST_DIR/user-hooks/static-reminder.txt" \
            "$TRACKER" track --verbose 2>&1)
    done

    echo "$result"
}

echo "=========================================="
echo "Response Tracker Test Suite"
echo "=========================================="
echo ""

setup

# Backup project reminder file if it exists
if [ -f "$SCRIPT_DIR/static-reminder.txt" ]; then
    mv "$SCRIPT_DIR/static-reminder.txt" "$SCRIPT_DIR/static-reminder.txt.backup"
fi

# Test 1: No reminder files (silent mode)
echo -e "${YELLOW}Test 1: No reminder files (silent mode)${NC}"
result=$(run_test "No reminder files" "silent")
if [ -z "$result" ]; then
    echo -e "${GREEN}✓ PASS: Silent when no files found${NC}"
else
    echo -e "${RED}✗ FAIL: Expected silence, got output${NC}"
    echo "$result" | head -5  # Show first 5 lines for debugging
fi
echo ""

# Test 2: No reminder files (verbose mode)
echo -e "${YELLOW}Test 2: No reminder files (verbose mode)${NC}"
result=$(run_test_verbose "No reminder files - verbose")
if echo "$result" | grep -q "WARNING: No static reminder files found"; then
    echo -e "${GREEN}✓ PASS: Warning shown in verbose mode${NC}"
else
    echo -e "${RED}✗ FAIL: Expected warning in verbose mode${NC}"
fi
echo ""

# Test 3: User-level reminder only
echo -e "${YELLOW}Test 3: User-level reminder only${NC}"
echo "USER LEVEL REMINDER CONTENT" > "$TEST_DIR/user-hooks/static-reminder.txt"
result=$(run_test "User-level only")
if echo "$result" | grep -q "USER LEVEL REMINDER CONTENT"; then
    echo -e "${GREEN}✓ PASS: User-level reminder loaded${NC}"
else
    echo -e "${RED}✗ FAIL: User-level reminder not found in output${NC}"
fi
echo ""

# Test 4: Project-level reminder only
echo -e "${YELLOW}Test 4: Project-level reminder only${NC}"
rm -f "$TEST_DIR/user-hooks/static-reminder.txt"
echo "PROJECT LEVEL REMINDER CONTENT" > "$SCRIPT_DIR/static-reminder.txt"
result=$(run_test "Project-level only")
if echo "$result" | grep -q "PROJECT LEVEL REMINDER CONTENT"; then
    echo -e "${GREEN}✓ PASS: Project-level reminder loaded${NC}"
else
    echo -e "${RED}✗ FAIL: Project-level reminder not found in output${NC}"
fi
echo ""

# Test 5: Both reminder files (concatenation)
echo -e "${YELLOW}Test 5: Both reminder files (concatenation)${NC}"
echo "USER LEVEL REMINDER" > "$TEST_DIR/user-hooks/static-reminder.txt"
result=$(run_test "Both levels")
if echo "$result" | grep -q "USER LEVEL REMINDER" && echo "$result" | grep -q "PROJECT LEVEL REMINDER CONTENT"; then
    echo -e "${GREEN}✓ PASS: Both reminders concatenated${NC}"
else
    echo -e "${RED}✗ FAIL: Expected both reminders in output${NC}"
fi
echo ""

# Test 6: Verbose mode shows file paths
echo -e "${YELLOW}Test 6: Verbose mode shows file paths${NC}"
result=$(run_test_verbose "Verbose file paths")
if echo "$result" | grep -q "Loaded user-level reminder" && echo "$result" | grep -q "Loaded project-level reminder"; then
    echo -e "${GREEN}✓ PASS: Verbose mode shows file paths${NC}"
else
    echo -e "${RED}✗ FAIL: Expected file path messages in verbose mode${NC}"
fi
echo ""

# Cleanup and restore
cleanup

# Restore project reminder file if we backed it up
if [ -f "$SCRIPT_DIR/static-reminder.txt.backup" ]; then
    mv "$SCRIPT_DIR/static-reminder.txt.backup" "$SCRIPT_DIR/static-reminder.txt"
fi

echo "=========================================="
echo "Test Suite Complete"
echo "=========================================="
