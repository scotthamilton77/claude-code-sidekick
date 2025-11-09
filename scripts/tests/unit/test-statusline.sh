#!/bin/bash
# test-statusline.sh - Unit tests for statusline feature
#
# Tests the STATUSLINE feature from features/statusline.sh

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
    export CLAUDE_PROJECT_DIR="$TEST_DIR"

    # Source common.sh and statusline.sh
    # shellcheck disable=SC1091
    source "$(dirname "$0")/../../../src/sidekick/lib/common.sh" 2>/dev/null || true
    # shellcheck disable=SC1091
    source "$(dirname "$0")/../../../src/sidekick/features/statusline.sh" 2>/dev/null || true

    # Set up config
    export FEATURE_STATUSLINE=true
    export STATUSLINE_TOKEN_THRESHOLD=160000
    export LOG_LEVEL=error  # Suppress logs during tests
}

# Teardown test environment
teardown() {
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

# Strip ANSI colors for easier assertions
strip_ansi() {
    echo "$1" | sed 's/\x1b\[[0-9;]*m//g'
}

# ============================================================================
# TESTS: _statusline_format_cost()
# ============================================================================

test_format_cost_zero() {
    local result
    result=$(_statusline_format_cost "0")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "--" ]
}

test_format_cost_null() {
    local result
    result=$(_statusline_format_cost "null")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "--" ]
}

test_format_cost_less_than_cent() {
    local result
    result=$(_statusline_format_cost "0.005")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "<1¢" ]
}

test_format_cost_cents() {
    local result
    result=$(_statusline_format_cost "0.25")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "25¢" ]
}

test_format_cost_dollars_low() {
    local result
    result=$(_statusline_format_cost "5.50")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "\$5.50" ]
}

test_format_cost_dollars_high() {
    local result
    result=$(_statusline_format_cost "150.75")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "\$150.75" ]
}

# ============================================================================
# TESTS: _statusline_format_duration()
# ============================================================================

test_format_duration_zero() {
    local result
    result=$(_statusline_format_duration "0")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "--" ]
}

test_format_duration_null() {
    local result
    result=$(_statusline_format_duration "null")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "--" ]
}

test_format_duration_milliseconds() {
    local result
    result=$(_statusline_format_duration "500")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "500ms" ]
}

test_format_duration_seconds_low() {
    local result
    result=$(_statusline_format_duration "5000")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "5.0s" ]
}

test_format_duration_seconds_high() {
    local result
    result=$(_statusline_format_duration "45000")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "45s" ]
}

test_format_duration_minutes() {
    local result
    result=$(_statusline_format_duration "180000")  # 3 minutes
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "3.0m" ]
}

test_format_duration_hours() {
    local result
    result=$(_statusline_format_duration "7200000")  # 2 hours
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "2.0h" ]
}

# ============================================================================
# TESTS: _statusline_format_tokens()
# ============================================================================

test_format_tokens_zero() {
    local result
    result=$(_statusline_format_tokens "0" "0")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "0" ]
}

test_format_tokens_low_count() {
    local result
    result=$(_statusline_format_tokens "500" "0")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "🪙 500" ]
}

test_format_tokens_k_notation() {
    local result
    result=$(_statusline_format_tokens "50000" "31")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "🪙 50.0K" ]
}

test_format_tokens_high_percentage() {
    local result
    result=$(_statusline_format_tokens "120000" "75")
    local stripped=$(strip_ansi "$result")
    # Should be yellow (70-89%)
    [[ "$result" == *"🪙 120.0K"* ]]
}

test_format_tokens_critical_percentage() {
    local result
    result=$(_statusline_format_tokens "145000" "91")
    local stripped=$(strip_ansi "$result")
    # Should be red (90%+)
    [[ "$result" == *"🪙 145.0K"* ]]
}

# ============================================================================
# TESTS: _statusline_get_topic()
# ============================================================================

test_get_topic_no_file() {
    local result
    result=$(_statusline_get_topic "nonexistent-session" "$TEST_DIR")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "--" ]
}

test_get_topic_null_session() {
    local result
    result=$(_statusline_get_topic "null" "$TEST_DIR")
    local stripped=$(strip_ansi "$result")
    [ "$stripped" = "--" ]
}

test_get_topic_with_valid_file() {
    # Override sidekick root to use test directory
    local session_id="test-session-123"
    export _SIDEKICK_ROOT="$TEST_DIR"
    mkdir -p "$TEST_DIR/.sidekick/sessions/$session_id"

    # Create topic.json
    cat > "$TEST_DIR/.sidekick/sessions/$session_id/topic.json" <<EOF
{
  "session_id": "$session_id",
  "task_ids": ["TASK-001", "FEAT-42"],
  "initial_goal": "Implement feature X",
  "current_objective": "Writing tests",
  "clarity_score": 8,
  "snarky_comment": "Because TDD is for the disciplined"
}
EOF

    local result
    result=$(_statusline_get_topic "$session_id" "$TEST_DIR")
    local stripped=$(strip_ansi "$result")

    # Should contain task IDs, goal, and snarky comment
    [[ "$stripped" == *"TASK-001"* ]]
    [[ "$stripped" == *"Implement feature X"* ]]
    [[ "$stripped" == *"Writing tests"* ]]
    [[ "$stripped" == *"TDD is for the disciplined"* ]]
}

test_get_topic_low_clarity_no_snark() {
    # Override sidekick root to use test directory
    local session_id="test-session-456"
    export _SIDEKICK_ROOT="$TEST_DIR"
    mkdir -p "$TEST_DIR/tmp/$session_id"

    # Create topic.json with low clarity (< 7)
    cat > "$TEST_DIR/tmp/$session_id/topic.json" <<EOF
{
  "session_id": "$session_id",
  "initial_goal": "Debug issue",
  "clarity_score": 5,
  "snarky_comment": "This should not appear"
}
EOF

    local result
    result=$(_statusline_get_topic "$session_id" "$TEST_DIR")
    local stripped=$(strip_ansi "$result")

    # Should contain goal but NOT snarky comment
    [[ "$stripped" == *"Debug issue"* ]]
    [[ "$stripped" != *"This should not appear"* ]]
}

# ============================================================================
# TESTS: _statusline_get_git_branch()
# ============================================================================

test_get_git_branch_not_a_repo() {
    local result
    result=$(_statusline_get_git_branch "$TEST_DIR")
    [ -z "$result" ]
}

test_get_git_branch_main() {
    # Create a git repo
    cd "$TEST_DIR"
    git init -q
    git checkout -b main 2>/dev/null || true

    local result
    result=$(_statusline_get_git_branch "$TEST_DIR")
    local stripped=$(strip_ansi "$result")

    [[ "$stripped" == *"⎇ main"* ]]
}

test_get_git_branch_feature() {
    # Create a git repo
    cd "$TEST_DIR"
    git init -q
    git checkout -b feature/test-branch 2>/dev/null || true

    local result
    result=$(_statusline_get_git_branch "$TEST_DIR")
    local stripped=$(strip_ansi "$result")

    [[ "$stripped" == *"⎇ feature/test-branch"* ]]
}

# ============================================================================
# TESTS: feature_statusline_render()
# ============================================================================

test_render_feature_disabled() {
    export FEATURE_STATUSLINE=false

    local input='{"session_id":"test"}'
    local result
    result=$(feature_statusline_render "$input")

    # Should return empty when disabled
    [ -z "$result" ]
}

test_render_invalid_json() {
    export FEATURE_STATUSLINE=true

    local input='invalid json'
    local result
    ! feature_statusline_render "$input" 2>/dev/null
}

test_render_full_statusline() {
    export FEATURE_STATUSLINE=true
    export _SIDEKICK_ROOT="$TEST_DIR"

    # Create transcript file
    local transcript="$TEST_DIR/transcript.jsonl"
    # Create a transcript with ~10K tokens (very rough estimate: 4 chars per token)
    printf '{"role":"user","content":"%s"}\n' "$(head -c 40000 < /dev/zero | tr '\0' 'x')" > "$transcript"

    # Create session and topic
    local session_id="test-session-789"
    mkdir -p "$TEST_DIR/.sidekick/sessions/$session_id"

    cat > "$TEST_DIR/.sidekick/sessions/$session_id/topic.json" <<EOF
{
  "session_id": "$session_id",
  "initial_goal": "Test statusline",
  "clarity_score": 8
}
EOF

    # Create input JSON
    local input
    input=$(cat <<EOF
{
  "session_id": "$session_id",
  "model": {"display_name": "Sonnet 4.5"},
  "workspace": {"current_dir": "$TEST_DIR", "project_dir": "$TEST_DIR"},
  "cost": {"total_cost_usd": 1.23},
  "duration_ms": 12500,
  "transcript_path": "$transcript"
}
EOF
)

    local result
    result=$(feature_statusline_render "$input")
    local stripped=$(strip_ansi "$result")

    # Should contain all expected parts
    [[ "$stripped" == *"Sonnet 4.5"* ]]
    [[ "$stripped" == *"🪙"* ]]
    [[ "$stripped" == *"%"* ]]
    [[ "$stripped" == *"📁"* ]]
    [[ "$stripped" == *"\$1.23"* ]]
    [[ "$stripped" == *"12"* ]]  # Duration (12.5s or similar)
    [[ "$stripped" == *"Test statusline"* ]]
}

# ============================================================================
# Main test execution
# ============================================================================

main() {
    echo "Running statusline feature tests..."
    echo

    setup

    # Cost formatting tests
    run_test test_format_cost_zero
    run_test test_format_cost_null
    run_test test_format_cost_less_than_cent
    run_test test_format_cost_cents
    run_test test_format_cost_dollars_low
    run_test test_format_cost_dollars_high

    # Duration formatting tests
    run_test test_format_duration_zero
    run_test test_format_duration_null
    run_test test_format_duration_milliseconds
    run_test test_format_duration_seconds_low
    run_test test_format_duration_seconds_high
    run_test test_format_duration_minutes
    run_test test_format_duration_hours

    # Token formatting tests
    run_test test_format_tokens_zero
    run_test test_format_tokens_low_count
    run_test test_format_tokens_k_notation
    run_test test_format_tokens_high_percentage
    run_test test_format_tokens_critical_percentage

    # Topic extraction tests
    run_test test_get_topic_no_file
    run_test test_get_topic_null_session
    run_test test_get_topic_with_valid_file
    run_test test_get_topic_low_clarity_no_snark

    # Git branch tests
    run_test test_get_git_branch_not_a_repo
    run_test test_get_git_branch_main
    run_test test_get_git_branch_feature

    # Full rendering tests
    run_test test_render_feature_disabled
    run_test test_render_invalid_json
    run_test test_render_full_statusline

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
