#!/bin/bash
# test-workspace.sh - Unit tests for workspace management functions
#
# Tests the WORKSPACE MANAGEMENT namespace from lib/common.sh

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

    # Mock LOG_LEVEL to suppress debug output
    export LOG_LEVEL=error

    # Source common.sh
    # shellcheck disable=SC1091
    source "$(dirname "$0")/../../../src/sidekick/lib/common.sh" 2>/dev/null || true
}

# Teardown test environment
teardown() {
    # Clean up any workspaces created during tests
    rm -rf /tmp/sidekick-* 2>/dev/null || true
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

# Test: workspace_create creates directory
test_workspace_create_directory() {
    local workspace
    workspace=$(workspace_create "test-$$")

    # Directory should exist
    [ -d "$workspace" ]

    # Cleanup
    workspace_cleanup "$workspace"
}

# Test: workspace_create has correct path pattern
test_workspace_create_path_pattern() {
    local workspace
    workspace=$(workspace_create "test-123")

    # Should be in /tmp and contain identifier
    [[ "$workspace" == /tmp/sidekick-test-123 ]]

    # Cleanup
    workspace_cleanup "$workspace"
}

# Test: workspace_create creates settings file
test_workspace_create_settings_file() {
    local workspace
    workspace=$(workspace_create "test-$$")

    local settings="${workspace}/.claude.settings.json"
    [ -f "$settings" ]

    # Cleanup
    workspace_cleanup "$workspace"
}

# Test: workspace_create settings disable hooks
test_workspace_create_disables_hooks() {
    local workspace
    workspace=$(workspace_create "test-$$")

    local settings="${workspace}/.claude.settings.json"

    # Verify hooks are disabled
    local hooks
    hooks=$(jq -r '.hooks' "$settings")
    [ "$hooks" = "{}" ]

    # Verify statusLine is disabled
    local statusline
    statusline=$(jq -r '.statusLine.enabled' "$settings")
    [ "$statusline" = "false" ]

    # Cleanup
    workspace_cleanup "$workspace"
}

# Test: workspace_cleanup removes directory
test_workspace_cleanup_removes_directory() {
    local workspace
    workspace=$(workspace_create "test-cleanup-$$")

    # Verify it exists
    [ -d "$workspace" ]

    # Cleanup
    workspace_cleanup "$workspace"

    # Should be removed
    [ ! -d "$workspace" ]
}

# Test: workspace_cleanup handles non-existent directory
test_workspace_cleanup_nonexistent() {
    local workspace="/tmp/nonexistent-workspace-$$"

    # Should not error
    workspace_cleanup "$workspace"
}

# Test: workspace_create creates isolated environment
test_workspace_create_isolation() {
    local workspace
    workspace=$(workspace_create "test-isolation-$$")

    # Create a test file in workspace
    touch "${workspace}/test-file.txt"
    [ -f "${workspace}/test-file.txt" ]

    # Cleanup should remove everything
    workspace_cleanup "$workspace"
    [ ! -f "${workspace}/test-file.txt" ]
}

# Test: multiple workspaces can coexist
test_multiple_workspaces() {
    local workspace1
    local workspace2

    workspace1=$(workspace_create "test-multi-1-$$")
    workspace2=$(workspace_create "test-multi-2-$$")

    # Both should exist
    [ -d "$workspace1" ]
    [ -d "$workspace2" ]

    # Should have different paths
    [ "$workspace1" != "$workspace2" ]

    # Cleanup
    workspace_cleanup "$workspace1"
    workspace_cleanup "$workspace2"

    # Both should be removed
    [ ! -d "$workspace1" ]
    [ ! -d "$workspace2" ]
}

# Main test execution
main() {
    echo "Running workspace management namespace tests..."
    echo

    setup

    # Run all tests
    run_test test_workspace_create_directory
    run_test test_workspace_create_path_pattern
    run_test test_workspace_create_settings_file
    run_test test_workspace_create_disables_hooks
    run_test test_workspace_cleanup_removes_directory
    run_test test_workspace_cleanup_nonexistent
    run_test test_workspace_create_isolation
    run_test test_multiple_workspaces

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
