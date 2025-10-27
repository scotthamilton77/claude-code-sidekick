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
    local scope="$2"  # "user" or "project"

    log_step "Copying files to $dest_dir..."

    # Preserve existing sidekick.conf if it exists (user scope only)
    local existing_config=""
    if [ "$scope" = "user" ] && [ -f "$dest_dir/sidekick.conf" ]; then
        existing_config=$(mktemp)
        cp "$dest_dir/sidekick.conf" "$existing_config"
        log_debug "Preserved existing sidekick.conf"
    fi

    # Remove old installation to ensure clean copy
    if [ -d "$dest_dir" ]; then
        rm -rf "$dest_dir"
    fi

    # Create destination directory
    mkdir -p "$dest_dir"

    # Copy entire source tree recursively
    cp -r "$SRC_DIR"/* "$dest_dir/"

    # Set executable permissions on all shell scripts
    find "$dest_dir" -type f -name "*.sh" -exec chmod +x {} \;

    # Handle feature selection if specified
    if [ -n "$SELECTED_FEATURES" ]; then
        # Remove all features except selected ones
        IFS=',' read -ra FEATURES <<< "$SELECTED_FEATURES"
        for feature_file in "$dest_dir/features"/*.sh; do
            feature_name=$(basename "$feature_file" .sh)
            # Check if this feature is in the selected list
            found=false
            for selected in "${FEATURES[@]}"; do
                if [ "$feature_name" = "$selected" ]; then
                    found=true
                    break
                fi
            done
            # Remove if not selected
            if [ "$found" = "false" ]; then
                rm -f "$feature_file"
                log_debug "Removed unselected feature: $feature_name"
            fi
        done
    fi

    # Restore or create sidekick.conf (user scope only)
    if [ "$scope" = "user" ]; then
        if [ -n "$existing_config" ] && [ -f "$existing_config" ]; then
            mv "$existing_config" "$dest_dir/sidekick.conf"
            log_info "Preserved existing sidekick.conf"
        else
            cp "$dest_dir/config.defaults" "$dest_dir/sidekick.conf"
            log_info "Created sidekick.conf from defaults"
        fi
    fi

    log_info "Files copied successfully"
}

# Initialize versioned project config
initialize_project_versioned_config() {
    local project_dir="$1"
    local sidekick_dir="$project_dir/.sidekick"
    local config_file="$sidekick_dir/sidekick.conf"
    local readme_file="$sidekick_dir/README.md"

    log_step "Initializing versioned project config..."

    # Create .sidekick directory if it doesn't exist
    mkdir -p "$sidekick_dir"

    # Create sidekick.conf if it doesn't exist (don't overwrite)
    if [ ! -f "$config_file" ]; then
        cp "$SRC_DIR/config.defaults" "$config_file"
        log_info "Created versioned config: $config_file"
        log_info "This file survives install/uninstall and can be committed to git"
    else
        log_info "Preserving existing versioned config: $config_file"
    fi

    # Copy README.md template (always overwrite to get latest docs)
    local readme_template="$SRC_DIR/templates/sidekick-directory-README.md"
    if [ -f "$readme_template" ]; then
        cp "$readme_template" "$readme_file"
        log_info "Copied .sidekick/README.md from template"
    else
        log_warn "README template not found at $readme_template"
    fi
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

# Update .gitignore
update_gitignore() {
    local project_dir="$1"
    local ignore_file="$project_dir/.gitignore"

    log_step "Updating .gitignore..."

    # Create .gitignore if it doesn't exist
    if [ ! -f "$ignore_file" ]; then
        touch "$ignore_file"
    fi

    # Check if our managed section already exists
    if grep -q "^# Sidekick Hook System (managed by scripts/install.sh)" "$ignore_file" 2>/dev/null; then
        log_info ".gitignore already contains Sidekick patterns"
        return 0
    fi

    # Add managed section with markers
    cat >> "$ignore_file" << 'EOF'
# Sidekick Hook System (managed by scripts/install.sh)
# Runtime data - ignored
.sidekick/*.log
.sidekick/sessions/

# Configuration and docs - tracked (do not ignore these)
# .sidekick/sidekick.conf
# .sidekick/README.md
# End Sidekick Hook System
EOF

    log_info "Added Sidekick patterns to .gitignore"
}

# Install to user scope
install_to_user() {
    log_info "Installing to user scope (~/.claude)..."

    local user_dir="$HOME/.claude/hooks/sidekick"
    local settings_file="$HOME/.claude/settings.json"

    # Copy files
    copy_files "$user_dir" "user"

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
    copy_files "$project_sidekick_dir" "project"

    # Initialize versioned project config (.sidekick/sidekick.conf)
    initialize_project_versioned_config "$project_dir"

    # Register hooks (use $CLAUDE_PROJECT_DIR variable in paths)
    register_hooks_in_settings "$settings_file" "\$CLAUDE_PROJECT_DIR/.claude/hooks/sidekick"

    # Update .claudeignore
    update_claudeignore "$project_dir"

    # Update .gitignore
    update_gitignore "$project_dir"

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
