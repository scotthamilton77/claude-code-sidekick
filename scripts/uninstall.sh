#!/bin/bash
# uninstall.sh - Uninstall Sidekick from user and/or project scope
#
# Usage:
#   uninstall.sh [--user|--project|--both]
#
# Options:
#   --user      Uninstall from ~/.claude only
#   --project   Uninstall from project .claude only
#   --both      Uninstall from both (default)
#
# Environment:
#   SIDEKICK_SKIP_CONFIRM=1   Skip confirmation prompt (for testing)
#
# Examples:
#   uninstall.sh --user
#   uninstall.sh --project
#   SIDEKICK_SKIP_CONFIRM=1 uninstall.sh --user

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Uninstallation scope
UNINSTALL_USER=false
UNINSTALL_PROJECT=false

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

# Parse command-line arguments
parse_args() {
    if [ $# -eq 0 ]; then
        # Default to --both if no args
        UNINSTALL_USER=true
        UNINSTALL_PROJECT=true
        return
    fi

    while [ $# -gt 0 ]; do
        case "$1" in
            --user)
                UNINSTALL_USER=true
                shift
                ;;
            --project)
                UNINSTALL_PROJECT=true
                shift
                ;;
            --both)
                UNINSTALL_USER=true
                UNINSTALL_PROJECT=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    # If neither specified, default to both
    if [ "$UNINSTALL_USER" = false ] && [ "$UNINSTALL_PROJECT" = false ]; then
        UNINSTALL_USER=true
        UNINSTALL_PROJECT=true
    fi
}

# Show help
show_help() {
    cat <<EOF
Sidekick Uninstallation Script

Usage:
  uninstall.sh [OPTIONS]

Options:
  --user      Uninstall from ~/.claude only
  --project   Uninstall from project .claude only
  --both      Uninstall from both scopes (default)
  -h, --help  Show this help message

Environment:
  SIDEKICK_SKIP_CONFIRM=1   Skip confirmation prompt (for testing)

Examples:
  uninstall.sh --user
  uninstall.sh --project
  SIDEKICK_SKIP_CONFIRM=1 uninstall.sh --user

EOF
}

# Confirm uninstallation
confirm_uninstall() {
    local scope="$1"

    # Skip confirmation if env var set
    if [ "${SIDEKICK_SKIP_CONFIRM:-0}" = "1" ]; then
        return 0
    fi

    echo -e "${YELLOW}WARNING:${NC} This will remove Sidekick from $scope scope."
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Uninstallation cancelled"
        return 1
    fi
    return 0
}

# Remove hooks from settings.json
remove_hooks_from_settings() {
    local settings_file="$1"

    log_step "Removing hooks from $settings_file..."

    if [ ! -f "$settings_file" ]; then
        log_warn "Settings file not found: $settings_file"
        return 0
    fi

    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed"
        return 1
    fi

    # Create backup
    local backup_file="${settings_file}.uninstall-backup.$(date +%Y%m%d-%H%M%S)"
    cp "$settings_file" "$backup_file"
    log_info "Backup created: $backup_file"

    # Remove sidekick hooks
    local settings
    settings=$(cat "$settings_file")

    # Remove hooks that contain "sidekick"
    settings=$(echo "$settings" | jq '
        if .hooks.SessionStart then
            .hooks.SessionStart = [.hooks.SessionStart[] |
                select(.hooks[0].command | contains("sidekick") | not)]
        else . end |
        if .hooks.UserPromptSubmit then
            .hooks.UserPromptSubmit = [.hooks.UserPromptSubmit[] |
                select(.hooks[0].command | contains("sidekick") | not)]
        else . end |
        if .statusLine.command then
            if (.statusLine.command | contains("sidekick")) then
                del(.statusLine)
            else . end
        else . end
    ')

    # Write updated settings
    echo "$settings" | jq '.' > "$settings_file"

    log_info "Hooks removed from $settings_file"
}

# Remove .claudeignore entry
remove_claudeignore_entry() {
    local project_dir="$1"
    local ignore_file="$project_dir/.claudeignore"

    if [ ! -f "$ignore_file" ]; then
        return 0
    fi

    log_step "Removing .claudeignore entry..."

    # Remove sidekick tmp entry
    if grep -q "hooks/sidekick/tmp/" "$ignore_file" 2>/dev/null; then
        grep -v "hooks/sidekick/tmp/" "$ignore_file" > "$ignore_file.tmp"
        mv "$ignore_file.tmp" "$ignore_file"
        log_info "Removed sidekick entry from .claudeignore"
    fi
}

# Check if tmp directory has recent sessions
has_recent_sessions() {
    local tmp_dir="$1"

    if [ ! -d "$tmp_dir" ]; then
        return 1
    fi

    # Check if any session directory modified in last 7 days
    local recent_count
    recent_count=$(find "$tmp_dir" -mindepth 1 -maxdepth 1 -type d -mtime -7 2>/dev/null | wc -l)

    [ "$recent_count" -gt 0 ]
}

# Uninstall from user scope
uninstall_from_user() {
    log_info "Uninstalling from user scope (~/.claude)..."

    if ! confirm_uninstall "user"; then
        return 1
    fi

    local user_dir="$HOME/.claude/hooks/sidekick"
    local settings_file="$HOME/.claude/settings.json"

    # Remove hooks from settings
    if [ -f "$settings_file" ]; then
        remove_hooks_from_settings "$settings_file"
    fi

    # Check for recent sessions
    if has_recent_sessions "$user_dir/tmp"; then
        log_warn "Found recent session data in $user_dir/tmp"
        if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ]; then
            read -p "Preserve tmp directory? (Y/n) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                log_info "Preserving tmp directory"
                # Remove everything except tmp
                find "$user_dir" -mindepth 1 -maxdepth 1 ! -name tmp -exec rm -rf {} +
                log_info "User scope uninstallation complete (tmp preserved)"
                return 0
            fi
        fi
    fi

    # Remove sidekick directory
    if [ -d "$user_dir" ]; then
        rm -rf "$user_dir"
        log_info "Removed $user_dir"
    else
        log_warn "Sidekick directory not found: $user_dir"
    fi

    log_info "User scope uninstallation complete"
}

# Uninstall from project scope
uninstall_from_project() {
    log_info "Uninstalling from project scope (.claude)..."

    if ! confirm_uninstall "project"; then
        return 1
    fi

    # Determine project directory
    local project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
    local project_sidekick_dir="$project_dir/.claude/hooks/sidekick"
    local settings_file="$project_dir/.claude/settings.json"

    # Remove hooks from settings
    if [ -f "$settings_file" ]; then
        remove_hooks_from_settings "$settings_file"
    fi

    # Remove .claudeignore entry
    remove_claudeignore_entry "$project_dir"

    # Check for recent sessions
    if has_recent_sessions "$project_sidekick_dir/tmp"; then
        log_warn "Found recent session data in $project_sidekick_dir/tmp"
        if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ]; then
            read -p "Preserve tmp directory? (Y/n) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                log_info "Preserving tmp directory"
                # Remove everything except tmp
                find "$project_sidekick_dir" -mindepth 1 -maxdepth 1 ! -name tmp -exec rm -rf {} +
                log_info "Project scope uninstallation complete (tmp preserved)"
                return 0
            fi
        fi
    fi

    # Remove sidekick directory
    if [ -d "$project_sidekick_dir" ]; then
        rm -rf "$project_sidekick_dir"
        log_info "Removed $project_sidekick_dir"
    else
        log_warn "Sidekick directory not found: $project_sidekick_dir"
    fi

    log_info "Project scope uninstallation complete"
}

# Main uninstallation flow
main() {
    echo ""
    echo "=================================================="
    echo "  Sidekick Uninstallation"
    echo "=================================================="
    echo ""

    # Parse arguments
    parse_args "$@"

    # Show uninstallation plan
    echo ""
    log_info "Uninstallation plan:"
    if [ "$UNINSTALL_USER" = true ]; then
        echo "  - User scope: ~/.claude/hooks/sidekick"
    fi
    if [ "$UNINSTALL_PROJECT" = true ]; then
        echo "  - Project scope: .claude/hooks/sidekick"
    fi
    echo ""

    # Uninstall from user scope
    if [ "$UNINSTALL_USER" = true ]; then
        uninstall_from_user || true
        echo ""
    fi

    # Uninstall from project scope
    if [ "$UNINSTALL_PROJECT" = true ]; then
        uninstall_from_project || true
        echo ""
    fi

    # Success
    echo "=================================================="
    log_info "Uninstallation complete!"
    echo "=================================================="
    echo ""
}

# Run main
main "$@"
