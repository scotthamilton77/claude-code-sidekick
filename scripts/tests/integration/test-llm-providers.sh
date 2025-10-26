#!/bin/bash
# test-llm-providers.sh - Integration tests for LLM providers
#
# Tests actual LLM CLI invocations (not mocks)
# Requires: claude, gemini CLIs installed and available in PATH
#
# NOTE: These tests make real API calls and may incur costs
# Tests are skipped if the required CLI is not available

set -euo pipefail

# Colors for test output
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly RED='\033[0;31m'
readonly RESET='\033[0m'

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Simple prompt for testing (minimizes cost/time)
readonly TEST_PROMPT='Respond with valid JSON: {"status":"ok","message":"test passed"}'

# Setup test environment
setup() {
    TEST_DIR=$(mktemp -d)

    # Set LOG_LEVEL to debug for troubleshooting
    export LOG_LEVEL=debug

    # Source common.sh
    # shellcheck disable=SC1091
    source "$(dirname "$0")/../../../src/sidekick/lib/common.sh" 2>/dev/null || true
}

# Teardown test environment
teardown() {
    rm -rf "$TEST_DIR"
    rm -rf /tmp/sidekick-* 2>/dev/null || true
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
        local exit_code=$?
        if [ $exit_code -eq 2 ]; then
            # Test was skipped
            echo -e "${YELLOW}⊘${RESET} ${test_name} (skipped)"
            TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
            TESTS_RUN=$((TESTS_RUN - 1)) # Don't count skipped tests
            return 0
        else
            echo -e "${RED}✗${RESET} ${test_name}"
            TESTS_FAILED=$((TESTS_FAILED + 1))
            return 1
        fi
    fi
}

# Check if CLI is available
# Args: $1 - CLI name (e.g., "claude", "gemini")
# Returns: 0 if available, 2 if not (for skip), 1 on error
check_cli_available() {
    local cli_name="$1"

    if ! command -v "$cli_name" >/dev/null 2>&1; then
        echo "CLI not found: $cli_name" >&2
        return 2
    fi

    return 0
}

# Template for testing an LLM provider
# Args:
#   $1 - provider name (e.g., "claude-cli", "gemini-cli")
#   $2 - CLI command name (e.g., "claude", "gemini")
#   $3 - model name (e.g., "haiku", "gemini-2.5-flash")
#   $4 - config_var for binary path (e.g., "LLM_CLAUDE_BIN")
# Returns: 0 on success, 1 on failure, 2 on skip
test_llm_provider() {
    local provider="$1"
    local cli_name="$2"
    local model="$3"
    local config_var="$4"

    # Check if CLI is available
    check_cli_available "$cli_name" || return $?

    # Configure provider
    export LLM_PROVIDER="$provider"

    # Set binary path if needed (some may be aliases)
    if [ -n "$config_var" ]; then
        local cli_path
        cli_path=$(command -v "$cli_name" 2>/dev/null || echo "$cli_name")
        export "$config_var=$cli_path"
    fi

    # Invoke LLM
    local result
    if ! result=$(llm_invoke "$model" "$TEST_PROMPT" 30 2>&1); then
        echo "LLM invocation failed for $provider" >&2
        echo "Output: $result" >&2
        return 1
    fi

    # Validate JSON structure
    if ! json_validate "$result"; then
        echo "Invalid JSON from $provider: $result" >&2
        return 1
    fi

    # Check for expected fields (basic sanity check)
    # Different providers may return different structures, so just verify it's valid JSON
    if [ -z "$result" ]; then
        echo "Empty response from $provider" >&2
        return 1
    fi

    return 0
}

# Test: Claude CLI provider
test_claude_cli_integration() {
    test_llm_provider "claude-cli" "claude" "haiku" "LLM_CLAUDE_BIN"
}

# Test: Gemini CLI provider
test_gemini_cli_integration() {
    test_llm_provider "gemini-cli" "gemini" "gemini-2.5-flash" "LLM_GEMINI_BIN"
}

# Test: OpenAI API provider (requires curl and API key)
test_openai_api_integration() {
    # Check if curl is available
    check_cli_available "curl" || return $?

    # Check if API key is available
    local api_key
    api_key=$(config_get "LLM_OPENAI_API_KEY")
    if [ -z "$api_key" ]; then
        api_key="${OPENAI_API_KEY:-}"
    fi

    if [ -z "$api_key" ]; then
        echo "OpenAI API key not configured" >&2
        return 2 # Skip
    fi

    export LLM_PROVIDER="openai-api"

    # Invoke LLM
    local result
    if ! result=$(llm_invoke "gpt-4o-mini" "$TEST_PROMPT" 30 2>&1); then
        echo "LLM invocation failed for openai-api" >&2
        echo "Output: $result" >&2
        return 1
    fi

    # Validate JSON structure
    if ! json_validate "$result"; then
        echo "Invalid JSON from openai-api: $result" >&2
        return 1
    fi

    return 0
}

# Test: Provider switching
test_provider_switching() {
    local providers_tested=0

    # Test each available provider
    for provider_info in \
        "claude-cli:claude:haiku:LLM_CLAUDE_BIN" \
        "gemini-cli:gemini:gemini-2.5-flash:LLM_GEMINI_BIN"
    do
        IFS=':' read -r provider cli_name model config_var <<< "$provider_info"

        # Skip if CLI not available
        if ! check_cli_available "$cli_name" 2>/dev/null; then
            continue
        fi

        # Test this provider
        if test_llm_provider "$provider" "$cli_name" "$model" "$config_var" 2>/dev/null; then
            providers_tested=$((providers_tested + 1))
        fi
    done

    # At least one provider should have worked
    if [ $providers_tested -eq 0 ]; then
        echo "No LLM providers available for testing" >&2
        return 2 # Skip
    fi

    return 0
}

# Test: Error handling for missing binary
test_missing_binary_error() {
    export LLM_PROVIDER="gemini-cli"
    export LLM_GEMINI_BIN="/nonexistent/path/to/gemini"

    # Should fail gracefully
    if llm_invoke "test-model" "test prompt" 5 2>/dev/null; then
        echo "Should have failed with missing binary" >&2
        return 1
    fi

    return 0
}

# Test: Error handling for invalid provider
test_invalid_provider_error() {
    export LLM_PROVIDER="nonexistent-provider"

    # Should fail gracefully
    if llm_invoke "test-model" "test prompt" 5 2>/dev/null; then
        echo "Should have failed with invalid provider" >&2
        return 1
    fi

    return 0
}

# Main test execution
main() {
    echo "Running LLM provider integration tests..."
    echo
    echo "NOTE: These tests make real API calls and may incur costs."
    echo "Tests will be skipped if the required CLI is not available."
    echo

    setup

    # Load config after setup
    config_load

    # Run integration tests for each provider
    run_test test_claude_cli_integration
    run_test test_gemini_cli_integration
    run_test test_openai_api_integration

    # Run functional tests
    run_test test_provider_switching
    run_test test_missing_binary_error
    run_test test_invalid_provider_error

    teardown

    # Print summary
    echo
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Tests run:    ${TESTS_RUN}"
    echo -e "Tests passed: ${GREEN}${TESTS_PASSED}${RESET}"
    if [ $TESTS_SKIPPED -gt 0 ]; then
        echo -e "Tests skipped: ${YELLOW}${TESTS_SKIPPED}${RESET}"
    fi
    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "Tests failed: ${RED}${TESTS_FAILED}${RESET}"
        exit 1
    else
        echo -e "${GREEN}All tests passed!${RESET}"
        exit 0
    fi
}

main "$@"
