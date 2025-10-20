#!/bin/bash
# Test harness for cleanup-reminders.sh - creates mock environment to test all cleanup scenarios
# without modifying real configuration files

# Note: NOT using set -e to allow test functions to return status codes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="/tmp/claude-cleanup-test-$$"

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

    cat > "$TEST_DIR/user_claude/.claude/hooks/reminders/response-tracker.sh" << 'EOF'
#!/bin/bash
echo "mock response-tracker.sh"
EOF

    # Copy to project hooks
    cp "$TEST_DIR/user_claude/.claude/hooks/reminders"/*.sh "$TEST_DIR/project_claude/.claude/hooks/reminders/"

    chmod +x "$TEST_DIR"/{user_claude,project_claude}/.claude/hooks/reminders/*.sh

    # Create some temp files in tmp directories
    echo "test" > "$TEST_DIR/user_claude/.claude/hooks/reminders/tmp/test.txt"
    echo "test" > "$TEST_DIR/project_claude/.claude/hooks/reminders/tmp/test.txt"
}

# Test 1: Remove permissions from configured settings.json
test_remove_permissions() {
    log_test "Test 1: Remove permissions from configured settings.json"

    local settings_file="$TEST_DIR/test1_settings.json"
    local hook_path="$TEST_DIR/user_claude/.claude/hooks"

    cat > "$settings_file" << EOF
{
  "permissions": {
    "allow": [
      "Bash(chmod:*)",
      "Bash(${hook_path}/reminders/write-topic.sh:*)",
      "Bash(${hook_path}/reminders/write-unclear-topic.sh:*)",
      "Read(//home/scott/.claude/**)"
    ],
    "deny": []
  },
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh --project-dir \"\$CLAUDE_PROJECT_DIR\""
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/reminders/response-tracker.sh init \"\$CLAUDE_PROJECT_DIR\""
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/reminders/snarkify-last-session.sh \"\$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/reminders/response-tracker.sh track \"\$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ]
  }
}
EOF

    remove_permissions "$settings_file" "$hook_path" '~/.claude'

    # Verify permissions, hooks, and statusline were removed
    local remaining_perms=$(jq -r '.permissions.allow | length' "$settings_file")
    local has_statusline=$(jq -e '.statusLine' "$settings_file" >/dev/null 2>&1 && echo "yes" || echo "no")
    local has_hooks=$(jq -e '.hooks' "$settings_file" >/dev/null 2>&1 && echo "yes" || echo "no")

    if [ "$remaining_perms" -eq 2 ] && \
       [ "$has_statusline" = "no" ] && \
       [ "$has_hooks" = "no" ] && \
       jq -e '.permissions.allow | map(select(test("chmod"))) | length == 1' "$settings_file" >/dev/null && \
       jq -e '.permissions.allow | map(select(test("Read"))) | length == 1' "$settings_file" >/dev/null; then
        log_pass "Reminders permissions, hooks, and statusline removed; other permissions preserved"
        return 0
    else
        echo "FAIL: Cleanup did not work correctly"
        echo "Remaining permissions: $remaining_perms (expected 2)"
        echo "Has statusline: $has_statusline (expected no)"
        echo "Has hooks: $has_hooks (expected no)"
        jq '.' "$settings_file"
        return 1
    fi
}

# Test 2: Handle already clean settings.json
test_already_clean() {
    log_test "Test 2: Handle already clean settings.json"

    local settings_file="$TEST_DIR/test2_settings.json"
    local hook_path="$TEST_DIR/user_claude/.claude/hooks"

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

    local backup_count_before=$(ls -1 "${settings_file}.backup."* 2>/dev/null | wc -l)

    remove_permissions "$settings_file" "$hook_path" '~/.claude'

    local backup_count_after=$(ls -1 "${settings_file}.backup."* 2>/dev/null | wc -l)

    if [ "$backup_count_before" -eq "$backup_count_after" ]; then
        log_pass "Already clean - no backup created"
        return 0
    else
        echo "FAIL: Backup created when it shouldn't have been"
        return 1
    fi
}

# Test 3: Corrupted JSON
test_corrupted_json() {
    log_test "Test 3: Corrupted JSON (should fail gracefully)"

    local settings_file="$TEST_DIR/test3_settings.json"
    local hook_path="$TEST_DIR/user_claude/.claude/hooks"

    echo "{ this is not valid json }" > "$settings_file"

    if remove_permissions "$settings_file" "$hook_path" 2>/dev/null; then
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
    local hook_path="$TEST_DIR/user_claude/.claude/hooks"

    if remove_permissions "$settings_file" "$hook_path" 2>/dev/null; then
        echo "FAIL: Should have failed on missing file"
        return 1
    else
        log_pass "Missing file handled gracefully"
        return 0
    fi
}

# Test 5: Remove tmp directory
test_remove_tmp_directory() {
    log_test "Test 5: Remove tmp directory"

    local claude_dir="$TEST_DIR/test5_claude"
    mkdir -p "$claude_dir/hooks/reminders/tmp"
    echo "test" > "$claude_dir/hooks/reminders/tmp/test.txt"
    echo "keep" > "$claude_dir/hooks/reminders/keep.txt"

    remove_tmp_directory "$claude_dir"

    if [ ! -d "$claude_dir/hooks/reminders/tmp" ] && \
       [ -f "$claude_dir/hooks/reminders/keep.txt" ]; then
        log_pass "tmp directory removed, other files preserved"
        return 0
    else
        echo "FAIL: tmp directory not removed correctly"
        return 1
    fi
}

# Test 6: Remove tmp directory when it doesn't exist
test_remove_tmp_missing() {
    log_test "Test 6: Remove tmp directory when it doesn't exist"

    local claude_dir="$TEST_DIR/test6_claude"
    mkdir -p "$claude_dir/hooks/reminders"

    remove_tmp_directory "$claude_dir"

    # Should succeed even though directory doesn't exist
    if [ $? -eq 0 ]; then
        log_pass "Handled missing tmp directory gracefully"
        return 0
    else
        echo "FAIL: Failed on missing tmp directory"
        return 1
    fi
}

# Test 7: Remove entire reminders directory
test_remove_reminders_directory() {
    log_test "Test 7: Remove entire reminders directory"

    local claude_dir="$TEST_DIR/test7_claude"
    mkdir -p "$claude_dir/hooks/reminders/tmp"
    mkdir -p "$claude_dir/hooks/other"
    echo "test" > "$claude_dir/hooks/reminders/script.sh"
    echo "keep" > "$claude_dir/hooks/other/script.sh"

    remove_reminders_directory "$claude_dir"

    if [ ! -d "$claude_dir/hooks/reminders" ] && \
       [ -d "$claude_dir/hooks/other" ] && \
       [ -f "$claude_dir/hooks/other/script.sh" ]; then
        log_pass "reminders directory removed, other hooks preserved"
        return 0
    else
        echo "FAIL: reminders directory not removed correctly"
        return 1
    fi
}

# Test 8: Remove reminders directory when it doesn't exist
test_remove_reminders_missing() {
    log_test "Test 8: Remove reminders directory when it doesn't exist"

    local claude_dir="$TEST_DIR/test8_claude"
    mkdir -p "$claude_dir/hooks"

    remove_reminders_directory "$claude_dir"

    # Should succeed even though directory doesn't exist
    if [ $? -eq 0 ]; then
        log_pass "Handled missing reminders directory gracefully"
        return 0
    else
        echo "FAIL: Failed on missing reminders directory"
        return 1
    fi
}

# Test 9: Partial configuration (only permissions, no hooks/statusline)
test_partial_config_permissions_only() {
    log_test "Test 9: Partial configuration (only permissions, no hooks/statusline)"

    local settings_file="$TEST_DIR/test9_settings.json"
    local hook_path="$TEST_DIR/user_claude/.claude/hooks"

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

    remove_permissions "$settings_file" "$hook_path" '~/.claude'

    local remaining_perms=$(jq -r '.permissions.allow | length' "$settings_file")

    if [ "$remaining_perms" -eq 0 ]; then
        log_pass "Permissions removed from partial configuration"
        return 0
    else
        echo "FAIL: Permissions not removed correctly"
        jq '.' "$settings_file"
        return 1
    fi
}

# Test 10: Backup file creation
test_backup_creation() {
    log_test "Test 10: Backup file creation"

    local settings_file="$TEST_DIR/test10_settings.json"
    local hook_path="$TEST_DIR/user_claude/.claude/hooks"

    cat > "$settings_file" << EOF
{
  "permissions": {
    "allow": [
      "Bash(${hook_path}/reminders/write-topic.sh:*)"
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "test"
  }
}
EOF

    # Reset backup tracking
    BACKUP_FILES=()

    remove_permissions "$settings_file" "$hook_path" '~/.claude'

    # Check if backup was created
    local backup_count=$(ls -1 "${settings_file}.backup."* 2>/dev/null | wc -l)

    if [ "$backup_count" -eq 1 ] && [ ${#BACKUP_FILES[@]} -eq 1 ]; then
        log_pass "Backup file created successfully"
        return 0
    else
        echo "FAIL: Backup file not created (count: $backup_count, tracked: ${#BACKUP_FILES[@]})"
        return 1
    fi
}

# Test 11: Project-scope cleanup
test_project_scope_cleanup() {
    log_test "Test 11: Project-scope cleanup"

    local settings_file="$TEST_DIR/test11_settings.json"
    local hook_path="$TEST_DIR/project_claude/.claude/hooks"

    cat > "$settings_file" << EOF
{
  "permissions": {
    "allow": [
      "Bash(${hook_path}/reminders/write-topic.sh:*)",
      "Bash(${hook_path}/reminders/write-unclear-topic.sh:*)"
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "\$CLAUDE_PROJECT_DIR/.claude/statusline.sh --project-dir \"\$CLAUDE_PROJECT_DIR\""
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\$CLAUDE_PROJECT_DIR/.claude/hooks/reminders/response-tracker.sh init \"\$CLAUDE_PROJECT_DIR\""
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "\$CLAUDE_PROJECT_DIR/.claude/hooks/reminders/snarkify-last-session.sh \"\$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\$CLAUDE_PROJECT_DIR/.claude/hooks/reminders/response-tracker.sh track \"\$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ]
  }
}
EOF

    remove_permissions "$settings_file" "$hook_path" '$CLAUDE_PROJECT_DIR/.claude'

    local has_statusline=$(jq -e '.statusLine' "$settings_file" >/dev/null 2>&1 && echo "yes" || echo "no")
    local has_hooks=$(jq -e '.hooks' "$settings_file" >/dev/null 2>&1 && echo "yes" || echo "no")
    local remaining_perms=$(jq -r '.permissions.allow | length' "$settings_file")

    if [ "$has_statusline" = "no" ] && \
       [ "$has_hooks" = "no" ] && \
       [ "$remaining_perms" -eq 0 ]; then
        log_pass "Project-scope configuration cleaned up"
        return 0
    else
        echo "FAIL: Project-scope cleanup incomplete"
        jq '.' "$settings_file"
        return 1
    fi
}

# Test 12: Custom hook preservation (surgical removal)
test_custom_hook_preservation() {
    log_test "Test 12: Custom hook preservation (surgical removal)"

    local settings_file="$TEST_DIR/test12_settings.json"
    local hook_path="$TEST_DIR/user_claude/.claude/hooks"

    cat > "$settings_file" << EOF
{
  "permissions": {
    "allow": [
      "Bash(${hook_path}/reminders/write-topic.sh:*)",
      "Bash(chmod:*)"
    ],
    "deny": []
  },
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh --project-dir \"\$CLAUDE_PROJECT_DIR\""
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/custom/hook.sh"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/reminders/response-tracker.sh init \"\$CLAUDE_PROJECT_DIR\""
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/reminders/snarkify-last-session.sh \"\$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/other/custom/hook.sh"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/reminders/response-tracker.sh track \"\$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ]
  }
}
EOF

    remove_permissions "$settings_file" "$hook_path" '~/.claude'

    # Verify only custom hooks remain
    local remaining_perms=$(jq -r '.permissions.allow | length' "$settings_file")
    local custom_session_start=$(jq -r '.hooks.SessionStart[0].hooks[0].command' "$settings_file" 2>/dev/null)
    local session_start_count=$(jq -r '.hooks.SessionStart | length' "$settings_file" 2>/dev/null)
    local custom_prompt_submit=$(jq -r '.hooks.UserPromptSubmit[0].hooks[0].command' "$settings_file" 2>/dev/null)
    local prompt_submit_count=$(jq -r '.hooks.UserPromptSubmit | length' "$settings_file" 2>/dev/null)
    local has_statusline=$(jq -e '.statusLine' "$settings_file" >/dev/null 2>&1 && echo "yes" || echo "no")

    if [ "$remaining_perms" -eq 1 ] && \
       [ "$custom_session_start" = "/custom/hook.sh" ] && \
       [ "$session_start_count" -eq 1 ] && \
       [ "$custom_prompt_submit" = "/other/custom/hook.sh" ] && \
       [ "$prompt_submit_count" -eq 1 ] && \
       [ "$has_statusline" = "no" ]; then
        log_pass "Custom hooks preserved, reminders hooks removed"
        return 0
    else
        echo "FAIL: Custom hooks not preserved correctly"
        echo "Remaining perms: $remaining_perms (expected 1)"
        echo "Custom SessionStart: $custom_session_start (expected /custom/hook.sh)"
        echo "SessionStart count: $session_start_count (expected 1)"
        echo "Custom UserPromptSubmit: $custom_prompt_submit (expected /other/custom/hook.sh)"
        echo "UserPromptSubmit count: $prompt_submit_count (expected 1)"
        echo "Has statusline: $has_statusline (expected no)"
        jq '.' "$settings_file"
        return 1
    fi
}

# Source cleanup-reminders.sh to import functions (won't execute main)
# Suppress the argument parsing by clearing args
set --
source "$SCRIPT_DIR/../scripts/cleanup-reminders.sh"

# Run all tests
echo ""
log_info "Setting up test environment..."
setup_test_env
echo ""

PASSED=0
FAILED=0

for test_func in test_remove_permissions test_already_clean test_corrupted_json test_missing_file test_remove_tmp_directory test_remove_tmp_missing test_remove_reminders_directory test_remove_reminders_missing test_partial_config_permissions_only test_backup_creation test_project_scope_cleanup test_custom_hook_preservation; do
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
