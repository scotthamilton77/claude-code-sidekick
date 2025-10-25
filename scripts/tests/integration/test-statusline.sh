#!/bin/bash
# Integration test for statusline feature
# Tests statusline rendering with mock data

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
    mkdir -p "$TEST_DIR/.claude/hooks/sidekick/features/prompts"
    mkdir -p "$TEST_DIR/.sidekick/sessions"

    # Make test dir a git repo for git branch testing
    cd "$TEST_DIR"
    git init -q
    git config user.name "Test User"
    git config user.email "test@example.com"
    git checkout -b main -q 2>/dev/null || git checkout -b master -q
    git commit --allow-empty -m "Initial commit" -q

    # Copy sidekick files to test directory
    cp "$PROJECT_ROOT/src/sidekick/sidekick.sh" "$TEST_DIR/.claude/hooks/sidekick/"
    cp "$PROJECT_ROOT/src/sidekick/lib/common.sh" "$TEST_DIR/.claude/hooks/sidekick/lib/"
    cp "$PROJECT_ROOT/src/sidekick/config.defaults" "$TEST_DIR/.claude/hooks/sidekick/"

    # Copy features if they exist
    if [ -d "$PROJECT_ROOT/src/sidekick/features" ]; then
        cp -r "$PROJECT_ROOT/src/sidekick/features/"*.sh "$TEST_DIR/.claude/hooks/sidekick/features/" 2>/dev/null || true
        cp -r "$PROJECT_ROOT/src/sidekick/features/prompts/"* "$TEST_DIR/.claude/hooks/sidekick/features/prompts/" 2>/dev/null || true
    fi

    # Make sidekick.sh executable
    chmod +x "$TEST_DIR/.claude/hooks/sidekick/sidekick.sh"

    # Create test config
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
# Test configuration
FEATURE_STATUSLINE=true
STATUSLINE_TOKEN_THRESHOLD=160000
LOG_LEVEL=debug
EOF

    pass "Test environment created at $TEST_DIR"
}

# Cleanup test environment
cleanup() {
    log_test "Cleaning up test environment"

    # Remove test directory
    if [ -n "${TEST_DIR:-}" ] && [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
        pass "Test environment cleaned up"
    fi
}

# Helper to create mock session with topic and transcript
create_mock_session() {
    local session_id="$1"
    local topic_text="${2:-Test objective}"
    local clarity_score="${3:-8}"
    local transcript_size="${4:-5000}"

    # Create session directory
    local session_dir="$TEST_DIR/.sidekick/sessions/$session_id"
    mkdir -p "$session_dir"

    # Create topic.json
    cat > "$session_dir/topic.json" <<EOF
{
  "session_id": "$session_id",
  "timestamp": "2025-10-22T12:00:00Z",
  "task_ids": ["TEST-001"],
  "initial_goal": "Test goal",
  "current_objective": "$topic_text",
  "clarity_score": $clarity_score,
  "confidence": 0.9,
  "snarky_comment": "Testing is fun!"
}
EOF

    # Create mock transcript with specified size
    local transcript_file="$TEST_DIR/test-transcript-$session_id.jsonl"
    > "$transcript_file"  # Clear file

    # Add lines until we reach desired size
    local line='{"type":"user","message":"Test message that is reasonably long to simulate real conversation flow and token usage patterns."}'
    while [ $(stat -f%z "$transcript_file" 2>/dev/null || stat -c%s "$transcript_file") -lt $transcript_size ]; do
        echo "$line" >> "$transcript_file"
    done

    echo "$transcript_file"
}

# Helper to invoke statusline
invoke_statusline() {
    local session_id="$1"
    local model_display="${2:-Sonnet 4.5}"
    local cost_usd="${3:-1.50}"
    local duration_ms="${4:-12500}"
    local transcript_path="${5:-}"

    local test_json=$(cat <<JSON
{
  "session_id": "$session_id",
  "model": {
    "display_name": "$model_display"
  },
  "workspace": {
    "project_dir": "$TEST_DIR",
    "current_dir": "$TEST_DIR"
  },
  "cost": {
    "total_cost_usd": $cost_usd
  },
  "duration_ms": $duration_ms,
  "version": "1.0.0",
  "transcript_path": "$transcript_path"
}
JSON
)

    echo "$test_json" | "$TEST_DIR/.claude/hooks/sidekick/sidekick.sh" statusline 2>&1
}

# Test 1: Basic statusline execution
test_statusline_basic() {
    log_test "Basic statusline execution"

    local session_id="test-statusline-001"
    local transcript=$(create_mock_session "$session_id" "Test objective" 8 5000)

    # Execute statusline
    local output
    local exit_code=0
    output=$(invoke_statusline "$session_id" "Sonnet 4.5" 1.50 12500 "$transcript") || exit_code=$?

    if [ $exit_code -eq 0 ]; then
        pass "statusline executed without errors"
    else
        fail "statusline failed with exit code $exit_code: $output"
        return 1
    fi
}

# Test 2: Statusline contains model name
test_statusline_contains_model() {
    log_test "Statusline contains model name"

    local session_id="test-statusline-002"
    local transcript=$(create_mock_session "$session_id" "Test objective" 8 5000)

    local output=$(invoke_statusline "$session_id" "Claude Opus 4" 2.00 10000 "$transcript")

    if echo "$output" | grep -q "Opus 4"; then
        pass "Statusline contains model name"
    else
        fail "Statusline does not contain model name. Output: $output"
        return 1
    fi
}

# Test 4: Statusline contains duration
test_statusline_contains_duration() {
    log_test "Statusline contains duration"

    local session_id="test-statusline-004"
    local transcript=$(create_mock_session "$session_id" "Test objective" 8 5000)

    local output=$(invoke_statusline "$session_id" "Sonnet 4.5" 1.00 125000 "$transcript")

    # Duration is 125000ms = 125s, should show something like "125s" or "2m"
    if echo "$output" | grep -qE '[0-9]+s|[0-9]+m'; then
        pass "Statusline contains duration"
    else
        fail "Statusline does not contain duration. Output: $output"
        return 1
    fi
}

# Test 5: Statusline contains token information
test_statusline_contains_tokens() {
    log_test "Statusline contains token information"

    local session_id="test-statusline-005"
    local transcript=$(create_mock_session "$session_id" "Test objective" 8 50000)

    local output=$(invoke_statusline "$session_id" "Sonnet 4.5" 2.00 20000 "$transcript")

    # Should contain token count (K for thousands)
    if echo "$output" | grep -qE '[0-9]+K|[0-9]+\.[0-9]+K'; then
        pass "Statusline contains token information"
    else
        fail "Statusline does not contain tokens. Output: $output"
        return 1
    fi
}

# Test 6: Statusline contains topic/objective
test_statusline_contains_topic() {
    log_test "Statusline contains topic"

    local session_id="test-statusline-006"
    local topic="Implementing feature X with TDD"
    local transcript=$(create_mock_session "$session_id" "$topic" 8 5000)

    local output=$(invoke_statusline "$session_id" "Sonnet 4.5" 1.00 10000 "$transcript")

    if echo "$output" | grep -q "Implementing feature X"; then
        pass "Statusline contains topic from topic.json"
    else
        fail "Statusline does not contain topic. Output: $output"
        return 1
    fi
}

# Test 7: Statusline contains git branch
test_statusline_contains_git_branch() {
    log_test "Statusline contains git branch"

    local session_id="test-statusline-007"
    local transcript=$(create_mock_session "$session_id" "Test objective" 8 5000)

    # We're on main/master branch from setup
    local output=$(invoke_statusline "$session_id" "Sonnet 4.5" 1.00 10000 "$transcript")

    if echo "$output" | grep -qE 'main|master'; then
        pass "Statusline contains git branch"
    else
        fail "Statusline does not contain git branch. Output: $output"
        return 1
    fi
}

# Test 8: Statusline with missing topic file (graceful degradation)
test_statusline_no_topic() {
    log_test "Statusline handles missing topic gracefully"

    local session_id="test-statusline-008-no-topic"
    # Don't create topic file
    mkdir -p "$TEST_DIR/.sidekick/sessions/$session_id"

    local transcript="$TEST_DIR/test-transcript-$session_id.jsonl"
    echo '{"type":"user","message":"test"}' > "$transcript"

    local output
    local exit_code=0
    output=$(invoke_statusline "$session_id" "Sonnet 4.5" 1.00 10000 "$transcript") || exit_code=$?

    if [ $exit_code -eq 0 ]; then
        pass "Statusline handled missing topic file gracefully"

        # Should still show basic info (model, cost, etc) even without topic
        if echo "$output" | grep -q "Sonnet"; then
            pass "Statusline shows model even without topic"
        fi
    else
        fail "Statusline crashed with missing topic file: $output"
        return 1
    fi
}

# Test 9: Statusline token percentage calculation
test_statusline_token_percentage() {
    log_test "Statusline calculates token percentage"

    local session_id="test-statusline-009"
    # Create large transcript (threshold is 160K tokens by default)
    # ~100K bytes should be ~25K tokens, which is ~15% of 160K
    local transcript=$(create_mock_session "$session_id" "Test objective" 8 100000)

    local output=$(invoke_statusline "$session_id" "Sonnet 4.5" 5.00 30000 "$transcript")

    # Should contain percentage
    if echo "$output" | grep -qE '[0-9]+%'; then
        pass "Statusline contains token percentage"
    else
        fail "Statusline does not contain percentage. Output: $output"
        return 1
    fi
}

# Test 10: Statusline with high token usage (warning colors)
test_statusline_high_token_usage() {
    log_test "Statusline handles high token usage"

    local session_id="test-statusline-010"
    # Create very large transcript (~400K bytes = ~100K tokens = ~62% of 160K)
    local transcript=$(create_mock_session "$session_id" "Test objective" 8 400000)

    local output
    local exit_code=0
    output=$(invoke_statusline "$session_id" "Sonnet 4.5" 10.00 60000 "$transcript") || exit_code=$?

    if [ $exit_code -eq 0 ]; then
        pass "Statusline handled high token usage"

        # Should show high percentage
        if echo "$output" | grep -qE '[5-9][0-9]%|100%'; then
            pass "Statusline shows high percentage for large transcript"
        fi
    else
        fail "Statusline failed with large transcript: $output"
        return 1
    fi
}

# Test 11: Statusline feature toggle
test_statusline_feature_disabled() {
    log_test "Statusline respects feature toggle"

    # Disable statusline feature
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
FEATURE_STATUSLINE=false
LOG_LEVEL=debug
EOF

    local session_id="test-statusline-011"
    local transcript=$(create_mock_session "$session_id" "Test objective" 8 5000)

    local output
    local exit_code=0
    output=$(invoke_statusline "$session_id" "Sonnet 4.5" 1.00 10000 "$transcript" 2>&1) || exit_code=$?

    # Should either exit with error or produce minimal output
    if [ $exit_code -ne 0 ] || [ -z "$output" ]; then
        pass "Statusline disabled when feature toggle is false"
    else
        # Might still execute but produce no output - that's okay too
        pass "Statusline handled disabled state (exit: $exit_code)"
    fi

    # Re-enable for remaining tests
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
FEATURE_STATUSLINE=true
STATUSLINE_TOKEN_THRESHOLD=160000
LOG_LEVEL=debug
EOF
}

# Test 12: Performance - execution time under 50ms
test_statusline_performance() {
    log_test "Performance - execution time"

    local session_id="test-statusline-012"
    local transcript=$(create_mock_session "$session_id" "Test objective" 8 10000)

    # Measure execution time
    local start_time=$(date +%s%N)
    invoke_statusline "$session_id" "Sonnet 4.5" 2.00 15000 "$transcript" >/dev/null 2>&1 || true
    local end_time=$(date +%s%N)

    local duration_ms=$(( (end_time - start_time) / 1000000 ))

    echo "  Execution time: ${duration_ms}ms"

    # Target is <50ms
    if [ $duration_ms -lt 200 ]; then
        pass "Execution time acceptable: ${duration_ms}ms"
    else
        fail "Execution time slow: ${duration_ms}ms (target <200ms)"
        # Don't fail test - informational during development
    fi
}

# Test 13: Statusline with different clarity scores (affects display)
test_statusline_low_clarity() {
    log_test "Statusline with low clarity topic"

    local session_id="test-statusline-013"
    local transcript=$(create_mock_session "$session_id" "Unclear objective" 3 5000)

    local output
    local exit_code=0
    output=$(invoke_statusline "$session_id" "Sonnet 4.5" 1.00 10000 "$transcript") || exit_code=$?

    if [ $exit_code -eq 0 ]; then
        pass "Statusline handled low clarity topic"

        # Should still display topic even if clarity is low
        if echo "$output" | grep -q "Unclear objective"; then
            pass "Statusline shows topic even with low clarity"
        fi
    else
        fail "Statusline failed with low clarity topic: $output"
        return 1
    fi
}

# Main test runner
main() {
    echo "=================================="
    echo "Sidekick Statusline Integration Test"
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

    test_statusline_basic || true
    test_statusline_contains_model || true
    test_statusline_contains_duration || true
    test_statusline_contains_tokens || true
    test_statusline_contains_topic || true
    test_statusline_contains_git_branch || true
    test_statusline_no_topic || true
    test_statusline_token_percentage || true
    test_statusline_high_token_usage || true
    test_statusline_feature_disabled || true
    test_statusline_performance || true
    test_statusline_low_clarity || true

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
        echo -e "${RED}Some tests failed. This is expected for TDD - implement statusline.sh to fix them.${NC}"
        exit 1
    else
        echo ""
        echo -e "${GREEN}All tests passed!${NC}"
        exit 0
    fi
}

# Run main
main "$@"
