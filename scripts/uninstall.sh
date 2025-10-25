#!/bin/bash
# uninstall.sh - Uninstall Sidekick from user and/or project scope
#
# Usage:
#   uninstall.sh [--user|--project|--both] [--dry-run] [--verbose]
#
# Options:
#   --user      Uninstall from ~/.claude only
#   --project   Uninstall from project .claude only
#   --both      Uninstall from both (default)
#   --dry-run   Show what would be deleted without actually deleting
#   --verbose   Show detailed output of all operations
#
# Environment:
#   SIDEKICK_SKIP_CONFIRM=1   Skip confirmation prompt (for testing)
#
# Examples:
#   uninstall.sh --user --dry-run
#   uninstall.sh --user --verbose
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

# Operation modes
DRY_RUN=false
VERBOSE=false

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

log_verbose() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[VERBOSE]${NC} $*"
    fi
}

log_operation() {
    local op="$1"
    shift
    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}[DRY-RUN]${NC} Would $op: $*"
    else
        log_verbose "$op: $*"
    fi
}

# Validate path is within expected boundaries
validate_path() {
    local path="$1"
    local scope="$2"  # "user" or "project"

    case "$scope" in
        user)
            # Must be within ~/.claude/hooks/sidekick
            if [[ ! "$path" =~ ^"$HOME"/.claude/hooks/sidekick ]]; then
                log_error "SAFETY: Path outside expected user scope: $path"
                log_error "         Expected: $HOME/.claude/hooks/sidekick/*"
                return 1
            fi
            ;;
        user-hooks)
            # Must be ~/.claude/hooks exactly
            if [ "$path" != "$HOME/.claude/hooks" ]; then
                log_error "SAFETY: Invalid hooks directory path: $path"
                log_error "         Expected: $HOME/.claude/hooks"
                return 1
            fi
            ;;
        user-claude)
            # Must be ~/.claude exactly
            if [ "$path" != "$HOME/.claude" ]; then
                log_error "SAFETY: Invalid claude directory path: $path"
                log_error "         Expected: $HOME/.claude"
                return 1
            fi
            ;;
        project)
            # Must contain .claude/hooks/sidekick
            if [[ ! "$path" =~ /.claude/hooks/sidekick ]]; then
                log_error "SAFETY: Path doesn't match project scope: $path"
                log_error "         Expected: */.claude/hooks/sidekick"
                return 1
            fi
            ;;
        project-sessions)
            # Must be */.sidekick
            if [[ ! "$path" =~ /.sidekick$ ]]; then
                log_error "SAFETY: Path doesn't match project sessions: $path"
                log_error "         Expected: */.sidekick"
                return 1
            fi
            ;;
    esac

    log_verbose "Path validation passed: $path (scope: $scope)"
    return 0
}

# Safe remove file/directory
safe_rm() {
    local path="$1"
    local scope="$2"

    if ! validate_path "$path" "$scope"; then
        log_error "Refusing to remove: $path"
        return 1
    fi

    log_operation "remove" "$path"

    if [ "$DRY_RUN" = false ]; then
        rm -rf "$path"
    fi
}

# Safe remove empty directory
safe_rmdir() {
    local path="$1"
    local scope="$2"

    if ! validate_path "$path" "$scope"; then
        log_error "Refusing to rmdir: $path"
        return 1
    fi

    if [ ! -d "$path" ]; then
        log_verbose "Directory does not exist: $path"
        return 0
    fi

    if [ -n "$(ls -A "$path" 2>/dev/null)" ]; then
        log_verbose "Directory not empty, skipping: $path"
        return 0
    fi

    log_operation "remove empty directory" "$path"

    if [ "$DRY_RUN" = false ]; then
        rmdir "$path"
    fi
}

# Safe find and remove (for selective cleanup)
safe_find_remove() {
    local base_dir="$1"
    local scope="$2"
    local exclude_name="$3"

    if ! validate_path "$base_dir" "$scope"; then
        log_error "Refusing to find/remove in: $base_dir"
        return 1
    fi

    # Show what would be removed
    local items
    items=$(find "$base_dir" -mindepth 1 -maxdepth 1 ! -name "$exclude_name" 2>/dev/null || true)

    if [ -z "$items" ]; then
        log_verbose "No items to remove in: $base_dir (excluding: $exclude_name)"
        return 0
    fi

    while IFS= read -r item; do
        log_operation "remove (find)" "$item"
    done <<< "$items"

    if [ "$DRY_RUN" = false ]; then
        find "$base_dir" -mindepth 1 -maxdepth 1 ! -name "$exclude_name" -exec rm -rf {} +
    fi
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
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --verbose)
                VERBOSE=true
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
  --dry-run   Show what would be deleted without actually deleting
  --verbose   Show detailed output of all operations
  -h, --help  Show this help message

Environment:
  SIDEKICK_SKIP_CONFIRM=1   Skip confirmation prompt (for testing)

Examples:
  uninstall.sh --user --dry-run
  uninstall.sh --user --verbose
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

    if [ "$DRY_RUN" = true ]; then
        log_operation "remove hooks from" "$settings_file"
        return 0
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

    # Remove .sidekick/ entry
    if grep -q "^\.sidekick/" "$ignore_file" 2>/dev/null; then
        grep -v "^\.sidekick/" "$ignore_file" > "$ignore_file.tmp"
        mv "$ignore_file.tmp" "$ignore_file"
        log_info "Removed .sidekick/ entry from .claudeignore"
    fi
}

# Clean up empty settings.json
cleanup_empty_settings() {
    local settings_file="$1"

    if [ ! -f "$settings_file" ]; then
        return 0
    fi

    log_step "Cleaning up empty settings..."

    # Check if settings.json is empty or only has empty hooks
    local is_empty
    is_empty=$(jq -r '
        # Remove empty arrays from hooks
        if .hooks then
            .hooks |= with_entries(select(.value | length > 0))
        else . end |
        # Check if hooks object is now empty
        if (.hooks // {} | length) == 0 then
            del(.hooks)
        else . end |
        # Check if entire object is empty
        if (. | length) == 0 then
            "empty"
        else
            "not_empty"
        end
    ' "$settings_file")

    if [ "$is_empty" = "empty" ]; then
        log_operation "remove empty settings.json" "$settings_file"
        if [ "$DRY_RUN" = false ]; then
            rm -f "$settings_file"
        fi
    else
        log_operation "clean up empty hook arrays in" "$settings_file"
        if [ "$DRY_RUN" = false ]; then
            # Clean up empty hook arrays
            jq '
                if .hooks then
                    .hooks |= with_entries(select(.value | length > 0))
                else . end |
                if (.hooks // {} | length) == 0 then
                    del(.hooks)
                else . end
            ' "$settings_file" > "$settings_file.tmp"
            mv "$settings_file.tmp" "$settings_file"
            log_info "Cleaned up empty hook entries"
        fi
    fi
}

# Clean up empty directories
cleanup_empty_directories() {
    local base_dir="$1"
    local scope="$2"  # "user" or "project"

    # Determine scope suffix for validation
    local hooks_scope
    local claude_scope
    if [ "$scope" = "user" ]; then
        hooks_scope="user-hooks"
        claude_scope="user-claude"
    else
        # For project scope, we can't safely remove parent dirs
        # since we don't control the entire project directory
        log_verbose "Skipping parent directory cleanup for project scope"
        return 0
    fi

    # Remove .claude/hooks if empty
    local hooks_dir="$base_dir/.claude/hooks"
    safe_rmdir "$hooks_dir" "$hooks_scope"

    # Remove .claude if empty
    local claude_dir="$base_dir/.claude"
    safe_rmdir "$claude_dir" "$claude_scope"
}

# Kill running sidekick processes for session
kill_sidekick_processes() {
    local tmp_dir="$1"

    if [ ! -d "$tmp_dir" ]; then
        return 0
    fi

    # Find all PID files
    local pid_files
    pid_files=$(find "$tmp_dir" -name "*.pid" 2>/dev/null || true)

    if [ -z "$pid_files" ]; then
        return 0
    fi

    log_warn "Found running Sidekick processes"

    local pids=()
    while IFS= read -r pid_file; do
        if [ -f "$pid_file" ]; then
            local pid
            pid=$(cat "$pid_file" 2>/dev/null || echo "")
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                pids+=("$pid")
            fi
        fi
    done <<< "$pid_files"

    if [ ${#pids[@]} -eq 0 ]; then
        return 0
    fi

    if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ]; then
        echo "Active processes (PIDs): ${pids[*]}"
        read -p "Kill these processes? (Y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            log_warn "Leaving processes running"
            return 0
        fi
    fi

    # Kill processes
    for pid in "${pids[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            log_info "Killing process $pid..."
            kill -TERM "$pid" 2>/dev/null || true
            sleep 1
            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                kill -KILL "$pid" 2>/dev/null || true
            fi
        fi
    done
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
    local project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
    local project_sessions_dir="$project_dir/.sidekick/sessions"

    # Kill any running processes first
    kill_sidekick_processes "$user_dir/tmp"
    kill_sidekick_processes "$project_sessions_dir"

    # Remove hooks from settings
    if [ -f "$settings_file" ]; then
        remove_hooks_from_settings "$settings_file"
        cleanup_empty_settings "$settings_file"
    fi

    # Check for recent sessions
    if has_recent_sessions "$user_dir/tmp"; then
        log_warn "Found recent session data in $user_dir/tmp"
        if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ] && [ "$DRY_RUN" = false ]; then
            read -p "Preserve tmp directory? (Y/n) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                log_info "Preserving tmp directory"
                # Remove everything except tmp
                safe_find_remove "$user_dir" "user" "tmp"
                log_info "User scope uninstallation complete (tmp preserved)"
                return 0
            fi
        fi
    fi

    # Remove sidekick directory
    if [ -d "$user_dir" ]; then
        safe_rm "$user_dir" "user"
        if [ "$DRY_RUN" = false ]; then
            log_info "Removed $user_dir"
        fi
    else
        log_warn "Sidekick directory not found: $user_dir"
    fi

    # Clean up empty directories
    cleanup_empty_directories "$HOME" "user"

    # Clean up project's .sidekick/sessions directory (user scope stores sessions here)
    local preserve_sessions=false
    if has_recent_sessions "$project_sessions_dir"; then
        log_warn "Found recent session data in $project_sessions_dir"
        if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ] && [ "$DRY_RUN" = false ]; then
            read -p "Preserve .sidekick/sessions directory? (Y/n) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                preserve_sessions=true
            fi
        fi
    fi

    # Handle .sidekick directory
    if [ "$preserve_sessions" = true ]; then
        log_info "Preserving .sidekick/sessions directory"
    else
        # Remove .sidekick directory
        if [ -d "$project_dir/.sidekick" ]; then
            safe_rm "$project_dir/.sidekick" "project-sessions"
            if [ "$DRY_RUN" = false ]; then
                log_info "Removed $project_dir/.sidekick"
            fi
        fi
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
    local project_sessions_dir="$project_dir/.sidekick/sessions"
    local settings_file="$project_dir/.claude/settings.json"

    # Kill any running processes first
    kill_sidekick_processes "$project_sidekick_dir/tmp"
    kill_sidekick_processes "$project_sessions_dir"

    # Remove hooks from settings
    if [ -f "$settings_file" ]; then
        remove_hooks_from_settings "$settings_file"
        cleanup_empty_settings "$settings_file"
    fi

    # Remove .claudeignore entry
    remove_claudeignore_entry "$project_dir"

    # Check for recent sessions in .claude/hooks/sidekick/tmp
    local preserve_tmp=false
    if has_recent_sessions "$project_sidekick_dir/tmp"; then
        log_warn "Found recent session data in $project_sidekick_dir/tmp"
        if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ] && [ "$DRY_RUN" = false ]; then
            read -p "Preserve tmp directory? (Y/n) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                preserve_tmp=true
            fi
        fi
    fi

    # Check for recent sessions in .sidekick/sessions
    local preserve_sessions=false
    if has_recent_sessions "$project_sessions_dir"; then
        log_warn "Found recent session data in $project_sessions_dir"
        if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ] && [ "$DRY_RUN" = false ]; then
            read -p "Preserve .sidekick/sessions directory? (Y/n) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                preserve_sessions=true
            fi
        fi
    fi

    # Handle sidekick directory
    if [ "$preserve_tmp" = true ]; then
        log_info "Preserving tmp directory"
        # Remove everything except tmp
        safe_find_remove "$project_sidekick_dir" "project" "tmp"
    else
        # Remove entire sidekick directory
        if [ -d "$project_sidekick_dir" ]; then
            safe_rm "$project_sidekick_dir" "project"
            if [ "$DRY_RUN" = false ]; then
                log_info "Removed $project_sidekick_dir"
            fi
        fi
    fi

    # Handle .sidekick/sessions directory
    if [ "$preserve_sessions" = true ]; then
        log_info "Preserving .sidekick/sessions directory"
    else
        # Remove .sidekick directory
        if [ -d "$project_dir/.sidekick" ]; then
            safe_rm "$project_dir/.sidekick" "project-sessions"
            if [ "$DRY_RUN" = false ]; then
                log_info "Removed $project_dir/.sidekick"
            fi
        fi
    fi

    # Clean up empty directories
    cleanup_empty_directories "$project_dir" "project"

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
    if [ "$DRY_RUN" = true ]; then
        echo "  - Mode: DRY-RUN (no files will be deleted)"
    fi
    if [ "$VERBOSE" = true ]; then
        echo "  - Verbose output: ENABLED"
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
