#!/bin/bash
# test-claude.sh - Unit tests for Claude invocation functions
#
# Tests the CLAUDE INVOCATION namespace from lib/common.sh

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

    # Create mock Claude binary
    MOCK_CLAUDE="${TEST_DIR}/mock-claude"
    cat > "$MOCK_CLAUDE" <<'EOF'
#!/bin/bash
# Mock Claude CLI for testing

# Default response
echo '{"result":"success","message":"mock response"}'
EOF
    chmod +x "$MOCK_CLAUDE"

    # Set LOG_LEVEL to error to suppress debug output
    export LOG_LEVEL=error

    # Source common.sh
    # shellcheck disable=SC1091
    source "$(dirname "$0")/../../../src/sidekick/lib/common.sh" 2>/dev/null || true
}

# Teardown test environment
teardown() {
    rm -rf "$TEST_DIR"
    rm -rf /tmp/sidekick-* 2>/dev/null || true
    unset CLAUDE_BIN
}

# Test helper
run_test() {
    local test_name="$1"
    TESTS_RUN=$((TESTS_RUN + 1))

    # Reset CLAUDE_BIN before each test
    unset CLAUDE_BIN

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

# Test: claude_find_bin finds CLAUDE_BIN config
test_claude_find_bin_from_config() {
    export CLAUDE_BIN="$MOCK_CLAUDE"

    local bin
    bin=$(claude_find_bin)
    [ "$bin" = "$MOCK_CLAUDE" ]
}

# Test: claude_find_bin finds ~/.claude/local/claude
test_claude_find_bin_from_local() {
    mkdir -p "${HOME}/.claude/local"
    cp "$MOCK_CLAUDE" "${HOME}/.claude/local/claude"
    chmod +x "${HOME}/.claude/local/claude"

    local bin
    bin=$(claude_find_bin)
    [ "$bin" = "${HOME}/.claude/local/claude" ]

    # Cleanup
    rm -f "${HOME}/.claude/local/claude"
}

# Test: claude_find_bin finds claude in PATH
test_claude_find_bin_from_path() {
    # Create a temp bin directory
    local temp_bin="${TEST_DIR}/bin"
    mkdir -p "$temp_bin"
    cp "$MOCK_CLAUDE" "${temp_bin}/claude"
    chmod +x "${temp_bin}/claude"

    # Add to PATH
    export PATH="${temp_bin}:${PATH}"

    local bin
    bin=$(claude_find_bin)
    [[ "$bin" == */claude ]]
}

# Test: claude_extract_json extracts from markdown
test_claude_extract_json_from_markdown() {
    local output='Some text before
```json
{"result":"extracted"}
```
Some text after'

    local json
    json=$(claude_extract_json "$output")

    # Should have extracted the JSON
    echo "$json" | grep -q '"result":"extracted"'
}

# Test: claude_extract_json handles plain JSON
test_claude_extract_json_plain() {
    local output='{"result":"plain"}'

    local json
    json=$(claude_extract_json "$output")

    [ "$json" = '{"result":"plain"}' ]
}

# Test: claude_extract_json finds JSON object in text
test_claude_extract_json_embedded() {
    local output='Some text before { "result": "embedded" } some text after'

    local json
    json=$(claude_extract_json "$output")

    # Should extract the JSON object
    echo "$json" | grep -q '"result"'
}

# Test: claude_invoke with mock binary
test_claude_invoke_with_mock() {
    export CLAUDE_BIN="$MOCK_CLAUDE"

    local result
    result=$(claude_invoke "test-model" "test prompt" 5 2>&1)

    # Should return valid JSON
    json_validate "$result"

    # Should have result field
    local value
    value=$(json_get "$result" ".result")
    [ "$value" = "success" ]
}

# Test: claude_invoke creates and cleans up workspace
test_claude_invoke_workspace_cleanup() {
    export CLAUDE_BIN="$MOCK_CLAUDE"

    # Count workspaces before
    local before
    before=$(find /tmp -name "sidekick-claude-invoke-*" -type d 2>/dev/null | wc -l)

    claude_invoke "test-model" "test prompt" 5 2>&1 >/dev/null

    # Count workspaces after
    local after
    after=$(find /tmp -name "sidekick-claude-invoke-*" -type d 2>/dev/null | wc -l)

    # Should not have created persistent workspace (cleaned up)
    [ "$before" -eq "$after" ]
}

# Test: claude_invoke handles markdown-wrapped JSON
test_claude_invoke_markdown_response() {
    # Create mock that returns markdown-wrapped JSON
    local mock_markdown="${TEST_DIR}/mock-claude-md"
    cat > "$mock_markdown" <<'EOF'
#!/bin/bash
cat <<'RESPONSE'
Here is the result:

```json
{
  "result": "markdown wrapped",
  "status": "ok"
}
```

Hope that helps!
RESPONSE
EOF
    chmod +x "$mock_markdown"

    export CLAUDE_BIN="$mock_markdown"

    local result
    result=$(claude_invoke "test-model" "test prompt" 5 2>&1)

    # Should have extracted and validated JSON
    json_validate "$result"

    local status
    status=$(json_get "$result" ".status")
    [ "$status" = "ok" ]
}

# Test: claude_invoke handles timeout
test_claude_invoke_timeout() {
    # Create mock that sleeps forever
    local mock_slow="${TEST_DIR}/mock-claude-slow"
    cat > "$mock_slow" <<'EOF'
#!/bin/bash
sleep 3600
EOF
    chmod +x "$mock_slow"

    export CLAUDE_BIN="$mock_slow"

    # Should timeout and fail
    ! claude_invoke "test-model" "test prompt" 1 2>/dev/null
}

# Test: claude_invoke validates JSON output
test_claude_invoke_validates_json() {
    # Create mock that returns invalid JSON
    local mock_invalid="${TEST_DIR}/mock-claude-invalid"
    cat > "$mock_invalid" <<'EOF'
#!/bin/bash
echo "This is not valid JSON"
EOF
    chmod +x "$mock_invalid"

    export CLAUDE_BIN="$mock_invalid"

    # Should fail validation
    ! claude_invoke "test-model" "test prompt" 5 2>/dev/null
}

# Main test execution
main() {
    echo "Running Claude invocation namespace tests..."
    echo

    setup

    # Run all tests
    run_test test_claude_find_bin_from_config
    run_test test_claude_find_bin_from_local
    run_test test_claude_find_bin_from_path
    run_test test_claude_extract_json_from_markdown
    run_test test_claude_extract_json_plain
    run_test test_claude_extract_json_embedded
    run_test test_claude_invoke_with_mock
    run_test test_claude_invoke_workspace_cleanup
    run_test test_claude_invoke_markdown_response
    run_test test_claude_invoke_timeout
    run_test test_claude_invoke_validates_json

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
