#!/bin/bash
# Simplified unit test for analyze-transcript.sh - focuses on core functionality
# Avoids complex shell interactions that cause hanging

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="${SCRIPT_DIR}/test-artifacts/analyze-simple"
ANALYZER="${SCRIPT_DIR}/../.claude/hooks/reminders/analyze-transcript.sh"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

PASS=0
FAIL=0

cleanup() {
    rm -rf "$TEST_DIR"
}

test_basic_execution() {
    echo -n "Test: Basic execution with dry-run... "
    mkdir -p "$TEST_DIR"
    echo '{"type":"user","text":"test"}' > "$TEST_DIR/transcript.jsonl"

    if CLAUDE_ANALYSIS_DRY_RUN=true "$ANALYZER" "test-basic" "$TEST_DIR/transcript.jsonl" "topic-only" "$TEST_DIR/output" > /dev/null 2>&1; then
        if [ -f "$TEST_DIR/output/tmp/test-basic/topic.json" ]; then
            echo -e "${GREEN}PASS${NC}"
            ((PASS++))
        else
            echo -e "${RED}FAIL - no output file${NC}"
            ((FAIL++))
        fi
    else
        echo -e "${RED}FAIL - execution failed${NC}"
        ((FAIL++))
    fi
}

test_json_validity() {
    echo -n "Test: JSON output validity... "
    if command -v jq >/dev/null 2>&1; then
        if jq -e '.session_id and .timestamp and .task_ids and .clarity_score' "$TEST_DIR/output/tmp/test-basic/topic.json" >/dev/null 2>&1; then
            echo -e "${GREEN}PASS${NC}"
            ((PASS++))
        else
            echo -e "${RED}FAIL - invalid JSON schema${NC}"
            ((FAIL++))
        fi
    else
        echo -e "SKIP - jq not installed"
    fi
}

test_output_routing_tmp() {
    echo -n "Test: Output routing to tmp/ (topic-only mode)... "
    mkdir -p "$TEST_DIR"
    echo '{"type":"user","text":"test"}' > "$TEST_DIR/transcript.jsonl"

    CLAUDE_ANALYSIS_DRY_RUN=true "$ANALYZER" "test-tmp" "$TEST_DIR/transcript.jsonl" "topic-only" "$TEST_DIR/output2" > /dev/null 2>&1

    if [ -f "$TEST_DIR/output2/tmp/test-tmp/topic.json" ]; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${RED}FAIL - topic file not in tmp/test-tmp/${NC}"
        ((FAIL++))
    fi
}

test_output_routing_analytics() {
    echo -n "Test: Output routing to analytics/ (full-analytics mode)... "
    CLAUDE_ANALYSIS_DRY_RUN=true "$ANALYZER" "test-analytics" "$TEST_DIR/transcript.jsonl" "full-analytics" "$TEST_DIR/output3" > /dev/null 2>&1

    if [ -f "$TEST_DIR/output3/analytics/test-analytics_analytics.json" ]; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${RED}FAIL - analytics file not in analytics/${NC}"
        ((FAIL++))
    fi
}

test_log_file_creation() {
    echo -n "Test: Log file creation in session-specific directory... "
    session_id="test-logging"
    log_file="$TEST_DIR/output4/tmp/${session_id}/analysis.log"
    rm -rf "$TEST_DIR/output4"

    CLAUDE_ANALYSIS_DRY_RUN=true "$ANALYZER" "$session_id" "$TEST_DIR/transcript.jsonl" "topic-only" "$TEST_DIR/output4" > /dev/null 2>&1

    if [ -f "$log_file" ]; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${RED}FAIL - no log file at $log_file${NC}"
        ((FAIL++))
    fi
}

echo "========================================"
echo "Analyze Transcript Simple Test Suite"
echo "========================================"
echo ""

cleanup
test_basic_execution
test_json_validity
test_output_routing_tmp
test_output_routing_analytics
test_log_file_creation
cleanup

echo ""
echo "========================================"
echo "Results: $PASS passed, $FAIL failed"
echo "========================================"

[ $FAIL -eq 0 ] && exit 0 || exit 1
