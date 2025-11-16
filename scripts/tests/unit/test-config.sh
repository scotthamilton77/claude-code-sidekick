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
    unset TEST_API_KEY ANOTHER_VAR SHARED_VAR SIDEKICK_ONLY
    unset USER_API_KEY USER_SETTING API_KEY USER_ONLY PROJECT_ONLY
    rm -f "${HOME}/.sidekick/.env"  # Clean up any user .env created by tests
}

# Test helper
run_test() {
    local test_name="$1"
    TESTS_RUN=$((TESTS_RUN + 1))

    # Reset config before each test
    unset FEATURE_TOPIC_EXTRACTION FEATURE_RESUME FEATURE_TRACKING
    unset TOPIC_CADENCE_HIGH LOG_LEVEL
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
    [ "${TOPIC_CADENCE_HIGH}" = "10" ]
    [ "${LOG_LEVEL}" = "info" ]
}

# Test: config_load loads user config override
test_config_load_user_override() {
    # Create user config
    mkdir -p "${HOME}/.claude/hooks/sidekick"
    cat > "${HOME}/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
# User overrides
TOPIC_CADENCE_HIGH=20
LOG_LEVEL=debug
EOF

    config_load

    # User config should override defaults
    [ "${TOPIC_CADENCE_HIGH}" = "20" ]
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
TOPIC_CADENCE_HIGH=20
LOG_LEVEL=debug
EOF

    # Create project config
    export CLAUDE_PROJECT_DIR="${TEST_DIR}/project"
    mkdir -p "${CLAUDE_PROJECT_DIR}/.claude/hooks/sidekick"
    cat > "${CLAUDE_PROJECT_DIR}/.claude/hooks/sidekick/sidekick.conf" <<'EOF'
TOPIC_CADENCE_HIGH=30
EOF

    config_load

    # Project should override user
    [ "${TOPIC_CADENCE_HIGH}" = "30" ]
    # But user should override defaults
    [ "${LOG_LEVEL}" = "debug" ]

    # Cleanup
    rm -f "${HOME}/.claude/hooks/sidekick/sidekick.conf"
}

# Test: config_get returns value
test_config_get_returns_value() {
    config_load

    local value
    value=$(config_get "TOPIC_CADENCE_HIGH")
    [ "$value" = "10" ]
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

# Test: config_load sources .env from project root
test_config_load_env_project_root() {
    # Create project directory with .env
    export CLAUDE_PROJECT_DIR="${TEST_DIR}/project"
    mkdir -p "${CLAUDE_PROJECT_DIR}"
    cat > "${CLAUDE_PROJECT_DIR}/.env" <<'EOF'
TEST_API_KEY=project-root-key
ANOTHER_VAR=project-value
EOF

    # Clear any existing values
    unset TEST_API_KEY ANOTHER_VAR

    config_load

    # Environment variables should be set and exported
    [ "${TEST_API_KEY}" = "project-root-key" ]
    [ "${ANOTHER_VAR}" = "project-value" ]
}

# Test: config_load .sidekick/.env overrides project root .env
test_config_load_env_sidekick_overrides() {
    # Create project directory with both .env files
    export CLAUDE_PROJECT_DIR="${TEST_DIR}/project"
    mkdir -p "${CLAUDE_PROJECT_DIR}"
    mkdir -p "${CLAUDE_PROJECT_DIR}/.sidekick"

    # Project root .env
    cat > "${CLAUDE_PROJECT_DIR}/.env" <<'EOF'
TEST_API_KEY=project-root-key
SHARED_VAR=from-root
EOF

    # Sidekick-specific .env (should override)
    cat > "${CLAUDE_PROJECT_DIR}/.sidekick/.env" <<'EOF'
TEST_API_KEY=sidekick-key
SIDEKICK_ONLY=sidekick-value
EOF

    # Clear any existing values
    unset TEST_API_KEY SHARED_VAR SIDEKICK_ONLY

    config_load

    # Sidekick .env should override project root for TEST_API_KEY
    [ "${TEST_API_KEY}" = "sidekick-key" ]
    # But project root values not in sidekick .env should remain
    [ "${SHARED_VAR}" = "from-root" ]
    # And sidekick-only values should be set
    [ "${SIDEKICK_ONLY}" = "sidekick-value" ]
}

# Test: config_load works without .env files
test_config_load_env_optional() {
    # Create project directory without .env
    export CLAUDE_PROJECT_DIR="${TEST_DIR}/project"
    mkdir -p "${CLAUDE_PROJECT_DIR}"

    # Should not fail if .env doesn't exist
    config_load

    # Defaults should still be loaded
    [ "${FEATURE_TOPIC_EXTRACTION}" = "true" ]
}

# Test: config_load sources user-wide .env
test_config_load_env_user_scope() {
    # Create user-wide .env
    mkdir -p "${HOME}/.sidekick"
    cat > "${HOME}/.sidekick/.env" <<'EOF'
USER_API_KEY=user-wide-key
USER_SETTING=user-value
EOF

    # Clear any existing values
    unset USER_API_KEY USER_SETTING

    config_load

    # Environment variables should be set
    [ "${USER_API_KEY}" = "user-wide-key" ]
    [ "${USER_SETTING}" = "user-value" ]

    # Cleanup
    rm -f "${HOME}/.sidekick/.env"
}

# Test: config_load project .env overrides user .env
test_config_load_env_project_overrides_user() {
    # Create user-wide .env
    mkdir -p "${HOME}/.sidekick"
    cat > "${HOME}/.sidekick/.env" <<'EOF'
API_KEY=user-key
USER_ONLY=user-value
EOF

    # Create project .env (should override)
    export CLAUDE_PROJECT_DIR="${TEST_DIR}/project"
    mkdir -p "${CLAUDE_PROJECT_DIR}"
    cat > "${CLAUDE_PROJECT_DIR}/.env" <<'EOF'
API_KEY=project-key
PROJECT_ONLY=project-value
EOF

    # Clear any existing values
    unset API_KEY USER_ONLY PROJECT_ONLY

    config_load

    # Project should override user for API_KEY
    [ "${API_KEY}" = "project-key" ]
    # User-only values should remain
    [ "${USER_ONLY}" = "user-value" ]
    # Project-only values should be set
    [ "${PROJECT_ONLY}" = "project-value" ]

    # Cleanup
    rm -f "${HOME}/.sidekick/.env"
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
    run_test test_config_load_env_user_scope
    run_test test_config_load_env_project_root
    run_test test_config_load_env_project_overrides_user
    run_test test_config_load_env_sidekick_overrides
    run_test test_config_load_env_optional
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
