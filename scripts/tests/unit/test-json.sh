#!/bin/bash
# test-json.sh - Unit tests for JSON processing functions
#
# Tests the JSON PROCESSING namespace from lib/common.sh

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

    # Source common.sh
    # shellcheck disable=SC1091
    source "$(dirname "$0")/../../../src/sidekick/lib/common.sh" 2>/dev/null || true
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

# Test: json_get extracts simple value
test_json_get_simple_value() {
    local json='{"name":"test","value":123}'

    local name
    name=$(json_get "$json" ".name")
    [ "$name" = "test" ]

    local value
    value=$(json_get "$json" ".value")
    [ "$value" = "123" ]
}

# Test: json_get extracts nested value
test_json_get_nested_value() {
    local json='{"workspace":{"project_dir":"/test/path"}}'

    local project_dir
    project_dir=$(json_get "$json" ".workspace.project_dir")
    [ "$project_dir" = "/test/path" ]
}

# Test: json_get returns empty for missing key
test_json_get_missing_key() {
    local json='{"name":"test"}'

    local value
    value=$(json_get "$json" ".nonexistent")
    [ -z "$value" ]
}

# Test: json_get handles null values
test_json_get_null_value() {
    local json='{"name":null}'

    local value
    value=$(json_get "$json" ".name")
    [ -z "$value" ]
}

# Test: json_get_session_id extracts session_id
test_json_get_session_id() {
    local json='{"session_id":"abc-123-def"}'

    local session_id
    session_id=$(json_get_session_id "$json")
    [ "$session_id" = "abc-123-def" ]
}

# Test: json_get_transcript_path extracts transcript_path
test_json_get_transcript_path() {
    local json='{"transcript_path":"/path/to/transcript.jsonl"}'

    local transcript_path
    transcript_path=$(json_get_transcript_path "$json")
    [ "$transcript_path" = "/path/to/transcript.jsonl" ]
}

# Test: json_validate accepts valid JSON
test_json_validate_valid() {
    local json='{"name":"test","value":123}'

    json_validate "$json"
}

# Test: json_validate rejects invalid JSON
test_json_validate_invalid() {
    local json='{"name":"test",invalid}'

    ! json_validate "$json"
}

# Test: json_validate accepts array
test_json_validate_array() {
    local json='[1,2,3]'

    json_validate "$json"
}

# Test: json_validate accepts empty object
test_json_validate_empty_object() {
    local json='{}'

    json_validate "$json"
}

# Test: json_extract_from_markdown extracts from code block
test_json_extract_from_markdown_code_block() {
    local text='```json
{"name":"test"}
```'

    local extracted
    extracted=$(json_extract_from_markdown "$text")
    [ "$extracted" = '{"name":"test"}' ]
}

# Test: json_extract_from_markdown returns as-is if not wrapped
test_json_extract_from_markdown_unwrapped() {
    local text='{"name":"test"}'

    local extracted
    extracted=$(json_extract_from_markdown "$text")
    [ "$extracted" = '{"name":"test"}' ]
}

# Test: json_extract_from_markdown handles multiline JSON
test_json_extract_from_markdown_multiline() {
    local text='```json
{
  "name": "test",
  "value": 123
}
```'

    local extracted
    extracted=$(json_extract_from_markdown "$text")

    # Should have extracted the JSON
    json_validate "$extracted"

    local name
    name=$(json_get "$extracted" ".name")
    [ "$name" = "test" ]
}

# Test: json_get handles special characters
test_json_get_special_characters() {
    local json='{"message":"Hello \"World\""}'

    local message
    message=$(json_get "$json" ".message")
    [ "$message" = 'Hello "World"' ]
}

# Test: json_get handles unicode
test_json_get_unicode() {
    local json='{"emoji":"🚀"}'

    local emoji
    emoji=$(json_get "$json" ".emoji")
    [ "$emoji" = "🚀" ]
}

# Main test execution
main() {
    echo "Running JSON processing namespace tests..."
    echo

    setup

    # Run all tests
    run_test test_json_get_simple_value
    run_test test_json_get_nested_value
    run_test test_json_get_missing_key
    run_test test_json_get_null_value
    run_test test_json_get_session_id
    run_test test_json_get_transcript_path
    run_test test_json_validate_valid
    run_test test_json_validate_invalid
    run_test test_json_validate_array
    run_test test_json_validate_empty_object
    run_test test_json_extract_from_markdown_code_block
    run_test test_json_extract_from_markdown_unwrapped
    run_test test_json_extract_from_markdown_multiline
    run_test test_json_get_special_characters
    run_test test_json_get_unicode

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
