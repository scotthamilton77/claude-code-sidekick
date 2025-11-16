#!/bin/bash
# Integration tests for install.sh and uninstall.sh
#
# Tests the complete installation workflow including:
# - File copying to user/project scopes
# - Permission setting
# - Settings.json hook registration
# - Uninstallation cleanup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SRC_DIR="$PROJECT_ROOT/src/sidekick"
INSTALL_SCRIPT="$PROJECT_ROOT/scripts/install.sh"
UNINSTALL_SCRIPT="$PROJECT_ROOT/scripts/uninstall.sh"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test utilities
log_test() {
    echo -e "${YELLOW}[TEST]${NC} $*"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $*"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $*"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

assert_file_exists() {
    local file="$1"
    local msg="${2:-File should exist: $file}"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ -f "$file" ]; then
        log_pass "$msg"
        return 0
    else
        log_fail "$msg"
        return 1
    fi
}

assert_dir_exists() {
    local dir="$1"
    local msg="${2:-Directory should exist: $dir}"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ -d "$dir" ]; then
        log_pass "$msg"
        return 0
    else
        log_fail "$msg"
        return 1
    fi
}

assert_file_not_exists() {
    local file="$1"
    local msg="${2:-File should not exist: $file}"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ ! -f "$file" ]; then
        log_pass "$msg"
        return 0
    else
        log_fail "$msg"
        return 1
    fi
}

assert_dir_not_exists() {
    local dir="$1"
    local msg="${2:-Directory should not exist: $dir}"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ ! -d "$dir" ]; then
        log_pass "$msg"
        return 0
    else
        log_fail "$msg"
        return 1
    fi
}

assert_executable() {
    local file="$1"
    local msg="${2:-File should be executable: $file}"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ -x "$file" ]; then
        log_pass "$msg"
        return 0
    else
        log_fail "$msg"
        return 1
    fi
}

assert_json_contains() {
    local json_file="$1"
    local jq_query="$2"
    local expected="$3"
    local msg="${4:-JSON should contain: $jq_query = $expected}"
    TESTS_RUN=$((TESTS_RUN + 1))

    if ! [ -f "$json_file" ]; then
        log_fail "$msg (file not found)"
        return 1
    fi

    local actual
    actual=$(jq -r "$jq_query" "$json_file" 2>/dev/null || echo "")

    if [ "$actual" = "$expected" ]; then
        log_pass "$msg"
        return 0
    else
        log_fail "$msg (got: $actual)"
        return 1
    fi
}

assert_string_contains() {
    local haystack="$1"
    local needle="$2"
    local msg="${3:-String should contain: $needle}"
    TESTS_RUN=$((TESTS_RUN + 1))

    if [[ "$haystack" == *"$needle"* ]]; then
        log_pass "$msg"
        return 0
    else
        log_fail "$msg"
        return 1
    fi
}

# Test: Install to user scope
test_install_user() {
    log_test "Testing install --user"

    # Create temp user home
    local temp_home=$(mktemp -d)
    export HOME="$temp_home"

    # Run install
    "$INSTALL_SCRIPT" --user

    # Verify directory structure
    assert_dir_exists "$HOME/.claude/hooks/sidekick"
    assert_dir_exists "$HOME/.claude/hooks/sidekick/lib"
    assert_dir_exists "$HOME/.claude/hooks/sidekick/handlers"
    assert_dir_exists "$HOME/.claude/hooks/sidekick/features"
    assert_dir_exists "$HOME/.claude/hooks/sidekick/prompts"
    assert_dir_exists "$HOME/.claude/hooks/sidekick/reminders"

    # Verify main files copied
    assert_file_exists "$HOME/.claude/hooks/sidekick/sidekick.sh"
    assert_file_exists "$HOME/.claude/hooks/sidekick/lib/common.sh"
    assert_file_exists "$HOME/.claude/hooks/sidekick/config.defaults"

    # Verify config file created (not overwritten if exists)
    assert_file_exists "$HOME/.claude/hooks/sidekick/sidekick.conf"

    # Verify executable permissions
    assert_executable "$HOME/.claude/hooks/sidekick/sidekick.sh"

    # Verify settings.json created with hooks
    assert_file_exists "$HOME/.claude/settings.json"
    assert_json_contains "$HOME/.claude/settings.json" \
        '.hooks.SessionStart[0].hooks[0].command' \
        '~/.claude/hooks/sidekick/sidekick.sh session-start' \
        "SessionStart hook registered"
    assert_json_contains "$HOME/.claude/settings.json" \
        '.hooks.UserPromptSubmit[0].hooks[0].command' \
        '~/.claude/hooks/sidekick/sidekick.sh user-prompt-submit' \
        "UserPromptSubmit hook registered"
    assert_json_contains "$HOME/.claude/settings.json" \
        '.statusLine.command' \
        '~/.claude/hooks/sidekick/sidekick.sh statusline' \
        "Statusline command registered"

    # Cleanup
    rm -rf "$temp_home"
}

# Test: Install to project scope
test_install_project() {
    log_test "Testing install --project"

    # Create temp project directory
    local temp_project=$(mktemp -d)
    cd "$temp_project"

    # Run install
    "$INSTALL_SCRIPT" --project

    # Verify directory structure
    assert_dir_exists "$temp_project/.claude/hooks/sidekick"
    assert_dir_exists "$temp_project/.claude/hooks/sidekick/lib"
    assert_dir_exists "$temp_project/.claude/hooks/sidekick/handlers"
    assert_dir_exists "$temp_project/.claude/hooks/sidekick/features"

    # Verify main files copied
    assert_file_exists "$temp_project/.claude/hooks/sidekick/sidekick.sh"
    assert_file_exists "$temp_project/.claude/hooks/sidekick/lib/common.sh"

    # Verify executable permissions
    assert_executable "$temp_project/.claude/hooks/sidekick/sidekick.sh"

    # Verify settings.json created with hooks
    assert_file_exists "$temp_project/.claude/settings.json"
    assert_json_contains "$temp_project/.claude/settings.json" \
        '.hooks.SessionStart[0].hooks[0].command' \
        '$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick/sidekick.sh session-start' \
        "SessionStart hook registered (project)"

    # Verify .claudeignore updated
    assert_file_exists "$temp_project/.claudeignore"
    local ignore_content
    ignore_content=$(cat "$temp_project/.claudeignore")
    assert_string_contains "$ignore_content" ".sidekick/" ".claudeignore contains session state directory"

    # Cleanup
    cd "$PROJECT_ROOT"
    rm -rf "$temp_project"
}

# Test: Install to both scopes
test_install_both() {
    log_test "Testing install --both (default)"

    # Create temp directories
    local temp_home=$(mktemp -d)
    local temp_project=$(mktemp -d)
    export HOME="$temp_home"
    cd "$temp_project"

    # Run install without flag (defaults to --both)
    "$INSTALL_SCRIPT"

    # Verify user scope
    assert_dir_exists "$HOME/.claude/hooks/sidekick"
    assert_file_exists "$HOME/.claude/hooks/sidekick/sidekick.sh"
    assert_file_exists "$HOME/.claude/settings.json"

    # Verify project scope
    assert_dir_exists "$temp_project/.claude/hooks/sidekick"
    assert_file_exists "$temp_project/.claude/hooks/sidekick/sidekick.sh"
    assert_file_exists "$temp_project/.claude/settings.json"

    # Cleanup
    cd "$PROJECT_ROOT"
    rm -rf "$temp_home" "$temp_project"
}

# Test: Config preservation
test_config_preservation() {
    log_test "Testing config file preservation"

    # Create temp user home
    local temp_home=$(mktemp -d)
    export HOME="$temp_home"

    # First install
    "$INSTALL_SCRIPT" --user

    # Modify config
    echo "# Custom setting" >> "$HOME/.claude/hooks/sidekick/sidekick.conf"
    echo "CUSTOM_VALUE=test" >> "$HOME/.claude/hooks/sidekick/sidekick.conf"

    # Second install (should not overwrite)
    "$INSTALL_SCRIPT" --user

    # Verify custom config preserved
    local config_content
    config_content=$(cat "$HOME/.claude/hooks/sidekick/sidekick.conf")
    assert_string_contains "$config_content" "CUSTOM_VALUE=test" "Custom config preserved"

    # Cleanup
    rm -rf "$temp_home"
}

# Test: Uninstall from user scope
test_uninstall_user() {
    log_test "Testing uninstall --user"

    # Create temp user home
    local temp_home=$(mktemp -d)
    export HOME="$temp_home"

    # First install
    "$INSTALL_SCRIPT" --user

    # Verify installed
    assert_dir_exists "$HOME/.claude/hooks/sidekick"

    # Uninstall (non-interactive for testing)
    SIDEKICK_SKIP_CONFIRM=1 "$UNINSTALL_SCRIPT" --user

    # Verify removed
    assert_dir_not_exists "$HOME/.claude/hooks/sidekick" "Sidekick directory removed"

    # Verify settings.json cleaned (hooks removed)
    if [ -f "$HOME/.claude/settings.json" ]; then
        assert_json_contains "$HOME/.claude/settings.json" \
            '.hooks.SessionStart // [] | length' \
            '0' \
            "SessionStart hooks removed"
        assert_json_contains "$HOME/.claude/settings.json" \
            '.hooks.UserPromptSubmit // [] | length' \
            '0' \
            "UserPromptSubmit hooks removed"
    fi

    # Cleanup
    rm -rf "$temp_home"
}

# Test: Uninstall from project scope
test_uninstall_project() {
    log_test "Testing uninstall --project"

    # Create temp project directory
    local temp_project=$(mktemp -d)
    cd "$temp_project"

    # First install
    "$INSTALL_SCRIPT" --project

    # Verify installed
    assert_dir_exists "$temp_project/.claude/hooks/sidekick"

    # Uninstall (non-interactive)
    SIDEKICK_SKIP_CONFIRM=1 "$UNINSTALL_SCRIPT" --project

    # Verify removed
    assert_dir_not_exists "$temp_project/.claude/hooks/sidekick" "Sidekick directory removed"

    # Cleanup
    cd "$PROJECT_ROOT"
    rm -rf "$temp_project"
}

# Test: Settings.json backup
test_settings_backup() {
    log_test "Testing settings.json backup on install"

    # Create temp user home
    local temp_home=$(mktemp -d)
    export HOME="$temp_home"

    # Create existing settings.json
    mkdir -p "$HOME/.claude"
    echo '{"existing":"value"}' > "$HOME/.claude/settings.json"

    # Install
    "$INSTALL_SCRIPT" --user

    # Verify backup created
    local backup_count
    backup_count=$(find "$HOME/.claude" -name "settings.json.backup.*" | wc -l)
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ "$backup_count" -gt 0 ]; then
        log_pass "Settings backup created"
    else
        log_fail "Settings backup not created"
    fi

    # Cleanup
    rm -rf "$temp_home"
}

# Main test runner
main() {
    echo "=================================================="
    echo "  Sidekick Installation Integration Tests"
    echo "=================================================="
    echo ""

    # Check prerequisites
    if [ ! -f "$INSTALL_SCRIPT" ]; then
        echo -e "${RED}ERROR:${NC} Install script not found: $INSTALL_SCRIPT"
        echo "Please create scripts/install.sh first"
        exit 1
    fi

    # Run tests
    test_install_user
    echo ""
    test_install_project
    echo ""
    test_install_both
    echo ""
    test_config_preservation
    echo ""
    test_settings_backup
    echo ""

    # Only run uninstall tests if uninstall script exists
    if [ -f "$UNINSTALL_SCRIPT" ]; then
        test_uninstall_user
        echo ""
        test_uninstall_project
        echo ""
    else
        echo -e "${YELLOW}[SKIP]${NC} Uninstall tests (uninstall.sh not yet implemented)"
        echo ""
    fi

    # Summary
    echo "=================================================="
    echo "  Test Summary"
    echo "=================================================="
    echo "Tests run:    $TESTS_RUN"
    echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
    echo ""

    if [ "$TESTS_FAILED" -eq 0 ]; then
        echo -e "${GREEN}All tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}Some tests failed.${NC}"
        exit 1
    fi
}

# Run tests
main "$@"
