#!/bin/bash
# test-resume.sh - Unit tests for resume feature

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

setup() {
    TEST_DIR=$(mktemp -d)
    export CLAUDE_PROJECT_DIR="$TEST_DIR"
    mkdir -p "$TEST_DIR/.sidekick/sessions"

    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/src/sidekick/lib/common.sh"
    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/src/sidekick/features/resume.sh"

    export FEATURE_STATUSLINE=true
    export FEATURE_TOPIC_EXTRACTION=true
    export FEATURE_SESSION_SUMMARY=true
    export FEATURE_RESUME=true
    export RESUME_MIN_CONFIDENCE=0.7

    log_init
}

teardown() {
    rm -rf "${TEST_DIR:-}"
}

run_test() {
    local test_name="$1"
    TESTS_RUN=$((TESTS_RUN + 1))

    reset_sessions_dir

    if "$test_name"; then
        echo -e "${GREEN}✓${RESET} ${test_name}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}✗${RESET} ${test_name}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

create_summary_file() {
    local session_id="$1"
    local confidence="$2"
    local intent_confidence="$3"
    local title="$4"
    local intent="$5"

    local session_dir="$TEST_DIR/.sidekick/sessions/$session_id"
    mkdir -p "$session_dir"

    cat > "$session_dir/session-summary.json" <<EOF
{
  "session_id": "$session_id",
  "timestamp": "2025-10-22T10:00:00Z",
  "session_title": "$title",
  "latest_intent": "$intent",
  "session_title_confidence": $confidence,
  "latest_intent_confidence": $intent_confidence,
  "session_title_key_phrases": ["$title"],
  "latest_intent_key_phrases": ["$intent"]
}
EOF
}

reset_sessions_dir() {
    rm -rf "$TEST_DIR/.sidekick/sessions"
    mkdir -p "$TEST_DIR/.sidekick/sessions"
}

# ----------------------------------------------------------------------------
# Tests
# ----------------------------------------------------------------------------

test_resume_creates_summary_from_previous_session() {
    local prev_session="resume-prev"
    local new_session="resume-new"

    create_summary_file "$prev_session" 0.95 0.88 "Previous session goal" "Testing resume"

    local new_session_dir="$TEST_DIR/.sidekick/sessions/$new_session"
    mkdir -p "$new_session_dir"

    resume_session_summary "$new_session" "$TEST_DIR"

    local new_summary="$new_session_dir/session-summary.json"
    [ -f "$new_summary" ] || return 1

    local title
    title=$(jq -r '.session_title' "$new_summary")
    [ "$title" = "Previous session goal" ] || return 1

    local confidence
    confidence=$(jq -r '.session_title_confidence' "$new_summary")
    [ "$confidence" = "0.7" ] || return 1

    local resume_flag
    resume_flag=$(jq -r '.resume_from_session' "$new_summary")
    [ "$resume_flag" = "true" ]
}

test_resume_skips_when_no_confident_session() {
    local prev_session="resume-low"
    local new_session="resume-low-new"

    create_summary_file "$prev_session" 0.4 0.5 "Low confidence" "Skip"

    local new_session_dir="$TEST_DIR/.sidekick/sessions/$new_session"
    mkdir -p "$new_session_dir"

    resume_session_summary "$new_session" "$TEST_DIR"

    [ ! -f "$new_session_dir/session-summary.json" ]
}

test_resume_does_not_overwrite_existing_summary() {
    local prev_session="resume-existing-prev"
    local new_session="resume-existing-new"

    create_summary_file "$prev_session" 0.95 0.9 "Existing Source" "Carry"

    local new_session_dir="$TEST_DIR/.sidekick/sessions/$new_session"
    mkdir -p "$new_session_dir"
    cat > "$new_session_dir/session-summary.json" <<EOF
{
  "session_id": "$new_session",
  "session_title": "Already set",
  "session_title_confidence": 0.9,
  "latest_intent": "Do not touch",
  "latest_intent_confidence": 0.9
}
EOF

    resume_session_summary "$new_session" "$TEST_DIR"

    local title
    title=$(jq -r '.session_title' "$new_session_dir/session-summary.json")
    [ "$title" = "Already set" ]
}

# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

main() {
    setup
    trap teardown EXIT

    run_test test_resume_creates_summary_from_previous_session
    run_test test_resume_skips_when_no_confident_session
    run_test test_resume_does_not_overwrite_existing_summary

    echo
    echo "Tests run:    $TESTS_RUN"
    echo -e "Tests passed: ${GREEN}$TESTS_PASSED${RESET}"
    echo -e "Tests failed: ${RED}$TESTS_FAILED${RESET}"

    if [ $TESTS_FAILED -gt 0 ]; then
        exit 1
    fi
}

main "$@"
