#!/bin/bash
# Setup script: Configure permissions for write-topic.sh and write-unclear-topic.sh hooks
# This script intelligently detects whether it's running in user (~/.claude) or project context
# and updates the appropriate settings.json file(s) with required permissions
#
# Usage: setup-reminders.sh [--project]
#   --project: Update ONLY project settings (default: user settings only)

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

# Function to add permissions, hooks, and statusline to a settings file
# Args: $1 = settings file path, $2 = hook script path (absolute), $3 = statusline command, $4 = hooks command prefix
add_permissions() {
    local settings_file="$1"
    local hook_path="$2"
    local statusline_cmd="$3"
    local hooks_cmd_prefix="$4"

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

    # Calculate permissions to add
    local write_topic_perm="Bash(${hook_path}/reminders/write-topic.sh:*)"
    local write_unclear_perm="Bash(${hook_path}/reminders/write-unclear-topic.sh:*)"

    # Calculate hooks commands
    local session_start_cmd="${hooks_cmd_prefix}/hooks/reminders/response-tracker.sh init \"\$CLAUDE_PROJECT_DIR\""
    local prompt_submit_cmd="${hooks_cmd_prefix}/hooks/reminders/response-tracker.sh track \"\$CLAUDE_PROJECT_DIR\""

    # Read current permissions and statusline
    local current_perms=$(jq -r '.permissions.allow // [] | join("\n")' "$settings_file" 2>/dev/null)
    if [ $? -ne 0 ]; then
        log_error "Failed to read permissions from: $settings_file"
        return 1
    fi

    local current_statusline=$(jq -r '.statusLine.command // ""' "$settings_file" 2>/dev/null)
    if [ $? -ne 0 ]; then
        log_error "Failed to read statusline from: $settings_file"
        return 1
    fi

    local current_hooks=$(jq -c '.hooks // {}' "$settings_file" 2>/dev/null)
    if [ $? -ne 0 ]; then
        log_error "Failed to read hooks from: $settings_file"
        return 1
    fi

    # Check if permissions, hooks, and statusline already exist
    local needs_update=false
    if ! echo "$current_perms" | grep -qF "$write_topic_perm"; then
        needs_update=true
    fi
    if ! echo "$current_perms" | grep -qF "$write_unclear_perm"; then
        needs_update=true
    fi
    # Compare statusline by checking if jq finds a match (handles escaping correctly)
    if ! jq -e --arg expected "$statusline_cmd" '.statusLine.command == $expected' "$settings_file" >/dev/null 2>&1; then
        needs_update=true
    fi
    # Check if hooks configuration exists
    if ! jq -e --arg expected "$session_start_cmd" '.hooks.SessionStart[0].hooks[0].command == $expected' "$settings_file" >/dev/null 2>&1; then
        needs_update=true
    fi
    if ! jq -e --arg expected "$prompt_submit_cmd" '.hooks.UserPromptSubmit[0].hooks[0].command == $expected' "$settings_file" >/dev/null 2>&1; then
        needs_update=true
    fi

    if [ "$needs_update" = false ]; then
        log_info "Configuration already up to date"
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

    # Add permissions, hooks, and statusline using jq
    local tmp_file=$(mktemp)
    if ! jq --arg write_topic "$write_topic_perm" \
       --arg write_unclear "$write_unclear_perm" \
       --arg statusline "$statusline_cmd" \
       --arg session_start "$session_start_cmd" \
       --arg prompt_submit "$prompt_submit_cmd" \
       '.permissions.allow += (
           if (.permissions.allow // []) | map(select(. == $write_topic)) | length == 0
           then [$write_topic]
           else []
           end
       ) | .permissions.allow += (
           if (.permissions.allow // []) | map(select(. == $write_unclear)) | length == 0
           then [$write_unclear]
           else []
           end
       ) | .statusLine = {
           "type": "command",
           "command": $statusline
       } | .hooks = {
           "SessionStart": [
               {
                   "hooks": [
                       {
                           "type": "command",
                           "command": $session_start
                       }
                   ]
               }
           ],
           "UserPromptSubmit": [
               {
                   "hooks": [
                       {
                           "type": "command",
                           "command": $prompt_submit
                       }
                   ]
               }
           ]
       }' "$settings_file" > "$tmp_file" 2>/dev/null; then
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

    log_success "Added permissions, hooks, and configured statusline"
}

# Function to update .gitignore with tmp directory
# Args: $1 = project root directory
update_gitignore() {
    local project_root="$1"
    local gitignore="$project_root/.gitignore"
    local cache_entry=".claude/hooks/reminders/tmp/"

    # Check if this is a git repository
    if [ ! -d "$project_root/.git" ]; then
        return 0  # Not a git repo, skip silently
    fi

    log_info "Git repository detected - checking .gitignore"

    # Create .gitignore if it doesn't exist
    if [ ! -f "$gitignore" ]; then
        log_info "Creating .gitignore"
        echo "$cache_entry" > "$gitignore"
        log_success "Added $cache_entry to new .gitignore"
        return 0
    fi

    # Check if entry already exists
    if grep -qF "$cache_entry" "$gitignore"; then
        log_info ".gitignore already contains $cache_entry"
        return 0
    fi

    # Add entry to .gitignore
    echo "$cache_entry" >> "$gitignore"
    log_success "Added $cache_entry to .gitignore"
}

# Detect execution context
detect_and_configure() {
    local user_claude_dir="$HOME/.claude"
    local user_settings="$user_claude_dir/settings.json"
    local user_hooks="$user_claude_dir/hooks"

    # Detect if we're running from within ~/.claude or a project
    if [[ "$PROJECT_ROOT" == "$user_claude_dir"* ]]; then
        log_info "Detected user-scope context (~/.claude)"

        # Configure user settings.json
        if [ -f "$user_settings" ] && [ -d "$user_hooks" ]; then
            local user_statusline='~/.claude/statusline.sh --project-dir "$CLAUDE_PROJECT_DIR"'
            local user_hooks_prefix='~/.claude'
            add_permissions "$user_settings" "$user_hooks" "$user_statusline" "$user_hooks_prefix"
        else
            log_warning "User hooks not found at: $user_hooks"
        fi
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
                    local project_statusline='$CLAUDE_PROJECT_DIR/.claude/statusline.sh --project-dir "$CLAUDE_PROJECT_DIR"'
                    local project_hooks_prefix='$CLAUDE_PROJECT_DIR/.claude'
                    add_permissions "$project_settings" "$project_claude_dir/hooks" "$project_statusline" "$project_hooks_prefix"
                else
                    log_warning "Project hooks not found at: $project_claude_dir/hooks"
                fi
            else
                log_warning "No .claude folder found in project"
            fi

            # Update .gitignore for project-scope contexts
            if [ -n "$PROJECT_ROOT" ]; then
                echo ""
                update_gitignore "$PROJECT_ROOT"
            fi

            log_info "Project-only mode - skipping user settings"
        else
            # Default: configure user ~/.claude/settings.json if hooks exist there
            if [ -f "$user_settings" ] && [ -d "$user_hooks" ]; then
                log_info "Configuring user-scope settings"
                local user_statusline='~/.claude/statusline.sh --project-dir "$CLAUDE_PROJECT_DIR"'
                local user_hooks_prefix='~/.claude'
                add_permissions "$user_settings" "$user_hooks" "$user_statusline" "$user_hooks_prefix"
            else
                log_warning "User settings or hooks not found at: $user_claude_dir"
            fi
        fi
    fi
}

# Main execution function
main() {
    echo ""
    log_info "Claude Hooks Permission Setup"
    echo ""

    detect_and_configure

    echo ""
    log_success "Setup complete!"
    echo ""
    log_info "Configured hooks and permissions for:"
    log_info "  - response-tracker.sh (SessionStart & UserPromptSubmit)"
    log_info "  - write-topic.sh (for clear user intents)"
    log_info "  - write-unclear-topic.sh (for vague requests)"
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
