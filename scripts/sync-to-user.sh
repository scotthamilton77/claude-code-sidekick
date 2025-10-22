#!/bin/bash
# sync-to-user.sh - Sync project sidekick installation to user scope
#
# Usage:
#   sync-to-user.sh
#
# Description:
#   Copies the project's .claude/hooks/sidekick/ to ~/.claude/hooks/sidekick/
#   Preserves user's sidekick.conf and tmp/ directory
#   Updates hooks in ~/.claude/settings.json
#
# Use case:
#   After testing sidekick changes in project scope, sync to user scope

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $*"
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites..."

    # Check if project sidekick exists
    if [ ! -d "$PROJECT_ROOT/.claude/hooks/sidekick" ]; then
        log_error "Project sidekick not found: $PROJECT_ROOT/.claude/hooks/sidekick"
        log_error "Run ./scripts/install.sh --project first"
        exit 1
    fi

    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed"
        exit 1
    fi

    log_info "Prerequisites check passed"
}

# Sync files
sync_files() {
    local src_dir="$PROJECT_ROOT/.claude/hooks/sidekick"
    local dest_dir="$HOME/.claude/hooks/sidekick"

    log_step "Syncing files from project to user scope..."

    # Create destination directory structure
    mkdir -p "$dest_dir/lib"
    mkdir -p "$dest_dir/handlers"
    mkdir -p "$dest_dir/features/prompts"
    mkdir -p "$dest_dir/tmp"

    # Copy main files
    cp "$src_dir/sidekick.sh" "$dest_dir/"
    chmod +x "$dest_dir/sidekick.sh"

    # Copy library
    cp -r "$src_dir/lib"/* "$dest_dir/lib/"

    # Copy handlers
    cp -r "$src_dir/handlers"/* "$dest_dir/handlers/"

    # Copy features
    cp -r "$src_dir/features"/* "$dest_dir/features/"

    # Copy config.defaults
    cp "$src_dir/config.defaults" "$dest_dir/"

    # Preserve sidekick.conf if it exists
    if [ ! -f "$dest_dir/sidekick.conf" ]; then
        cp "$src_dir/config.defaults" "$dest_dir/sidekick.conf"
        log_info "Created sidekick.conf from defaults"
    else
        log_info "Preserved existing sidekick.conf"
    fi

    log_info "Files synced successfully"
}

# Update settings.json hooks
update_hooks() {
    local settings_file="$HOME/.claude/settings.json"

    log_step "Updating hooks in $settings_file..."

    # Create .claude directory if it doesn't exist
    mkdir -p "$HOME/.claude"

    # Create settings.json if it doesn't exist
    if [ ! -f "$settings_file" ]; then
        echo '{}' > "$settings_file"
    fi

    # Create backup
    local backup_file="${settings_file}.sync-backup.$(date +%Y%m%d-%H%M%S)"
    cp "$settings_file" "$backup_file"
    log_info "Backup created: $backup_file"

    # Update hooks using jq
    local settings
    settings=$(cat "$settings_file")

    settings=$(echo "$settings" | jq \
        --arg session_cmd '~/.claude/hooks/sidekick/sidekick.sh session-start "$CLAUDE_PROJECT_DIR"' \
        --arg prompt_cmd '~/.claude/hooks/sidekick/sidekick.sh user-prompt-submit "$CLAUDE_PROJECT_DIR"' \
        --arg status_cmd '~/.claude/hooks/sidekick/sidekick.sh statusline --project-dir "$CLAUDE_PROJECT_DIR"' \
        '
        .hooks.SessionStart = [{
            "hooks": [{
                "type": "command",
                "command": $session_cmd
            }]
        }] |
        .hooks.UserPromptSubmit = [{
            "hooks": [{
                "type": "command",
                "command": $prompt_cmd
            }]
        }] |
        .statusLine = {
            "type": "command",
            "command": $status_cmd
        }
        ')

    # Write updated settings
    echo "$settings" | jq '.' > "$settings_file"

    log_info "Hooks updated successfully"
}

# Main sync flow
main() {
    echo ""
    echo "=================================================="
    echo "  Sidekick Sync (Project → User)"
    echo "=================================================="
    echo ""

    # Check prerequisites
    check_prerequisites

    echo ""
    log_info "Sync plan:"
    echo "  Source:      $PROJECT_ROOT/.claude/hooks/sidekick"
    echo "  Destination: ~/.claude/hooks/sidekick"
    echo "  Preserved:   sidekick.conf, tmp/"
    echo ""

    # Sync files
    sync_files
    echo ""

    # Update hooks
    update_hooks
    echo ""

    # Success
    echo "=================================================="
    log_info "Sync complete!"
    echo "=================================================="
    echo ""
    echo "Next steps:"
    echo "  1. Review configuration: cat ~/.claude/hooks/sidekick/sidekick.conf"
    echo "  2. Start a new Claude session to use updated hooks"
    echo ""
}

# Run main
main "$@"
