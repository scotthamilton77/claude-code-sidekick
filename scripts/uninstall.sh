#!/bin/bash
# uninstall.sh - Uninstall Sidekick from user and/or project scope
#
# Usage:
#   uninstall.sh [--user|--project|--both] [--dry-run] [--verbose] [--force]
#
# Options:
#   --user      Uninstall from ~/.claude only
#   --project   Uninstall from project .claude only
#   --both      Uninstall from both (default)
#   --dry-run   Show what would be deleted without actually deleting
#   --verbose   Show detailed output of all operations
#   --force     Force uninstall even if not detected as installed (skip all prompts)
#
# Environment:
#   SIDEKICK_SKIP_CONFIRM=1   Skip confirmation prompt (for testing)
#
# Examples:
#   uninstall.sh --user --dry-run
#   uninstall.sh --user --verbose
#   uninstall.sh --project
#   uninstall.sh --user --force
#   SIDEKICK_SKIP_CONFIRM=1 uninstall.sh --user

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$PROJECT_ROOT/src/sidekick"

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
FORCE=false

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
            --force)
                FORCE=true
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
  --force     Force uninstall even if not detected as installed (skip all prompts)
  -h, --help  Show this help message

Environment:
  SIDEKICK_SKIP_CONFIRM=1   Skip confirmation prompt (for testing)

Examples:
  uninstall.sh --user --dry-run
  uninstall.sh --user --verbose
  uninstall.sh --project
  uninstall.sh --user --force
  SIDEKICK_SKIP_CONFIRM=1 uninstall.sh --user

EOF
}

# Check if Sidekick is installed in the specified scope
# Args: $1 - scope ("user" or "project")
# Returns: 0 if installed, 1 if not installed
is_installed() {
    local scope="$1"

    case "$scope" in
        user)
            [ -d "$HOME/.claude/hooks/sidekick" ]
            ;;
        project)
            local project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
            [ -d "$project_dir/.claude/hooks/sidekick" ]
            ;;
        *)
            log_error "Unknown scope: $scope"
            return 1
            ;;
    esac
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
        if .hooks.PostToolUse then
            .hooks.PostToolUse = [.hooks.PostToolUse[] |
                select(.hooks[0].command | contains("sidekick") | not)]
        else . end |
        if .hooks.Stop then
            .hooks.Stop = [.hooks.Stop[] |
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

    # Preserve .claudeignore modifications (harmless ignore patterns)
    if [ -f "$ignore_file" ] && grep -q "^\.sidekick/" "$ignore_file" 2>/dev/null; then
        log_verbose "Preserving .claudeignore entry (harmless ignore pattern)"
    fi
    return 0
}

# Remove .gitignore entry
remove_gitignore_entry() {
    local project_dir="$1"
    local ignore_file="$project_dir/.gitignore"

    # Preserve .gitignore modifications (harmless ignore patterns)
    if [ -f "$ignore_file" ] && grep -q "^# Sidekick Hook System" "$ignore_file" 2>/dev/null; then
        log_verbose "Preserving .gitignore entries (harmless ignore patterns)"
    fi
    return 0
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

    log_step "Cleaning up empty directories..."

    if [ "$scope" = "user" ]; then
        # User scope: Clean up ~/.claude hierarchy
        local hooks_dir="$base_dir/.claude/hooks"
        safe_rmdir "$hooks_dir" "user-hooks"

        local claude_dir="$base_dir/.claude"
        safe_rmdir "$claude_dir" "user-claude"
    else
        # Project scope: Only clean up .claude/hooks if empty
        # We can safely remove .claude/hooks since it's specifically for hooks
        local project_hooks_dir="$base_dir/.claude/hooks"
        if [ -d "$project_hooks_dir" ]; then
            if [ -z "$(ls -A "$project_hooks_dir" 2>/dev/null)" ]; then
                log_operation "remove empty directory" "$project_hooks_dir"
                if [ "$DRY_RUN" = false ]; then
                    rmdir "$project_hooks_dir"
                    log_info "Removed empty directory: $project_hooks_dir"
                fi
            else
                log_verbose "Directory not empty, skipping: $project_hooks_dir"
            fi
        fi

        # Also try to remove .claude if now empty
        local project_claude_dir="$base_dir/.claude"
        if [ -d "$project_claude_dir" ]; then
            if [ -z "$(ls -A "$project_claude_dir" 2>/dev/null)" ]; then
                log_operation "remove empty directory" "$project_claude_dir"
                if [ "$DRY_RUN" = false ]; then
                    rmdir "$project_claude_dir"
                    log_info "Removed empty directory: $project_claude_dir"
                fi
            else
                log_verbose "Directory not empty, skipping: $project_claude_dir"
            fi
        fi
    fi
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

# Check if sessions directory has recent sessions
has_recent_sessions() {
    local sessions_dir="$1"

    if [ ! -d "$sessions_dir" ]; then
        return 1
    fi

    # Check if any session directory modified in last 7 days
    local recent_count
    recent_count=$(find "$sessions_dir" -mindepth 1 -maxdepth 1 -type d -mtime -7 2>/dev/null | wc -l)

    [ "$recent_count" -gt 0 ]
}

# Check if versioned config differs from defaults
# Returns 0 if different, 1 if same or doesn't exist
# Uses SRC_DIR global variable for config.defaults location
versioned_config_differs_from_defaults() {
    local versioned_config="$1"

    if [ ! -f "$versioned_config" ]; then
        return 1  # Doesn't exist, so not different
    fi

    local defaults="${SRC_DIR}/config.defaults"
    if [ ! -f "$defaults" ]; then
        log_warn "Cannot compare: config.defaults not found at $defaults"
        return 0  # Assume different if can't compare
    fi

    # Compare SHA256 hashes
    local hash_versioned hash_defaults
    hash_versioned=$(sha256sum "$versioned_config" | awk '{print $1}')
    hash_defaults=$(sha256sum "$defaults" | awk '{print $1}')

    if [ "$hash_versioned" = "$hash_defaults" ]; then
        return 1  # Same
    else
        return 0  # Different
    fi
}

# Check if a custom file matches its template in the same directory or source
# Returns 0 if matches template or source, 1 if different
custom_file_matches_template() {
    local custom_file="$1"
    local custom_basename
    custom_basename=$(basename "$custom_file")
    local template_file="${custom_file}.template"

    if [ ! -f "$custom_file" ]; then
        return 1  # File doesn't exist
    fi

    # Get hash of custom file
    local hash_custom
    hash_custom=$(sha256sum "$custom_file" | awk '{print $1}')

    # Check 1: Compare with .template file in same directory
    if [ -f "$template_file" ]; then
        local hash_template
        hash_template=$(sha256sum "$template_file" | awk '{print $1}')
        if [ "$hash_custom" = "$hash_template" ]; then
            return 0  # Matches template
        fi
    fi

    # Check 2: Compare with source file (for renamed templates)
    local source_file="${SRC_DIR}/reminders/${custom_basename}"
    if [ -f "$source_file" ]; then
        local hash_source
        hash_source=$(sha256sum "$source_file" | awk '{print $1}')
        if [ "$hash_custom" = "$hash_source" ]; then
            return 0  # Matches source
        fi
    fi

    return 1  # Different from both template and source
}

# Check for custom reminder files (non-template files)
# Returns 0 if custom reminders exist, 1 if none found
# Files that match their templates are not considered custom
has_custom_reminders() {
    local reminders_dir="$1"

    if [ ! -d "$reminders_dir" ]; then
        return 1
    fi

    # Check for any non-template files that differ from their templates
    local custom_count=0
    while IFS= read -r custom_file; do
        if [ -f "$custom_file" ]; then
            # If file matches its template, don't count it as custom
            if ! custom_file_matches_template "$custom_file"; then
                custom_count=$((custom_count + 1))
            fi
        fi
    done < <(find "$reminders_dir" -mindepth 1 -maxdepth 1 -type f ! -name "*.template" 2>/dev/null || true)

    [ "$custom_count" -gt 0 ]
}

# Check if a reminder template differs from source
# Returns 0 if different, 1 if same or doesn't exist
reminder_template_differs_from_source() {
    local template_file="$1"
    local template_name
    template_name=$(basename "$template_file")

    if [ ! -f "$template_file" ]; then
        return 1  # Doesn't exist
    fi

    # Strip .template extension to find source file
    # Templates are created as: source.txt -> source.txt.template
    local source_name="${template_name%.template}"
    local source_file="${SRC_DIR}/reminders/${source_name}"

    if [ ! -f "$source_file" ]; then
        # No source file to compare against, assume it's custom
        log_verbose "No source file found for template: $template_name"
        return 0
    fi

    # Compare SHA256 hashes
    local hash_template hash_source
    hash_template=$(sha256sum "$template_file" | awk '{print $1}')
    hash_source=$(sha256sum "$source_file" | awk '{print $1}')

    if [ "$hash_template" = "$hash_source" ]; then
        return 1  # Same
    else
        return 0  # Different
    fi
}

# Check if a modular config template differs from source defaults
# Returns 0 if different, 1 if same or doesn't exist
# Modular templates: config.conf.template, llm-core.conf.template, etc.
modular_template_differs_from_defaults() {
    local template_file="$1"
    local template_name
    template_name=$(basename "$template_file")

    if [ ! -f "$template_file" ]; then
        return 1  # Doesn't exist
    fi

    # Extract module name from template
    # E.g., "config.conf.template" -> "config"
    local module_name="${template_name%.conf.template}"

    # If we couldn't extract a valid module name, it's not a modular template
    if [ "$module_name" = "$template_name" ] || [ -z "$module_name" ]; then
        log_verbose "Not a modular config template: $template_name"
        return 0  # Assume different
    fi

    # Find corresponding .defaults file
    local defaults_file="${SRC_DIR}/${module_name}.defaults"

    if [ ! -f "$defaults_file" ]; then
        log_verbose "No defaults file found for template: $template_name (expected: $defaults_file)"
        return 0  # Assume different if can't compare
    fi

    # Compare SHA256 hashes
    local hash_template hash_defaults
    hash_template=$(sha256sum "$template_file" | awk '{print $1}')
    hash_defaults=$(sha256sum "$defaults_file" | awk '{print $1}')

    if [ "$hash_template" = "$hash_defaults" ]; then
        return 1  # Same
    else
        return 0  # Different
    fi
}

# Handle .sidekick directory cleanup with user prompts
# Handles sessions, logs, config templates, and reminders based on user choices
handle_sidekick_cleanup() {
    local sidekick_dir="$1"
    local sessions_dir="$sidekick_dir/sessions"
    local versioned_config="$sidekick_dir/sidekick.conf"
    local config_template="$sidekick_dir/sidekick.conf.template"
    local reminders_dir="$sidekick_dir/reminders"

    if [ ! -d "$sidekick_dir" ]; then
        log_verbose "Sidekick directory does not exist: $sidekick_dir"
        return 0
    fi

    log_step "Cleaning up $sidekick_dir..."

    # 1. Primary decision: remove .sidekick directory?
    local remove_sidekick=true
    if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ] && [ "$DRY_RUN" = false ]; then
        log_warn "The .sidekick directory contains session data and configuration"
        read -p "Remove $sidekick_dir and its contents? (Y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            remove_sidekick=false
            log_info "Preserving .sidekick directory"
            return 0
        fi
    fi

    # If user chose not to remove .sidekick, preserve everything
    if [ "$remove_sidekick" = false ]; then
        return 0
    fi

    # Track what to preserve (within removal decision)
    local preserve_config=false
    local preserve_custom_reminders=false

    # 2. Check versioned config and prompt if customized
    if [ -f "$versioned_config" ]; then
        if versioned_config_differs_from_defaults "$versioned_config"; then
            log_warn "Config is customized: $versioned_config"
            if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ] && [ "$DRY_RUN" = false ]; then
                read -p "Preserve customized config file? (Y/n) " -n 1 -r
                echo
                if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                    preserve_config=true
                fi
            fi
        else
            log_verbose "Config is identical to defaults, will remove"
        fi
    fi

    # 3. Check for custom reminders and prompt
    if has_custom_reminders "$reminders_dir"; then
        log_warn "Found custom reminders (non-template files) in $reminders_dir"
        if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ] && [ "$DRY_RUN" = false ]; then
            read -p "Preserve custom reminder files? (Y/n) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                preserve_custom_reminders=true
            fi
        fi
    fi

    # 4. Perform cleanup
    # Always remove log files (ephemeral)
    if [ -n "$(find "$sidekick_dir" -maxdepth 1 -name "*.log" 2>/dev/null)" ]; then
        log_operation "remove" "$sidekick_dir/*.log files"
        if [ "$DRY_RUN" = false ]; then
            rm -f "$sidekick_dir"/*.log
        fi
    fi

    # Always remove sessions (ephemeral data)
    if [ -d "$sessions_dir" ]; then
        log_operation "remove" "$sessions_dir"
        if [ "$DRY_RUN" = false ]; then
            rm -rf "$sessions_dir"
        fi
    fi

    # Handle reminders directory
    if [ -d "$reminders_dir" ]; then
        # Always remove template files (they're defaults, not custom)
        local templates_found=false
        for template_file in "$reminders_dir"/*.template; do
            if [ -f "$template_file" ]; then
                templates_found=true
                # Check if modified from source
                if reminder_template_differs_from_source "$template_file"; then
                    log_warn "Template was modified: $(basename "$template_file")"
                    if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ] && [ "$DRY_RUN" = false ]; then
                        read -p "Remove modified template? (Y/n) " -n 1 -r
                        echo
                        if [[ $REPLY =~ ^[Nn]$ ]]; then
                            log_info "Preserving modified template: $(basename "$template_file")"
                            continue
                        fi
                    fi
                fi
                log_operation "remove" "$template_file"
                if [ "$DRY_RUN" = false ]; then
                    rm -f "$template_file"
                fi
            fi
        done

        # Remove custom reminders unless preserved
        if [ "$preserve_custom_reminders" = false ]; then
            # Remove non-template files
            for reminder_file in "$reminders_dir"/*; do
                if [ -f "$reminder_file" ] && [[ ! "$reminder_file" =~ \.template$ ]]; then
                    log_operation "remove" "$reminder_file"
                    if [ "$DRY_RUN" = false ]; then
                        rm -f "$reminder_file"
                    fi
                fi
            done
        else
            # Still remove files that match their templates (not truly custom)
            for reminder_file in "$reminders_dir"/*; do
                if [ -f "$reminder_file" ] && [[ ! "$reminder_file" =~ \.template$ ]]; then
                    if custom_file_matches_template "$reminder_file"; then
                        log_verbose "Removing non-custom file (matches template): $(basename "$reminder_file")"
                        log_operation "remove" "$reminder_file"
                        if [ "$DRY_RUN" = false ]; then
                            rm -f "$reminder_file"
                        fi
                    fi
                fi
            done
            log_info "Preserving custom reminder files"
        fi

        # Remove reminders directory if empty
        if [ "$DRY_RUN" = false ]; then
            if [ -d "$reminders_dir" ] && [ -z "$(ls -A "$reminders_dir" 2>/dev/null)" ]; then
                log_operation "remove empty directory" "$reminders_dir"
                rmdir "$reminders_dir"
            fi
        fi
    fi

    # Remove versioned config unless preserved
    if [ "$preserve_config" = false ] && [ -f "$versioned_config" ]; then
        log_operation "remove" "$versioned_config"
        if [ "$DRY_RUN" = false ]; then
            rm -f "$versioned_config"
        fi
    elif [ "$preserve_config" = true ]; then
        log_info "Preserving versioned config: $versioned_config"
    fi

    # Always remove config template (it's a defaults copy, not custom)
    if [ -f "$config_template" ]; then
        # Check if template was modified from defaults
        if versioned_config_differs_from_defaults "$config_template"; then
            log_warn "Config template was modified: $config_template"
            if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ] && [ "$DRY_RUN" = false ]; then
                read -p "Remove modified config template? (Y/n) " -n 1 -r
                echo
                if [[ $REPLY =~ ^[Nn]$ ]]; then
                    log_info "Preserving modified config template"
                else
                    log_operation "remove" "$config_template"
                    rm -f "$config_template"
                fi
            else
                log_operation "remove" "$config_template"
                if [ "$DRY_RUN" = false ]; then
                    rm -f "$config_template"
                fi
            fi
        else
            log_operation "remove" "$config_template"
            if [ "$DRY_RUN" = false ]; then
                rm -f "$config_template"
            fi
        fi
    fi

    # Handle modular config templates (config.conf.template, llm-core.conf.template, etc.)
    # These are always defaults copies, remove unless modified
    local modular_templates=("config.conf.template" "llm-core.conf.template" "llm-providers.conf.template" "features.conf.template")
    for template_name in "${modular_templates[@]}"; do
        local template_file="$sidekick_dir/$template_name"
        if [ -f "$template_file" ]; then
            # Check if template was modified from defaults
            if modular_template_differs_from_defaults "$template_file"; then
                log_warn "Modular template was modified: $template_name"
                if [ "${SIDEKICK_SKIP_CONFIRM:-0}" != "1" ] && [ "$DRY_RUN" = false ]; then
                    read -p "Remove modified template $template_name? (Y/n) " -n 1 -r
                    echo
                    if [[ $REPLY =~ ^[Nn]$ ]]; then
                        log_info "Preserving modified template: $template_name"
                        continue
                    fi
                fi
            fi
            # Remove template (either unmodified or user agreed to remove)
            log_operation "remove" "$template_file"
            if [ "$DRY_RUN" = false ]; then
                rm -f "$template_file"
            fi
        fi
    done

    # Always remove README.md (it's documentation, not custom)
    if [ -f "$sidekick_dir/README.md" ]; then
        log_operation "remove" "$sidekick_dir/README.md"
        if [ "$DRY_RUN" = false ]; then
            rm -f "$sidekick_dir/README.md"
        fi
    fi

    # Remove prompts directory if it exists (templates)
    if [ -d "$sidekick_dir/prompts" ]; then
        log_operation "remove" "$sidekick_dir/prompts"
        if [ "$DRY_RUN" = false ]; then
            rm -rf "$sidekick_dir/prompts"
        fi
    fi

    # Remove .sidekick directory if now empty
    if [ "$DRY_RUN" = false ]; then
        if [ -d "$sidekick_dir" ] && [ -z "$(ls -A "$sidekick_dir" 2>/dev/null)" ]; then
            log_operation "remove empty directory" "$sidekick_dir"
            rmdir "$sidekick_dir"
        fi
    fi

    log_info ".sidekick cleanup complete"
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
    kill_sidekick_processes "$project_sessions_dir"

    # Remove hooks from settings
    if [ -f "$settings_file" ]; then
        remove_hooks_from_settings "$settings_file"
        cleanup_empty_settings "$settings_file"
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

    # Clean up user-persistent .sidekick directory (with prompts for config/templates)
    if [ -d "$HOME/.sidekick" ]; then
        handle_sidekick_cleanup "$HOME/.sidekick"
    fi

    # Clean up project's .claudeignore entry
    remove_claudeignore_entry "$project_dir"

    # Clean up project's .gitignore entry
    remove_gitignore_entry "$project_dir"

    # Clean up project's .sidekick directory (with prompts for sessions/config)
    if [ -d "$project_dir/.sidekick" ]; then
        handle_sidekick_cleanup "$project_dir/.sidekick"
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
    kill_sidekick_processes "$project_sessions_dir"

    # Remove hooks from settings
    if [ -f "$settings_file" ]; then
        remove_hooks_from_settings "$settings_file"
        cleanup_empty_settings "$settings_file"
    fi

    # Remove .claudeignore entry
    remove_claudeignore_entry "$project_dir"

    # Remove .gitignore entry
    remove_gitignore_entry "$project_dir"

    # Handle sidekick directory
    if [ -d "$project_sidekick_dir" ]; then
        safe_rm "$project_sidekick_dir" "project"
        if [ "$DRY_RUN" = false ]; then
            log_info "Removed $project_sidekick_dir"
        fi
    fi

    # Clean up .sidekick directory (with prompts for sessions/config)
    if [ -d "$project_dir/.sidekick" ]; then
        handle_sidekick_cleanup "$project_dir/.sidekick"
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

    # If force mode, skip all confirmations
    if [ "$FORCE" = true ]; then
        export SIDEKICK_SKIP_CONFIRM=1
    fi

    # Check if anything is installed (skip check if force mode)
    local user_installed=false
    local project_installed=false

    if [ "$FORCE" = true ]; then
        # Force mode: always proceed regardless of installation status
        if [ "$UNINSTALL_USER" = true ]; then
            user_installed=true
        fi
        if [ "$UNINSTALL_PROJECT" = true ]; then
            project_installed=true
        fi
    else
        # Normal mode: check installation status
        if [ "$UNINSTALL_USER" = true ] && is_installed "user"; then
            user_installed=true
        fi

        if [ "$UNINSTALL_PROJECT" = true ] && is_installed "project"; then
            project_installed=true
        fi

        # If nothing is installed, just say so and exit
        if [ "$user_installed" = false ] && [ "$project_installed" = false ]; then
            log_info "No Sidekick features are installed."
            if [ "$UNINSTALL_USER" = true ] && [ "$UNINSTALL_PROJECT" = true ]; then
                echo "  - User scope: Not installed"
                echo "  - Project scope: Not installed"
            elif [ "$UNINSTALL_USER" = true ]; then
                echo "  - User scope: Not installed"
            else
                echo "  - Project scope: Not installed"
            fi
            echo ""
            return 0
        fi
    fi

    # Show uninstallation plan
    echo ""
    log_info "Uninstallation plan:"
    if [ "$UNINSTALL_USER" = true ]; then
        if [ "$FORCE" = true ]; then
            echo "  - User scope: ~/.claude/hooks/sidekick (force mode)"
        elif [ "$user_installed" = true ]; then
            echo "  - User scope: ~/.claude/hooks/sidekick (installed)"
        else
            echo "  - User scope: ~/.claude/hooks/sidekick (not installed, skipping)"
        fi
    fi
    if [ "$UNINSTALL_PROJECT" = true ]; then
        if [ "$FORCE" = true ]; then
            echo "  - Project scope: .claude/hooks/sidekick (force mode)"
        elif [ "$project_installed" = true ]; then
            echo "  - Project scope: .claude/hooks/sidekick (installed)"
        else
            echo "  - Project scope: .claude/hooks/sidekick (not installed, skipping)"
        fi
    fi
    if [ "$DRY_RUN" = true ]; then
        echo "  - Mode: DRY-RUN (no files will be deleted)"
    fi
    if [ "$VERBOSE" = true ]; then
        echo "  - Verbose output: ENABLED"
    fi
    if [ "$FORCE" = true ]; then
        echo "  - Force mode: ENABLED (skip checks, skip confirmations)"
    fi
    echo ""

    # Uninstall from user scope (only if installed or force mode)
    if [ "$UNINSTALL_USER" = true ] && [ "$user_installed" = true ]; then
        uninstall_from_user || true
        echo ""
    fi

    # Uninstall from project scope (only if installed or force mode)
    if [ "$UNINSTALL_PROJECT" = true ] && [ "$project_installed" = true ]; then
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
