#!/bin/bash
# test-plugin-dependencies.sh - Unit tests for plugin dependency resolution
#
# Tests the PLUGIN LOADER namespace from lib/common.sh

set -euo pipefail

# Colors for test output
readonly GREEN='\033[0;32m'
readonly RED='\033[0;31m'
readonly RESET='\033[0m'

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Setup test environment
setup() {
    TEST_DIR=$(mktemp -d)
    export CLAUDE_PROJECT_DIR="$TEST_DIR/project"
    mkdir -p "$CLAUDE_PROJECT_DIR/.sidekick/sessions"

    # Source the library under test
    source "$PROJECT_ROOT/src/sidekick/lib/common.sh"
}

# Teardown
teardown() {
    rm -rf "$TEST_DIR"
}

# Test assertion helpers
assert_equals() {
    local expected="$1"
    local actual="$2"
    local message="${3:-}"

    if [ "$expected" = "$actual" ]; then
        return 0
    else
        echo "  Expected: '$expected'"
        echo "  Actual:   '$actual'"
        if [ -n "$message" ]; then
            echo "  Message:  $message"
        fi
        return 1
    fi
}

assert_true() {
    local condition="$1"
    local message="${2:-}"

    if eval "$condition"; then
        return 0
    else
        echo "  Condition failed: $condition"
        if [ -n "$message" ]; then
            echo "  Message: $message"
        fi
        return 1
    fi
}

# Test runner
run_test() {
    local test_name="$1"
    local test_func="$2"

    TESTS_RUN=$((TESTS_RUN + 1))

    echo -n "Testing: $test_name ... "

    if $test_func 2>&1 | grep -q "^"; then
        local output=$($test_func 2>&1 || true)
        if [ -z "$output" ]; then
            echo -e "${GREEN}PASS${RESET}"
            TESTS_PASSED=$((TESTS_PASSED + 1))
        else
            echo -e "${RED}FAIL${RESET}"
            echo "$output" | sed 's/^/  /'
            TESTS_FAILED=$((TESTS_FAILED + 1))
        fi
    fi
}

# Print test summary
print_summary() {
    echo ""
    echo "========================================"
    echo "Tests run: $TESTS_RUN"
    echo -e "${GREEN}Passed: $TESTS_PASSED${RESET}"
    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "${RED}Failed: $TESTS_FAILED${RESET}"
        exit 1
    else
        echo "All tests passed!"
        exit 0
    fi
}

# ============================================================================
# TEST: plugin_extract_depends - Extract dependencies from plugin file
# ============================================================================

test_extract_depends_no_deps() {
    local test_file="/tmp/test-plugin-no-deps.sh"

    cat > "$test_file" <<'EOF'
#!/bin/bash
# Test plugin without dependencies

test_function() {
    echo "test"
}
EOF

    local result
    result=$(plugin_extract_depends "$test_file")

    assert_equals "" "$result" "Should return empty string for plugin without PLUGIN_DEPENDS"

    rm -f "$test_file"
}

test_extract_depends_with_deps() {
    local test_file="/tmp/test-plugin-with-deps.sh"

    cat > "$test_file" <<'EOF'
#!/bin/bash
# Test plugin with dependencies

readonly PLUGIN_DEPENDS="tracking statusline"

test_function() {
    echo "test"
}
EOF

    local result
    result=$(plugin_extract_depends "$test_file")

    assert_equals "tracking statusline" "$result" "Should extract dependency list"

    rm -f "$test_file"
}

test_extract_depends_readonly() {
    local test_file="/tmp/test-plugin-readonly.sh"

    cat > "$test_file" <<'EOF'
#!/bin/bash
readonly PLUGIN_DEPENDS="foo bar"
EOF

    local result
    result=$(plugin_extract_depends "$test_file")

    assert_equals "foo bar" "$result" "Should extract readonly PLUGIN_DEPENDS"

    rm -f "$test_file"
}

# ============================================================================
# TEST: plugin_toposort - Topological sort of plugins
# ============================================================================

test_toposort_no_deps() {
    declare -A deps_map
    deps_map["plugin-a"]=""
    deps_map["plugin-b"]=""
    deps_map["plugin-c"]=""

    local sorted=()
    plugin_toposort deps_map sorted

    assert_equals 3 "${#sorted[@]}" "Should have 3 plugins in sorted output"

    # All plugins should be present (order doesn't matter without dependencies)
    local found_a=false found_b=false found_c=false
    for plugin in "${sorted[@]}"; do
        case "$plugin" in
            plugin-a) found_a=true ;;
            plugin-b) found_b=true ;;
            plugin-c) found_c=true ;;
        esac
    done

    assert_true "$found_a" "plugin-a should be in sorted output"
    assert_true "$found_b" "plugin-b should be in sorted output"
    assert_true "$found_c" "plugin-c should be in sorted output"
}

test_toposort_simple_chain() {
    declare -A deps_map
    deps_map["plugin-a"]=""
    deps_map["plugin-b"]="plugin-a"
    deps_map["plugin-c"]="plugin-b"

    local sorted=()
    plugin_toposort deps_map sorted

    assert_equals 3 "${#sorted[@]}" "Should have 3 plugins in sorted output"

    # Check order: a should come before b, b before c
    local idx_a=-1 idx_b=-1 idx_c=-1
    for i in "${!sorted[@]}"; do
        case "${sorted[$i]}" in
            plugin-a) idx_a=$i ;;
            plugin-b) idx_b=$i ;;
            plugin-c) idx_c=$i ;;
        esac
    done

    assert_true "[ $idx_a -lt $idx_b ]" "plugin-a should come before plugin-b"
    assert_true "[ $idx_b -lt $idx_c ]" "plugin-b should come before plugin-c"
}

test_toposort_diamond() {
    declare -A deps_map
    deps_map["base"]=""
    deps_map["left"]="base"
    deps_map["right"]="base"
    deps_map["top"]="left right"

    local sorted=()
    plugin_toposort deps_map sorted

    assert_equals 4 "${#sorted[@]}" "Should have 4 plugins in sorted output"

    # Check order: base should come before left and right, left and right before top
    local idx_base=-1 idx_left=-1 idx_right=-1 idx_top=-1
    for i in "${!sorted[@]}"; do
        case "${sorted[$i]}" in
            base) idx_base=$i ;;
            left) idx_left=$i ;;
            right) idx_right=$i ;;
            top) idx_top=$i ;;
        esac
    done

    assert_true "[ $idx_base -lt $idx_left ]" "base should come before left"
    assert_true "[ $idx_base -lt $idx_right ]" "base should come before right"
    assert_true "[ $idx_left -lt $idx_top ]" "left should come before top"
    assert_true "[ $idx_right -lt $idx_top ]" "right should come before top"
}

test_toposort_circular_dependency() {
    declare -A deps_map
    deps_map["plugin-a"]="plugin-b"
    deps_map["plugin-b"]="plugin-c"
    deps_map["plugin-c"]="plugin-a"

    local sorted=()

    # Should fail with circular dependency
    if plugin_toposort deps_map sorted 2>/dev/null; then
        fail "Should detect circular dependency"
    else
        pass "Detected circular dependency"
    fi
}

test_toposort_missing_dependency() {
    declare -A deps_map
    deps_map["plugin-a"]=""
    deps_map["plugin-b"]="plugin-nonexistent"

    local sorted=()

    # Should fail with missing dependency
    if plugin_toposort deps_map sorted 2>/dev/null; then
        fail "Should detect missing dependency"
    else
        pass "Detected missing dependency"
    fi
}

test_toposort_hyphen_normalization() {
    declare -A deps_map
    deps_map["session-summary"]=""
    deps_map["reminder"]="session_summary"  # Reference with underscore

    local sorted=()
    plugin_toposort deps_map sorted

    assert_equals 2 "${#sorted[@]}" "Should have 2 plugins in sorted output"

    # session-summary should come before reminder
    local idx_summary=-1 idx_reminder=-1
    for i in "${!sorted[@]}"; do
        case "${sorted[$i]}" in
            session-summary) idx_summary=$i ;;
            reminder) idx_reminder=$i ;;
        esac
    done

    assert_true "[ $idx_summary -lt $idx_reminder ]" "session-summary should come before reminder"
}

# ============================================================================
# RUN TESTS
# ============================================================================

# Run all tests
main() {
    echo "========================================"
    echo "Unit Tests: Plugin Dependencies"
    echo "========================================"

    setup

    # Extract dependencies tests
    run_test "plugin_extract_depends: no dependencies" test_extract_depends_no_deps
    run_test "plugin_extract_depends: with dependencies" test_extract_depends_with_deps
    run_test "plugin_extract_depends: readonly declaration" test_extract_depends_readonly

    # Topological sort tests
    run_test "plugin_toposort: no dependencies" test_toposort_no_deps
    run_test "plugin_toposort: simple chain" test_toposort_simple_chain
    run_test "plugin_toposort: diamond pattern" test_toposort_diamond
    run_test "plugin_toposort: circular dependency" test_toposort_circular_dependency
    run_test "plugin_toposort: missing dependency" test_toposort_missing_dependency
    run_test "plugin_toposort: hyphen normalization" test_toposort_hyphen_normalization

    teardown

    print_summary
}

main
