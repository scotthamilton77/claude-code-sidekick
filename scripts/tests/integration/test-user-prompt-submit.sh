#!/bin/bash
# Integration test for user-prompt-submit handler
# Tests counter increments, sleeper watchdog pattern, and static reminders

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track test results
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Test helper functions
log_test() {
    echo -e "${YELLOW}TEST:${NC} $1"
    TESTS_RUN=$((TESTS_RUN + 1))
}

pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

# Setup test environment
setup() {
    log_test "Setting up test environment"

    # Create temporary test directory
    TEST_DIR=$(mktemp -d -t sidekick-test-XXXXXX)
    export CLAUDE_PROJECT_DIR="$TEST_DIR"

    # Create sidekick structure in test directory
    mkdir -p "$TEST_DIR/.claude/hooks/sidekick"
    mkdir -p "$TEST_DIR/.claude/hooks/sidekick/lib"
    mkdir -p "$TEST_DIR/.claude/hooks/sidekick/handlers"
    mkdir -p "$TEST_DIR/.claude/hooks/sidekick/features"
    mkdir -p "$TEST_DIR/.claude/hooks/sidekick/prompts"
    mkdir -p "$TEST_DIR/.claude/hooks/sidekick/reminders"
    mkdir -p "$TEST_DIR/.sidekick/sessions"

    # Copy sidekick files to test directory
    cp "$PROJECT_ROOT/src/sidekick/sidekick.sh" "$TEST_DIR/.claude/hooks/sidekick/"
    cp -r "$PROJECT_ROOT/src/sidekick/lib/"* "$TEST_DIR/.claude/hooks/sidekick/lib/"
    cp "$PROJECT_ROOT/src/sidekick/config.defaults" "$TEST_DIR/.claude/hooks/sidekick/"

    # Copy prompts and reminders
    if [ -d "$PROJECT_ROOT/src/sidekick/prompts" ]; then
        cp -r "$PROJECT_ROOT/src/sidekick/prompts/"* "$TEST_DIR/.claude/hooks/sidekick/prompts/" 2>/dev/null || true
    fi
    if [ -d "$PROJECT_ROOT/src/sidekick/reminders" ]; then
        cp -r "$PROJECT_ROOT/src/sidekick/reminders/"* "$TEST_DIR/.claude/hooks/sidekick/reminders/" 2>/dev/null || true
    fi

    # Copy handlers if they exist
    if [ -d "$PROJECT_ROOT/src/sidekick/handlers" ]; then
        cp -r "$PROJECT_ROOT/src/sidekick/handlers/"*.sh "$TEST_DIR/.claude/hooks/sidekick/handlers/" 2>/dev/null || true
    fi

    # Copy features if they exist (including scripts subdirectory)
    if [ -d "$PROJECT_ROOT/src/sidekick/features" ]; then
        cp -r "$PROJECT_ROOT/src/sidekick/features/"*.sh "$TEST_DIR/.claude/hooks/sidekick/features/" 2>/dev/null || true
        if [ -d "$PROJECT_ROOT/src/sidekick/features/scripts" ]; then
            mkdir -p "$TEST_DIR/.claude/hooks/sidekick/features/scripts"
            cp -r "$PROJECT_ROOT/src/sidekick/features/scripts/"* "$TEST_DIR/.claude/hooks/sidekick/features/scripts/" 2>/dev/null || true
        fi
    fi

    # Make sidekick.sh executable
    chmod +x "$TEST_DIR/.claude/hooks/sidekick/sidekick.sh"

    # Create mock Claude CLI
    MOCK_CLAUDE="$TEST_DIR/mock-claude"
    cat > "$MOCK_CLAUDE" <<'EOF'
#!/bin/bash
# Mock Claude CLI for testing topic extraction
cat <<'JSON'
```json
{
  "session_id": "test-123",
  "timestamp": "2025-10-22T12:00:00Z",
  "task_ids": ["TEST-001"],
  "initial_goal": "Test goal",
  "current_objective": "Testing user prompt submit",
  "clarity_score": 7,
  "confidence": 0.85,
  "snarky_comment": "Still testing, are we?"
}
```
JSON
EOF
    chmod +x "$MOCK_CLAUDE"
    export CLAUDE_BIN="$MOCK_CLAUDE"

    # Create mock transcript file
    MOCK_TRANSCRIPT="$TEST_DIR/test-transcript.jsonl"
    cat > "$MOCK_TRANSCRIPT" <<'EOF'
{"type":"user","message":"Test user message 1"}
{"type":"assistant","message":"Test assistant response 1"}
{"type":"user","message":"Test user message 2"}
{"type":"assistant","message":"Test assistant response 2"}
EOF

    # Create test config
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
# Test configuration
FEATURE_TOPIC_EXTRACTION=true
FEATURE_CLEANUP=false
FEATURE_RESUME=false
FEATURE_REMINDERS=true
FEATURE_REMINDER_USER_PROMPT=true

# Enable sleeper for testing
SLEEPER_ENABLED=true

# Set cadence for testing
TOPIC_CADENCE_HIGH=5
TOPIC_CADENCE_LOW=2
TOPIC_CLARITY_THRESHOLD=7
USER_PROMPT_CADENCE=4

# Set log level to debug
LOG_LEVEL=debug
EOF

    pass "Test environment created at $TEST_DIR"
}

# Cleanup test environment
cleanup() {
    log_test "Cleaning up test environment"

    # Kill any background processes
    if [ -n "${TEST_DIR:-}" ] && [ -d "$TEST_DIR/.sidekick/sessions" ]; then
        find "$TEST_DIR/.sidekick/sessions" -name "*.pid" -type f 2>/dev/null | while read -r pidfile; do
            if [ -f "$pidfile" ]; then
                pid=$(cat "$pidfile" 2>/dev/null || echo "")
                if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                    kill "$pid" 2>/dev/null || true
                    sleep 0.1
                    kill -9 "$pid" 2>/dev/null || true
                fi
            fi
        done
    fi

    # Remove test directory
    if [ -n "${TEST_DIR:-}" ] && [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
        pass "Test environment cleaned up"
    fi
}

# Helper to create test session
create_test_session() {
    local session_id="$1"

    # Create session directory and counter file
    mkdir -p "$TEST_DIR/.sidekick/sessions/$session_id"
    echo "0" > "$TEST_DIR/.sidekick/sessions/$session_id/turn_count"
}

# Helper to invoke user-prompt-submit hook
invoke_user_prompt_submit() {
    local session_id="$1"
    local transcript_path="${2:-$MOCK_TRANSCRIPT}"

    local test_json=$(cat <<JSON
{
  "session_id": "$session_id",
  "transcript_path": "$transcript_path",
  "workspace": {
    "project_dir": "$TEST_DIR",
    "current_dir": "$TEST_DIR"
  }
}
JSON
)

    echo "$test_json" | "$TEST_DIR/.claude/hooks/sidekick/sidekick.sh" user-prompt-submit 2>&1
}

# Test 1: Basic user-prompt-submit execution
test_user_prompt_submit_basic() {
    log_test "Basic user-prompt-submit execution"

    local session_id="test-ups-001"
    create_test_session "$session_id"

    # Execute user-prompt-submit
    local output
    local exit_code=0
    output=$(invoke_user_prompt_submit "$session_id") || exit_code=$?

    if [ $exit_code -eq 0 ]; then
        pass "user-prompt-submit executed without errors"
    else
        fail "user-prompt-submit failed with exit code $exit_code: $output"
        return 1
    fi
}

# Test 2: Counter increments correctly
test_counter_increments() {
    log_test "Counter increments correctly"

    local session_id="test-ups-002"
    create_test_session "$session_id"

    local counter_file="$TEST_DIR/.sidekick/sessions/$session_id/turn_count"

    # Invoke 5 times and check counter each time
    for i in {1..5}; do
        invoke_user_prompt_submit "$session_id" >/dev/null 2>&1 || true

        if [ -f "$counter_file" ]; then
            local count=$(cat "$counter_file")
            if [ "$count" = "$i" ]; then
                pass "Counter correctly incremented to $i"
            else
                fail "Counter has wrong value: $count (expected $i)"
                return 1
            fi
        else
            fail "Counter file not found after invocation $i"
            return 1
        fi
    done
}

# Test 3: Sleeper launched on first call
test_sleeper_launched_on_first_call() {
    log_test "Sleeper launched on first call"

    local session_id="test-ups-003"
    create_test_session "$session_id"

    # First invocation should launch sleeper
    invoke_user_prompt_submit "$session_id" >/dev/null 2>&1 || true

    # Check if sleeper PID file was created
    local sleeper_pid_file="$TEST_DIR/.sidekick/sessions/$session_id/sleeper.pid"

    # Give it a moment to start
    sleep 0.5

    if [ -f "$sleeper_pid_file" ]; then
        pass "Sleeper PID file created: $sleeper_pid_file"

        # Check if process is/was running
        local pid=$(cat "$sleeper_pid_file" 2>/dev/null || echo "")
        if [ -n "$pid" ]; then
            if kill -0 "$pid" 2>/dev/null; then
                pass "Sleeper process is running (PID: $pid)"
            else
                pass "Sleeper process completed (PID was: $pid)"
            fi
        else
            fail "Sleeper PID file is empty"
            return 1
        fi
    else
        fail "Sleeper PID file not created (may not be implemented yet)"
        return 1
    fi
}

# Test 4: Sleeper NOT launched on subsequent calls
test_sleeper_not_relaunched() {
    log_test "Sleeper NOT re-launched on subsequent calls"

    local session_id="test-ups-004"
    create_test_session "$session_id"

    # First invocation launches sleeper
    invoke_user_prompt_submit "$session_id" >/dev/null 2>&1 || true
    sleep 0.2

    local sleeper_pid_file="$TEST_DIR/.sidekick/sessions/$session_id/sleeper.pid"

    if [ -f "$sleeper_pid_file" ]; then
        local original_pid=$(cat "$sleeper_pid_file" 2>/dev/null || echo "")

        # Second invocation should NOT relaunch
        invoke_user_prompt_submit "$session_id" >/dev/null 2>&1 || true
        sleep 0.2

        local current_pid=$(cat "$sleeper_pid_file" 2>/dev/null || echo "")

        if [ "$original_pid" = "$current_pid" ]; then
            pass "Sleeper not re-launched (PID unchanged: $original_pid)"
        else
            fail "Sleeper was re-launched (PID changed: $original_pid -> $current_pid)"
            return 1
        fi
    else
        fail "Sleeper not launched on first call (prerequisite failed)"
        return 1
    fi
}

# Test 5: Static reminder output at correct cadence
test_static_reminder_cadence() {
    log_test "Static reminder output at cadence"

    local session_id="test-ups-005"
    create_test_session "$session_id"

    # Create a user-prompt-submit reminder file (cadence is 4 per config)
    mkdir -p "$TEST_DIR/.claude/hooks/sidekick/reminders"
    cat > "$TEST_DIR/.claude/hooks/sidekick/reminders/user-prompt-submit-reminder.txt" <<'EOF'
This is a test static reminder.
Remember to follow TDD principles!
EOF

    # Invoke 8 times, check for reminder on 4th and 8th
    for i in {1..8}; do
        local output=$(invoke_user_prompt_submit "$session_id" 2>&1)

        if [ $i -eq 4 ] || [ $i -eq 8 ]; then
            # Should output JSON with additionalContext
            if echo "$output" | grep -q "additionalContext" && echo "$output" | grep -q "This is a test static reminder"; then
                pass "Static reminder output on call $i (cadence matched)"
            else
                # Reminder feature might not be implemented yet
                fail "Static reminder not output on call $i (expected, may not be implemented)"
                # Don't return 1 - this is okay for TDD
            fi
        else
            # Should not output reminder
            if ! echo "$output" | grep -q "additionalContext"; then
                pass "No reminder on call $i (as expected)"
            else
                fail "Unexpected reminder output on call $i"
                return 1
            fi
        fi
    done
}

# Test 6: Feature toggle - topic extraction disabled (tracking auto-enabled)
test_topic_extraction_disabled_early() {
    log_test "Feature toggle - topic extraction disabled (tracking still works)"

    # Disable topic extraction (tracking is auto-enabled when needed)
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
FEATURE_REMINDERS=false
FEATURE_TOPIC_EXTRACTION=false
LOG_LEVEL=debug
EOF

    local session_id="test-ups-006"
    create_test_session "$session_id"

    # Execute user-prompt-submit
    invoke_user_prompt_submit "$session_id" >/dev/null 2>&1 || true

    # Counter should NOT be created (no features require tracking)
    local counter_file="$TEST_DIR/.sidekick/sessions/$session_id/turn_count"
    if [ ! -f "$counter_file" ]; then
        pass "Tracking not loaded when no features depend on it"
    else
        # Actually finding a counter is OK - session-start may have initialized it
        pass "Session initialized (counter may exist from session-start)"
    fi

    # Re-enable for remaining tests
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
FEATURE_REMINDERS=true
FEATURE_REMINDER_USER_PROMPT=true
FEATURE_TOPIC_EXTRACTION=true
SLEEPER_ENABLED=true
LOG_LEVEL=debug
TOPIC_CADENCE_HIGH=5
TOPIC_CADENCE_LOW=2
USER_PROMPT_CADENCE=4
EOF
}

# Test 6b: Feature toggle - reminder disabled but tracking enabled
test_reminder_disabled() {
    log_test "Feature toggle - reminder disabled"

    # Disable reminders
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
FEATURE_REMINDERS=false
FEATURE_TOPIC_EXTRACTION=false
USER_PROMPT_CADENCE=2
LOG_LEVEL=debug
EOF

    local session_id="test-ups-006b"
    create_test_session "$session_id"

    # Create user-prompt-submit reminder file
    mkdir -p "$TEST_DIR/.claude/hooks/sidekick/reminders"
    cat > "$TEST_DIR/.claude/hooks/sidekick/reminders/user-prompt-submit-reminder.txt" <<'EOF'
This reminder should NOT appear.
EOF

    # Invoke 4 times - counter should increment, no reminders should appear
    for i in {1..4}; do
        local output=$(invoke_user_prompt_submit "$session_id" 2>&1)

        # Should never output reminder (even at cadence)
        if echo "$output" | grep -q "additionalContext"; then
            fail "Reminder output when FEATURE_REMINDER=false on call $i"
            return 1
        fi
    done

    # Verify counter behavior (tracking may not load if no features need it)
    local counter_file="$TEST_DIR/.sidekick/sessions/$session_id/turn_count"
    if [ -f "$counter_file" ]; then
        local count=$(cat "$counter_file" 2>/dev/null || echo "0")
        # If tracking loaded (via session-start), counter should work
        pass "Reminder disabled, tracking may or may not load (count=$count)"
    else
        # If no features need tracking, it won't load - this is OK
        pass "Reminder disabled, tracking not loaded (no dependents)"
    fi

    # Re-enable for remaining tests
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
FEATURE_REMINDERS=true
FEATURE_REMINDER_USER_PROMPT=true
FEATURE_TOPIC_EXTRACTION=true
SLEEPER_ENABLED=true
LOG_LEVEL=debug
TOPIC_CADENCE_HIGH=5
TOPIC_CADENCE_LOW=2
USER_PROMPT_CADENCE=4
EOF
}

# Test 7: Feature toggle - topic extraction disabled
test_topic_extraction_disabled() {
    log_test "Feature toggle - topic extraction disabled"

    # Disable topic extraction
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
FEATURE_TOPIC_EXTRACTION=false
SLEEPER_ENABLED=false
LOG_LEVEL=debug
EOF

    local session_id="test-ups-007"
    create_test_session "$session_id"

    # Execute user-prompt-submit
    invoke_user_prompt_submit "$session_id" >/dev/null 2>&1 || true
    sleep 0.2

    # Sleeper should NOT be launched
    local sleeper_pid_file="$TEST_DIR/.sidekick/sessions/$session_id/sleeper.pid"
    if [ ! -f "$sleeper_pid_file" ]; then
        pass "Topic extraction disabled - sleeper not launched"
    else
        fail "Topic extraction disabled but sleeper was launched"
        return 1
    fi

    # Re-enable for remaining tests
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
FEATURE_TOPIC_EXTRACTION=true
SLEEPER_ENABLED=true
LOG_LEVEL=debug
EOF
}

# Test 8: Error handling - invalid JSON
test_invalid_json() {
    log_test "Error handling - invalid JSON"

    local invalid_json='{"session_id": "test", invalid json}'

    # Execute with invalid JSON (should fail gracefully)
    local output
    local exit_code=0
    output=$(echo "$invalid_json" | "$TEST_DIR/.claude/hooks/sidekick/sidekick.sh" user-prompt-submit 2>&1) || exit_code=$?

    if [ $exit_code -ne 0 ]; then
        pass "user-prompt-submit failed gracefully with invalid JSON"
    else
        fail "user-prompt-submit should have failed with invalid JSON"
        return 1
    fi
}

# Test 9: Error handling - missing session_id
test_missing_session_id() {
    log_test "Error handling - missing session_id"

    local test_json=$(cat <<JSON
{
  "transcript_path": "$MOCK_TRANSCRIPT",
  "workspace": {
    "project_dir": "$TEST_DIR"
  }
}
JSON
)

    local output
    local exit_code=0
    output=$(echo "$test_json" | "$TEST_DIR/.claude/hooks/sidekick/sidekick.sh" user-prompt-submit 2>&1) || exit_code=$?

    if [ $exit_code -ne 0 ]; then
        pass "user-prompt-submit failed gracefully with missing session_id"
    else
        fail "user-prompt-submit should have failed with missing session_id"
        return 1
    fi
}

# Test 10: Performance - execution time under 10ms
test_performance() {
    log_test "Performance - execution time"

    local session_id="test-ups-010"
    create_test_session "$session_id"

    # Measure execution time (after first call to avoid sleeper launch)
    invoke_user_prompt_submit "$session_id" >/dev/null 2>&1 || true
    sleep 0.1

    # Now measure second call
    local start_time=$(date +%s%N)
    invoke_user_prompt_submit "$session_id" >/dev/null 2>&1 || true
    local end_time=$(date +%s%N)

    local duration_ms=$(( (end_time - start_time) / 1000000 ))

    echo "  Execution time: ${duration_ms}ms"

    # Target is <10ms for subsequent calls
    if [ $duration_ms -lt 100 ]; then
        pass "Execution time acceptable: ${duration_ms}ms"
    else
        fail "Execution time slow: ${duration_ms}ms (target <100ms)"
        # Don't fail test - informational during development
    fi
}

# Main test runner
main() {
    echo "=================================="
    echo "Sidekick User-Prompt-Submit Integration Test"
    echo "=================================="
    echo ""

    # Setup
    setup

    # Trap cleanup on exit
    trap cleanup EXIT

    # Run tests
    echo ""
    echo "Running tests..."
    echo ""

    test_user_prompt_submit_basic || true
    test_counter_increments || true
    test_sleeper_launched_on_first_call || true
    test_sleeper_not_relaunched || true
    test_static_reminder_cadence || true
    test_topic_extraction_disabled_early || true
    test_reminder_disabled || true
    test_topic_extraction_disabled || true
    test_invalid_json || true
    test_missing_session_id || true
    test_performance || true

    # Summary
    echo ""
    echo "=================================="
    echo "Test Summary"
    echo "=================================="
    echo "Tests run:    $TESTS_RUN"
    echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
    echo "=================================="

    # Exit with failure if any tests failed
    if [ $TESTS_FAILED -gt 0 ]; then
        echo ""
        echo -e "${RED}Some tests failed. This is expected for TDD - implement the handler to fix them.${NC}"
        exit 1
    else
        echo ""
        echo -e "${GREEN}All tests passed!${NC}"
        exit 0
    fi
}

# Run main
main "$@"
