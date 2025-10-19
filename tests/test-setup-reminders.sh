#!/bin/bash
# Test harness for setup-reminders.sh - creates mock environment to test all error scenarios
# without modifying real configuration files

# Note: NOT using set -e to allow test functions to return status codes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="/tmp/claude-setup-test-$$"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_test() { echo -e "${BLUE}TEST${NC} $1"; }
log_pass() { echo -e "${GREEN}PASS${NC} $1"; }
log_info() { echo -e "${YELLOW}INFO${NC} $1"; }

cleanup() {
    if [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
        log_info "Cleaned up test directory"
    fi
}

trap cleanup EXIT

# Setup test environment
setup_test_env() {
    mkdir -p "$TEST_DIR"/{user_claude,project_claude}/.claude/hooks/reminders/tmp

    # Create mock hook scripts
    cat > "$TEST_DIR/user_claude/.claude/hooks/reminders/write-topic.sh" << 'EOF'
#!/bin/bash
echo "mock write-topic.sh"
EOF

    cat > "$TEST_DIR/user_claude/.claude/hooks/reminders/write-unclear-topic.sh" << 'EOF'
#!/bin/bash
echo "mock write-unclear-topic.sh"
EOF

    # Copy to project hooks
    cp "$TEST_DIR/user_claude/.claude/hooks/reminders"/*.sh "$TEST_DIR/project_claude/.claude/hooks/reminders/"

    chmod +x "$TEST_DIR"/{user_claude,project_claude}/.claude/hooks/reminders/*.sh
}

# Test 1: Valid JSON with existing permissions
test_valid_with_permissions() {
    log_test "Test 1: Valid JSON with existing permissions"

    local settings_file="$TEST_DIR/test1_settings.json"
    cat > "$settings_file" << 'EOF'
{
  "permissions": {
    "allow": [
      "Bash(chmod:*)",
      "Read(//home/scott/.claude/**)"
    ],
    "deny": []
  }
}
EOF

    add_permissions "$settings_file" "$TEST_DIR/user_claude/.claude/hooks" '~/.claude/statusline.sh --project-dir "$CLAUDE_PROJECT_DIR"' '~/.claude'

    # Verify permissions, hooks, and statusline were added
    local expected_statusline='~/.claude/statusline.sh --project-dir "$CLAUDE_PROJECT_DIR"'
    local expected_session_start='~/.claude/hooks/reminders/response-tracker.sh init "$CLAUDE_PROJECT_DIR"'
    local expected_prompt_submit='~/.claude/hooks/reminders/response-tracker.sh track "$CLAUDE_PROJECT_DIR"'

    if jq -e '.permissions.allow | map(select(test("write-topic"))) | length > 0' "$settings_file" >/dev/null && \
       jq -e --arg expected "$expected_statusline" '.statusLine.command == $expected' "$settings_file" >/dev/null && \
       jq -e --arg expected "$expected_session_start" '.hooks.SessionStart[0].hooks[0].command == $expected' "$settings_file" >/dev/null && \
       jq -e --arg expected "$expected_prompt_submit" '.hooks.UserPromptSubmit[0].hooks[0].command == $expected' "$settings_file" >/dev/null; then
        log_pass "Permissions, hooks, and statusline added successfully"
        return 0
    else
        echo "FAIL: Permissions, hooks, or statusline not added correctly"
        return 1
    fi
}

# Test 2: Valid JSON without permissions key
test_valid_no_permissions() {
    log_test "Test 2: Valid JSON without permissions key"

    local settings_file="$TEST_DIR/test2_settings.json"
    cat > "$settings_file" << 'EOF'
{
  "hooks": {},
  "statusLine": {}
}
EOF

    add_permissions "$settings_file" "$TEST_DIR/user_claude/.claude/hooks" '~/.claude/statusline.sh --project-dir "$CLAUDE_PROJECT_DIR"' '~/.claude'

    if jq -e '.permissions.allow | length > 0' "$settings_file" >/dev/null && \
       jq -e '.statusLine.command' "$settings_file" >/dev/null && \
       jq -e '.hooks.SessionStart' "$settings_file" >/dev/null && \
       jq -e '.hooks.UserPromptSubmit' "$settings_file" >/dev/null; then
        log_pass "Permissions, hooks, and statusline structure created and populated"
        return 0
    else
        echo "FAIL: Permissions, hooks, or statusline not created"
        return 1
    fi
}

# Test 3: Corrupted JSON
test_corrupted_json() {
    log_test "Test 3: Corrupted JSON (should fail gracefully)"

    local settings_file="$TEST_DIR/test3_settings.json"
    echo "{ this is not valid json }" > "$settings_file"

    if add_permissions "$settings_file" "$TEST_DIR/user_claude/.claude/hooks" "~/.claude/statusline.sh" '~/.claude' 2>/dev/null; then
        echo "FAIL: Should have rejected corrupted JSON"
        return 1
    else
        log_pass "Corrupted JSON rejected as expected"
        return 0
    fi
}

# Test 4: Missing file
test_missing_file() {
    log_test "Test 4: Missing file (should warn and skip)"

    local settings_file="$TEST_DIR/nonexistent.json"

    if add_permissions "$settings_file" "$TEST_DIR/user_claude/.claude/hooks" "~/.claude/statusline.sh" '~/.claude' 2>/dev/null; then
        echo "FAIL: Should have failed on missing file"
        return 1
    else
        log_pass "Missing file handled gracefully"
        return 0
    fi
}

# Test 5: All configuration already present (should skip)
test_already_configured() {
    log_test "Test 5: All configuration already present (should skip)"

    local settings_file="$TEST_DIR/test5_settings.json"
    local hook_path="$TEST_DIR/user_claude/.claude/hooks"
    # Note: Pass the bash-escaped version to add_permissions, but JSON contains unescaped
    local statusline_cmd='~/.claude/statusline.sh --project-dir "$CLAUDE_PROJECT_DIR"'

    cat > "$settings_file" << 'EOF'
{
  "permissions": {
    "allow": [
      "Bash(/tmp/claude-setup-test-*/user_claude/.claude/hooks/reminders/write-topic.sh:*)",
      "Bash(/tmp/claude-setup-test-*/user_claude/.claude/hooks/reminders/write-unclear-topic.sh:*)"
    ],
    "deny": []
  },
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh --project-dir \"$CLAUDE_PROJECT_DIR\""
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/reminders/response-tracker.sh init \"$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/reminders/response-tracker.sh track \"$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ]
  }
}
EOF

    # Update the file with actual paths
    local tmp_file=$(mktemp)
    jq --arg write_topic "Bash(${hook_path}/reminders/write-topic.sh:*)" \
       --arg write_unclear "Bash(${hook_path}/reminders/write-unclear-topic.sh:*)" \
       '.permissions.allow = [$write_topic, $write_unclear]' "$settings_file" > "$tmp_file"
    mv "$tmp_file" "$settings_file"

    local backup_count_before=$(ls -1 "${settings_file}.backup."* 2>/dev/null | wc -l)

    add_permissions "$settings_file" "$hook_path" "$statusline_cmd" '~/.claude'

    local backup_count_after=$(ls -1 "${settings_file}.backup."* 2>/dev/null | wc -l)

    if [ "$backup_count_before" -eq "$backup_count_after" ]; then
        log_pass "Already configured - no backup created"
        return 0
    else
        echo "FAIL: Backup created when it shouldn't have been"
        return 1
    fi
}

# Test 6: Statusline missing (should update)
test_statusline_missing() {
    log_test "Test 6: Statusline missing (should update)"

    local settings_file="$TEST_DIR/test6_settings.json"
    local hook_path="$TEST_DIR/user_claude/.claude/hooks"
    local statusline_cmd='~/.claude/statusline.sh --project-dir "$CLAUDE_PROJECT_DIR"'

    cat > "$settings_file" << EOF
{
  "permissions": {
    "allow": [
      "Bash(${hook_path}/reminders/write-topic.sh:*)",
      "Bash(${hook_path}/reminders/write-unclear-topic.sh:*)"
    ],
    "deny": []
  }
}
EOF

    add_permissions "$settings_file" "$hook_path" "$statusline_cmd" '~/.claude'

    local expected_statusline='~/.claude/statusline.sh --project-dir "$CLAUDE_PROJECT_DIR"'
    if jq -e --arg expected "$expected_statusline" '.statusLine.command == $expected' "$settings_file" >/dev/null && \
       jq -e '.hooks.SessionStart' "$settings_file" >/dev/null && \
       jq -e '.hooks.UserPromptSubmit' "$settings_file" >/dev/null; then
        log_pass "Statusline and hooks added when missing"
        return 0
    else
        echo "FAIL: Statusline or hooks not added"
        return 1
    fi
}

# Test 7: Project-scope hooks configuration
test_project_scope_hooks() {
    log_test "Test 7: Project-scope hooks configuration"

    local settings_file="$TEST_DIR/test7_settings.json"
    local hook_path="$TEST_DIR/project_claude/.claude/hooks"
    local statusline_cmd='$CLAUDE_PROJECT_DIR/.claude/statusline.sh --project-dir "$CLAUDE_PROJECT_DIR"'
    local hooks_prefix='$CLAUDE_PROJECT_DIR/.claude'

    cat > "$settings_file" << 'EOF'
{
  "permissions": {
    "allow": [],
    "deny": []
  }
}
EOF

    add_permissions "$settings_file" "$hook_path" "$statusline_cmd" "$hooks_prefix"

    local expected_session_start='$CLAUDE_PROJECT_DIR/.claude/hooks/reminders/response-tracker.sh init "$CLAUDE_PROJECT_DIR"'
    local expected_prompt_submit='$CLAUDE_PROJECT_DIR/.claude/hooks/reminders/response-tracker.sh track "$CLAUDE_PROJECT_DIR"'

    if jq -e --arg expected "$expected_session_start" '.hooks.SessionStart[0].hooks[0].command == $expected' "$settings_file" >/dev/null && \
       jq -e --arg expected "$expected_prompt_submit" '.hooks.UserPromptSubmit[0].hooks[0].command == $expected' "$settings_file" >/dev/null; then
        log_pass "Project-scope hooks configured correctly"
        return 0
    else
        echo "FAIL: Project-scope hooks not configured correctly"
        jq '.hooks' "$settings_file"
        return 1
    fi
}

# Test 8: .gitignore creation in git repo
test_gitignore_creation() {
    log_test "Test 8: .gitignore creation in git repo"

    local test_project="$TEST_DIR/git_project"
    mkdir -p "$test_project"
    cd "$test_project"
    git init -q

    update_gitignore "$test_project"

    if [ -f "$test_project/.gitignore" ] && grep -qF ".claude/hooks/reminders/tmp/" "$test_project/.gitignore"; then
        log_pass ".gitignore created with tmp entry"
        cd - >/dev/null
        return 0
    else
        echo "FAIL: .gitignore not created or missing entry"
        cd - >/dev/null
        return 1
    fi
}

# Test 9: .gitignore update in existing file
test_gitignore_update() {
    log_test "Test 9: .gitignore update in existing file"

    local test_project="$TEST_DIR/git_project2"
    mkdir -p "$test_project"
    cd "$test_project"
    git init -q
    echo "node_modules/" > "$test_project/.gitignore"

    update_gitignore "$test_project"

    if grep -qF ".claude/hooks/reminders/tmp/" "$test_project/.gitignore" && \
       grep -qF "node_modules/" "$test_project/.gitignore"; then
        log_pass ".gitignore updated without losing existing entries"
        cd - >/dev/null
        return 0
    else
        echo "FAIL: .gitignore not updated correctly"
        cd - >/dev/null
        return 1
    fi
}

# Test 10: .gitignore skip when not a git repo
test_gitignore_skip_non_git() {
    log_test "Test 10: .gitignore skip when not a git repo"

    local test_project="$TEST_DIR/non_git_project"
    mkdir -p "$test_project"

    update_gitignore "$test_project"

    if [ ! -f "$test_project/.gitignore" ]; then
        log_pass "Skipped .gitignore for non-git directory"
        return 0
    else
        echo "FAIL: .gitignore created in non-git directory"
        return 1
    fi
}

# Test 11: .gitignore idempotency
test_gitignore_idempotent() {
    log_test "Test 11: .gitignore idempotency (no duplicates)"

    local test_project="$TEST_DIR/git_project3"
    mkdir -p "$test_project"
    cd "$test_project"
    git init -q

    update_gitignore "$test_project"
    update_gitignore "$test_project"

    local count=$(grep -cF ".claude/hooks/reminders/tmp/" "$test_project/.gitignore")

    if [ "$count" -eq 1 ]; then
        log_pass "No duplicate entries added"
        cd - >/dev/null
        return 0
    else
        echo "FAIL: Duplicate entries found ($count instances)"
        cd - >/dev/null
        return 1
    fi
}

# Source setup-reminders.sh once to import functions (won't execute main)
# Suppress the argument parsing by clearing args
set --
source "$SCRIPT_DIR/../scripts/setup-reminders.sh"

# Run all tests
echo ""
log_info "Setting up test environment..."
setup_test_env
echo ""

PASSED=0
FAILED=0

for test_func in test_valid_with_permissions test_valid_no_permissions test_corrupted_json test_missing_file test_already_configured test_statusline_missing test_project_scope_hooks test_gitignore_creation test_gitignore_update test_gitignore_skip_non_git test_gitignore_idempotent; do
    # Reset global state between tests
    BACKUP_FILES=()

    if $test_func; then
        ((PASSED++))
    else
        ((FAILED++))
    fi
    echo ""
done

echo "================================="
echo "Test Results:"
echo "  Passed: $PASSED"
echo "  Failed: $FAILED"
echo "================================="
echo ""

if [ $FAILED -eq 0 ]; then
    log_pass "All tests passed!"
    exit 0
else
    echo "Some tests failed!"
    exit 1
fi
