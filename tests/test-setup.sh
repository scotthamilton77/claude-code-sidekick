#!/bin/bash
# Test harness for setup.sh - creates mock environment to test all error scenarios
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
    mkdir -p "$TEST_DIR"/{user_claude,project_claude}/.claude/{hooks,cache}

    # Create mock hook scripts
    cat > "$TEST_DIR/user_claude/.claude/hooks/write-topic.sh" << 'EOF'
#!/bin/bash
echo "mock write-topic.sh"
EOF

    cat > "$TEST_DIR/user_claude/.claude/hooks/write-unclear-topic.sh" << 'EOF'
#!/bin/bash
echo "mock write-unclear-topic.sh"
EOF

    # Copy to project hooks
    cp "$TEST_DIR/user_claude/.claude/hooks"/*.sh "$TEST_DIR/project_claude/.claude/hooks/"

    chmod +x "$TEST_DIR"/{user_claude,project_claude}/.claude/hooks/*.sh
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

    add_permissions "$settings_file" "$TEST_DIR/user_claude/.claude/hooks"

    # Verify permissions were added
    if jq -e '.permissions.allow | map(select(test("write-topic"))) | length > 0' "$settings_file" >/dev/null; then
        log_pass "Permissions added successfully"
        return 0
    else
        echo "FAIL: Permissions not added"
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

    add_permissions "$settings_file" "$TEST_DIR/user_claude/.claude/hooks"

    if jq -e '.permissions.allow | length > 0' "$settings_file" >/dev/null; then
        log_pass "Permissions structure created and populated"
        return 0
    else
        echo "FAIL: Permissions not created"
        return 1
    fi
}

# Test 3: Corrupted JSON
test_corrupted_json() {
    log_test "Test 3: Corrupted JSON (should fail gracefully)"

    local settings_file="$TEST_DIR/test3_settings.json"
    echo "{ this is not valid json }" > "$settings_file"

    if add_permissions "$settings_file" "$TEST_DIR/user_claude/.claude/hooks" 2>/dev/null; then
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

    if add_permissions "$settings_file" "$TEST_DIR/user_claude/.claude/hooks" 2>/dev/null; then
        echo "FAIL: Should have failed on missing file"
        return 1
    else
        log_pass "Missing file handled gracefully"
        return 0
    fi
}

# Test 5: Permissions already configured
test_already_configured() {
    log_test "Test 5: Permissions already configured (should skip)"

    local settings_file="$TEST_DIR/test6_settings.json"
    local hook_path="$TEST_DIR/user_claude/.claude/hooks"

    cat > "$settings_file" << EOF
{
  "permissions": {
    "allow": [
      "Bash(${hook_path}/write-topic.sh:*)",
      "Bash(${hook_path}/write-unclear-topic.sh:*)"
    ],
    "deny": []
  }
}
EOF

    local backup_count_before=$(ls -1 "${settings_file}.backup."* 2>/dev/null | wc -l)

    add_permissions "$settings_file" "$hook_path"

    local backup_count_after=$(ls -1 "${settings_file}.backup."* 2>/dev/null | wc -l)

    if [ "$backup_count_before" -eq "$backup_count_after" ]; then
        log_pass "Already configured - no backup created"
        return 0
    else
        echo "FAIL: Backup created when it shouldn't have been"
        return 1
    fi
}

# Source setup.sh once to import functions (won't execute main)
source "$SCRIPT_DIR/setup.sh"

# Run all tests
echo ""
log_info "Setting up test environment..."
setup_test_env
echo ""

PASSED=0
FAILED=0

for test_func in test_valid_with_permissions test_valid_no_permissions test_corrupted_json test_missing_file test_already_configured; do
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
