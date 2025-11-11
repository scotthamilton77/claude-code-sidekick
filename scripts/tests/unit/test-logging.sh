#!/bin/bash
# test-logging.sh - Unit tests for logging functions
#
# Tests the LOGGING namespace from lib/common.sh

set -euo pipefail

# Colors for test output
readonly GREEN='\033[0;32m'
readonly RED='\033[0;31m'
readonly YELLOW='\033[0;33m'
readonly RESET='\033[0m'

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Setup test environment
setup() {
    # Create temp directory for test session
    TEST_DIR=$(mktemp -d)
    TEST_SESSION_ID="test-$(date +%s)-$$"

    # Source common.sh
    # Temporarily disable error trap to set up our test environment
    set +e
    trap - ERR

    # We need to mock path_get_session_dir before sourcing common.sh
    # Create a minimal implementation
    export SIDEKICK_TEST_MODE=1
    export SIDEKICK_ROOT="${TEST_DIR}"
    export CLAUDE_PROJECT_DIR="${TEST_DIR}"

    # Source the library
    # shellcheck disable=SC1091
    source "$(dirname "$0")/../../../src/sidekick/lib/common.sh" 2>/dev/null || true

    # Re-enable strict mode
    set -euo pipefail

    # Override path functions for testing
    path_get_sidekick_root() {
        echo "${TEST_DIR}"
    }

    path_get_session_dir() {
        local session_id="$1"
        local session_dir="${TEST_DIR}/.sidekick/sessions/${session_id}"
        mkdir -p "$session_dir"
        echo "$session_dir"
    }
}

# Teardown test environment
teardown() {
    rm -rf "$TEST_DIR"
}

# Test helper: run a test and track results
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

# Test: log_init creates log file
test_log_init_creates_file() {
    local session_id="test-init-$$"
    # Create session directory (log_init expects it to exist)
    path_get_session_dir "$session_id" >/dev/null
    log_init "$session_id"

    local expected_log="${TEST_DIR}/.sidekick/sessions/${session_id}/sidekick.log"
    [ -f "$expected_log" ]
}

# Test: log_init writes initialization message
test_log_init_writes_message() {
    local session_id="test-init-msg-$$"
    # Create session directory (log_init expects it to exist)
    path_get_session_dir "$session_id" >/dev/null
    log_init "$session_id"

    local log_file="${TEST_DIR}/.sidekick/sessions/${session_id}/sidekick.log"
    grep -q "Sidekick session started: ${session_id}" "$log_file"
}

# Test: log_debug respects LOG_LEVEL
test_log_debug_respects_level() {
    local session_id="test-debug-level-$$"
    # Create session directory (log_init expects it to exist)
    path_get_session_dir "$session_id" >/dev/null
    log_init "$session_id"

    # Test with LOG_LEVEL=info (debug should not log)
    LOG_LEVEL=info
    log_debug "debug message should not appear"

    local log_file="${TEST_DIR}/.sidekick/sessions/${session_id}/sidekick.log"
    ! grep -q "debug message should not appear" "$log_file"
}

# Test: log_debug outputs when LOG_LEVEL=debug
test_log_debug_outputs_when_enabled() {
    local session_id="test-debug-enabled-$$"
    # Create session directory (log_init expects it to exist)
    path_get_session_dir "$session_id" >/dev/null
    log_init "$session_id"

    # Test with LOG_LEVEL=debug
    LOG_LEVEL=debug
    log_debug "debug message should appear"

    local log_file="${TEST_DIR}/.sidekick/sessions/${session_id}/sidekick.log"
    grep -q "debug message should appear" "$log_file"
}

# Test: log_info outputs correctly
test_log_info_outputs() {
    local session_id="test-info-$$"
    # Create session directory (log_init expects it to exist)
    path_get_session_dir "$session_id" >/dev/null
    log_init "$session_id"

    LOG_LEVEL=info
    log_info "info message"

    local log_file="${TEST_DIR}/.sidekick/sessions/${session_id}/sidekick.log"
    grep -qF "info message" "$log_file"
}

# Test: log_warn outputs correctly
test_log_warn_outputs() {
    local session_id="test-warn-$$"
    # Create session directory (log_init expects it to exist)
    path_get_session_dir "$session_id" >/dev/null
    log_init "$session_id"

    LOG_LEVEL=warn
    log_warn "warning message"

    local log_file="${TEST_DIR}/.sidekick/sessions/${session_id}/sidekick.log"
    grep -qF "warning message" "$log_file"
}

# Test: log_error always outputs
test_log_error_always_outputs() {
    local session_id="test-error-$$"
    # Create session directory (log_init expects it to exist)
    path_get_session_dir "$session_id" >/dev/null
    log_init "$session_id"

    # Even with LOG_LEVEL=error, errors should log
    LOG_LEVEL=error
    log_error "error message"

    local log_file="${TEST_DIR}/.sidekick/sessions/${session_id}/sidekick.log"
    grep -qF "error message" "$log_file"
}

# Test: _log_to_file includes timestamp
test_log_to_file_includes_timestamp() {
    local session_id="test-timestamp-$$"
    # Create session directory (log_init expects it to exist)
    path_get_session_dir "$session_id" >/dev/null
    log_init "$session_id"

    log_info "timestamped message"

    local log_file="${TEST_DIR}/.sidekick/sessions/${session_id}/sidekick.log"
    # Check for timestamp format: [YYYY-MM-DD HH:MM:SS]
    grep -q '\[[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\} [0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}\]' "$log_file"
}

# Test: log levels are hierarchical
test_log_levels_hierarchical() {
    local session_id="test-hierarchy-$$"
    # Create session directory (log_init expects it to exist)
    path_get_session_dir "$session_id" >/dev/null
    log_init "$session_id"

    # With LOG_LEVEL=warn, info should not log
    LOG_LEVEL=warn
    log_info "should not appear"
    log_warn "should appear"

    local log_file="${TEST_DIR}/.sidekick/sessions/${session_id}/sidekick.log"
    ! grep -q "should not appear" "$log_file"
    grep -q "should appear" "$log_file"
}

# Test: console logging can be suppressed for debug/info/warn
test_console_logging_suppression() {
    local session_id="test-console-suppress-$$"
    path_get_session_dir "$session_id" >/dev/null
    log_init "$session_id"

    # Disable console logging
    export _CONSOLE_LOGGING_ENABLED=false
    LOG_LEVEL=debug

    # Capture stderr
    local stderr_output
    stderr_output=$(log_debug "console suppressed debug" 2>&1 || true)

    # Should not appear in stderr
    [ -z "$stderr_output" ] || [[ ! "$stderr_output" =~ "console suppressed debug" ]]

    # But should still be in log file
    local log_file="${TEST_DIR}/.sidekick/sessions/${session_id}/sidekick.log"
    grep -q "console suppressed debug" "$log_file"
}

# Test: log_error bypasses console logging suppression
test_error_bypasses_console_suppression() {
    local session_id="test-error-bypass-$$"
    path_get_session_dir "$session_id" >/dev/null
    log_init "$session_id"

    # Disable console logging
    export _CONSOLE_LOGGING_ENABLED=false

    # Capture stderr
    local stderr_output
    stderr_output=$(log_error "critical error visible" 2>&1 || true)

    # Error should appear in stderr (bypasses flag)
    [[ "$stderr_output" =~ "critical error visible" ]]

    # And also in log file
    local log_file="${TEST_DIR}/.sidekick/sessions/${session_id}/sidekick.log"
    grep -q "critical error visible" "$log_file"
}

# Test: file logging continues when console logging disabled
test_file_logging_when_console_disabled() {
    local session_id="test-file-when-disabled-$$"
    path_get_session_dir "$session_id" >/dev/null
    log_init "$session_id"

    export _CONSOLE_LOGGING_ENABLED=false
    LOG_LEVEL=debug

    log_debug "file only debug"
    log_info "file only info"
    log_warn "file only warn"

    local log_file="${TEST_DIR}/.sidekick/sessions/${session_id}/sidekick.log"
    grep -q "file only debug" "$log_file"
    grep -q "file only info" "$log_file"
    grep -q "file only warn" "$log_file"
}

# Test: console logging enabled by default
test_console_logging_default_enabled() {
    local session_id="test-console-default-$$"
    path_get_session_dir "$session_id" >/dev/null

    # Unset the flag to test default
    unset _CONSOLE_LOGGING_ENABLED
    log_init "$session_id"

    # Capture stderr
    local stderr_output
    stderr_output=$(log_info "default console output" 2>&1 || true)

    # Should appear in stderr by default
    [[ "$stderr_output" =~ "default console output" ]]
}

# Main test execution
main() {
    echo "Running logging namespace tests..."
    echo

    setup

    # Run all tests
    run_test test_log_init_creates_file
    run_test test_log_init_writes_message
    run_test test_log_debug_respects_level
    run_test test_log_debug_outputs_when_enabled
    run_test test_log_info_outputs
    run_test test_log_warn_outputs
    run_test test_log_error_always_outputs
    run_test test_log_to_file_includes_timestamp
    run_test test_log_levels_hierarchical
    run_test test_console_logging_suppression
    run_test test_error_bypasses_console_suppression
    run_test test_file_logging_when_console_disabled
    run_test test_console_logging_default_enabled

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
