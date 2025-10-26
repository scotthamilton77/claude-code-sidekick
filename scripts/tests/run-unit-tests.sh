#!/bin/bash
# run-unit-tests.sh - Test runner for all unit tests
#
# Runs all unit test suites for the Sidekick library

set -euo pipefail

# Colors for output
readonly GREEN='\033[0;32m'
readonly RED='\033[0;31m'
readonly YELLOW='\033[0;33m'
readonly BLUE='\033[0;34m'
readonly BOLD='\033[1m'
readonly RESET='\033[0m'

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_TEST_DIR="${SCRIPT_DIR}/unit"

# Test counters
TOTAL_SUITES=0
PASSED_SUITES=0
FAILED_SUITES=0

# Failed test tracking
declare -a FAILED_TESTS=()

# Run a single test suite
run_suite() {
    local test_script="$1"
    local test_name
    test_name=$(basename "$test_script" .sh)

    TOTAL_SUITES=$((TOTAL_SUITES + 1))

    echo
    echo -e "${BLUE}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${BLUE}${BOLD}Running: ${test_name}${RESET}"
    echo -e "${BLUE}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo

    if "$test_script"; then
        echo -e "${GREEN}✓ ${test_name} passed${RESET}"
        PASSED_SUITES=$((PASSED_SUITES + 1))
        return 0
    else
        echo -e "${RED}✗ ${test_name} FAILED${RESET}"
        FAILED_SUITES=$((FAILED_SUITES + 1))
        FAILED_TESTS+=("$test_name")
        return 1
    fi
}

# Main test execution
main() {
    echo -e "${BOLD}╔════════════════════════════════════════╗${RESET}"
    echo -e "${BOLD}║   Sidekick Unit Test Suite Runner     ║${RESET}"
    echo -e "${BOLD}╚════════════════════════════════════════╝${RESET}"
    echo

    # Check if test directory exists
    if [ ! -d "$UNIT_TEST_DIR" ]; then
        echo -e "${RED}ERROR: Unit test directory not found: ${UNIT_TEST_DIR}${RESET}"
        exit 1
    fi

    # Find all test scripts
    local test_scripts=()
    while IFS= read -r -d '' script; do
        test_scripts+=("$script")
    done < <(find "$UNIT_TEST_DIR" -name "test-*.sh" -type f -print0 | sort -z)

    if [ ${#test_scripts[@]} -eq 0 ]; then
        echo -e "${YELLOW}WARNING: No test scripts found in ${UNIT_TEST_DIR}${RESET}"
        exit 0
    fi

    echo "Found ${#test_scripts[@]} test suite(s)"
    echo

    # Run each test suite
    for script in "${test_scripts[@]}"; do
        run_suite "$script" || true  # Don't exit on failure, continue testing
    done

    # Print final summary
    echo
    echo -e "${BOLD}╔════════════════════════════════════════╗${RESET}"
    echo -e "${BOLD}║          Test Suite Summary            ║${RESET}"
    echo -e "${BOLD}╚════════════════════════════════════════╝${RESET}"
    echo
    echo "Total test suites:  ${TOTAL_SUITES}"
    echo -e "Passed suites:      ${GREEN}${PASSED_SUITES}${RESET}"

    if [ $FAILED_SUITES -gt 0 ]; then
        echo -e "Failed suites:      ${RED}${FAILED_SUITES}${RESET}"
        echo
        echo -e "${RED}${BOLD}Failed test suites:${RESET}"
        for test in "${FAILED_TESTS[@]}"; do
            echo -e "  ${RED}✗${RESET} $test"
        done
        echo
        exit 1
    else
        echo -e "Failed suites:      ${GREEN}0${RESET}"
        echo
        echo -e "${GREEN}${BOLD}╔════════════════════════════════════════╗${RESET}"
        echo -e "${GREEN}${BOLD}║     ALL TESTS PASSED! 🎉               ║${RESET}"
        echo -e "${GREEN}${BOLD}╚════════════════════════════════════════╝${RESET}"
        echo
        exit 0
    fi
}

# Parse command line args
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Run all unit tests for the Sidekick library.

Options:
  -h, --help    Show this help message

Test suites run:
  - test-circuit-breaker.sh  - Circuit breaker state machine tests
  - test-logging.sh          - Logging namespace tests
  - test-config.sh           - Configuration namespace tests
  - test-paths.sh            - Path resolution namespace tests
  - test-json.sh             - JSON processing namespace tests
  - test-process.sh          - Process management namespace tests
  - test-statusline.sh       - Statusline feature tests
  - test-topic-extraction.sh - Topic extraction feature tests
  - test-plugin-dependencies.sh - Plugin dependency resolution tests
  - test-workspace.sh        - Workspace management namespace tests

Exit codes:
  0 - All tests passed
  1 - One or more tests failed
EOF
    exit 0
fi

main "$@"
