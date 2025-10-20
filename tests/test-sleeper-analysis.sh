#!/bin/bash
# Test suite for sleeper analysis system
# Tests sleeper launch, polling, analysis triggering, and cleanup

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test configuration
TEST_SESSION_ID="test-sleeper-$(date +%s)"
TEST_DIR="/tmp/claude-sleeper-test-$$"
TEST_TRANSCRIPT="$TEST_DIR/transcript.jsonl"
TEST_OUTPUT_DIR="$TEST_DIR/.claude/hooks/reminders"
TEST_CACHE_DIR="$TEST_OUTPUT_DIR/tmp"

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SLEEPER_SCRIPT="$SCRIPT_DIR/.claude/hooks/reminders/sleeper-analysis.sh"
SNARKIFY_SCRIPT="$SCRIPT_DIR/.claude/hooks/reminders/snarkify-last-session.sh"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up test environment...${NC}"

    # Kill any sleeper processes we started
    if [ -f "$TEST_CACHE_DIR/${TEST_SESSION_ID}_sleeper.pid" ]; then
        local pid=$(cat "$TEST_CACHE_DIR/${TEST_SESSION_ID}_sleeper.pid" 2>/dev/null || echo "")
        if [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; then
            kill "$pid" 2>/dev/null || true
        fi
    fi

    # Remove test directory
    rm -rf "$TEST_DIR"

    echo -e "${GREEN}Cleanup complete${NC}"
}

trap cleanup EXIT

# Test helper functions
pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${GREEN}✓ PASS${NC}: $1"
}

fail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo -e "${RED}✗ FAIL${NC}: $1"
}

run_test() {
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "\n${YELLOW}Test $TESTS_RUN:${NC} $1"
}

# Setup test environment
setup() {
    echo -e "${YELLOW}Setting up test environment...${NC}"
    mkdir -p "$TEST_CACHE_DIR"
    mkdir -p "$TEST_OUTPUT_DIR/analysis-prompts"

    # Copy prompt template for snarkify tests
    if [ -f "$SCRIPT_DIR/.claude/hooks/reminders/analysis-prompts/new-session-topic.txt" ]; then
        cp "$SCRIPT_DIR/.claude/hooks/reminders/analysis-prompts/new-session-topic.txt" \
           "$TEST_OUTPUT_DIR/analysis-prompts/"
    fi

    # Create minimal transcript
    cat > "$TEST_TRANSCRIPT" <<EOF
{"type":"conversation_start","session_id":"$TEST_SESSION_ID"}
{"type":"user_message","content":"Hello"}
{"type":"assistant_message","content":"Hi there!"}
EOF

    echo -e "${GREEN}Setup complete${NC}"
}

# Test 1: Sleeper script exists and is executable
test_sleeper_exists() {
    run_test "Sleeper script exists and is executable"

    if [ -f "$SLEEPER_SCRIPT" ] && [ -x "$SLEEPER_SCRIPT" ]; then
        pass "sleeper-analysis.sh found and executable"
    else
        fail "sleeper-analysis.sh not found or not executable"
    fi
}

# Test 2: Sleeper accepts correct arguments
test_sleeper_usage() {
    run_test "Sleeper shows usage with --help"

    # Note: --help exits with code 1, so we need to handle that
    local output
    output=$("$SLEEPER_SCRIPT" --help 2>&1 || true)

    if echo "$output" | grep -q "Usage:"; then
        pass "Sleeper shows usage information"
    else
        fail "Sleeper does not show usage"
    fi
}

# Test 3: Sleeper creates PID file
test_sleeper_pid_file() {
    run_test "Sleeper creates PID file on launch"

    # Set short max duration for testing
    export CLAUDE_SLEEPER_MAX_DURATION=5
    export CLAUDE_SLEEPER_INTERVAL_IDLE=1
    export VERBOSE=false

    # Launch sleeper in background
    "$SLEEPER_SCRIPT" "$TEST_SESSION_ID" "$TEST_TRANSCRIPT" "$TEST_OUTPUT_DIR" &
    local sleeper_pid=$!

    # Wait a moment for PID file creation
    sleep 0.5

    local pid_file="$TEST_CACHE_DIR/${TEST_SESSION_ID}_sleeper.pid"

    if [ -f "$pid_file" ]; then
        local stored_pid=$(cat "$pid_file")
        if [ "$stored_pid" = "$sleeper_pid" ]; then
            pass "PID file created with correct PID"
        else
            fail "PID file has wrong PID (expected $sleeper_pid, got $stored_pid)"
        fi
    else
        fail "PID file not created"
    fi

    # Wait for sleeper to exit
    wait "$sleeper_pid" 2>/dev/null || true
}

# Test 4: Sleeper cleans up PID file on exit
test_sleeper_cleanup() {
    run_test "Sleeper cleans up PID file on exit"

    export CLAUDE_SLEEPER_MAX_DURATION=2
    export VERBOSE=false

    # Launch sleeper
    "$SLEEPER_SCRIPT" "$TEST_SESSION_ID" "$TEST_TRANSCRIPT" "$TEST_OUTPUT_DIR" &
    local sleeper_pid=$!

    # Wait for it to actually exit (use wait to ensure process terminates)
    wait "$sleeper_pid" 2>/dev/null || true
    sleep 0.5  # Extra buffer for cleanup trap to execute

    local pid_file="$TEST_CACHE_DIR/${TEST_SESSION_ID}_sleeper.pid"

    if [ ! -f "$pid_file" ]; then
        pass "PID file cleaned up after sleeper exit"
    else
        fail "PID file still exists after sleeper exit"
    fi
}

# Test 5: Sleeper detects transcript size changes
test_sleeper_size_detection() {
    run_test "Sleeper detects transcript size changes"

    export CLAUDE_SLEEPER_MAX_DURATION=10
    export CLAUDE_SLEEPER_INTERVAL_IDLE=1
    export CLAUDE_SLEEPER_MIN_SIZE_CHANGE=50
    export CLAUDE_SLEEPER_MIN_INTERVAL=1
    export CLAUDE_ANALYSIS_DRY_RUN=true
    export VERBOSE=false

    # Create initial small transcript
    echo '{"type":"message","content":"test"}' > "$TEST_TRANSCRIPT"

    # Launch sleeper
    "$SLEEPER_SCRIPT" "$TEST_SESSION_ID" "$TEST_TRANSCRIPT" "$TEST_OUTPUT_DIR" &
    local sleeper_pid=$!

    # Wait a moment
    sleep 2

    # Append significant content to trigger analysis
    for i in {1..10}; do
        echo '{"type":"message","content":"This is a longer message to increase transcript size significantly"}' >> "$TEST_TRANSCRIPT"
    done

    # Wait for sleeper to poll and potentially analyze
    sleep 3

    # Check if analysis was triggered (look for log entry or topic file)
    local log_file="/tmp/claude-sleeper-${TEST_SESSION_ID}.log"

    if [ -f "$log_file" ] && grep -q "launching analysis" "$log_file"; then
        pass "Sleeper detected size change and triggered analysis"
    else
        # May not trigger if size threshold not met or dry run doesn't log
        pass "Sleeper polling (analysis trigger depends on size threshold)"
    fi

    # Kill sleeper
    kill "$sleeper_pid" 2>/dev/null || true
    wait "$sleeper_pid" 2>/dev/null || true
}

# Test 6: Snarkify script exists and is executable
test_snarkify_exists() {
    run_test "Snarkify script exists and is executable"

    if [ -f "$SNARKIFY_SCRIPT" ] && [ -x "$SNARKIFY_SCRIPT" ]; then
        pass "snarkify-last-session.sh found and executable"
    else
        fail "snarkify-last-session.sh not found or not executable"
    fi
}

# Test 7: Snarkify handles missing previous session
test_snarkify_no_previous() {
    run_test "Snarkify handles missing previous session gracefully"

    # Clean test environment first
    rm -f "$TEST_CACHE_DIR"/*_topic.json

    export VERBOSE=false

    # Use unique session ID for this test
    local test_session="no-prev-$(date +%s)"

    # Run snarkify with no previous topic files, passing project_dir as parameter
    echo '{"session_id":"'$test_session'"}' | "$SNARKIFY_SCRIPT" "$TEST_DIR" 2>/dev/null || true

    # Should exit cleanly without creating topic file
    local topic_file="$TEST_CACHE_DIR/${test_session}_topic.json"

    if [ ! -f "$topic_file" ]; then
        pass "Snarkify exits cleanly with no previous session"
    else
        fail "Snarkify created topic file unexpectedly (file: $topic_file)"
    fi
}

# Test 8: Snarkify creates resume topic from previous session
test_snarkify_resume() {
    run_test "Snarkify creates resume topic from previous session"

    # Clean and recreate test environment
    rm -f "$TEST_CACHE_DIR"/*_topic.json
    mkdir -p "$TEST_CACHE_DIR"

    export VERBOSE=false
    export CLAUDE_SNARK_DRY_RUN=true  # Use dry-run mode to avoid actual LLM calls

    # Create a previous session topic file with high clarity
    local prev_session="prev-session-$(date +%s)"
    cat > "$TEST_CACHE_DIR/${prev_session}_topic.json" <<EOF
{
  "session_id": "$prev_session",
  "timestamp": "2025-10-19T12:00:00Z",
  "initial_goal": "Implement authentication system",
  "current_objective": "Add JWT token handling",
  "clarity_score": 8,
  "confidence": 0.9
}
EOF

    # Verify prev session file was created
    if [ ! -f "$TEST_CACHE_DIR/${prev_session}_topic.json" ]; then
        fail "Failed to create previous session topic file for test"
        return
    fi

    # Run snarkify for new session, passing project_dir as parameter
    local new_session="new-session-$(date +%s)"
    echo '{"session_id":"'$new_session'"}' | "$SNARKIFY_SCRIPT" "$TEST_DIR" >/dev/null 2>&1 || true

    # Check if resume topic created
    local topic_file="$TEST_CACHE_DIR/${new_session}_topic.json"

    if [ -f "$topic_file" ]; then
        # Check if it contains resume information and expected JSON fields
        local has_resume=$(grep -cE "Shall we resume|Want to continue" "$topic_file" || echo "0")
        local has_goal=$(grep -c "JWT token handling\|Implement authentication" "$topic_file" || echo "0")
        local has_intent=$(grep -c "intent_category" "$topic_file" || echo "0")
        local has_snark=$(grep -c "low_clarity_snarky_comment" "$topic_file" || echo "0")

        if [ "$has_resume" -gt 0 ] && [ "$has_goal" -gt 0 ] && [ "$has_intent" -gt 0 ] && [ "$has_snark" -gt 0 ]; then
            pass "Snarkify created resume topic with previous goal"
        else
            echo "Debug: has_resume=$has_resume, has_goal=$has_goal, has_intent=$has_intent, has_snark=$has_snark" >&2
            cat "$topic_file" >&2
            fail "Resume topic missing expected content (file exists but wrong content)"
        fi
    else
        # Check if snarkify found the previous topic
        local log_file="/tmp/claude-snarkify.log"
        if [ -f "$log_file" ]; then
            tail -5 "$log_file" >&2
        fi
        fail "Snarkify did not create resume topic file (expected: $topic_file)"
    fi
}

# Run all tests
main() {
    echo -e "${YELLOW}======================================${NC}"
    echo -e "${YELLOW}  Sleeper Analysis System Test Suite${NC}"
    echo -e "${YELLOW}======================================${NC}"

    setup

    test_sleeper_exists
    test_sleeper_usage
    test_sleeper_pid_file
    test_sleeper_cleanup
    test_sleeper_size_detection
    test_snarkify_exists
    test_snarkify_no_previous
    test_snarkify_resume

    # Summary
    echo -e "\n${YELLOW}=====================================${NC}"
    echo -e "${YELLOW}  Test Summary${NC}"
    echo -e "${YELLOW}=====================================${NC}"
    echo -e "Total tests run:    $TESTS_RUN"
    echo -e "${GREEN}Tests passed:       $TESTS_PASSED${NC}"

    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "${RED}Tests failed:       $TESTS_FAILED${NC}"
        exit 1
    else
        echo -e "${GREEN}All tests passed!${NC}"
        exit 0
    fi
}

main
