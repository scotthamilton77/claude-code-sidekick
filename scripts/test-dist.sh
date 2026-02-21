#!/bin/bash
#
# Test distribution package locally without publishing to npm.
# Uses globally installed tarball to simulate production environment.
#
# Usage:
#   ./scripts/test-dist.sh setup    # Build, pack, install globally, swap hooks
#   ./scripts/test-dist.sh teardown # Uninstall, restore original hooks
#   ./scripts/test-dist.sh rebuild  # Quick rebuild + reinstall (no hook swap)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_ROOT/packages/sidekick-dist"
HOOKS_DIR="$PROJECT_ROOT/packages/sidekick-plugin/hooks"
HOOKS_FILE="$HOOKS_DIR/hooks.json"
BACKUP_FILE="$HOOKS_DIR/TESTING-DO_NOT_COMMIT_ME.json"

setup() {
    echo "=== Setting up dist test environment ==="

    # Check if already in test mode
    if [[ -f "$BACKUP_FILE" ]]; then
        echo "ERROR: Test mode already active (backup file exists)."
        echo "Run 'teardown' first or delete $BACKUP_FILE"
        exit 1
    fi

    # Build everything
    echo "Building project..."
    cd "$PROJECT_ROOT"
    pnpm build

    # Bundle and pack
    echo "Bundling sidekick-dist..."
    cd "$DIST_DIR"
    pnpm bundle

    echo "Creating tarball..."
    rm -f *.tgz
    npm pack

    # Install globally
    echo "Installing globally from tarball..."
    TARBALL=$(ls -1 *.tgz | head -1)
    npm install -g "./$TARBALL"

    # Swap hooks
    echo "Swapping hooks.json for local testing..."
    mv "$HOOKS_FILE" "$BACKUP_FILE"

    # Create test hooks.json (replace npx @scotthamilton77/sidekick with sidekick)
    sed 's/npx @scotthamilton77\/sidekick/sidekick/g' "$BACKUP_FILE" > "$HOOKS_FILE"

    echo ""
    echo "=== Setup complete ==="
    echo "- Global 'sidekick' command installed"
    echo "- hooks.json swapped for local testing"
    echo "- Original backed up to TESTING-DO_NOT_COMMIT_ME.json"
    echo ""
    echo "Verify sidekick is active in Claude Code. Run 'pnpm test:dist:teardown' when done."
}

teardown() {
    echo "=== Tearing down dist test environment ==="

    # Check if in test mode
    if [[ ! -f "$BACKUP_FILE" ]]; then
        echo "Not in test mode (no backup file found)."
        # Still try to uninstall in case partially set up
        npm uninstall -g @scotthamilton77/sidekick 2>/dev/null || true
        exit 0
    fi

    # Uninstall global package
    echo "Uninstalling global sidekick..."
    npm uninstall -g @scotthamilton77/sidekick 2>/dev/null || true

    # Restore hooks
    echo "Restoring original hooks.json..."
    rm -f "$HOOKS_FILE"
    mv "$BACKUP_FILE" "$HOOKS_FILE"

    # Clean up tarball
    echo "Cleaning up tarball..."
    rm -f "$DIST_DIR"/*.tgz

    echo ""
    echo "=== Teardown complete ==="
    echo "- Global package uninstalled"
    echo "- Original hooks.json restored"
}

rebuild() {
    echo "=== Quick rebuild for dist testing ==="

    # Check if in test mode
    if [[ ! -f "$BACKUP_FILE" ]]; then
        echo "Not in test mode. Run 'setup' first."
        exit 1
    fi

    # Build and bundle
    echo "Building project..."
    cd "$PROJECT_ROOT"
    pnpm build

    echo "Bundling sidekick-dist..."
    cd "$DIST_DIR"
    pnpm bundle

    echo "Creating tarball..."
    rm -f *.tgz
    npm pack

    # Reinstall globally
    echo "Reinstalling globally..."
    TARBALL=$(ls -1 *.tgz | head -1)
    npm install -g "./$TARBALL"

    echo ""
    echo "=== Rebuild complete ==="
    echo "Verify sidekick is active in Claude Code."
}

case "${1:-}" in
    setup)
        setup
        ;;
    teardown)
        teardown
        ;;
    rebuild)
        rebuild
        ;;
    *)
        echo "Usage: $0 {setup|teardown|rebuild}"
        echo ""
        echo "  setup    - Build, pack, install globally, swap hooks for local testing"
        echo "  teardown - Uninstall global package, restore original hooks"
        echo "  rebuild  - Quick rebuild + reinstall (when already in test mode)"
        exit 1
        ;;
esac
