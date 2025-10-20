#!/bin/bash
# Simplified integration test - focuses on key workflows without complex shell interactions

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="${SCRIPT_DIR}/test-artifacts/integration-simple"
TRACKER="${SCRIPT_DIR}/../.claude/hooks/reminders/response-tracker.sh"
STATUSLINE="${SCRIPT_DIR}/../.claude/statusline.sh"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

PASS=0
FAIL=0

cleanup() {
    rm -rf "$TEST_DIR"
    rm -f /tmp/claude-analysis-test-*.log
    pkill -f "analyze-transcript.sh.*test-integration" 2>/dev/null || true
}

create_test_input() {
    local session_id="$1"
    cat <<EOF
{
  "session_id": "$session_id",
  "transcript_path": "$TEST_DIR/.claude/hooks/reminders/tmp/${session_id}_transcript.jsonl"
}
EOF
}

test_hook_performance() {
    echo -n "Test: Hook completes quickly (<100ms)... "
    mkdir -p "$TEST_DIR/.claude/hooks/reminders/tmp"
    session_id="test-perf"
    echo '{"type":"user","text":"test"}' > "$TEST_DIR/.claude/hooks/reminders/tmp/${session_id}_transcript.jsonl"

    start=$(date +%s%N)
    create_test_input "$session_id" | \
        CLAUDE_ANALYSIS_ENABLED=true \
        CLAUDE_ANALYSIS_DRY_RUN=true \
        "$TRACKER" init "$TEST_DIR" > /dev/null 2>&1
    end=$(date +%s%N)

    elapsed_ms=$(( (end - start) / 1000000 ))

    if [ $elapsed_ms -lt 100 ]; then
        echo -e "${GREEN}PASS (${elapsed_ms}ms)${NC}"
        ((PASS++))
    else
        echo -e "${RED}FAIL (${elapsed_ms}ms, expected <100ms)${NC}"
        ((FAIL++))
    fi
}

test_analysis_triggered() {
    echo -n "Test: Analysis triggered and output created... "
    session_id="test-analysis"
    mkdir -p "$TEST_DIR/.claude/hooks/reminders/tmp"
    echo '{"type":"user","text":"test"}' > "$TEST_DIR/.claude/hooks/reminders/tmp/${session_id}_transcript.jsonl"

    create_test_input "$session_id" | \
        CLAUDE_ANALYSIS_ENABLED=true \
        CLAUDE_ANALYSIS_DRY_RUN=true \
        "$TRACKER" init "$TEST_DIR" > /dev/null 2>&1

    sleep 1

    # Check if analysis output file was created (dry-run mode completes quickly)
    if [ -f "$TEST_DIR/.claude/hooks/reminders/tmp/${session_id}_topic.json" ]; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${RED}FAIL - no topic file created${NC}"
        ((FAIL++))
    fi
}

test_statusline_reads_topic() {
    echo -n "Test: Statusline reads LLM-generated topics... "
    session_id="test-statusline"
    mkdir -p "$TEST_DIR/.claude/hooks/reminders/tmp"

    cat > "$TEST_DIR/.claude/hooks/reminders/tmp/${session_id}_topic.json" <<EOF
{
  "session_id": "$session_id",
  "timestamp": "2025-10-19T12:00:00Z",
  "task_ids": ["T001", "TEST-42"],
  "initial_goal": "Test integration",
  "current_objective": "Verify statusline",
  "clarity_score": 9,
  "confidence": 0.95,
  "high_clarity_snarky_comment": "Testing is the opiate of the paranoid"
}
EOF

    result=$(create_test_input "$session_id" | "$STATUSLINE" --project-dir "$TEST_DIR" 2>/dev/null || true)

    if echo "$result" | grep -q "T001" && echo "$result" | grep -q "TEST-42"; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${RED}FAIL - statusline didn't show task IDs${NC}"
        ((FAIL++))
    fi
}

test_statusline_shows_snarky_comment() {
    echo -n "Test: Statusline shows snarky comment for high clarity... "
    # Reuse session from previous test
    session_id="test-statusline"
    result=$(create_test_input "$session_id" | "$STATUSLINE" --project-dir "$TEST_DIR" 2>/dev/null || true)

    if echo "$result" | grep -q "Testing is the opiate"; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${RED}FAIL - no snarky comment${NC}"
        ((FAIL++))
    fi
}

test_disabled_analysis_skips() {
    echo -n "Test: Disabled analysis doesn't create PID file... "
    session_id="test-disabled"
    mkdir -p "$TEST_DIR/.claude/hooks/reminders/tmp"
    echo '{"type":"user","text":"test"}' > "$TEST_DIR/.claude/hooks/reminders/tmp/${session_id}_transcript.jsonl"

    create_test_input "$session_id" | \
        CLAUDE_ANALYSIS_ENABLED=false \
        "$TRACKER" init "$TEST_DIR" > /dev/null 2>&1

    if [ ! -f "$TEST_DIR/.claude/hooks/reminders/tmp/${session_id}_analysis.pid" ]; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${RED}FAIL - PID file created when disabled${NC}"
        ((FAIL++))
    fi
}

echo "========================================"
echo "LLM Integration Simple Test Suite"
echo "========================================"
echo ""

cleanup
mkdir -p "$TEST_DIR/.claude/hooks/reminders/tmp"
test_hook_performance
test_analysis_triggered
test_statusline_reads_topic
test_statusline_shows_snarky_comment
test_disabled_analysis_skips
cleanup

echo ""
echo "========================================"
echo "Results: $PASS passed, $FAIL failed"
echo "========================================"

[ $FAIL -eq 0 ] && exit 0 || exit 1
