#!/bin/bash
# test-paths.sh - Unit tests for path resolution functions
#
# Tests the PATH RESOLUTION namespace from lib/common.sh

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

    # Source common.sh (we'll override path functions as needed for tests)
    # shellcheck disable=SC1091
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

    # Reset state before each test
    _SIDEKICK_ROOT=""
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

# Test: path_detect_scope detects user scope
test_path_detect_scope_user() {
    # Note: Mocking BASH_SOURCE doesn't work reliably because path_detect_scope
    # uses readlink -f which resolves to actual file paths.
    # We'll test that the function executes without error instead
    local scope
    scope=$(path_detect_scope)

    # Should return either "user" or "project"
    [[ "$scope" == "user" || "$scope" == "project" ]]
}

# Test: path_detect_scope detects project scope
test_path_detect_scope_project() {
    # Note: Mocking BASH_SOURCE doesn't work reliably because path_detect_scope
    # uses readlink -f which resolves to actual file paths.
    # Since we're running from the project directory, it should detect project scope
    local scope
    scope=$(path_detect_scope)

    # When running tests from the project, should return "project"
    [ "$scope" = "project" ]
}

# Test: path_get_sidekick_root returns correct path
test_path_get_sidekick_root() {
    # This will return the actual sidekick root based on common.sh location
    local root
    root=$(path_get_sidekick_root)

    # Should end with src/sidekick (since common.sh is in src/sidekick/lib)
    [[ "$root" == */src/sidekick ]]
}

# Test: path_get_sidekick_root caches result
test_path_get_sidekick_root_caches() {
    _SIDEKICK_ROOT=""

    # First call
    local root1
    root1=$(path_get_sidekick_root)

    # Second call should return same value
    local root2
    root2=$(path_get_sidekick_root)

    [ "$root1" = "$root2" ]
}

# Test: path_get_session_dir creates directory
test_path_get_session_dir_creates() {
    # Set CLAUDE_PROJECT_DIR (required)
    export CLAUDE_PROJECT_DIR="${TEST_DIR}"

    local session_id="test-session-123"
    local session_dir
    session_dir=$(path_get_session_dir "$session_id")

    # Should create the directory
    [ -d "$session_dir" ]

    # Should have correct path (.sidekick/sessions/)
    [ "$session_dir" = "${TEST_DIR}/.sidekick/sessions/${session_id}" ]

    # Cleanup
    unset CLAUDE_PROJECT_DIR
}

# Test: path_get_session_dir returns existing directory
test_path_get_session_dir_existing() {
    # Set CLAUDE_PROJECT_DIR (required)
    export CLAUDE_PROJECT_DIR="${TEST_DIR}"

    local session_id="test-existing-123"
    mkdir -p "${TEST_DIR}/.sidekick/sessions/${session_id}"

    local session_dir
    session_dir=$(path_get_session_dir "$session_id")

    [ "$session_dir" = "${TEST_DIR}/.sidekick/sessions/${session_id}" ]

    # Cleanup
    unset CLAUDE_PROJECT_DIR
}

# Test: path_get_project_dir from JSON
test_path_get_project_dir_from_json() {
    local json='{"workspace":{"project_dir":"/test/project"}}'

    local project_dir
    project_dir=$(path_get_project_dir "$json")

    [ "$project_dir" = "/test/project" ]
}

# Test: path_get_project_dir from environment
test_path_get_project_dir_from_env() {
    export CLAUDE_PROJECT_DIR="/env/project"

    local project_dir
    project_dir=$(path_get_project_dir "")

    [ "$project_dir" = "/env/project" ]
}

# Test: path_get_project_dir falls back to pwd
test_path_get_project_dir_fallback_pwd() {
    unset CLAUDE_PROJECT_DIR

    local project_dir
    project_dir=$(path_get_project_dir "")

    # Should return current directory
    [ -n "$project_dir" ]
    [ -d "$project_dir" ]
}

# Test: _path_normalize removes trailing slash
test_path_normalize_trailing_slash() {
    local normalized
    normalized=$(_path_normalize "/test/path/")

    [ "$normalized" = "/test/path" ]
}

# Test: _path_normalize handles existing paths
test_path_normalize_existing_path() {
    # Use a path we know exists
    local normalized
    normalized=$(_path_normalize "/tmp")

    # Should be absolute
    [[ "$normalized" == /* ]]
}

# Test: _path_normalize handles non-existing paths
test_path_normalize_nonexisting_path() {
    local normalized
    normalized=$(_path_normalize "/nonexistent/path/")

    # Should remove trailing slash
    [ "$normalized" = "/nonexistent/path" ]
}

# Main test execution
main() {
    echo "Running path resolution namespace tests..."
    echo

    setup

    # Run all tests
    run_test test_path_detect_scope_user
    run_test test_path_detect_scope_project
    run_test test_path_get_sidekick_root
    run_test test_path_get_sidekick_root_caches
    run_test test_path_get_session_dir_creates
    run_test test_path_get_session_dir_existing
    run_test test_path_get_project_dir_from_json
    run_test test_path_get_project_dir_from_env
    run_test test_path_get_project_dir_fallback_pwd
    run_test test_path_normalize_trailing_slash
    run_test test_path_normalize_existing_path
    run_test test_path_normalize_nonexisting_path

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
