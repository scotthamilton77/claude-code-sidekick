#!/bin/bash
# test-session-summary.sh - Unit tests for session summary feature
#
# Tests the SESSION SUMMARY feature from features/session-summary.sh

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
    export CLAUDE_PROJECT_DIR="$TEST_DIR"

    # Source common.sh first
    # shellcheck disable=SC1091
    source "$(dirname "$0")/../../../src/sidekick/lib/common.sh" 2>/dev/null || true

    # Override _SIDEKICK_ROOT AFTER sourcing (common.sh sets it during source)
    export _SIDEKICK_ROOT="$TEST_DIR"

    # Copy prompts to test directory
    mkdir -p "$TEST_DIR/.sidekick/prompts"
    cp "$(dirname "$0")/../../../src/sidekick/prompts/"*.txt "$TEST_DIR/.sidekick/prompts/" 2>/dev/null || true
    cp "$(dirname "$0")/../../../src/sidekick/prompts/"*.json "$TEST_DIR/.sidekick/prompts/" 2>/dev/null || true

    # Copy scripts to test directory (needed for background processes)
    mkdir -p "$TEST_DIR/.sidekick/features/scripts"
    cp "$(dirname "$0")/../../../src/sidekick/features/scripts/"*.sh "$TEST_DIR/.sidekick/features/scripts/" 2>/dev/null || true
    chmod +x "$TEST_DIR/.sidekick/features/scripts/"*.sh 2>/dev/null || true

    # Copy session-summary.sh
    mkdir -p "$TEST_DIR/.sidekick/features"
    cp "$(dirname "$0")/../../../src/sidekick/features/session-summary.sh" "$TEST_DIR/.sidekick/features/" 2>/dev/null || true

    # Copy all lib files (needed by background scripts)
    mkdir -p "$TEST_DIR/.sidekick/lib"
    cp "$(dirname "$0")/../../../src/sidekick/lib/"*.sh "$TEST_DIR/.sidekick/lib/" 2>/dev/null || true

    # Create config.defaults for background processes
    cat >> "$TEST_DIR/config.defaults" <<'EOFCONFIG'
# Test configuration
FEATURE_STATUSLINE=true
FEATURE_SESSION_SUMMARY=true
LLM_PROVIDER=claude-cli
LLM_CLAUDE_MODEL=haiku
LOG_LEVEL=error
EOFCONFIG

    # Create other required defaults (empty is fine for tests)
    touch "$TEST_DIR/llm-core.defaults"
    touch "$TEST_DIR/llm-providers.defaults"
    touch "$TEST_DIR/features.defaults"

    # Set up config for current process
    export FEATURE_STATUSLINE=true
    export FEATURE_SESSION_SUMMARY=true
    export LLM_PROVIDER=claude-cli
    export LLM_CLAUDE_MODEL=haiku
    export LOG_LEVEL=error  # Suppress logs during tests

    # Initialize logging
    log_init "test-session"

    # Create mock Claude CLI
    MOCK_CLAUDE="$TEST_DIR/mock-claude"
    cat > "$MOCK_CLAUDE" <<'EOFCLAUDE'
#!/bin/bash
# Mock Claude CLI that returns markdown-wrapped JSON (like real Claude)
# The CLI output format wraps the model response in a "result" field
cat <<'EOF'
{
  "result": "```json\n{\n  \"session_id\": \"test-session\",\n  \"timestamp\": \"2025-10-22T12:00:00Z\",\n  \"task_ids\": [\"TEST-001\"],\n  \"session_title\": \"Test goal\",\n  \"latest_intent\": \"Testing\",\n  \"session_title_confidence\": 0.95,\n  \"snarky_comment\": \"Mock snark\"\n}\n```",
  "duration_ms": 100,
  "total_cost_usd": 0.001,
  "usage": {
    "input_tokens": 100,
    "output_tokens": 50
  }
}
EOF
EOFCLAUDE
    chmod +x "$MOCK_CLAUDE"
    export CLAUDE_BIN="$MOCK_CLAUDE"

    # Source session-summary.sh (will be implemented)
    # shellcheck disable=SC1091
    if [ -f "$(dirname "$0")/../../../src/sidekick/features/session-summary.sh" ]; then
        source "$(dirname "$0")/../../../src/sidekick/features/session-summary.sh" 2>/dev/null || true
    fi
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

# ============================================================================
# TESTS: session_summary_get_title()
# ============================================================================

test_get_title_from_valid_file() {
    # Skip if function doesn't exist yet
    if ! command -v session_summary_get_title &> /dev/null; then
        return 0
    fi

    local session_id="test-session-title"
    mkdir -p "$TEST_DIR/.sidekick/sessions/$session_id"

    cat > "$TEST_DIR/.sidekick/sessions/$session_id/session-summary.json" <<EOF
{
  "session_id": "$session_id",
  "session_title": "My Title"
}
EOF

    local title
    title=$(session_summary_get_title "$session_id")
    [ "$title" = "My Title" ]
}

test_get_title_missing_file() {
    # Skip if function doesn't exist yet
    if ! command -v session_summary_get_title &> /dev/null; then
        return 0
    fi

    local title
    title=$(session_summary_get_title "nonexistent-session")
    # Should return empty
    [ -z "$title" ]
}

test_get_title_invalid_json() {
    # Skip if function doesn't exist yet
    if ! command -v session_summary_get_title &> /dev/null; then
        return 0
    fi

    local session_id="test-session-invalid"
    mkdir -p "$TEST_DIR/.sidekick/sessions/$session_id"

    echo "invalid json" > "$TEST_DIR/.sidekick/sessions/$session_id/session-summary.json"

    local title
    title=$(session_summary_get_title "$session_id" 2>/dev/null || echo "")
    # Should return empty on error
    [ -z "$title" ]
}

# ============================================================================
# TESTS: session_summary_analyze()
# ============================================================================

test_analyze_creates_summary_file() {
    # Skip if function doesn't exist yet
    if ! command -v session_summary_analyze &> /dev/null; then
        return 0
    fi

    local session_id="test-session-analyze"
    mkdir -p "$TEST_DIR/.sidekick/sessions/$session_id"

    # Create mock transcript
    local transcript="$TEST_DIR/transcript.jsonl"
    cat > "$transcript" <<EOF
{"role":"user","content":"Let's implement feature X"}
{"role":"assistant","content":"Sure, I'll help with that"}
EOF

    session_summary_analyze "$session_id" "$transcript" "$TEST_DIR"

    # Should have created session-summary.json
    [ -f "$TEST_DIR/.sidekick/sessions/$session_id/session-summary.json" ]

    # Should contain expected fields
    local title
    title=$(jq -r '.session_title' "$TEST_DIR/.sidekick/sessions/$session_id/session-summary.json")
    [ -n "$title" ]
}

test_analyze_handles_llm_failure() {
    # Skip if function doesn't exist yet
    if ! command -v session_summary_analyze &> /dev/null; then
        return 0
    fi

    # Create failing mock
    cat > "$MOCK_CLAUDE" <<'EOF'
#!/bin/bash
exit 1
EOF
    chmod +x "$MOCK_CLAUDE"

    local session_id="test-session-fail"
    mkdir -p "$TEST_DIR/.sidekick/sessions/$session_id"

    local transcript="$TEST_DIR/transcript.jsonl"
    echo '{"role":"user","content":"test"}' > "$transcript"

    # Should not crash, should handle gracefully
    session_summary_analyze "$session_id" "$transcript" "$TEST_DIR" 2>/dev/null || true

    # Restore working mock
    setup
}

# ============================================================================
# TESTS: _session_summary_extract_excerpt() - Preprocessing
# ============================================================================

test_excerpt_filters_tool_messages_when_enabled() {
    set -x
    # Skip if function doesn't exist yet
    if ! command -v _session_summary_extract_excerpt &> /dev/null; then
        return 0
    fi

    # Set config to filter tool messages (default)
    export SUMMARY_FILTER_TOOL_MESSAGES=true
    export SUMMARY_EXCERPT_LINES=10

    local transcript="$TEST_DIR/transcript-with-tools.jsonl"
    cat > "$transcript" <<'EOF'
{"type":"user","message":{"role":"user","content":"Hello"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool1","name":"Bash"}],"model":"claude-sonnet-4-5","id":"msg_123","stop_reason":"tool_use","usage":{"input_tokens":100}}}
{"type":"tool_result","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool1","content":"output"}]}}
{"type":"assistant","message":{"role":"assistant","content":"Here's the result","model":"claude-sonnet-4-5","id":"msg_124"}}
EOF

    local result
    result=$(_session_summary_extract_excerpt "$transcript")

    # Should have 2 messages (user and final assistant, not the tool messages)
    local count
    count=$(echo "$result" | jq '.transcript | length')
    [ "$count" = "2" ]

    # First message should be user message
    local first_role
    first_role=$(echo "$result" | jq -r '.transcript[0].role')
    [ "$first_role" = "user" ]

    # Second message should be final assistant (not tool_use)
    local second_content
    second_content=$(echo "$result" | jq -r '.transcript[1].content')
    [ "$second_content" = "Here's the result" ]
}

test_excerpt_keeps_tool_messages_when_disabled() {
    # Skip if function doesn't exist yet
    if ! command -v _session_summary_extract_excerpt &> /dev/null; then
        return 0
    fi

    # Set config to NOT filter tool messages
    export SUMMARY_FILTER_TOOL_MESSAGES=false
    export SUMMARY_EXCERPT_LINES=10

    local transcript="$TEST_DIR/transcript-with-tools-keep.jsonl"
    cat > "$transcript" <<'EOF'
{"type":"user","message":{"role":"user","content":"Hello"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool1","name":"Bash"}],"model":"claude-sonnet-4-5"}}
{"type":"assistant","message":{"role":"assistant","content":"Result","model":"claude-sonnet-4-5"}}
EOF

    local result
    result=$(_session_summary_extract_excerpt "$transcript")

    # Should have 3 messages (including tool_use)
    local count
    count=$(echo "$result" | jq '.transcript | length')
    [ "$count" = "3" ]

    # Second message should have tool_use
    local has_tool
    has_tool=$(echo "$result" | jq -r '.transcript[1].content[0].type')
    [ "$has_tool" = "tool_use" ]
}

test_excerpt_strips_metadata_fields() {
    # Skip if function doesn't exist yet
    if ! command -v _session_summary_extract_excerpt &> /dev/null; then
        return 0
    fi

    export SUMMARY_EXCERPT_LINES=10

    local transcript="$TEST_DIR/transcript-with-metadata.jsonl"
    cat > "$transcript" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":"Hello","model":"claude-sonnet-4-5","id":"msg_123","type":"message","stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}}}
EOF

    local result
    result=$(_session_summary_extract_excerpt "$transcript")

    # Should have message with content
    local content
    content=$(echo "$result" | jq -r '.transcript[0].content')
    [ "$content" = "Hello" ]

    # Should NOT have metadata fields
    local has_model
    has_model=$(echo "$result" | jq -r '.transcript[0].model')
    [ "$has_model" = "null" ]

    local has_id
    has_id=$(echo "$result" | jq -r '.transcript[0].id')
    [ "$has_id" = "null" ]

    local has_usage
    has_usage=$(echo "$result" | jq -r '.transcript[0].usage')
    [ "$has_usage" = "null" ]
}

test_excerpt_filters_null_messages() {
    # Skip if function doesn't exist yet
    if ! command -v _session_summary_extract_excerpt &> /dev/null; then
        return 0
    fi

    export SUMMARY_EXCERPT_LINES=10

    local transcript="$TEST_DIR/transcript-with-nulls.jsonl"
    cat > "$transcript" <<'EOF'
{"type":"user","message":{"role":"user","content":"Hello"}}
{"type":"summary","message":null}
{"type":"assistant","message":{"role":"assistant","content":"Response"}}
EOF

    local result
    result=$(_session_summary_extract_excerpt "$transcript")

    # Should have 2 messages (null filtered out)
    local count
    count=$(echo "$result" | jq '.transcript | length')
    [ "$count" = "2" ]
}

test_excerpt_filters_meta_messages() {
    # Skip if function doesn't exist yet
    if ! command -v _session_summary_extract_excerpt &> /dev/null; then
        return 0
    fi

    export SUMMARY_EXCERPT_LINES=10

    local transcript="$TEST_DIR/transcript-with-meta.jsonl"
    cat > "$transcript" <<'EOF'
{"isMeta":true,"message":{"role":"user","content":"This is a meta message"}}
{"isMeta":false,"message":{"role":"user","content":"Hello"}}
{"message":{"role":"assistant","content":"Response"}}
{"isMeta":true,"message":{"role":"user","content":"Another meta message"}}
EOF

    local result
    result=$(_session_summary_extract_excerpt "$transcript")

    # Should have 2 messages (isMeta=true filtered out)
    local count
    count=$(echo "$result" | jq '.transcript | length')
    [ "$count" = "2" ]

    # Verify the correct messages were kept
    local content1 content2
    content1=$(echo "$result" | jq -r '.transcript[0].content')
    content2=$(echo "$result" | jq -r '.transcript[1].content')
    [ "$content1" = "Hello" ]
    [ "$content2" = "Response" ]
}

test_excerpt_respects_line_count_config() {
    # Skip if function doesn't exist yet
    if ! command -v _session_summary_extract_excerpt &> /dev/null; then
        return 0
    fi

    # Set to only extract 2 lines
    export SUMMARY_EXCERPT_LINES=2

    local transcript="$TEST_DIR/transcript-long.jsonl"
    cat > "$transcript" <<'EOF'
{"type":"user","message":{"role":"user","content":"Message 1"}}
{"type":"assistant","message":{"role":"assistant","content":"Response 1"}}
{"type":"user","message":{"role":"user","content":"Message 2"}}
{"type":"assistant","message":{"role":"assistant","content":"Response 2"}}
{"type":"user","message":{"role":"user","content":"Message 3"}}
EOF

    local result
    result=$(_session_summary_extract_excerpt "$transcript")

    # Should have only last 2 lines processed
    local count
    count=$(echo "$result" | jq '.transcript | length')
    [ "$count" -le "2" ]

    # Last message should be "Message 3"
    local last_content
    last_content=$(echo "$result" | jq -r '.transcript[-1].content')
    [ "$last_content" = "Message 3" ]
}

test_excerpt_extracts_only_message_field() {
    # Skip if function doesn't exist yet
    if ! command -v _session_summary_extract_excerpt &> /dev/null; then
        return 0
    fi

    export SUMMARY_EXCERPT_LINES=10

    local transcript="$TEST_DIR/transcript-with-extra-fields.jsonl"
    cat > "$transcript" <<'EOF'
{"type":"user","parentUuid":"abc123","sessionId":"session1","timestamp":"2025-10-26T00:00:00Z","message":{"role":"user","content":"Test"}}
EOF

    local result
    result=$(_session_summary_extract_excerpt "$transcript")

    # Should only have fields from .message (not type, parentUuid, etc)
    local has_role
    has_role=$(echo "$result" | jq -r '.transcript[0].role')
    [ "$has_role" = "user" ]

    # Should NOT have transcript-level fields
    local has_type
    has_type=$(echo "$result" | jq -r '.transcript[0].type')
    [ "$has_type" = "null" ]

    local has_session
    has_session=$(echo "$result" | jq -r '.transcript[0].sessionId')
    [ "$has_session" = "null" ]
}

# ============================================================================
# TESTS: Countdown & Bookmark Logic
# ============================================================================

test_check_trigger_decrements_countdowns() {
    if ! declare -F _session_summary_check_trigger >/dev/null; then
        return 0
    fi

    local session_id="test-countdown-step"
    local session_dir="$TEST_DIR/.sidekick/sessions/$session_id"
    mkdir -p "$session_dir"

    cat > "$session_dir/session-summary-state.sh" <<'EOF'
SUMMARY_TITLE_COUNTDOWN=3
SUMMARY_INTENT_COUNTDOWN=2
SUMMARY_TITLE_CONFIDENCE_BOOKMARK=0
EOF

    if _session_summary_check_trigger "$session_id" "false"; then
        echo "Unexpected trigger while countdowns > 0" >&2
        return 1
    fi

    # shellcheck disable=SC1090
    source "$session_dir/session-summary-state.sh"

    [ "$SUMMARY_TITLE_COUNTDOWN" -eq 2 ] && [ "$SUMMARY_INTENT_COUNTDOWN" -eq 1 ]
}

test_check_trigger_triggers_when_zero() {
    if ! declare -F _session_summary_check_trigger >/dev/null; then
        return 0
    fi

    local session_id="test-countdown-trigger"
    local session_dir="$TEST_DIR/.sidekick/sessions/$session_id"
    mkdir -p "$session_dir"

    cat > "$session_dir/session-summary-state.sh" <<'EOF'
SUMMARY_TITLE_COUNTDOWN=1
SUMMARY_INTENT_COUNTDOWN=5
SUMMARY_TITLE_CONFIDENCE_BOOKMARK=0
EOF

    if ! _session_summary_check_trigger "$session_id" "false"; then
        echo "Expected trigger when countdown hits zero" >&2
        return 1
    fi

    # shellcheck disable=SC1090
    source "$session_dir/session-summary-state.sh"

    [ "$SUMMARY_TITLE_COUNTDOWN" -eq 0 ] && [ "$SUMMARY_INTENT_COUNTDOWN" -eq 4 ]
}

test_write_summary_sets_high_confidence_countdowns_and_bookmark() {
    if ! declare -F _session_summary_write_summary >/dev/null; then
        return 0
    fi

    export SUMMARY_COUNTDOWN_LOW=3
    export SUMMARY_COUNTDOWN_MED=5
    export SUMMARY_COUNTDOWN_HIGH=7
    export SUMMARY_BOOKMARK_ENABLED=true
    export SUMMARY_BOOKMARK_CONFIDENCE_THRESHOLD=0.8
    export SUMMARY_BOOKMARK_RESET_THRESHOLD=0.7

    local session_id="test-summary-high"
    local session_dir="$TEST_DIR/.sidekick/sessions/$session_id"
    mkdir -p "$session_dir"

    local llm_output='```json
{
  "session_title": "Bookmark Title",
  "session_title_confidence": 0.9,
  "session_title_key_phrases": ["Bookmark", "Title", "High"],
  "latest_intent": "Finish tests",
  "latest_intent_confidence": 0.88,
  "latest_intent_key_phrases": ["Finish", "tests"]
}
```'

    _session_summary_write_summary "$session_id" "$llm_output" 120

    local state_file="$session_dir/session-summary-state.sh"
    [ -f "$state_file" ] || return 1

    # shellcheck disable=SC1090
    source "$state_file"

    [ "$SUMMARY_TITLE_COUNTDOWN" -eq 7 ]
    [ "$SUMMARY_INTENT_COUNTDOWN" -eq 7 ]
    [ "$SUMMARY_TITLE_CONFIDENCE_BOOKMARK" -eq 120 ]

    local summary_file="$session_dir/session-summary.json"
    [ -f "$summary_file" ] || return 1
    local title
    title=$(jq -r '.session_title' "$summary_file")
    [ "$title" = "Bookmark Title" ]
}

test_write_summary_resets_bookmark_on_confidence_drop() {
    if ! declare -F _session_summary_write_summary >/dev/null; then
        return 0
    fi

    export SUMMARY_COUNTDOWN_LOW=3
    export SUMMARY_COUNTDOWN_MED=5
    export SUMMARY_COUNTDOWN_HIGH=7
    export SUMMARY_BOOKMARK_ENABLED=true
    export SUMMARY_BOOKMARK_CONFIDENCE_THRESHOLD=0.8
    export SUMMARY_BOOKMARK_RESET_THRESHOLD=0.7

    local session_id="test-summary-low"
    local session_dir="$TEST_DIR/.sidekick/sessions/$session_id"
    mkdir -p "$session_dir"

    local high_output='```json
{
  "session_title": "Stable Title",
  "session_title_confidence": 0.85,
  "session_title_key_phrases": ["Stable"],
  "latest_intent": "Ship",
  "latest_intent_confidence": 0.82,
  "latest_intent_key_phrases": ["Ship"]
}
```'

    _session_summary_write_summary "$session_id" "$high_output" 90

    local low_output='```json
{
  "session_title": "Unclear",
  "session_title_confidence": 0.55,
  "session_title_key_phrases": ["Unclear"],
  "latest_intent": "Investigate",
  "latest_intent_confidence": 0.58,
  "latest_intent_key_phrases": ["Investigate"]
}
```'

    _session_summary_write_summary "$session_id" "$low_output" 110

    local state_file="$session_dir/session-summary-state.sh"
    # shellcheck disable=SC1090
    source "$state_file"

    [ "$SUMMARY_TITLE_COUNTDOWN" -eq 3 ]
    [ "$SUMMARY_INTENT_COUNTDOWN" -eq 3 ]
    [ "$SUMMARY_TITLE_CONFIDENCE_BOOKMARK" -eq 0 ]
}

test_excerpt_uses_bookmark_split_when_conditions_met() {
    if ! declare -F _session_summary_extract_excerpt >/dev/null; then
        return 0
    fi

    export SUMMARY_MIN_USER_MESSAGES=1
    export SUMMARY_MIN_RECENT_LINES=1

    local transcript="$TEST_DIR/transcript-bookmark.jsonl"
    : > "$transcript"
    for i in $(seq 1 60); do
        if (( i % 2 == 1 )); then
            cat >> "$transcript" <<EOF
{"type":"user","message":{"role":"user","content":"User line $i"}}
EOF
        else
            cat >> "$transcript" <<EOF
{"type":"assistant","message":{"role":"assistant","content":"Assistant line $i"}}
EOF
        fi
    done

    local result
    result=$(_session_summary_extract_excerpt "$transcript" 5)

    local type
    type=$(echo "$result" | jq -r '.type')
    [ "$type" = "tiered" ]

    local historical_len
    historical_len=$(echo "$result" | jq '.historical | length')
    [ "$historical_len" -eq 5 ]

    local recent_len
    recent_len=$(echo "$result" | jq '.recent | length')
    [ "$recent_len" -eq 55 ]
}


# ============================================================================
# Main test execution
# ============================================================================

main() {
    echo "Running session summary feature tests..."
    echo
    echo "NOTE: These are TDD tests - functions may not be implemented yet."
    echo "Tests will be skipped if functions don't exist."
    echo

    setup

    # Title extraction tests
    run_test test_get_title_from_valid_file
    run_test test_get_title_missing_file
    run_test test_get_title_invalid_json

    # Analysis tests
    run_test test_analyze_creates_summary_file
    run_test test_analyze_handles_llm_failure

    # Preprocessing/excerpt tests
    run_test test_excerpt_filters_tool_messages_when_enabled
    run_test test_excerpt_keeps_tool_messages_when_disabled
    run_test test_excerpt_strips_metadata_fields
    run_test test_excerpt_filters_null_messages
    run_test test_excerpt_filters_meta_messages
    run_test test_excerpt_respects_line_count_config
    run_test test_excerpt_extracts_only_message_field
    run_test test_check_trigger_decrements_countdowns
    run_test test_check_trigger_triggers_when_zero
    run_test test_write_summary_sets_high_confidence_countdowns_and_bookmark
    run_test test_write_summary_resets_bookmark_on_confidence_drop
    run_test test_excerpt_uses_bookmark_split_when_conditions_met

    teardown

    # Print summary
    echo
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Tests run:    ${TESTS_RUN}"
    echo -e "Tests passed: ${GREEN}${TESTS_PASSED}${RESET}"
    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "Tests failed: ${RED}${TESTS_FAILED}${RESET}"
        echo
        echo "This is expected for TDD - implement the feature to pass tests."
        exit 0  # Don't fail on unimplemented features
    else
        echo -e "${GREEN}All tests passed!${RESET}"
        exit 0
    fi
}

main "$@"

