#!/bin/bash

# install-commands.sh
# Copy Claude Code planning commands to user's ~/.claude/commands/ or project's ./.claude/commands/ directory
# Usage: ./install-commands.sh user|project [--target /path] [--backup]

set -euo pipefail

# Check for required parameter
if [[ $# -eq 0 || ( "$1" != "user" && "$1" != "project" ) ]]; then
    echo "Usage: $0 user|project [--target /path] [--backup]"
    echo ""
    echo "Arguments:"
    echo "  user      Install to user's ~/.claude/commands/ directory"  
    echo "  project   Install to current project's ./.claude/commands/ directory"
    echo ""
    echo "Options:"
    echo "  --target /path   For 'project' mode, specify target project directory"
    echo "  --backup         Create backup before installation"
    exit 1
fi

INSTALL_MODE="$1"
shift

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMANDS_SOURCE_DIR="${PROJECT_DIR}/commands"

# Set target directory based on install mode
if [[ "$INSTALL_MODE" == "user" ]]; then
    COMMANDS_TARGET_DIR="${HOME}/.claude/commands"
    INSTALL_TITLE="🚀 Claude Code Commands User-Level Installation"
    INSTALL_SEPARATOR="==============================================="
elif [[ "$INSTALL_MODE" == "project" ]]; then
    # Handle --target option for project mode
    if [[ "${1:-}" == "--target" && -n "${2:-}" ]]; then
        TARGET_PROJECT_DIR="$(cd "$2" && pwd)"
        shift 2
    else
        TARGET_PROJECT_DIR="$(pwd)"
    fi
    COMMANDS_TARGET_DIR="${TARGET_PROJECT_DIR}/.claude/commands"
    INSTALL_TITLE="🏗️  Claude Code Commands Project-Level Installation"
    INSTALL_SEPARATOR="===================================================="
fi

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

print_status $BLUE "$INSTALL_TITLE"
print_status $BLUE "$INSTALL_SEPARATOR"

# Validate source directory exists
if [[ ! -d "$COMMANDS_SOURCE_DIR" ]]; then
    print_status $RED "❌ Error: Commands source directory not found: $COMMANDS_SOURCE_DIR"
    exit 1
fi

# Check for commands in source directory
COMMAND_COUNT=$(find "$COMMANDS_SOURCE_DIR" -name "*.md" -type f | wc -l)
if [[ $COMMAND_COUNT -eq 0 ]]; then
    print_status $RED "❌ Error: No command files (*.md) found in $COMMANDS_SOURCE_DIR"
    exit 1
fi

print_status $BLUE "📁 Source: $COMMANDS_SOURCE_DIR"
if [[ "$INSTALL_MODE" == "project" ]]; then
    print_status $BLUE "📁 Target Project: ${TARGET_PROJECT_DIR:-$(pwd)}"
fi
print_status $BLUE "📁 Target: $COMMANDS_TARGET_DIR"
print_status $BLUE "📋 Found $COMMAND_COUNT command files to install"

# Warn if installing to same project in project mode
if [[ "$INSTALL_MODE" == "project" && "${TARGET_PROJECT_DIR:-$(pwd)}" == "$PROJECT_DIR" ]]; then
    print_status $YELLOW "⚠️  Installing commands to the same project they came from"
    print_status $YELLOW "   This will create ./.claude/commands/ in this project"
fi

# Create target directory if it doesn't exist
if [[ ! -d "$COMMANDS_TARGET_DIR" ]]; then
    if [[ "$INSTALL_MODE" == "user" ]]; then
        print_status $YELLOW "📂 Creating user commands directory: $COMMANDS_TARGET_DIR"
    else
        print_status $YELLOW "📂 Creating project commands directory: $COMMANDS_TARGET_DIR"
    fi
    mkdir -p "$COMMANDS_TARGET_DIR"
fi

# Function to copy commands recursively
copy_commands() {
    local source_dir=$1
    local target_dir=$2
    local relative_path=${3:-""}
    
    for item in "$source_dir"/*; do
        if [[ ! -e "$item" ]]; then
            continue
        fi
        
        local basename=$(basename "$item")
        local target_item="$target_dir/$basename"
        local display_path="${relative_path:+$relative_path/}$basename"
        
        if [[ -d "$item" ]]; then
            # Create directory in target
            mkdir -p "$target_item"
            print_status $BLUE "📁 Created directory: $display_path"
            
            # Recursively copy contents
            copy_commands "$item" "$target_item" "$display_path"
        elif [[ -f "$item" && "$basename" == *.md ]]; then
            # Copy markdown files (commands)
            if [[ -f "$target_item" ]]; then
                print_status $YELLOW "🔄 Overwriting: $display_path"
            else
                print_status $GREEN "📄 Installing: $display_path"
            fi
            cp "$item" "$target_item"
        fi
    done
}

# Backup existing commands if requested
if [[ "${1:-}" == "--backup" ]]; then
    if [[ -d "$COMMANDS_TARGET_DIR" ]]; then
        BACKUP_DIR="${COMMANDS_TARGET_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
        print_status $YELLOW "💾 Creating backup: $BACKUP_DIR"
        cp -r "$COMMANDS_TARGET_DIR" "$BACKUP_DIR"
    fi
fi

# Copy all commands
if [[ "$INSTALL_MODE" == "user" ]]; then
    print_status $BLUE "🔄 Installing user-level commands..."
else
    print_status $BLUE "🔄 Installing project-level commands..."
fi
copy_commands "$COMMANDS_SOURCE_DIR" "$COMMANDS_TARGET_DIR"

# Count installed files
INSTALLED_COUNT=$(find "$COMMANDS_TARGET_DIR" -name "*.md" -type f | wc -l)

if [[ "$INSTALL_MODE" == "user" ]]; then
    print_status $GREEN "✅ User-level installation completed successfully!"
else
    print_status $GREEN "✅ Project-level installation completed successfully!"
fi
print_status $GREEN "📊 Installed $INSTALLED_COUNT command files"

# List installed planning commands
if [[ "$INSTALL_MODE" == "user" ]]; then
    print_status $BLUE "📋 Installed Planning Commands (User-Level):"
    CMD_PREFIX="   /"
    EXAMPLE_CMD="/plan-create \"your project idea\""
else
    print_status $BLUE "📋 Installed Planning Commands (Project-Level):"
    CMD_PREFIX="   /project:"
    EXAMPLE_CMD="/project:plan-create \"your project idea\""
fi

if [[ -d "$COMMANDS_TARGET_DIR/plan" ]]; then
    find "$COMMANDS_TARGET_DIR/plan" -name "*.md" -type f | while read -r cmd; do
        local cmd_name=$(basename "$cmd" .md)
        print_status $GREEN "${CMD_PREFIX}${cmd_name}"
    done
else
    find "$COMMANDS_TARGET_DIR" -name "plan-*.md" -type f | while read -r cmd; do
        local cmd_name=$(basename "$cmd" .md)
        print_status $GREEN "${CMD_PREFIX}${cmd_name}"
    done
fi

print_status $BLUE "✨ Commands are now available in Claude Code!"
print_status $BLUE "   Try: $EXAMPLE_CMD"

# Add .gitignore entry for project mode
if [[ "$INSTALL_MODE" == "project" ]]; then
    TARGET_DIR="${TARGET_PROJECT_DIR:-$(pwd)}"
    GITIGNORE_FILE="${TARGET_DIR}/.gitignore"
    if [[ -f "$GITIGNORE_FILE" ]]; then
        if ! grep -q "^\.claude/" "$GITIGNORE_FILE" 2>/dev/null; then
            print_status $YELLOW "📝 Adding .claude/ to .gitignore"
            echo "" >> "$GITIGNORE_FILE"
            echo "# Claude Code project commands" >> "$GITIGNORE_FILE"
            echo ".claude/" >> "$GITIGNORE_FILE"
        fi
    else
        print_status $YELLOW "📝 Creating .gitignore with .claude/ entry"
        cat > "$GITIGNORE_FILE" << 'EOF'
# Claude Code project commands
.claude/
EOF
    fi
fi

# Show usage information
if [[ "$INSTALL_MODE" == "user" ]]; then
cat << 'EOF'

🔧 Usage:
   ./scripts/install-commands.sh user             # Install to user directory
   ./scripts/install-commands.sh user --backup    # Install with backup

📚 Next Steps:
   1. Ensure Atlas MCP is configured (see mcp.json)
   2. Start with: /plan-create "your project description"  
   3. Follow the workflow: create → decompose → execution-init → status

EOF
else
cat << 'EOF'

🔧 Usage:
   ./scripts/install-commands.sh project                    # Install to current directory
   ./scripts/install-commands.sh project --target /path    # Install to specific project
   ./scripts/install-commands.sh project --backup          # Install with backup

📚 Project-Level Commands:
   /project:plan-create "description"    # Use project-level command explicitly
   /plan-create "description"            # May use project or user level (precedence varies)

🔍 Command Precedence:
   - User-level: ~/.claude/commands/ 
   - Project-level: ./.claude/commands/ (prefix: /project:)

💡 Next Steps:
   1. Ensure Atlas MCP is configured (see mcp.json)
   2. Start with: /project:plan-create "your project description"
   3. Follow workflow: create → decompose → execution-init → status

EOF
fi