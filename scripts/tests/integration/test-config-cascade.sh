#!/bin/bash
# test-config-cascade.sh - Integration test for configuration cascade
#
# Tests:
# - Default config loaded from config.defaults
# - User installed config overrides defaults
# - User persistent config overrides user installed
# - Project deployed config overrides user configs
# - Project versioned config overrides deployed config
# - Configuration precedence: versioned project > deployed project > user persistent > user installed > defaults

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
    cp -r "$SRC_DIR/lib/"* "$TEST_DIR/.claude/hooks/sidekick/lib/"
    cp "$SRC_DIR/config.defaults" "$TEST_DIR/.claude/hooks/sidekick/"
    cp "$SRC_DIR/handlers"/*.sh "$TEST_DIR/.claude/hooks/sidekick/handlers/" 2>/dev/null || true
    cp "$SRC_DIR/features"/*.sh "$TEST_DIR/.claude/hooks/sidekick/features/" 2>/dev/null || true

    chmod +x "$TEST_DIR/.claude/hooks/sidekick/sidekick.sh"

    # Copy to user scope for cascade testing
    cp "$SRC_DIR/sidekick.sh" "$HOME/.claude/hooks/sidekick-test/"
    cp -r "$SRC_DIR/lib/"* "$HOME/.claude/hooks/sidekick-test/lib/"
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

}

# Test 2: User config overrides defaults
test_user_overrides_defaults() {
    local test_name="User config overrides defaults"

    # Create user config with overrides
    cat > "$HOME/.claude/hooks/sidekick-test/sidekick.conf" << 'EOF'
# User config overrides
LOG_LEVEL=debug
SLEEPER_MAX_DURATION=20
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

    if test_config_value "SLEEPER_MAX_DURATION" "20" "user"; then
        pass "$test_name - SLEEPER_MAX_DURATION overridden"
    else
        fail "$test_name - SLEEPER_MAX_DURATION" "User override failed"
    fi

    if test_config_value "SLEEPER_ENABLED" "false" "user"; then
        pass "$test_name - SLEEPER_ENABLED overridden"
    else
        fail "$test_name - SLEEPER_ENABLED" "User override failed"
    fi

    # Test that non-overridden values still come from defaults
}

# Test 3: Project config overrides user config
test_project_overrides_user() {
    local test_name="Project config overrides user config"

    # Keep user config from previous test
    # Create project config with different overrides
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" << 'EOF'
# Project config overrides
LOG_LEVEL=warn
SLEEPER_MAX_DURATION=30
CLEANUP_MIN_COUNT=20
EOF

    # Test that project values override user values
    if test_config_value "LOG_LEVEL" "warn" "project"; then
        pass "$test_name - LOG_LEVEL overridden by project"
    else
        fail "$test_name - LOG_LEVEL" "Project override failed"
        return
    fi

    if test_config_value "SLEEPER_MAX_DURATION" "30" "project"; then
        pass "$test_name - SLEEPER_MAX_DURATION overridden by project"
    else
        fail "$test_name - SLEEPER_MAX_DURATION" "Project override failed"
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

    # Default: SLEEPER_MAX_DURATION=10
    # User: SLEEPER_MAX_DURATION=20
    # Project: SLEEPER_MAX_DURATION=30
    # Expected: 30 (project wins)

    if test_config_value "SLEEPER_MAX_DURATION" "30" "project"; then
        pass "$test_name - SLEEPER_MAX_DURATION = 30 (project wins)"
    else
        fail "$test_name - SLEEPER_MAX_DURATION" "Full cascade failed"
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
}

# Test 6: Numeric config cascade
test_numeric_config_cascade() {
    local test_name="Numeric config values cascade"

    # Create user config with numeric values
    cat > "$HOME/.claude/hooks/sidekick-test/sidekick.conf" << 'EOF'
SLEEPER_MAX_DURATION=20
SLEEPER_MAX_DURATION=300
CLEANUP_AGE_DAYS=5
EOF

    # Create project config overriding some
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" << 'EOF'
SLEEPER_MAX_DURATION=15
SLEEPER_MAX_DURATION=450
EOF

    # Test project overrides
    if test_config_value "SLEEPER_MAX_DURATION" "15" "project"; then
        pass "$test_name - SLEEPER_MAX_DURATION = 15 (project)"
    else
        fail "$test_name - SLEEPER_MAX_DURATION" "Project override failed"
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
SLEEPER_MAX_DURATION=15
EOF

    # Test project values
    if test_config_value "LOG_LEVEL" "error" "project"; then
        pass "$test_name - LOG_LEVEL = error (project)"
    else
        fail "$test_name - LOG_LEVEL" "Project override failed without user config"
        return
    fi

    # Test defaults for non-overridden values
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
}

# Test 9: User persistent config overrides user installed config
test_user_persistent_overrides_user_installed() {
    local test_name="User persistent config overrides user installed"

    # Create user installed config
    cat > "$HOME/.claude/hooks/sidekick-test/sidekick.conf" << 'EOF'
LOG_LEVEL=debug
SLEEPER_MAX_DURATION=20
CLEANUP_MIN_COUNT=10
EOF

    # Create user persistent config (higher priority)
    mkdir -p "$HOME/.sidekick"
    cat > "$HOME/.sidekick/sidekick.conf" << 'EOF'
LOG_LEVEL=warn
CLEANUP_MIN_COUNT=15
EOF

    # Remove project configs for this test
    rm -f "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf"
    rm -f "$TEST_DIR/.sidekick/sidekick.conf"

    # Test that user persistent config wins
    if test_config_value "LOG_LEVEL" "warn" "project"; then
        pass "$test_name - LOG_LEVEL = warn (user persistent wins)"
    else
        fail "$test_name - LOG_LEVEL" "User persistent override failed"
        return
    fi

    # Test that user persistent config wins for CLEANUP_MIN_COUNT
    if test_config_value "CLEANUP_MIN_COUNT" "15" "project"; then
        pass "$test_name - CLEANUP_MIN_COUNT = 15 (user persistent wins)"
    else
        fail "$test_name - CLEANUP_MIN_COUNT" "User persistent override failed"
    fi

    # Test that user installed config applies for non-overridden values
    if test_config_value "SLEEPER_MAX_DURATION" "20" "project"; then
        pass "$test_name - SLEEPER_MAX_DURATION = 20 (user installed)"
    else
        fail "$test_name - SLEEPER_MAX_DURATION" "User installed value not preserved"
    fi

    # Cleanup user persistent config for next tests
    rm -f "$HOME/.sidekick/sidekick.conf"
}

# Test 10: Versioned project config overrides deployed project config
test_versioned_project_overrides_deployed() {
    local test_name="Versioned project config overrides deployed"

    # Create user config
    cat > "$HOME/.claude/hooks/sidekick-test/sidekick.conf" << 'EOF'
LOG_LEVEL=debug
SLEEPER_MAX_DURATION=20
EOF

    # Create project deployed config
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" << 'EOF'
LOG_LEVEL=warn
SLEEPER_MAX_DURATION=30
CLEANUP_MIN_COUNT=15
EOF

    # Create versioned project config (highest priority)
    mkdir -p "$TEST_DIR/.sidekick"
    cat > "$TEST_DIR/.sidekick/sidekick.conf" << 'EOF'
LOG_LEVEL=error
CLEANUP_MIN_COUNT=25
EOF

    # Test that versioned project config wins
    if test_config_value "LOG_LEVEL" "error" "project"; then
        pass "$test_name - LOG_LEVEL = error (versioned project wins)"
    else
        fail "$test_name - LOG_LEVEL" "Versioned project override failed"
        return
    fi

    # Test that versioned project config wins for CLEANUP_MIN_COUNT
    if test_config_value "CLEANUP_MIN_COUNT" "25" "project"; then
        pass "$test_name - CLEANUP_MIN_COUNT = 25 (versioned project wins)"
    else
        fail "$test_name - CLEANUP_MIN_COUNT" "Versioned project override failed"
    fi

    # Test that deployed project config applies for non-overridden values
    if test_config_value "SLEEPER_MAX_DURATION" "30" "project"; then
        pass "$test_name - SLEEPER_MAX_DURATION = 30 (deployed project)"
    else
        fail "$test_name - SLEEPER_MAX_DURATION" "Deployed project value not preserved"
    fi
}

# Test 11: Full five-level cascade (defaults → user installed → user persistent → deployed → versioned)
test_five_level_cascade() {
    local test_name="Five-level cascade (defaults → user installed → user persistent → deployed → versioned)"

    # Create all five levels with different values
    # Defaults: LOG_LEVEL=info, SLEEPER_MAX_DURATION=10, CLEANUP_MIN_COUNT=5, SLEEPER_MAX_DURATION=600

    # User installed config
    cat > "$HOME/.claude/hooks/sidekick-test/sidekick.conf" << 'EOF'
LOG_LEVEL=debug
SLEEPER_MAX_DURATION=20
CLEANUP_MIN_COUNT=10
SLEEPER_MAX_DURATION=300
EOF

    # User persistent config
    mkdir -p "$HOME/.sidekick"
    cat > "$HOME/.sidekick/sidekick.conf" << 'EOF'
LOG_LEVEL=info
SLEEPER_MAX_DURATION=25
CLEANUP_MIN_COUNT=12
EOF

    # Project deployed config
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" << 'EOF'
LOG_LEVEL=warn
SLEEPER_MAX_DURATION=30
EOF

    # Versioned project config
    cat > "$TEST_DIR/.sidekick/sidekick.conf" << 'EOF'
LOG_LEVEL=error
EOF

    # Test cascade precedence:
    # LOG_LEVEL: error (versioned wins over all)
    # SLEEPER_MAX_DURATION: 30 (deployed wins over user persistent, user installed, defaults)
    # CLEANUP_MIN_COUNT: 12 (user persistent wins over user installed, defaults)
    # SLEEPER_MAX_DURATION: 300 (user installed wins over defaults)
    # FEATURE_TRACKING: true (defaults, not overridden)

    if test_config_value "LOG_LEVEL" "error" "project"; then
        pass "$test_name - LOG_LEVEL = error (versioned wins)"
    else
        fail "$test_name - LOG_LEVEL" "Five-level cascade failed"
        return
    fi

    if test_config_value "SLEEPER_MAX_DURATION" "30" "project"; then
        pass "$test_name - SLEEPER_MAX_DURATION = 30 (deployed wins)"
    else
        fail "$test_name - SLEEPER_MAX_DURATION" "Five-level cascade failed"
    fi

    if test_config_value "CLEANUP_MIN_COUNT" "12" "project"; then
        pass "$test_name - CLEANUP_MIN_COUNT = 12 (user persistent wins)"
    else
        fail "$test_name - CLEANUP_MIN_COUNT" "Five-level cascade failed"
    fi

    if test_config_value "SLEEPER_MAX_DURATION" "300" "project"; then
        pass "$test_name - SLEEPER_MAX_DURATION = 300 (user installed wins)"
    else
        fail "$test_name - SLEEPER_MAX_DURATION" "Five-level cascade failed"
    fi


    # Cleanup user persistent config
    rm -f "$HOME/.sidekick/sidekick.conf"
}

# Test 12: config_is_feature_enabled through cascade
test_feature_enabled_cascade() {
    local test_name="config_is_feature_enabled through cascade"

    # Create user config
    cat > "$HOME/.claude/hooks/sidekick-test/sidekick.conf" << 'EOF'
FEATURE_CLEANUP=false
EOF

    # Create project config
    cat > "$TEST_DIR/.claude/hooks/sidekick/sidekick.conf" << 'EOF'
FEATURE_SESSION_SUMMARY=false
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
        if config_is_feature_enabled 'session_summary'; then
            echo 'enabled'
        else
            echo 'disabled'
        fi
    " 2>/dev/null)

    if [ "$result" == "disabled" ]; then
        pass "$test_name - session_summary disabled (project config)"
    else
        fail "$test_name - session_summary" "Feature detection failed, got: $result"
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
    test_user_persistent_overrides_user_installed
    test_versioned_project_overrides_deployed
    test_five_level_cascade
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
