#!/bin/bash
# run-integration-tests.sh - Integration test runner for Sidekick
#
# Runs all integration tests and reports results

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTEGRATION_DIR="$SCRIPT_DIR/integration"

# Test tracking
TOTAL_SUITES=0
PASSED_SUITES=0
FAILED_SUITES=0
SKIPPED_SUITES=0

# Array to track failed tests
declare -a FAILED_TESTS=()

# Helper functions
info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

header() {
    echo ""
    echo -e "${BOLD}=========================================${NC}"
    echo -e "${BOLD}$1${NC}"
    echo -e "${BOLD}=========================================${NC}"
    echo ""
}

# Run a single test suite
run_test_suite() {
    local test_script="$1"
    local test_name=$(basename "$test_script" .sh)

    ((TOTAL_SUITES++))

    echo ""
    echo -e "${BOLD}Running: ${BLUE}$test_name${NC}"
    echo "-------------------------------------------"

    # Check if test exists and is executable
    if [ ! -f "$test_script" ]; then
        warning "Test not found: $test_script"
        ((SKIPPED_SUITES++))
        return
    fi

    if [ ! -x "$test_script" ]; then
        warning "Test not executable: $test_script (fixing...)"
        chmod +x "$test_script"
    fi

    # Run test and capture exit code
    local exit_code=0
    if "$test_script"; then
        success "PASSED: $test_name"
        ((PASSED_SUITES++))
    else
        exit_code=$?
        error "FAILED: $test_name (exit code: $exit_code)"
        ((FAILED_SUITES++))
        FAILED_TESTS+=("$test_name")
    fi

    return $exit_code
}

# Main test execution
main() {
    header "Sidekick Integration Test Suite"

    info "Test directory: $INTEGRATION_DIR"
    echo ""

    # Check if integration tests directory exists
    if [ ! -d "$INTEGRATION_DIR" ]; then
        error "Integration tests directory not found: $INTEGRATION_DIR"
        exit 1
    fi

    # Parse command line arguments
    local run_specific=""
    local verbose=false
    local stop_on_fail=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                verbose=true
                shift
                ;;
            -s|--stop-on-fail)
                stop_on_fail=true
                shift
                ;;
            -t|--test)
                run_specific="$2"
                shift 2
                ;;
            -h|--help)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  -v, --verbose       Enable verbose output"
                echo "  -s, --stop-on-fail  Stop on first failure"
                echo "  -t, --test NAME     Run specific test (e.g., test-statusline)"
                echo "  -h, --help          Show this help message"
                echo ""
                echo "Available tests:"
                for test in "$INTEGRATION_DIR"/test-*.sh; do
                    if [ -f "$test" ]; then
                        echo "  - $(basename "$test" .sh)"
                    fi
                done
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                echo "Use -h or --help for usage information"
                exit 1
                ;;
        esac
    done

    # Determine which tests to run
    local test_files=()
    if [ -n "$run_specific" ]; then
        # Run specific test
        local test_file="$INTEGRATION_DIR/${run_specific}.sh"
        if [ ! -f "$test_file" ]; then
            # Try with test- prefix
            test_file="$INTEGRATION_DIR/test-${run_specific}.sh"
        fi

        if [ -f "$test_file" ]; then
            test_files=("$test_file")
            info "Running specific test: $(basename "$test_file")"
        else
            error "Test not found: $run_specific"
            exit 1
        fi
    else
        # Run all tests in order
        test_files=(
            "$INTEGRATION_DIR/test-session-start.sh"
            "$INTEGRATION_DIR/test-user-prompt-submit.sh"
            "$INTEGRATION_DIR/test-statusline.sh"
            "$INTEGRATION_DIR/test-feature-toggles.sh"
            "$INTEGRATION_DIR/test-config-cascade.sh"
            "$INTEGRATION_DIR/test-install.sh"
        )
    fi

    # Run tests
    local start_time=$(date +%s)

    for test_file in "${test_files[@]}"; do
        if [ -f "$test_file" ]; then
            if ! run_test_suite "$test_file"; then
                if [ "$stop_on_fail" = true ]; then
                    error "Stopping on first failure (--stop-on-fail)"
                    break
                fi
            fi
        else
            warning "Test file not found: $test_file"
            ((SKIPPED_SUITES++))
        fi
    done

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Print summary
    header "Test Summary"

    echo "Total test suites: $TOTAL_SUITES"
    echo -e "${GREEN}Passed: $PASSED_SUITES${NC}"

    if [ $FAILED_SUITES -gt 0 ]; then
        echo -e "${RED}Failed: $FAILED_SUITES${NC}"
        echo ""
        echo -e "${RED}Failed tests:${NC}"
        for test in "${FAILED_TESTS[@]}"; do
            echo -e "  ${RED}✗${NC} $test"
        done
    else
        echo -e "${GREEN}Failed: 0${NC}"
    fi

    if [ $SKIPPED_SUITES -gt 0 ]; then
        echo -e "${YELLOW}Skipped: $SKIPPED_SUITES${NC}"
    fi

    echo ""
    echo "Duration: ${duration}s"
    echo ""

    # Exit with appropriate code
    if [ $FAILED_SUITES -gt 0 ]; then
        echo -e "${RED}Some tests failed!${NC}"
        exit 1
    elif [ $PASSED_SUITES -eq 0 ]; then
        echo -e "${YELLOW}No tests were run!${NC}"
        exit 1
    else
        echo -e "${GREEN}All tests passed!${NC}"
        exit 0
    fi
}

# Run main
main "$@"
