#!/bin/bash
# Cleanup script: Remove reminders hooks, permissions, and statusline configuration
# This script reverses the changes made by setup-reminders.sh, intelligently detecting whether
# it's running in user (~/.claude) or project context and updating the appropriate
# settings.json file(s)
#
# Usage: cleanup-reminders.sh [--project]
#   --project: Cleanup ONLY project settings (default: user settings only)
#
# Note: NOT using set -e to allow graceful error handling per-file

# Determine script location and context
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Color output helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Track backup files for final report
BACKUP_FILES=()

# Parse command line arguments
PROJECT_ONLY=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --project)
            PROJECT_ONLY=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Usage: $0 [--project]"
            exit 1
            ;;
    esac
done

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    log_error "jq is required but not installed. Install with: sudo apt-get install jq (or brew install jq on macOS)"
    exit 1
fi

# Function to remove permissions, hooks, and statusline from a settings file
# Args: $1 = settings file path, $2 = hook script path (absolute), $3 = hooks command prefix
remove_permissions() {
    local settings_file="$1"
    local hook_path="$2"
    local hooks_cmd_prefix="$3"

    if [ ! -f "$settings_file" ]; then
        log_warning "Settings file not found: $settings_file"
        return 1
    fi

    log_info "Processing: $settings_file"

    # Validate JSON structure
    if ! jq empty "$settings_file" 2>/dev/null; then
        log_error "Invalid JSON in: $settings_file"
        log_error "Skipping this file - please fix JSON syntax manually"
        return 1
    fi

    # Calculate permissions to remove
    local write_topic_perm="Bash(${hook_path}/reminders/write-topic.sh:*)"
    local write_unclear_perm="Bash(${hook_path}/reminders/write-unclear-topic.sh:*)"

    # Read current permissions, statusline, and hooks
    local current_perms=$(jq -r '.permissions.allow // [] | join("\n")' "$settings_file" 2>/dev/null)
    if [ $? -ne 0 ]; then
        log_error "Failed to read permissions from: $settings_file"
        return 1
    fi

    local has_statusline=$(jq -r '.statusLine.command // ""' "$settings_file" 2>/dev/null)
    local has_hooks=$(jq -e '.hooks' "$settings_file" >/dev/null 2>&1 && echo "yes" || echo "no")

    # Check if anything needs to be removed
    local needs_update=false
    if echo "$current_perms" | grep -qF "$write_topic_perm"; then
        needs_update=true
    fi
    if echo "$current_perms" | grep -qF "$write_unclear_perm"; then
        needs_update=true
    fi
    if [ -n "$has_statusline" ]; then
        needs_update=true
    fi
    if [ "$has_hooks" = "yes" ]; then
        needs_update=true
    fi

    if [ "$needs_update" = false ]; then
        log_info "No reminders configuration found - already clean"
        return 0
    fi

    # Backup original file with timestamp
    local backup_file="${settings_file}.backup.$(date +%Y%m%d_%H%M%S)"
    if ! cp "$settings_file" "$backup_file" 2>/dev/null; then
        log_error "Failed to create backup of: $settings_file"
        log_error "Check file permissions and disk space"
        return 1
    fi
    BACKUP_FILES+=("$backup_file")
    log_info "Backed up to: $backup_file"

    # Calculate hooks commands to remove (using same prefix format as setup script)
    local session_start_init_cmd="${hooks_cmd_prefix}/hooks/reminders/response-tracker.sh init \"\$CLAUDE_PROJECT_DIR\""
    local session_start_snarkify_cmd="${hooks_cmd_prefix}/hooks/reminders/snarkify-last-session.sh \"\$CLAUDE_PROJECT_DIR\""
    local prompt_submit_cmd="${hooks_cmd_prefix}/hooks/reminders/response-tracker.sh track \"\$CLAUDE_PROJECT_DIR\""

    # Remove permissions, hooks, and statusline using jq (surgical removal)
    local tmp_file=$(mktemp)
    if ! jq --arg write_topic "$write_topic_perm" \
       --arg write_unclear "$write_unclear_perm" \
       --arg session_start_init "$session_start_init_cmd" \
       --arg session_start_snarkify "$session_start_snarkify_cmd" \
       --arg prompt_submit "$prompt_submit_cmd" \
       '
       # Remove specific permissions
       .permissions.allow = (
           (.permissions.allow // [])
           | map(select(. != $write_topic and . != $write_unclear))
       )
       # Remove statusLine
       | del(.statusLine)
       # Surgically remove only our SessionStart hooks
       | if .hooks.SessionStart then
           .hooks.SessionStart = (.hooks.SessionStart | map(select(
               .hooks[0].command != $session_start_init and
               .hooks[0].command != $session_start_snarkify
           ))) |
           if (.hooks.SessionStart | length) == 0 then
               del(.hooks.SessionStart)
           else . end
         else . end
       # Surgically remove only our UserPromptSubmit hooks
       | if .hooks.UserPromptSubmit then
           .hooks.UserPromptSubmit = (.hooks.UserPromptSubmit | map(select(
               .hooks[0].command != $prompt_submit
           ))) |
           if (.hooks.UserPromptSubmit | length) == 0 then
               del(.hooks.UserPromptSubmit)
           else . end
         else . end
       # Remove hooks object entirely if empty
       | if .hooks and (.hooks | length) == 0 then
           del(.hooks)
         else . end
       ' "$settings_file" > "$tmp_file" 2>/dev/null; then
        log_error "Failed to update settings in: $settings_file"
        rm -f "$tmp_file"
        return 1
    fi

    if ! mv "$tmp_file" "$settings_file" 2>/dev/null; then
        log_error "Failed to write updated settings to: $settings_file"
        log_error "Check file permissions - backup preserved at: $backup_file"
        rm -f "$tmp_file"
        return 1
    fi

    log_success "Removed reminders permissions, hooks, and statusline configuration"
}

# Function to remove tmp directory
# Args: $1 = claude directory path
remove_tmp_directory() {
    local claude_dir="$1"
    local tmp_dir="$claude_dir/hooks/reminders/tmp"

    if [ ! -d "$tmp_dir" ]; then
        log_info "No tmp directory found at: $tmp_dir"
        return 0
    fi

    log_info "Removing tmp directory: $tmp_dir"
    if rm -rf "$tmp_dir" 2>/dev/null; then
        log_success "Removed tmp directory"
        return 0
    else
        log_error "Failed to remove tmp directory: $tmp_dir"
        return 1
    fi
}

# Function to remove entire reminders directory (user scope only)
# Args: $1 = claude directory path
remove_reminders_directory() {
    local claude_dir="$1"
    local reminders_dir="$claude_dir/hooks/reminders"

    if [ ! -d "$reminders_dir" ]; then
        log_info "No reminders directory found at: $reminders_dir"
        return 0
    fi

    log_info "Removing reminders directory: $reminders_dir"
    if rm -rf "$reminders_dir" 2>/dev/null; then
        log_success "Removed reminders directory"
        return 0
    else
        log_error "Failed to remove reminders directory: $reminders_dir"
        return 1
    fi
}

# Function to remove statusline.sh file (user scope only)
# Args: $1 = claude directory path
remove_statusline() {
    local claude_dir="$1"
    local statusline_file="$claude_dir/statusline.sh"

    if [ ! -f "$statusline_file" ]; then
        log_info "No statusline.sh found at: $statusline_file"
        return 0
    fi

    log_info "Removing statusline.sh: $statusline_file"
    if rm -f "$statusline_file" 2>/dev/null; then
        log_success "Removed statusline.sh"
        return 0
    else
        log_error "Failed to remove statusline.sh: $statusline_file"
        return 1
    fi
}

# Detect execution context and cleanup
detect_and_cleanup() {
    local user_claude_dir="$HOME/.claude"
    local user_settings="$user_claude_dir/settings.json"
    local user_hooks="$user_claude_dir/hooks"

    # Detect if we're running from within ~/.claude or a project
    if [[ "$PROJECT_ROOT" == "$user_claude_dir"* ]]; then
        log_info "Detected user-scope context (~/.claude)"

        # Cleanup user settings.json
        if [ -f "$user_settings" ] && [ -d "$user_hooks" ]; then
            local user_hooks_prefix='~/.claude'
            remove_permissions "$user_settings" "$user_hooks" "$user_hooks_prefix"
        else
            log_warning "User settings or hooks not found at: $user_claude_dir"
        fi

        # Remove tmp directory
        remove_tmp_directory "$user_claude_dir"

        # Remove entire reminders directory in user scope
        echo ""
        remove_reminders_directory "$user_claude_dir"

        # Remove statusline.sh in user scope
        echo ""
        remove_statusline "$user_claude_dir"
    else
        log_info "Detected project-scope context"

        if [ "$PROJECT_ONLY" = true ]; then
            # Look for project .claude folder
            local project_claude_dir=""
            local project_settings=""

            # Check current directory
            if [ -d "$PROJECT_ROOT/.claude" ]; then
                project_claude_dir="$PROJECT_ROOT/.claude"
            # Check parent directory (in case running from scripts/)
            elif [ -d "$PROJECT_ROOT/../.claude" ]; then
                project_claude_dir="$(cd "$PROJECT_ROOT/../.claude" && pwd)"
                PROJECT_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"
            fi

            if [ -n "$project_claude_dir" ]; then
                # Try settings.local.json first, then settings.json
                if [ -f "$project_claude_dir/settings.local.json" ]; then
                    project_settings="$project_claude_dir/settings.local.json"
                elif [ -f "$project_claude_dir/settings.json" ]; then
                    project_settings="$project_claude_dir/settings.json"
                fi

                if [ -n "$project_settings" ] && [ -d "$project_claude_dir/hooks" ]; then
                    local project_hooks_prefix='$CLAUDE_PROJECT_DIR/.claude'
                    remove_permissions "$project_settings" "$project_claude_dir/hooks" "$project_hooks_prefix"
                else
                    log_warning "Project hooks not found at: $project_claude_dir/hooks"
                fi

                # Remove tmp directory in project scope
                echo ""
                remove_tmp_directory "$project_claude_dir"
            else
                log_warning "No .claude folder found in project"
            fi

            log_info "Project-only mode - skipping user settings"
        else
            # Default: cleanup user ~/.claude/settings.json if hooks exist there
            if [ -f "$user_settings" ] && [ -d "$user_hooks" ]; then
                log_info "Cleaning up user-scope settings"
                local user_hooks_prefix='~/.claude'
                remove_permissions "$user_settings" "$user_hooks" "$user_hooks_prefix"
            else
                log_warning "User settings or hooks not found at: $user_claude_dir"
            fi

            # Remove tmp directory
            echo ""
            remove_tmp_directory "$user_claude_dir"

            # Remove entire reminders directory in user scope
            echo ""
            remove_reminders_directory "$user_claude_dir"

            # Remove statusline.sh in user scope
            echo ""
            remove_statusline "$user_claude_dir"
        fi
    fi
}

# Main execution function
main() {
    echo ""
    log_info "Claude Reminders Cleanup"
    echo ""

    detect_and_cleanup

    echo ""
    log_success "Cleanup complete!"
    echo ""
    log_info "Removed configuration for:"
    log_info "  - response-tracker.sh init (SessionStart hook)"
    log_info "  - snarkify-last-session.sh (SessionStart hook)"
    log_info "  - response-tracker.sh track (UserPromptSubmit hook)"
    log_info "  - write-topic.sh permissions"
    log_info "  - write-unclear-topic.sh permissions"
    log_info "  - statusline configuration"
    if [ "$PROJECT_ONLY" = false ]; then
        log_info "  - reminders directory (user scope only)"
        log_info "  - statusline.sh file (user scope only)"
    fi
    echo ""

    # Report backup files if any were created
    if [ ${#BACKUP_FILES[@]} -gt 0 ]; then
        log_info "Backup files created:"
        for backup in "${BACKUP_FILES[@]}"; do
            echo "  - $backup"
        done
        echo ""
    fi
}

# Only run main if executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi
