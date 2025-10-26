#!/bin/bash
# install.sh - Install Sidekick to user and/or project scope
#
# Usage:
#   install.sh [--user|--project|--both] [--features <list>]
#
# Options:
#   --user              Install to ~/.claude only
#   --project           Install to project .claude only
#   --both              Install to both (default)
#   --features <list>   Install specific features only (comma-separated)
#
# Examples:
#   install.sh --user
#   install.sh --project
#   install.sh --both
#   install.sh --user --features topic-extraction,resume

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

# Installation scope
INSTALL_USER=false
INSTALL_PROJECT=false

# Feature selection (empty = all)
SELECTED_FEATURES=""

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
        INSTALL_USER=true
        INSTALL_PROJECT=true
        return
    fi

    while [ $# -gt 0 ]; do
        case "$1" in
            --user)
                INSTALL_USER=true
                shift
                ;;
            --project)
                INSTALL_PROJECT=true
                shift
                ;;
            --both)
                INSTALL_USER=true
                INSTALL_PROJECT=true
                shift
                ;;
            --features)
                SELECTED_FEATURES="$2"
                shift 2
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
    if [ "$INSTALL_USER" = false ] && [ "$INSTALL_PROJECT" = false ]; then
        INSTALL_USER=true
        INSTALL_PROJECT=true
    fi
}

# Show help
show_help() {
    cat <<EOF
Sidekick Installation Script

Usage:
  install.sh [OPTIONS]

Options:
  --user              Install to ~/.claude only
  --project           Install to project .claude only
  --both              Install to both scopes (default)
  --features <list>   Install specific features only (comma-separated)
  -h, --help          Show this help message

Examples:
  install.sh --user
  install.sh --project
  install.sh --both
  install.sh --user --features topic-extraction,resume

EOF
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites..."

    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed. Please install jq first."
        exit 1
    fi

    # Check if source directory exists
    if [ ! -d "$SRC_DIR" ]; then
        log_error "Source directory not found: $SRC_DIR"
        exit 1
    fi

    log_info "Prerequisites check passed"
}

# Copy files to destination
copy_files() {
    local dest_dir="$1"

    log_step "Copying files to $dest_dir..."

    # Create directory structure
    mkdir -p "$dest_dir"
    mkdir -p "$dest_dir/lib"
    mkdir -p "$dest_dir/handlers"
    mkdir -p "$dest_dir/features"
    mkdir -p "$dest_dir/features/prompts"
    mkdir -p "$dest_dir/config"

    # Copy main entry point
    cp "$SRC_DIR/sidekick.sh" "$dest_dir/"
    chmod +x "$dest_dir/sidekick.sh"

    # Copy library (all namespace files)
    cp "$SRC_DIR/lib"/*.sh "$dest_dir/lib/"

    # Copy handlers
    cp "$SRC_DIR/handlers"/*.sh "$dest_dir/handlers/"

    # Copy features (all or selected)
    if [ -n "$SELECTED_FEATURES" ]; then
        # Copy selected features
        IFS=',' read -ra FEATURES <<< "$SELECTED_FEATURES"
        for feature in "${FEATURES[@]}"; do
            if [ -f "$SRC_DIR/features/${feature}.sh" ]; then
                cp "$SRC_DIR/features/${feature}.sh" "$dest_dir/features/"
            else
                log_warn "Feature not found: ${feature}.sh"
            fi
        done
    else
        # Copy all features
        cp "$SRC_DIR/features"/*.sh "$dest_dir/features/"
    fi

    # Copy prompts
    cp "$SRC_DIR/features/prompts"/*.txt "$dest_dir/features/prompts/"

    # Copy scripts (for sleeper-loop, etc.)
    if [ -d "$SRC_DIR/features/scripts" ]; then
        mkdir -p "$dest_dir/features/scripts"
        cp "$SRC_DIR/features/scripts"/*.sh "$dest_dir/features/scripts/"
        chmod +x "$dest_dir/features/scripts"/*.sh
    fi

    # Copy config defaults
    cp "$SRC_DIR/config.defaults" "$dest_dir/"

    # Copy static reminder if it exists
    if [ -f "$SRC_DIR/config/static-reminder.txt" ]; then
        cp "$SRC_DIR/config/static-reminder.txt" "$dest_dir/config/"
    fi

    # Create sidekick.conf if it doesn't exist (don't overwrite)
    if [ ! -f "$dest_dir/sidekick.conf" ]; then
        cp "$SRC_DIR/config.defaults" "$dest_dir/sidekick.conf"
        log_info "Created sidekick.conf from defaults"
    else
        log_info "Preserving existing sidekick.conf"
    fi

    log_info "Files copied successfully"
}

# Register hooks in settings.json
register_hooks_in_settings() {
    local settings_file="$1"
    local sidekick_path="$2"

    log_step "Registering hooks in $settings_file..."

    # Create backup of existing settings
    if [ -f "$settings_file" ]; then
        local backup_file="${settings_file}.backup.$(date +%Y%m%d-%H%M%S)"
        cp "$settings_file" "$backup_file"
        log_info "Backup created: $backup_file"
    fi

    # Create .claude directory if it doesn't exist
    mkdir -p "$(dirname "$settings_file")"

    # Read existing settings or create empty object
    local settings="{}"
    if [ -f "$settings_file" ]; then
        settings=$(cat "$settings_file")
    fi

    # Add hooks using jq
    settings=$(echo "$settings" | jq \
        --arg session_cmd "${sidekick_path}/sidekick.sh session-start \"\$CLAUDE_PROJECT_DIR\"" \
        --arg prompt_cmd "${sidekick_path}/sidekick.sh user-prompt-submit \"\$CLAUDE_PROJECT_DIR\"" \
        --arg status_cmd "${sidekick_path}/sidekick.sh statusline --project-dir \"\$CLAUDE_PROJECT_DIR\"" \
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

    log_info "Hooks registered successfully"
}

# Update .claudeignore
update_claudeignore() {
    local project_dir="$1"
    local ignore_file="$project_dir/.claudeignore"

    log_step "Updating .claudeignore..."

    # Create .claudeignore if it doesn't exist
    if [ ! -f "$ignore_file" ]; then
        touch "$ignore_file"
    fi

    # Add sidekick session state directory if not already present
    if ! grep -q "^\.sidekick/" "$ignore_file" 2>/dev/null; then
        echo ".sidekick/" >> "$ignore_file"
        log_info "Added .sidekick/ to .claudeignore"
    else
        log_info ".claudeignore already contains .sidekick/ directory"
    fi
}

# Install to user scope
install_to_user() {
    log_info "Installing to user scope (~/.claude)..."

    local user_dir="$HOME/.claude/hooks/sidekick"
    local settings_file="$HOME/.claude/settings.json"

    # Copy files
    copy_files "$user_dir"

    # Register hooks
    register_hooks_in_settings "$settings_file" "~/.claude/hooks/sidekick"

    log_info "User scope installation complete"
}

# Install to project scope
install_to_project() {
    log_info "Installing to project scope (.claude)..."

    # Determine project directory (current directory if in a project)
    local project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
    local project_sidekick_dir="$project_dir/.claude/hooks/sidekick"
    local settings_file="$project_dir/.claude/settings.json"

    # Copy files
    copy_files "$project_sidekick_dir"

    # Register hooks (use $CLAUDE_PROJECT_DIR variable in paths)
    register_hooks_in_settings "$settings_file" "\$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick"

    # Update .claudeignore
    update_claudeignore "$project_dir"

    log_info "Project scope installation complete"
}

# Main installation flow
main() {
    echo ""
    echo "=================================================="
    echo "  Sidekick Installation"
    echo "=================================================="
    echo ""

    # Parse arguments
    parse_args "$@"

    # Check prerequisites
    check_prerequisites

    # Show installation plan
    echo ""
    log_info "Installation plan:"
    if [ "$INSTALL_USER" = true ]; then
        echo "  - User scope: ~/.claude/hooks/sidekick"
    fi
    if [ "$INSTALL_PROJECT" = true ]; then
        echo "  - Project scope: .claude/hooks/sidekick"
    fi
    if [ -n "$SELECTED_FEATURES" ]; then
        echo "  - Features: $SELECTED_FEATURES"
    else
        echo "  - Features: all"
    fi
    echo ""

    # Install to user scope
    if [ "$INSTALL_USER" = true ]; then
        install_to_user
        echo ""
    fi

    # Install to project scope
    if [ "$INSTALL_PROJECT" = true ]; then
        install_to_project
        echo ""
    fi

    # Success
    echo "=================================================="
    log_info "Installation complete!"
    echo "=================================================="
    echo ""
    echo "Next steps:"
    echo "  1. Review configuration: cat ~/.claude/hooks/sidekick/sidekick.conf"
    echo "  2. Start a new Claude session to activate hooks"
    echo "  3. Logs will be created in .sidekick/sessions/\${session_id}/sidekick.log on first use"
    echo ""
}

# Run main
main "$@"
