#!/bin/bash
# demo-circuit-breaker.sh - Demonstrate circuit breaker functionality
#
# This script simulates LLM provider failures to demonstrate the circuit breaker
# behavior: CLOSED → OPEN (after 3 failures) → HALF_OPEN (after backoff) → CLOSED

set -euo pipefail

# Colors for output
readonly GREEN='\033[0;32m'
readonly RED='\033[0;31m'
readonly YELLOW='\033[0;33m'
readonly BLUE='\033[0;34m'
readonly BOLD='\033[1m'
readonly RESET='\033[0m'

# Setup test environment
TEST_DIR=$(mktemp -d)
TEST_SIDEKICK_ROOT="${TEST_DIR}/sidekick"
TEST_SESSION_DIR="${TEST_DIR}/sessions/demo-session"
mkdir -p "${TEST_SIDEKICK_ROOT}/lib"
mkdir -p "${TEST_SESSION_DIR}"

export CLAUDE_SESSION_ID="demo-session"
export SIDEKICK_USER_ROOT="sidekick-demo-$$"
unset CLAUDE_PROJECT_DIR

# Create config with short backoff for demo
cat > "${TEST_SIDEKICK_ROOT}/config.defaults" <<'EOF'
CIRCUIT_BREAKER_ENABLED=true
CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
CIRCUIT_BREAKER_BACKOFF_INITIAL=5
CIRCUIT_BREAKER_BACKOFF_MAX=60
CIRCUIT_BREAKER_BACKOFF_MULTIPLIER=2
LLM_FALLBACK_PROVIDER=claude-cli
LLM_FALLBACK_MODEL=haiku
LLM_PROVIDER=openrouter
LLM_OPENROUTER_MODEL=google/gemma-3n-e4b-it
LOG_LEVEL=info
EOF

# Source libraries
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1090
source "${SCRIPT_DIR}/../../src/sidekick/lib/common.sh" 2>/dev/null || true
# shellcheck disable=SC1090
source "${SCRIPT_DIR}/../../src/sidekick/lib/llm.sh" 2>/dev/null || true

# Mock functions AFTER sourcing
path_get_sidekick_root() {
    echo "${TEST_SIDEKICK_ROOT}"
}
export -f path_get_sidekick_root

paths_session_dir() {
    echo "${TEST_SESSION_DIR}"
}
export -f paths_session_dir

# Load config
config_load

# Print header
echo -e "${BOLD}╔════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║        Circuit Breaker Demonstration                  ║${RESET}"
echo -e "${BOLD}╚════════════════════════════════════════════════════════╝${RESET}"
echo
echo "This demo shows the circuit breaker state machine:"
echo "  1. CLOSED → Primary provider used normally"
echo "  2. CLOSED → OPEN after 3 failures"
echo "  3. OPEN → Fallback provider used immediately"
echo "  4. OPEN → HALF_OPEN after backoff expires"
echo "  5. HALF_OPEN → CLOSED on successful primary test"
echo

# Print config
echo -e "${BLUE}Configuration:${RESET}"
echo "  Primary provider:      openrouter"
echo "  Fallback provider:     claude-cli"
echo "  Failure threshold:     3"
echo "  Initial backoff:       5 seconds"
echo "  Backoff multiplier:    2x"
echo

# Helper function to show circuit state
show_state() {
    _circuit_breaker_load_state
    local state_color=""
    case "$CB_STATE" in
        CLOSED) state_color="$GREEN" ;;
        OPEN) state_color="$RED" ;;
        HALF_OPEN) state_color="$YELLOW" ;;
    esac

    echo -e "${BOLD}Circuit State:${RESET} ${state_color}${CB_STATE}${RESET}"
    echo "  Consecutive failures: $CB_CONSECUTIVE_FAILURES"
    if [ "$CB_STATE" = "OPEN" ]; then
        local now=$(date +%s)
        local remaining=$((CB_NEXT_RETRY_TIME - now))
        if [ $remaining -gt 0 ]; then
            echo "  Backoff remaining:    ${remaining}s"
        else
            echo "  Backoff expired:      ready to test"
        fi
    fi
    echo
}

# Step 1: Initial state
echo -e "${BOLD}━━━ Step 1: Initial State ━━━${RESET}"
show_state

# Step 2: First failure
echo -e "${BOLD}━━━ Step 2: Simulate First Failure ━━━${RESET}"
_circuit_breaker_record_failure
show_state

# Step 3: Second failure
echo -e "${BOLD}━━━ Step 3: Simulate Second Failure ━━━${RESET}"
_circuit_breaker_record_failure
show_state

# Step 4: Third failure (circuit opens)
echo -e "${BOLD}━━━ Step 4: Simulate Third Failure (Circuit Opens) ━━━${RESET}"
_circuit_breaker_record_failure
show_state

# Step 5: Check if fallback would be used
echo -e "${BOLD}━━━ Step 5: Check Fallback Usage ━━━${RESET}"
if _circuit_breaker_should_use_fallback; then
    echo -e "${GREEN}✓${RESET} Circuit is OPEN - fallback provider would be used"
else
    echo -e "${RED}✗${RESET} ERROR: Circuit should be open"
fi
echo

# Step 6: Wait for backoff to expire
echo -e "${BOLD}━━━ Step 6: Wait for Backoff to Expire ━━━${RESET}"
echo "Waiting 6 seconds for backoff to expire..."
sleep 6
show_state

# Step 7: Transition to HALF_OPEN
echo -e "${BOLD}━━━ Step 7: Check State (Should Transition to HALF_OPEN) ━━━${RESET}"
if ! _circuit_breaker_should_use_fallback; then
    echo -e "${GREEN}✓${RESET} Circuit transitioned to HALF_OPEN - primary will be tested"
else
    echo -e "${YELLOW}⚠${RESET} Still in backoff"
fi
show_state

# Step 8: Simulate successful test
echo -e "${BOLD}━━━ Step 8: Simulate Successful Primary Test ━━━${RESET}"
_circuit_breaker_record_success
show_state

# Step 9: Verify circuit is closed
echo -e "${BOLD}━━━ Step 9: Verify Circuit is CLOSED ━━━${RESET}"
if ! _circuit_breaker_should_use_fallback; then
    echo -e "${GREEN}✓${RESET} Circuit is CLOSED - primary provider restored"
else
    echo -e "${RED}✗${RESET} ERROR: Circuit should be closed"
fi
show_state

# Cleanup
rm -rf "$TEST_DIR"

echo -e "${GREEN}${BOLD}╔════════════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║            Circuit Breaker Demo Complete!             ║${RESET}"
echo -e "${GREEN}${BOLD}╚════════════════════════════════════════════════════════╝${RESET}"
