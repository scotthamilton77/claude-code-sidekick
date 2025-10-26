#!/bin/bash
# test-config-cascade.sh - Integration test for configuration cascade
#
# Tests:
# - Default config loaded from config.defaults
# - User config overrides defaults
# - Project config overrides user config
# - Configuration precedence: project > user > defaults

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test result tracking
pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "${GREEN}✓${NC} $1"
}

fail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "${RED}✗${NC} $1"
    echo -e "  ${YELLOW}Details:${NC} $2"
}

info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

# Setup test environment
setup() {
    info "Setting up test environment..."

    # Create temp directory for test
    TEST_DIR=$(mktemp -d -t sidekick-test-cascade-XXXXXX)
    export CLAUDE_PROJECT_DIR="$TEST_DIR"

    # Create sidekick directory structure for project scope
    mkdir -p "$TEST_DIR/.claude/hooks/sidekick/lib"
    mkdir -p "$TEST_DIR/.claude/hooks/sidekick/handlers"
    mkdir -p "$TEST_DIR/.claude/hooks/sidekick/features"
    mkdir -p "$TEST_DIR/.sidekick/sessions"

    # Create sidekick directory structure for user scope
    mkdir -p "$HOME/.claude/hooks/sidekick-test/lib"
    mkdir -p "$HOME/.claude/hooks/sidekick-test/handlers"
    mkdir -p "$HOME/.claude/hooks/sidekick-test/features"

    # Copy sidekick files to project scope
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    SRC_DIR="$SCRIPT_DIR/../../../src/sidekick"

    cp "$SRC_DIR/sidekick.sh" "$TEST_DIR/.claude/hooks/sidekick/"
    cp "$SRC_DIR/lib/common.sh" "$TEST_DIR/.claude/hooks/sidekick/lib/"
    cp "$SRC_DIR/config.defaults" "$TEST_DIR/.claude/hooks/sidekick/"
    cp "$SRC_DIR/handlers"/*.sh "$TEST_DIR/.claude/hooks/sidekick/handlers/" 2>/dev/null || true
    cp "$SRC_DIR/features"/*.sh "$TEST_DIR/.claude/hooks/sidekick/features/" 2>/dev/null || true

    chmod +x "$TEST_DIR/.claude/hooks/sidekick/sidekick.sh"

    # Copy to user scope for cascade testing
    cp "$SRC_DIR/sidekick.sh" "$HOME/.claude/hooks/sidekick-test/"
    cp "$SRC_DIR/lib/common.sh" "$HOME/.claude/hooks/sidekick-test/lib/"
    cp "$SRC_DIR/config.defaults" "$HOME/.claude/hooks/sidekick-test/"
    cp "$SRC_DIR/handlers"/*.sh "$HOME/.claude/hooks/sidekick-test/handlers/" 2>/dev/null || true
    cp "$SRC_DIR/features"/*.sh "$HOME/.claude/hooks/sidekick-test/features/" 2>/dev/null || true

    chmod +x "$HOME/.claude/hooks/sidekick-test/sidekick.sh"

    # Create test session
    TEST_SESSION="test-cascade-$(date +%s)"
    mkdir -p "$TEST_DIR/.sidekick/sessions/$TEST_SESSION"

    info "Test environment created at: $TEST_DIR"
    info "User test environment at: $HOME/.claude/hooks/sidekick-test"
}

# Cleanup test environment
cleanup() {
    if [ -n "${TEST_DIR:-}" ] && [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
        info "Project test environment cleaned up"
    fi

    if [ -d "$HOME/.claude/hooks/sidekick-test" ]; then
        rm -rf "$HOME/.claude/hooks/sidekick-test"
        info "User test environment cleaned up"
    fi
}

# Helper: Test config value by sourcing common.sh and calling config_get
test_config_value() {
    local config_key="$1"
    local expected_value="$2"
    local test_location="${3:-project}"

    # Source common.sh to load config functions
    local sidekick_root
    if [ "$test_location" == "user" ]; then
        sidekick_root="$HOME/.claude/hooks/sidekick-test"
    else
        sidekick_root="$TEST_DIR/.claude/hooks/sidekick"
    fi

    # Run in subshell to isolate config
    local actual_value
    actual_value=$(bash -c "
        export SIDEKICK_ROOT='$sidekick_root'
        export SIDEKICK_USER_ROOT='sidekick-test'
        export CLAUDE_PROJECT_DIR='$TEST_DIR'
        source '$sidekick_root/lib/common.sh' 2>/dev/null
        config_load 2>/dev/null
        config_get '$config_key'
    " 2>/dev/null)

    if [ "$actual_value" == "$expected_value" ]; then
        return 0
    else
        echo "Expected: $expected_value, Got: $actual_value" >&2
        return 1
    fi
}

# Test 1: Defaults only (no user or project config)
test_defaults_only() {
    local test_name="Defaults only (no overrides)"

    # Don't create any override configs
    # Just verify defaults are loaded

    if test_config_value "LOG_LEVEL" "info" "project"; then
        pass "$test_name - LOG_LEVEL from defaults"
    else
        fail "$test_name - LOG_LEVEL" "Could not read default LOG_LEVEL"
        return
    fi

    if test_config_value "FEATURE_TRACKING" "true" "project"; then
        pass "$test_name - FEATURE_TRACKING from defaults"
    else
        fail "$test_name - FEATURE_TRACKING" "Could not read default FEATURE_TRACKING"
    fi
}

# Test 2: User config overrides defaults
test_user_overrides_defaults() {
    local test_name="User config overrides defaults"

    # Create user config with overrides
    cat > "$HOME/.claude/hooks/sidekick-test/sidekick.conf" << 'EOF'
# User config overrides
LOG_LEVEL=debug
TOPIC_CADENCE_HIGH=20
SLEEPER_ENABLED=false
CLEANUP_MIN_COUNT=10
EOF

    # Test that user values override defaults
    if test_config_value "LOG_LEVEL" "debug" "user"; then
        pass "$test_name - LOG_LEVEL overridden"
    else
        fail "$test_name - LOG_LEVEL" "User override failed"
        return
    fi

    if test_config_value "TOPIC_CADENCE_HIGH" "20" "user"; then
        pass "$test_name - TOPIC_CADENCE_HIGH overridden"
    else
        fail "$test_name - TOPIC_CADENCE_HIGH" "User override failed"
    fi

    if test_config_value "SLEEPER_ENABLED" "false" "user"; then
        pass "$test_name - SLEEPER_ENABLED overridden"
    else
        fail "$test_name - SLEEPER_ENABLED" "User override failed"
    fi

    # Test that non-overridden values still come from defaults
    if test_config_value "FEATURE_TRACKING" "true" "user"; then
        pass "$test_name - FEATURE_TRACKING from defaults"
    else
        fail "$test_name - FEATURE_TRACKING" "Default value not preserved"
    fi
}

# Test 3: Project config overrides user config
test_project_overrides_user() {
    local test_name="Project config overrides user config"

    # Keep user config from previous test
    # Create project config with different overrides
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" << 'EOF'
# Project config overrides
LOG_LEVEL=warn
TOPIC_CADENCE_HIGH=30
CLEANUP_MIN_COUNT=20
EOF

    # Test that project values override user values
    if test_config_value "LOG_LEVEL" "warn" "project"; then
        pass "$test_name - LOG_LEVEL overridden by project"
    else
        fail "$test_name - LOG_LEVEL" "Project override failed"
        return
    fi

    if test_config_value "TOPIC_CADENCE_HIGH" "30" "project"; then
        pass "$test_name - TOPIC_CADENCE_HIGH overridden by project"
    else
        fail "$test_name - TOPIC_CADENCE_HIGH" "Project override failed"
    fi

    if test_config_value "CLEANUP_MIN_COUNT" "20" "project"; then
        pass "$test_name - CLEANUP_MIN_COUNT overridden by project"
    else
        fail "$test_name - CLEANUP_MIN_COUNT" "Project override failed"
    fi

    # Test that user config still applies for non-overridden values
    if test_config_value "SLEEPER_ENABLED" "false" "project"; then
        pass "$test_name - SLEEPER_ENABLED from user config"
    else
        fail "$test_name - SLEEPER_ENABLED" "User value not preserved"
    fi
}

# Test 4: Full cascade (defaults → user → project)
test_full_cascade() {
    local test_name="Full cascade (defaults → user → project)"

    # Verify the complete cascade with different levels
    # Default: LOG_LEVEL=info
    # User: LOG_LEVEL=debug
    # Project: LOG_LEVEL=warn
    # Expected: warn (project wins)

    if test_config_value "LOG_LEVEL" "warn" "project"; then
        pass "$test_name - LOG_LEVEL = warn (project wins)"
    else
        fail "$test_name - LOG_LEVEL" "Full cascade failed"
        return
    fi

    # Default: TOPIC_CADENCE_HIGH=10
    # User: TOPIC_CADENCE_HIGH=20
    # Project: TOPIC_CADENCE_HIGH=30
    # Expected: 30 (project wins)

    if test_config_value "TOPIC_CADENCE_HIGH" "30" "project"; then
        pass "$test_name - TOPIC_CADENCE_HIGH = 30 (project wins)"
    else
        fail "$test_name - TOPIC_CADENCE_HIGH" "Full cascade failed"
    fi

    # Default: SLEEPER_ENABLED=true
    # User: SLEEPER_ENABLED=false
    # Project: (not set)
    # Expected: false (user wins)

    if test_config_value "SLEEPER_ENABLED" "false" "project"; then
        pass "$test_name - SLEEPER_ENABLED = false (user wins)"
    else
        fail "$test_name - SLEEPER_ENABLED" "User value not respected"
    fi

    # Default: FEATURE_TRACKING=true
    # User: (not set)
    # Project: (not set)
    # Expected: true (default wins)

    if test_config_value "FEATURE_TRACKING" "true" "project"; then
        pass "$test_name - FEATURE_TRACKING = true (default wins)"
    else
        fail "$test_name - FEATURE_TRACKING" "Default value not preserved"
    fi
}

# Test 5: Feature toggle cascade
test_feature_toggle_cascade() {
    local test_name="Feature toggle cascade"

    # Test that feature toggles work through cascade
    # Create user config disabling a feature
    cat > "$HOME/.claude/hooks/sidekick-test/sidekick.conf" << 'EOF'
FEATURE_CLEANUP=false
FEATURE_RESUME=true
EOF

    # Create project config enabling cleanup but disabling resume
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" << 'EOF'
FEATURE_CLEANUP=true
FEATURE_RESUME=false
EOF

    # Test cleanup (project should win)
    if test_config_value "FEATURE_CLEANUP" "true" "project"; then
        pass "$test_name - FEATURE_CLEANUP enabled (project wins)"
    else
        fail "$test_name - FEATURE_CLEANUP" "Project override failed"
        return
    fi

    # Test resume (project should win)
    if test_config_value "FEATURE_RESUME" "false" "project"; then
        pass "$test_name - FEATURE_RESUME disabled (project wins)"
    else
        fail "$test_name - FEATURE_RESUME" "Project override failed"
    fi

    # Test non-overridden feature (should be default=true)
    if test_config_value "FEATURE_TRACKING" "true" "project"; then
        pass "$test_name - FEATURE_TRACKING from defaults"
    else
        fail "$test_name - FEATURE_TRACKING" "Default not preserved"
    fi
}

# Test 6: Numeric config cascade
test_numeric_config_cascade() {
    local test_name="Numeric config values cascade"

    # Create user config with numeric values
    cat > "$HOME/.claude/hooks/sidekick-test/sidekick.conf" << 'EOF'
TOPIC_CADENCE_HIGH=20
SLEEPER_MAX_DURATION=300
CLEANUP_AGE_DAYS=5
EOF

    # Create project config overriding some
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" << 'EOF'
TOPIC_CADENCE_HIGH=15
SLEEPER_MAX_DURATION=450
EOF

    # Test project overrides
    if test_config_value "TOPIC_CADENCE_HIGH" "15" "project"; then
        pass "$test_name - TOPIC_CADENCE_HIGH = 15 (project)"
    else
        fail "$test_name - TOPIC_CADENCE_HIGH" "Project override failed"
        return
    fi

    if test_config_value "SLEEPER_MAX_DURATION" "450" "project"; then
        pass "$test_name - SLEEPER_MAX_DURATION = 450 (project)"
    else
        fail "$test_name - SLEEPER_MAX_DURATION" "Project override failed"
    fi

    # Test user value preserved
    if test_config_value "CLEANUP_AGE_DAYS" "5" "project"; then
        pass "$test_name - CLEANUP_AGE_DAYS = 5 (user)"
    else
        fail "$test_name - CLEANUP_AGE_DAYS" "User value not preserved"
    fi
}

# Test 7: Empty user config (project overrides defaults directly)
test_empty_user_config() {
    local test_name="Empty user config (project ↔ defaults)"

    # Remove user config
    rm -f "$HOME/.claude/hooks/sidekick-test/sidekick.conf"

    # Create project config
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" << 'EOF'
LOG_LEVEL=error
TOPIC_CADENCE_HIGH=15
EOF

    # Test project values
    if test_config_value "LOG_LEVEL" "error" "project"; then
        pass "$test_name - LOG_LEVEL = error (project)"
    else
        fail "$test_name - LOG_LEVEL" "Project override failed without user config"
        return
    fi

    # Test defaults for non-overridden values
    if test_config_value "FEATURE_TRACKING" "true" "project"; then
        pass "$test_name - FEATURE_TRACKING = true (default)"
    else
        fail "$test_name - FEATURE_TRACKING" "Default not preserved"
    fi
}

# Test 8: Empty project config (user overrides defaults only)
test_empty_project_config() {
    local test_name="Empty project config (user ↔ defaults)"

    # Create user config
    cat > "$HOME/.claude/hooks/sidekick-test/sidekick.conf" << 'EOF'
LOG_LEVEL=debug
SLEEPER_ENABLED=false
EOF

    # Remove project config
    rm -f "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf"

    # Test user values
    if test_config_value "LOG_LEVEL" "debug" "project"; then
        pass "$test_name - LOG_LEVEL = debug (user)"
    else
        fail "$test_name - LOG_LEVEL" "User override failed without project config"
        return
    fi

    if test_config_value "SLEEPER_ENABLED" "false" "project"; then
        pass "$test_name - SLEEPER_ENABLED = false (user)"
    else
        fail "$test_name - SLEEPER_ENABLED" "User override failed"
    fi

    # Test defaults
    if test_config_value "FEATURE_TRACKING" "true" "project"; then
        pass "$test_name - FEATURE_TRACKING = true (default)"
    else
        fail "$test_name - FEATURE_TRACKING" "Default not preserved"
    fi
}

# Test 9: config_is_feature_enabled through cascade
test_feature_enabled_cascade() {
    local test_name="config_is_feature_enabled through cascade"

    # Create user config
    cat > "$HOME/.claude/hooks/sidekick-test/sidekick.conf" << 'EOF'
FEATURE_CLEANUP=false
EOF

    # Create project config
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" << 'EOF'
FEATURE_TOPIC_EXTRACTION=false
FEATURE_CLEANUP=true
EOF

    # Test feature detection in script
    local result
    result=$(bash -c "
        export SIDEKICK_ROOT='$TEST_DIR/.claude/hooks/sidekick'
        export CLAUDE_PROJECT_DIR='$TEST_DIR'
        source '$TEST_DIR/.claude/hooks/sidekick/lib/common.sh' 2>/dev/null
        config_load 2>/dev/null
        if config_is_feature_enabled 'cleanup'; then
            echo 'enabled'
        else
            echo 'disabled'
        fi
    " 2>/dev/null)

    if [ "$result" == "enabled" ]; then
        pass "$test_name - cleanup enabled (project overrides user)"
    else
        fail "$test_name - cleanup" "Feature detection failed, got: $result"
        return
    fi

    result=$(bash -c "
        export SIDEKICK_ROOT='$TEST_DIR/.claude/hooks/sidekick'
        export CLAUDE_PROJECT_DIR='$TEST_DIR'
        source '$TEST_DIR/.claude/hooks/sidekick/lib/common.sh' 2>/dev/null
        config_load 2>/dev/null
        if config_is_feature_enabled 'topic_extraction'; then
            echo 'enabled'
        else
            echo 'disabled'
        fi
    " 2>/dev/null)

    if [ "$result" == "disabled" ]; then
        pass "$test_name - topic_extraction disabled (project config)"
    else
        fail "$test_name - topic_extraction" "Feature detection failed, got: $result"
    fi
}

# Main test execution
main() {
    echo "========================================="
    echo "Sidekick Config Cascade Integration Tests"
    echo "========================================="
    echo ""

    # Setup
    setup
    trap cleanup EXIT

    # Run tests
    test_defaults_only
    test_user_overrides_defaults
    test_project_overrides_user
    test_full_cascade
    test_feature_toggle_cascade
    test_numeric_config_cascade
    test_empty_user_config
    test_empty_project_config
    test_feature_enabled_cascade

    # Summary
    echo ""
    echo "========================================="
    echo "Test Summary"
    echo "========================================="
    echo "Total tests run: $TESTS_RUN"
    echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "${RED}Failed: $TESTS_FAILED${NC}"
        exit 1
    else
        echo -e "${GREEN}All tests passed!${NC}"
        exit 0
    fi
}

# Run main if executed directly
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi
