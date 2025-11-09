#!/bin/bash
# test-circuit-breaker.sh - Unit tests for circuit breaker functionality
#
# Tests the circuit breaker state management in lib/llm.sh

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
    TEST_SIDEKICK_ROOT="${TEST_DIR}/sidekick"
    TEST_SESSION_DIR="${TEST_DIR}/sessions/test-session"
    mkdir -p "${TEST_SIDEKICK_ROOT}/lib"
    mkdir -p "${TEST_SESSION_DIR}"

    # Set session ID for tests
    export CLAUDE_SESSION_ID="test-session"

    # Prevent loading real user config
    export SIDEKICK_USER_ROOT="sidekick-test-$$"

    # Create minimal config.defaults
    cat > "${TEST_SIDEKICK_ROOT}/config.defaults" <<'EOF'
# Test defaults
CIRCUIT_BREAKER_ENABLED=true
CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
CIRCUIT_BREAKER_BACKOFF_INITIAL=60
CIRCUIT_BREAKER_BACKOFF_MAX=3600
CIRCUIT_BREAKER_BACKOFF_MULTIPLIER=2
LLM_FALLBACK_PROVIDER=claude-cli
LLM_FALLBACK_MODEL=haiku
LOG_LEVEL=error
EOF

    # Source common.sh and llm.sh first
    # shellcheck disable=SC1090
    source "$(dirname "$0")/../../../src/sidekick/lib/common.sh" 2>/dev/null || true
    # shellcheck disable=SC1090
    source "$(dirname "$0")/../../../src/sidekick/lib/llm.sh" 2>/dev/null || true

    # Mock path_get_sidekick_root AFTER sourcing (to override the real implementation)
    path_get_sidekick_root() {
        echo "${TEST_SIDEKICK_ROOT}"
    }
    export -f path_get_sidekick_root

    # Mock paths_session_dir AFTER sourcing
    paths_session_dir() {
        echo "${TEST_SESSION_DIR}"
    }
    export -f paths_session_dir

    # Load config
    config_load
}

# Teardown test environment
teardown() {
    rm -rf "$TEST_DIR"
    unset CLAUDE_SESSION_ID SIDEKICK_USER_ROOT
}

# Test helper
run_test() {
    local test_name="$1"
    TESTS_RUN=$((TESTS_RUN + 1))

    # Reset circuit breaker state before each test
    local state_file="${TEST_SESSION_DIR}/circuit-breaker.json"
    rm -f "$state_file"
    unset CB_STATE CB_CONSECUTIVE_FAILURES CB_LAST_FAILURE_TIME CB_BACKOFF_DURATION CB_NEXT_RETRY_TIME

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

# Test: Initial state is CLOSED
test_initial_state_closed() {
    _circuit_breaker_load_state

    [ "$CB_STATE" = "CLOSED" ] || return 1
    [ "$CB_CONSECUTIVE_FAILURES" -eq 0 ] || return 1
}

# Test: Should not use fallback when CLOSED
test_closed_no_fallback() {
    _circuit_breaker_load_state
    CB_STATE="CLOSED"
    _circuit_breaker_save_state

    # Returns 1 means "use primary"
    ! _circuit_breaker_should_use_fallback
}

# Test: Record single failure stays CLOSED
test_single_failure_stays_closed() {
    _circuit_breaker_record_failure
    _circuit_breaker_load_state

    [ "$CB_STATE" = "CLOSED" ] || return 1
    [ "$CB_CONSECUTIVE_FAILURES" -eq 1 ] || return 1
}

# Test: Three failures transition to OPEN
test_three_failures_open_circuit() {
    _circuit_breaker_record_failure
    _circuit_breaker_record_failure
    _circuit_breaker_record_failure

    _circuit_breaker_load_state

    [ "$CB_STATE" = "OPEN" ] || return 1
    [ "$CB_CONSECUTIVE_FAILURES" -eq 3 ] || return 1
    [ "$CB_BACKOFF_DURATION" -eq 60 ] || return 1
}

# Test: OPEN circuit uses fallback immediately
test_open_uses_fallback() {
    # Set state to OPEN with future retry time
    _circuit_breaker_load_state
    CB_STATE="OPEN"
    CB_NEXT_RETRY_TIME=$(($(date +%s) + 100))
    _circuit_breaker_save_state

    # Returns 0 means "use fallback"
    _circuit_breaker_should_use_fallback
}

# Test: OPEN circuit transitions to HALF_OPEN after backoff
test_open_to_halfopen_after_backoff() {
    # Set state to OPEN with past retry time
    _circuit_breaker_load_state
    CB_STATE="OPEN"
    CB_NEXT_RETRY_TIME=$(($(date +%s) - 10))
    _circuit_breaker_save_state

    # Should transition to HALF_OPEN
    ! _circuit_breaker_should_use_fallback || return 1

    _circuit_breaker_load_state
    [ "$CB_STATE" = "HALF_OPEN" ]
}

# Test: HALF_OPEN success resets to CLOSED
test_halfopen_success_resets() {
    _circuit_breaker_load_state
    CB_STATE="HALF_OPEN"
    CB_CONSECUTIVE_FAILURES=3
    CB_BACKOFF_DURATION=60
    _circuit_breaker_save_state

    _circuit_breaker_record_success
    _circuit_breaker_load_state

    [ "$CB_STATE" = "CLOSED" ] || return 1
    [ "$CB_CONSECUTIVE_FAILURES" -eq 0 ] || return 1
    [ "$CB_BACKOFF_DURATION" -eq 0 ] || return 1
}

# Test: HALF_OPEN failure reopens with exponential backoff
test_halfopen_failure_exponential_backoff() {
    _circuit_breaker_load_state
    CB_STATE="HALF_OPEN"
    CB_BACKOFF_DURATION=60
    _circuit_breaker_save_state

    _circuit_breaker_record_failure
    _circuit_breaker_load_state

    [ "$CB_STATE" = "OPEN" ] || return 1
    [ "$CB_BACKOFF_DURATION" -eq 120 ] || return 1  # 60 * 2
}

# Test: Backoff caps at maximum
test_backoff_caps_at_max() {
    _circuit_breaker_load_state
    CB_STATE="HALF_OPEN"
    CB_BACKOFF_DURATION=2000  # Already above max
    _circuit_breaker_save_state

    _circuit_breaker_record_failure
    _circuit_breaker_load_state

    [ "$CB_STATE" = "OPEN" ] || return 1
    [ "$CB_BACKOFF_DURATION" -eq 3600 ] || return 1  # Capped at max
}

# Test: Success in CLOSED resets failure count
test_closed_success_resets_count() {
    _circuit_breaker_record_failure
    _circuit_breaker_record_failure

    _circuit_breaker_record_success
    _circuit_breaker_load_state

    [ "$CB_STATE" = "CLOSED" ] || return 1
    [ "$CB_CONSECUTIVE_FAILURES" -eq 0 ] || return 1
}

# Test: Disabled circuit breaker always uses primary
test_disabled_always_primary() {
    # Create config with circuit breaker disabled
    cat > "${TEST_SIDEKICK_ROOT}/config.defaults" <<'EOF'
CIRCUIT_BREAKER_ENABLED=false
CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
CIRCUIT_BREAKER_BACKOFF_INITIAL=60
CIRCUIT_BREAKER_BACKOFF_MAX=3600
CIRCUIT_BREAKER_BACKOFF_MULTIPLIER=2
LLM_FALLBACK_PROVIDER=claude-cli
LLM_FALLBACK_MODEL=haiku
LOG_LEVEL=error
EOF

    # Reset config variables and reload
    unset CIRCUIT_BREAKER_ENABLED LLM_FALLBACK_PROVIDER
    config_load

    # Even after failures, should not use fallback
    _circuit_breaker_record_failure
    _circuit_breaker_record_failure
    _circuit_breaker_record_failure

    ! _circuit_breaker_should_use_fallback
}

# Test: No fallback provider means always primary
test_no_fallback_always_primary() {
    # Create config without fallback
    cat > "${TEST_SIDEKICK_ROOT}/config.defaults" <<'EOF'
CIRCUIT_BREAKER_ENABLED=true
CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
CIRCUIT_BREAKER_BACKOFF_INITIAL=60
CIRCUIT_BREAKER_BACKOFF_MAX=3600
CIRCUIT_BREAKER_BACKOFF_MULTIPLIER=2
LLM_FALLBACK_PROVIDER=
LLM_FALLBACK_MODEL=
LOG_LEVEL=error
EOF

    # Reset config variables and reload
    unset CIRCUIT_BREAKER_ENABLED LLM_FALLBACK_PROVIDER LLM_FALLBACK_MODEL
    config_load

    # Even after failures, should not use fallback
    _circuit_breaker_record_failure
    _circuit_breaker_record_failure
    _circuit_breaker_record_failure

    ! _circuit_breaker_should_use_fallback
}

# Test: State file persists across loads
test_state_persists() {
    _circuit_breaker_load_state
    CB_STATE="OPEN"
    CB_CONSECUTIVE_FAILURES=5
    CB_BACKOFF_DURATION=120
    CB_NEXT_RETRY_TIME=1234567890
    _circuit_breaker_save_state

    # Clear globals and reload
    unset CB_STATE CB_CONSECUTIVE_FAILURES CB_BACKOFF_DURATION CB_NEXT_RETRY_TIME
    _circuit_breaker_load_state

    [ "$CB_STATE" = "OPEN" ] || return 1
    [ "$CB_CONSECUTIVE_FAILURES" -eq 5 ] || return 1
    [ "$CB_BACKOFF_DURATION" -eq 120 ] || return 1
    [ "$CB_NEXT_RETRY_TIME" -eq 1234567890 ] || return 1
}

# Run all tests
main() {
    echo "Circuit Breaker Unit Tests"
    echo "=========================="
    echo ""

    setup

    run_test test_initial_state_closed
    run_test test_closed_no_fallback
    run_test test_single_failure_stays_closed
    run_test test_three_failures_open_circuit
    run_test test_open_uses_fallback
    run_test test_open_to_halfopen_after_backoff
    run_test test_halfopen_success_resets
    run_test test_halfopen_failure_exponential_backoff
    run_test test_backoff_caps_at_max
    run_test test_closed_success_resets_count
    run_test test_disabled_always_primary
    run_test test_no_fallback_always_primary
    run_test test_state_persists

    teardown

    echo ""
    echo "=========================="
    echo "Tests run: ${TESTS_RUN}"
    echo -e "Passed: ${GREEN}${TESTS_PASSED}${RESET}"
    echo -e "Failed: ${RED}${TESTS_FAILED}${RESET}"

    if [ "$TESTS_FAILED" -eq 0 ]; then
        echo -e "${GREEN}All tests passed!${RESET}"
        exit 0
    else
        echo -e "${RED}Some tests failed${RESET}"
        exit 1
    fi
}

main
