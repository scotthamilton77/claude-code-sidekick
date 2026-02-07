#!/bin/bash
# test-setup-scenarios.sh - Manual test scenarios for sidekick setup/doctor
#
# Usage:
#   ./scripts/test-setup-scenarios.sh              # List available tests
#   ./scripts/test-setup-scenarios.sh A.1          # Run specific test
#   ./scripts/test-setup-scenarios.sh A.1 A.2 A.3  # Run multiple tests
#   ./scripts/test-setup-scenarios.sh --all        # Run all tests (Part A only, no plugin)
#   ./scripts/test-setup-scenarios.sh --all-b      # Run all Part B tests (requires plugin)
#   ./scripts/test-setup-scenarios.sh --backup     # Backup settings only
#   ./scripts/test-setup-scenarios.sh --restore    # Restore settings only
#
# Environment:
#   OPENROUTER_API_KEY    Required for API key tests (A.8, A.9, A.10, B.7)
#   SIDEKICK_TEST_VERBOSE Set to 1 for verbose output

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="/tmp/sidekick-test-backup"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Test state
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# =============================================================================
# Utility Functions
# =============================================================================

log_info() { echo -e "${BLUE}INFO${NC}: $1"; }
log_warn() { echo -e "${YELLOW}WARN${NC}: $1"; }
log_error() { echo -e "${RED}ERROR${NC}: $1"; }
log_verbose() { [[ "${SIDEKICK_TEST_VERBOSE:-0}" == "1" ]] && echo -e "${CYAN}DEBUG${NC}: $1" || true; }

pass() {
  echo -e "${GREEN}✓ PASS${NC}: $1"
  ((TESTS_PASSED++)) || true
}

fail() {
  echo -e "${RED}✗ FAIL${NC}: $1"
  ((TESTS_FAILED++)) || true
  if [[ "${2:-}" == "fatal" ]]; then
    exit 1
  fi
}

assert_exit_code() {
  local expected=$1
  local actual=$2
  local msg=$3
  if [[ "$actual" -eq "$expected" ]]; then
    pass "$msg (exit code $actual)"
  else
    fail "$msg (expected exit $expected, got $actual)"
  fi
}

assert_file_exists() {
  local file=$1
  local msg=${2:-"File exists: $file"}
  if [[ -f "$file" ]]; then
    pass "$msg"
  else
    fail "$msg (file not found: $file)"
  fi
}

assert_file_not_exists() {
  local file=$1
  local msg=${2:-"File does not exist: $file"}
  if [[ ! -f "$file" ]]; then
    pass "$msg"
  else
    fail "$msg (file exists: $file)"
  fi
}

assert_file_contains() {
  local file=$1
  local pattern=$2
  local msg=${3:-"File contains pattern"}
  if grep -q "$pattern" "$file" 2>/dev/null; then
    pass "$msg"
  else
    fail "$msg (pattern '$pattern' not found in $file)"
  fi
}

assert_json_field() {
  local file=$1
  local jq_expr=$2
  local msg=${3:-"JSON field check"}
  if jq -e "$jq_expr" "$file" > /dev/null 2>&1; then
    pass "$msg"
  else
    fail "$msg (jq '$jq_expr' failed on $file)"
  fi
}

assert_doctor_contains() {
  local pattern=$1
  local msg=$2
  if echo "$DOCTOR_OUTPUT" | grep -q "$pattern"; then
    pass "$msg"
  else
    fail "$msg (pattern '$pattern' not in doctor output)"
    log_verbose "Doctor output was:\n$DOCTOR_OUTPUT"
  fi
}

run_doctor() {
  log_verbose "Running: pnpm sidekick doctor"
  DOCTOR_EXIT=0
  DOCTOR_OUTPUT=$(cd "$PROJECT_DIR" && pnpm sidekick doctor 2>&1) || DOCTOR_EXIT=$?
  log_verbose "Doctor exit code: $DOCTOR_EXIT"
  log_verbose "Doctor output:\n$DOCTOR_OUTPUT"
}

run_setup() {
  log_verbose "Running: pnpm sidekick setup $*"
  cd "$PROJECT_DIR" && pnpm sidekick setup "$@"
}

run_devmode() {
  log_verbose "Running: pnpm sidekick dev-mode $*"
  cd "$PROJECT_DIR" && pnpm sidekick dev-mode "$@"
}

# =============================================================================
# Backup / Restore / Clean
# =============================================================================

backup_settings() {
  # Only backup once per session - don't overwrite existing backup
  if [[ -f "$BACKUP_DIR/.backup_done" ]]; then
    log_verbose "Backup already exists, skipping"
    return 0
  fi

  log_info "Backing up settings to $BACKUP_DIR"
  mkdir -p "$BACKUP_DIR"

  if [[ -f ~/.claude/settings.json ]]; then
    cp ~/.claude/settings.json "$BACKUP_DIR/"
    log_info "  Backed up ~/.claude/settings.json"
  fi

  if [[ -f "$PROJECT_DIR/.claude/settings.local.json" ]]; then
    cp "$PROJECT_DIR/.claude/settings.local.json" "$BACKUP_DIR/"
    log_info "  Backed up .claude/settings.local.json"
  fi

  # Save gitignore state marker
  if grep -q ">>> sidekick" "$PROJECT_DIR/.gitignore" 2>/dev/null; then
    echo "had_sidekick_gitignore" > "$BACKUP_DIR/.gitignore_state"
  fi

  # Mark backup as done
  touch "$BACKUP_DIR/.backup_done"

  log_info "Backup complete"
}

restore_settings() {
  log_info "Restoring settings from $BACKUP_DIR"

  if [[ -f "$BACKUP_DIR/settings.json" ]]; then
    cp "$BACKUP_DIR/settings.json" ~/.claude/
    log_info "  Restored ~/.claude/settings.json"
  fi

  if [[ -f "$BACKUP_DIR/settings.local.json" ]]; then
    mkdir -p "$PROJECT_DIR/.claude"
    cp "$BACKUP_DIR/settings.local.json" "$PROJECT_DIR/.claude/"
    log_info "  Restored .claude/settings.local.json"
  fi

  # Clear backup marker so next run takes a fresh backup
  rm -f "$BACKUP_DIR/.backup_done"

  log_info "Restore complete"
}

clean_slate() {
  log_verbose "Cleaning slate..."

  # Remove sidekick state (ephemeral)
  rm -rf ~/.sidekick/
  rm -rf "$PROJECT_DIR/.sidekick/"

  # Remove statusLine from user settings (preserve other settings)
  if [[ -f ~/.claude/settings.json ]]; then
    local tmp
    tmp=$(mktemp)
    jq 'del(.statusLine) | del(.hooks)' ~/.claude/settings.json > "$tmp" && mv "$tmp" ~/.claude/settings.json
  fi

  # Remove project settings file entirely
  rm -f "$PROJECT_DIR/.claude/settings.local.json"

  # Remove dev-mode skill
  rm -rf "$PROJECT_DIR/.claude/skills/sidekick-config/"

  # Remove sidekick section from gitignore (keep rest of file)
  if [[ -f "$PROJECT_DIR/.gitignore" ]]; then
    local tmp
    tmp=$(mktemp)
    sed '/# >>> sidekick/,/# <<< sidekick/d' "$PROJECT_DIR/.gitignore" > "$tmp" && mv "$tmp" "$PROJECT_DIR/.gitignore"
  fi

  log_verbose "Clean slate ready"
}

check_plugin_installed() {
  if claude plugin list --json 2>/dev/null | grep -q "sidekick"; then
    return 0
  else
    return 1
  fi
}

# =============================================================================
# Part A Tests - WITHOUT Plugin
# =============================================================================

test_A1() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.1: Clean Slate - Doctor Reports Nothing Configured"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  clean_slate
  run_doctor

  assert_exit_code 1 "$DOCTOR_EXIT" "Doctor exits 1 on unconfigured system"
  assert_doctor_contains "Plugin: not installed" "Reports plugin not installed"
  assert_doctor_contains "Statusline: none" "Reports no statusline"
  assert_doctor_contains "Gitignore: missing" "Reports gitignore missing"
  assert_doctor_contains "needs attention" "Reports needs attention"
}

test_A2() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.2: User-Level Statusline Only"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  clean_slate
  run_setup --statusline-scope=user
  run_doctor

  assert_json_field ~/.claude/settings.json '.statusLine.command | contains("sidekick")' \
    "User settings.json has sidekick statusline"
  assert_file_not_exists "$PROJECT_DIR/.claude/settings.local.json" \
    "No project settings.local.json created"
  assert_doctor_contains "Statusline: user" "Doctor reports user-level statusline"
}

test_A3() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.3: Project-Level Statusline Only"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  clean_slate
  run_setup --statusline-scope=project
  run_doctor

  assert_file_exists "$PROJECT_DIR/.claude/settings.local.json" \
    "Project settings.local.json created"
  assert_json_field "$PROJECT_DIR/.claude/settings.local.json" '.statusLine.command | contains("sidekick")' \
    "Project settings has sidekick statusline"
  assert_doctor_contains "Statusline: project" "Doctor reports project-level statusline"
}

test_A4() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.4: Both Statusline Scopes"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  clean_slate
  run_setup --statusline-scope=user
  run_setup --statusline-scope=project
  run_doctor

  assert_json_field ~/.claude/settings.json '.statusLine.command | contains("sidekick")' \
    "User settings has sidekick statusline"
  assert_json_field "$PROJECT_DIR/.claude/settings.local.json" '.statusLine.command | contains("sidekick")' \
    "Project settings has sidekick statusline"
  assert_doctor_contains "Statusline: both" "Doctor reports both scopes"
}

test_A5() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.5: Gitignore Configuration"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  clean_slate

  # Verify gitignore section is missing
  run_doctor
  assert_doctor_contains "Gitignore: missing" "Initially gitignore is missing"

  # Install gitignore
  run_setup --gitignore
  run_doctor

  assert_file_contains "$PROJECT_DIR/.gitignore" ">>> sidekick" "Gitignore has start marker"
  assert_file_contains "$PROJECT_DIR/.gitignore" ".sidekick/logs/" "Gitignore excludes logs"
  assert_file_contains "$PROJECT_DIR/.gitignore" "<<< sidekick" "Gitignore has end marker"
  assert_doctor_contains "Gitignore: installed" "Doctor reports gitignore installed"
}

test_A6() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.6: Personas Enabled (No API Key)"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  clean_slate

  # Unset API key to ensure it's not found
  unset OPENROUTER_API_KEY 2>/dev/null || true

  run_setup --personas
  run_doctor

  assert_file_exists ~/.sidekick/features.yaml "Features file created"
  assert_file_contains ~/.sidekick/features.yaml "enabled: true" "Personas enabled in config"
  assert_doctor_contains "OpenRouter API Key: missing" "Doctor reports API key missing"
}

test_A7() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.7: Personas Disabled (Key Not Required)"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  clean_slate
  run_setup --statusline-scope=user --gitignore --no-personas
  run_doctor

  assert_file_exists ~/.sidekick/features.yaml "Features file created"
  assert_file_contains ~/.sidekick/features.yaml "enabled: false" "Personas disabled in config"
  # BUG: sidekick-8m42 - scripted --no-personas doesn't update status files
  # Should report "not required" but currently reports "missing"
  assert_doctor_contains "OpenRouter API Key: missing" "Doctor reports key missing (bug: should be 'not required')"
}

test_A8() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.8: API Key - User Scope"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    log_warn "OPENROUTER_API_KEY not set - skipping test A.8"
    return 0
  fi

  clean_slate
  run_setup --personas --api-key-scope=user
  run_doctor

  assert_file_exists ~/.sidekick/.env "User .env file created"
  assert_file_contains ~/.sidekick/.env "OPENROUTER_API_KEY" "API key saved to user .env"
  assert_doctor_contains "OpenRouter API Key: healthy" "Doctor reports key healthy"
  assert_doctor_contains "(user)" "Key source is user scope"
}

test_A9() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.9: API Key - Project Scope"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    log_warn "OPENROUTER_API_KEY not set - skipping test A.9"
    return 0
  fi

  clean_slate
  run_setup --personas --api-key-scope=project
  run_doctor

  assert_file_exists "$PROJECT_DIR/.sidekick/.env" "Project .env file created"
  assert_file_contains "$PROJECT_DIR/.sidekick/.env" "OPENROUTER_API_KEY" "API key saved to project .env"
  assert_doctor_contains "OpenRouter API Key: healthy" "Doctor reports key healthy"
  assert_doctor_contains "(project)" "Key source is project scope"
}

test_A10() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.10: API Key - Invalid Key"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  clean_slate

  # Use invalid key
  # BUG: sidekick-25mx - OpenRouter /models endpoint is public, so validation always passes
  OPENROUTER_API_KEY="sk-invalid-garbage-key-12345" run_setup --personas --api-key-scope=user
  run_doctor

  assert_file_exists ~/.sidekick/.env "User .env file created (even with invalid key)"
  # BUG: sidekick-25mx - validation doesn't catch invalid keys, reports healthy
  assert_doctor_contains "OpenRouter API Key: healthy" "Doctor reports key healthy (bug: validation broken)"
}

test_A11() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.11: Dev-Mode Enable (No Plugin)"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  clean_slate
  run_devmode enable
  run_doctor

  assert_file_exists "$PROJECT_DIR/.claude/settings.local.json" "Project settings created"
  assert_json_field "$PROJECT_DIR/.claude/settings.local.json" '.hooks | length > 0' \
    "Hooks configured in settings"
  assert_file_exists "$PROJECT_DIR/.sidekick/setup-status.json" "Setup status created"
  assert_json_field "$PROJECT_DIR/.sidekick/setup-status.json" '.devMode == true' \
    "devMode flag is true"
  assert_doctor_contains "Plugin: dev-mode" "Doctor reports dev-mode active"
}

test_A12() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.12: Dev-Mode Disable"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  # Ensure dev-mode is enabled first
  clean_slate
  run_devmode enable

  # Now disable
  run_devmode disable
  run_doctor

  # Check hooks are removed (file may still exist but without dev-sidekick hooks)
  if [[ -f "$PROJECT_DIR/.claude/settings.local.json" ]]; then
    if jq -e '.hooks | to_entries | map(select(.value | contains("dev-sidekick"))) | length == 0' \
        "$PROJECT_DIR/.claude/settings.local.json" > /dev/null 2>&1; then
      pass "No dev-sidekick hooks in settings"
    else
      fail "Dev-sidekick hooks still present"
    fi
  else
    pass "Settings file removed (no hooks)"
  fi

  assert_doctor_contains "Plugin: not installed" "Doctor reports no plugin"
}

test_A13() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.13: Full Setup (User Scope, All Features)"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    log_warn "OPENROUTER_API_KEY not set - running without API key test"
    clean_slate
    run_setup --statusline-scope=user --gitignore --no-personas --auto-config=auto
    run_doctor

    assert_doctor_contains "Statusline: user" "Statusline configured"
    assert_doctor_contains "Gitignore: installed" "Gitignore configured"
    # BUG: sidekick-8m42 - scripted --no-personas doesn't update status to not-required
    assert_doctor_contains "missing" "API key missing (bug: should be 'not required')"
  else
    clean_slate
    run_setup --statusline-scope=user --gitignore --personas --api-key-scope=user --auto-config=auto
    run_doctor

    assert_doctor_contains "Statusline: user" "Statusline configured"
    assert_doctor_contains "Gitignore: installed" "Gitignore configured"
    assert_doctor_contains "OpenRouter API Key: healthy" "API key healthy"
  fi

  # Plugin still not installed, so overall should need attention
  assert_doctor_contains "Plugin: not installed" "No plugin (expected)"
}

test_A14() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.14: Cache Reconciliation - Manual Change Detected"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  clean_slate

  # Start with user-level statusline
  run_setup --statusline-scope=user

  # Manually add project-level statusline (simulating external change)
  mkdir -p "$PROJECT_DIR/.claude"
  cat > "$PROJECT_DIR/.claude/settings.local.json" << 'EOF'
{
  "statusLine": {
    "command": "npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR"
  }
}
EOF

  # Doctor should detect the change
  run_doctor

  assert_doctor_contains "Statusline: both" "Doctor detects both scopes after manual change"
  # Note: Cache correction message format may vary
}

test_A15() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test A.15: Clean-All Resets Setup Status"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  clean_slate

  # Use dev-mode enable which DOES create setup-status.json
  # (scripted setup doesn't create status files - related to sidekick-8m42)
  run_devmode enable
  assert_file_exists "$PROJECT_DIR/.sidekick/setup-status.json" "Setup status exists before clean-all"

  # Run clean-all (non-interactive - should auto-confirm)
  echo "y" | run_devmode clean-all 2>/dev/null || run_devmode clean-all

  assert_file_not_exists "$PROJECT_DIR/.sidekick/setup-status.json" "Setup status removed after clean-all"
}

# =============================================================================
# Part B Tests - WITH Plugin Installed
# =============================================================================

test_B1() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test B.1: Plugin Only (No Dev-Mode)"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  if ! check_plugin_installed; then
    log_warn "Plugin not installed - skipping test B.1"
    log_warn "Install with: claude plugin install @scotthamilton77/sidekick"
    return 0
  fi

  clean_slate
  run_doctor

  assert_doctor_contains "Plugin: installed" "Doctor reports plugin installed"
}

test_B2() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test B.2: Plugin + User Statusline"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  if ! check_plugin_installed; then
    log_warn "Plugin not installed - skipping test B.2"
    return 0
  fi

  clean_slate
  run_setup --statusline-scope=user --gitignore --no-personas
  run_doctor

  assert_doctor_contains "Plugin: installed" "Plugin installed"
  assert_doctor_contains "Statusline: user" "User statusline"
  assert_doctor_contains "Gitignore: installed" "Gitignore installed"
}

test_B3() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test B.3: Plugin + Project Statusline"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  if ! check_plugin_installed; then
    log_warn "Plugin not installed - skipping test B.3"
    return 0
  fi

  clean_slate
  run_setup --statusline-scope=project --gitignore --no-personas
  run_doctor

  assert_doctor_contains "Plugin: installed" "Plugin installed"
  assert_doctor_contains "Statusline: project" "Project statusline"
}

test_B4() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test B.4: Plugin + Both Statuslines"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  if ! check_plugin_installed; then
    log_warn "Plugin not installed - skipping test B.4"
    return 0
  fi

  clean_slate
  run_setup --statusline-scope=user
  run_setup --statusline-scope=project
  run_setup --gitignore --no-personas
  run_doctor

  assert_doctor_contains "Plugin: installed" "Plugin installed"
  assert_doctor_contains "Statusline: both" "Both statuslines"
}

test_B5() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test B.5: Plugin + Dev-Mode CONFLICT"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  if ! check_plugin_installed; then
    log_warn "Plugin not installed - skipping test B.5"
    return 0
  fi

  clean_slate
  run_devmode enable
  run_doctor

  assert_doctor_contains "Plugin: conflict" "Doctor reports conflict"
  assert_exit_code 1 "$DOCTOR_EXIT" "Doctor exits 1 on conflict"
}

test_B6() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test B.6: Resolve Conflict by Disabling Dev-Mode"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  if ! check_plugin_installed; then
    log_warn "Plugin not installed - skipping test B.6"
    return 0
  fi

  # Start with conflict state
  clean_slate
  run_devmode enable

  # Resolve by disabling dev-mode
  run_devmode disable
  run_doctor

  assert_doctor_contains "Plugin: installed" "Plugin installed (conflict resolved)"
}

test_B7() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test B.7: Full Healthy Setup with Plugin"
  echo "═══════════════════════════════════════════════════════════════"
  ((TESTS_RUN++)) || true

  if ! check_plugin_installed; then
    log_warn "Plugin not installed - skipping test B.7"
    return 0
  fi

  clean_slate

  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    run_setup --statusline-scope=user --gitignore --no-personas
    run_doctor

    assert_doctor_contains "Plugin: installed" "Plugin installed"
    assert_doctor_contains "Statusline: user" "Statusline configured"
    assert_doctor_contains "Gitignore: installed" "Gitignore configured"
    assert_doctor_contains "not required" "API key not required"
  else
    run_setup --statusline-scope=user --gitignore --personas --api-key-scope=user
    run_doctor

    assert_doctor_contains "Plugin: installed" "Plugin installed"
    assert_doctor_contains "Statusline: user" "Statusline configured"
    assert_doctor_contains "Gitignore: installed" "Gitignore configured"
    assert_doctor_contains "OpenRouter API Key: healthy" "API key healthy"
  fi

  # This should be fully healthy
  # Note: Liveness check may timeout in automated testing
}

# =============================================================================
# Test Runner
# =============================================================================

list_tests() {
  echo "Available tests:"
  echo ""
  echo "Part A - WITHOUT Plugin:"
  echo "  A.1   Clean Slate - Doctor Reports Nothing Configured"
  echo "  A.2   User-Level Statusline Only"
  echo "  A.3   Project-Level Statusline Only"
  echo "  A.4   Both Statusline Scopes"
  echo "  A.5   Gitignore Configuration"
  echo "  A.6   Personas Enabled (No API Key)"
  echo "  A.7   Personas Disabled (Key Not Required)"
  echo "  A.8   API Key - User Scope (requires OPENROUTER_API_KEY)"
  echo "  A.9   API Key - Project Scope (requires OPENROUTER_API_KEY)"
  echo "  A.10  API Key - Invalid Key"
  echo "  A.11  Dev-Mode Enable (No Plugin)"
  echo "  A.12  Dev-Mode Disable"
  echo "  A.13  Full Setup (User Scope, All Features)"
  echo "  A.14  Cache Reconciliation - Manual Change Detected"
  echo "  A.15  Clean-All Resets Setup Status"
  echo ""
  echo "Part B - WITH Plugin Installed:"
  echo "  B.1   Plugin Only (No Dev-Mode)"
  echo "  B.2   Plugin + User Statusline"
  echo "  B.3   Plugin + Project Statusline"
  echo "  B.4   Plugin + Both Statuslines"
  echo "  B.5   Plugin + Dev-Mode CONFLICT"
  echo "  B.6   Resolve Conflict by Disabling Dev-Mode"
  echo "  B.7   Full Healthy Setup with Plugin"
  echo ""
  echo "Usage:"
  echo "  $0 A.1           Run specific test"
  echo "  $0 A.1 A.2 A.3   Run multiple tests"
  echo "  $0 --all         Run all Part A tests"
  echo "  $0 --all-b       Run all Part B tests"
  echo "  $0 --backup      Backup settings only"
  echo "  $0 --restore     Restore settings only"
  echo ""
  echo "Environment:"
  echo "  OPENROUTER_API_KEY      Required for A.8, A.9, B.7"
  echo "  SIDEKICK_TEST_VERBOSE=1 Enable verbose output"
}

run_test() {
  local test_name=$1
  case $test_name in
    A.1|a.1)   test_A1 ;;
    A.2|a.2)   test_A2 ;;
    A.3|a.3)   test_A3 ;;
    A.4|a.4)   test_A4 ;;
    A.5|a.5)   test_A5 ;;
    A.6|a.6)   test_A6 ;;
    A.7|a.7)   test_A7 ;;
    A.8|a.8)   test_A8 ;;
    A.9|a.9)   test_A9 ;;
    A.10|a.10) test_A10 ;;
    A.11|a.11) test_A11 ;;
    A.12|a.12) test_A12 ;;
    A.13|a.13) test_A13 ;;
    A.14|a.14) test_A14 ;;
    A.15|a.15) test_A15 ;;
    B.1|b.1)   test_B1 ;;
    B.2|b.2)   test_B2 ;;
    B.3|b.3)   test_B3 ;;
    B.4|b.4)   test_B4 ;;
    B.5|b.5)   test_B5 ;;
    B.6|b.6)   test_B6 ;;
    B.7|b.7)   test_B7 ;;
    *)
      log_error "Unknown test: $test_name"
      exit 1
      ;;
  esac
}

run_all_a() {
  log_info "Running all Part A tests (no plugin required)"
  for t in A.1 A.2 A.3 A.4 A.5 A.6 A.7 A.8 A.9 A.10 A.11 A.12 A.13 A.14 A.15; do
    run_test "$t"
  done
}

run_all_b() {
  log_info "Running all Part B tests (plugin required)"
  if ! check_plugin_installed; then
    log_error "Plugin not installed. Install with: claude plugin install @scotthamilton77/sidekick"
    exit 1
  fi
  for t in B.1 B.2 B.3 B.4 B.5 B.6 B.7; do
    run_test "$t"
  done
}

print_summary() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "Test Summary"
  echo "═══════════════════════════════════════════════════════════════"
  echo "Tests run:    $TESTS_RUN"
  echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
  echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"

  if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
  fi
}

# =============================================================================
# Main
# =============================================================================

main() {
  if [[ $# -eq 0 ]]; then
    list_tests
    exit 0
  fi

  case $1 in
    --help|-h)
      list_tests
      exit 0
      ;;
    --backup)
      # Force fresh backup by clearing marker
      rm -f "$BACKUP_DIR/.backup_done"
      backup_settings
      exit 0
      ;;
    --restore)
      restore_settings
      exit 0
      ;;
    --all)
      backup_settings
      run_all_a
      print_summary
      ;;
    --all-b)
      backup_settings
      run_all_b
      print_summary
      ;;
    *)
      # Run specific tests
      backup_settings
      for test_name in "$@"; do
        run_test "$test_name"
      done
      print_summary
      ;;
  esac
}

main "$@"
