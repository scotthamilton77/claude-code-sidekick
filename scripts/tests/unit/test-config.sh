#!/bin/bash
# test-config.sh - Unit tests for configuration functions
#
# Tests the CONFIGURATION namespace from lib/common.sh

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
    mkdir -p "${TEST_SIDEKICK_ROOT}/lib"

    # Create minimal config.defaults
    cat > "${TEST_SIDEKICK_ROOT}/config.defaults" <<'EOF'
# Test defaults
FEATURE_TOPIC_EXTRACTION=true
FEATURE_RESUME=true
FEATURE_TRACKING=true
FEATURE_NONEXISTENT=false
TOPIC_MODE=topic-only
TOPIC_CADENCE_HIGH=10
LOG_LEVEL=info
TOPIC_CADENCE_LOW=1
TOPIC_CLARITY_THRESHOLD=7
SLEEPER_MAX_DURATION=600
SLEEPER_MIN_SIZE_CHANGE=500
SLEEPER_MIN_INTERVAL=10
SLEEPER_MIN_SLEEP=2
SLEEPER_MAX_SLEEP=20
RESUME_MIN_CLARITY=5
STATUSLINE_TOKEN_THRESHOLD=160000
TRACKING_STATIC_CADENCE=4
CLEANUP_MIN_COUNT=5
CLEANUP_AGE_DAYS=2
EOF

    # Mock path_get_sidekick_root
    path_get_sidekick_root() {
        echo "${TEST_SIDEKICK_ROOT}"
    }
    export -f path_get_sidekick_root

    # Source common.sh
    # shellcheck disable=SC1090
    source "$(dirname "$0")/../../../src/sidekick/lib/common.sh" 2>/dev/null || true
}

# Teardown test environment
teardown() {
    rm -rf "$TEST_DIR"
    unset CLAUDE_PROJECT_DIR
}

# Test helper
run_test() {
    local test_name="$1"
    TESTS_RUN=$((TESTS_RUN + 1))

    # Reset config before each test
    unset FEATURE_TOPIC_EXTRACTION FEATURE_RESUME FEATURE_TRACKING
    unset TOPIC_MODE TOPIC_CADENCE_HIGH LOG_LEVEL
    unset CLAUDE_PROJECT_DIR

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

# Test: config_load sources defaults
test_config_load_sources_defaults() {
    config_load

    # Check that defaults were loaded
    [ "${FEATURE_TOPIC_EXTRACTION}" = "true" ]
    [ "${TOPIC_MODE}" = "topic-only" ]
    [ "${LOG_LEVEL}" = "info" ]
}

# Test: config_load loads user config override
test_config_load_user_override() {
    # Create user config
    mkdir -p "${HOME}/.claude/hooks/sidekick"
    cat > "${HOME}/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
# User overrides
TOPIC_MODE=incremental
LOG_LEVEL=debug
EOF

    config_load

    # User config should override defaults
    [ "${TOPIC_MODE}" = "incremental" ]
    [ "${LOG_LEVEL}" = "debug" ]
    # But unoverridden values should remain
    [ "${FEATURE_TOPIC_EXTRACTION}" = "true" ]

    # Cleanup
    rm -f "${HOME}/.claude/hooks/sidekick/sidekick.conf"
}

# Test: config_load project config overrides user
test_config_load_project_override() {
    # Create user config
    mkdir -p "${HOME}/.claude/hooks/sidekick"
    cat > "${HOME}/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
TOPIC_MODE=incremental
LOG_LEVEL=debug
EOF

    # Create project config
    export CLAUDE_PROJECT_DIR="${TEST_DIR}/project"
    mkdir -p "${CLAUDE_PROJECT_DIR}/.claude/hooks/sidekick"
    cat > "${CLAUDE_PROJECT_DIR}/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
TOPIC_MODE=full-analytics
EOF

    config_load

    # Project should override user
    [ "${TOPIC_MODE}" = "full-analytics" ]
    # But user should override defaults
    [ "${LOG_LEVEL}" = "debug" ]

    # Cleanup
    rm -f "${HOME}/.claude/hooks/sidekick/sidekick.conf"
}

# Test: config_get returns value
test_config_get_returns_value() {
    config_load

    local value
    value=$(config_get "TOPIC_MODE")
    [ "$value" = "topic-only" ]
}

# Test: config_get returns empty for missing key
test_config_get_missing_key() {
    config_load

    local value
    value=$(config_get "NONEXISTENT_KEY")
    [ -z "$value" ]
}

# Test: config_is_feature_enabled returns 0 for enabled
test_config_is_feature_enabled_true() {
    config_load

    # FEATURE_TOPIC_EXTRACTION=true in defaults
    config_is_feature_enabled "topic_extraction"
}

# Test: config_is_feature_enabled returns 1 for disabled
test_config_is_feature_enabled_false() {
    config_load

    # FEATURE_NONEXISTENT=false in defaults
    # Temporarily disable error trap and errexit to test function that returns 1
    trap - ERR
    set +e
    config_is_feature_enabled "nonexistent"
    local result=$?
    set -e
    trap 'error_trap $LINENO' ERR

    # Should return 1 (disabled)
    [ "$result" -eq 1 ]
}

# Test: config_is_feature_enabled handles uppercase
test_config_is_feature_enabled_case_insensitive() {
    config_load

    # Should convert to uppercase
    config_is_feature_enabled "resume"
    config_is_feature_enabled "RESUME"
}

# Test: _config_validate catches invalid LOG_LEVEL
test_config_validate_invalid_log_level() {
    # Set invalid log level
    LOG_LEVEL="invalid"

    # Validation should warn and reset to info
    local output
    output=$(_config_validate 2>&1 || true)
    echo "$output" | grep -q "Invalid LOG_LEVEL"
}

# Test: _config_validate accepts valid LOG_LEVEL
test_config_validate_valid_log_level() {
    LOG_LEVEL="debug"
    _config_validate
    [ "${LOG_LEVEL}" = "debug" ]

    LOG_LEVEL="info"
    _config_validate
    [ "${LOG_LEVEL}" = "info" ]

    LOG_LEVEL="warn"
    _config_validate
    [ "${LOG_LEVEL}" = "warn" ]

    LOG_LEVEL="error"
    _config_validate
    [ "${LOG_LEVEL}" = "error" ]
}

# Test: _config_validate checks numeric values
test_config_validate_numeric_values() {
    TOPIC_CADENCE_HIGH=10
    SLEEPER_MIN_SLEEP=2
    SLEEPER_MAX_SLEEP=20

    _config_validate
}

# Test: _config_validate rejects non-numeric values
test_config_validate_rejects_non_numeric() {
    TOPIC_CADENCE_HIGH="not a number"

    ! _config_validate 2>/dev/null
}

# Main test execution
main() {
    echo "Running configuration namespace tests..."
    echo

    setup

    # Run all tests
    run_test test_config_load_sources_defaults
    run_test test_config_load_user_override
    run_test test_config_load_project_override
    run_test test_config_get_returns_value
    run_test test_config_get_missing_key
    run_test test_config_is_feature_enabled_true
    run_test test_config_is_feature_enabled_false
    run_test test_config_is_feature_enabled_case_insensitive
    run_test test_config_validate_invalid_log_level
    run_test test_config_validate_valid_log_level
    run_test test_config_validate_numeric_values
    run_test test_config_validate_rejects_non_numeric

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
