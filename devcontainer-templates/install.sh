#!/bin/bash
set -e

# ============================================================================
# DevContainer Template Installer
# ============================================================================
# Installs devcontainer templates with configuration options
#
# Usage:
#   ./install.sh [options]
#   ./install.sh --interactive
#   ./install.sh --template node-typescript --target ~/my-project
#   ./install.sh --dry-run
#
# See --help for full usage
# ============================================================================

# Script directory (where templates are located)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default configuration file
CONFIG_FILE="${SCRIPT_DIR}/install.conf"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Flags
DRY_RUN=false
INTERACTIVE=false
VERBOSE=false

# ============================================================================
# Utility Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1" >&2
}

log_verbose() {
    if [ "$VERBOSE" = "true" ]; then
        echo -e "${CYAN}→${NC} $1"
    fi
}

log_dry_run() {
    if [ "$DRY_RUN" = "true" ]; then
        echo -e "${CYAN}[DRY RUN]${NC} $1"
    fi
}

show_help() {
    cat << EOF
DevContainer Template Installer

Usage:
  $(basename "$0") [options]

Options:
  -h, --help                Show this help message
  -i, --interactive         Interactive mode (guided setup)
  -d, --dry-run            Preview actions without making changes
  -v, --verbose            Verbose output

Target:
  -t, --target DIR         Target directory (default: current directory)
  --template NAME          Template to install (base, node-typescript,
                          node-typescript-postgres, node-ai-stack)

Configuration:
  -c, --config FILE        Configuration file (default: install.conf)
  --host-username NAME     Host username for mounts
  --host-home PATH         Host home directory

Features (node-ai-stack):
  --claude-code           Install Claude Code CLI
  --gemini-cli            Install Gemini CLI
  --codex-cli             Install OpenAI Codex CLI
  --uv                    Install uv (Python package manager)
  --specify-cli           Install specify-cli
  --mount-claude          Mount Claude configuration
  --mount-oss             Mount OSS projects
  --mount-docker          Mount Docker socket (SECURITY WARNING)

Database (postgres templates):
  --db-host HOST          PostgreSQL host
  --db-port PORT          PostgreSQL port
  --db-name NAME          Database name
  --db-user USER          Database user
  --db-password PASS      Database password
  --db-network NET        Docker network name

Options:
  --no-env                Don't create .env file
  --no-gitignore          Don't update .gitignore
  --no-backup             Don't backup existing .devcontainer
  --skip-validation       Skip validation checks

Examples:
  # Interactive mode (recommended for first-time users)
  $(basename "$0") --interactive

  # Quick install with defaults
  $(basename "$0") --template node-typescript

  # Install to specific directory
  $(basename "$0") --template node-ai-stack --target ~/my-project

  # Full AI stack with features
  $(basename "$0") --template node-ai-stack --claude-code --uv --mount-claude

  # Dry run to preview changes
  $(basename "$0") --template node-typescript-postgres --dry-run

  # Use custom config file
  $(basename "$0") --config my-install.conf --target ~/project

EOF
}

# ============================================================================
# Configuration Loading
# ============================================================================

load_config() {
    if [ -f "$CONFIG_FILE" ]; then
        log_verbose "Loading configuration from: $CONFIG_FILE"
        # Source config file, ignoring comments and empty lines
        while IFS='=' read -r key value; do
            # Skip comments and empty lines
            [[ "$key" =~ ^[[:space:]]*# ]] && continue
            [[ -z "$key" ]] && continue

            # Remove leading/trailing whitespace and quotes
            key=$(echo "$key" | xargs)
            value=$(echo "$value" | xargs | sed 's/^"//;s/"$//')

            # Export as environment variable
            export "$key=$value"
        done < "$CONFIG_FILE"
        log_verbose "Configuration loaded successfully"
    else
        log_warning "Configuration file not found: $CONFIG_FILE"
        log_info "Using default values"
    fi
}

# ============================================================================
# Argument Parsing
# ============================================================================

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -i|--interactive)
                INTERACTIVE=true
                shift
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -t|--target)
                TARGET_DIR="$2"
                shift 2
                ;;
            --template)
                TEMPLATE="$2"
                shift 2
                ;;
            -c|--config)
                CONFIG_FILE="$2"
                shift 2
                ;;
            --host-username)
                HOST_USERNAME="$2"
                shift 2
                ;;
            --host-home)
                HOST_HOME="$2"
                shift 2
                ;;
            --claude-code)
                INSTALL_CLAUDE_CODE="true"
                shift
                ;;
            --gemini-cli)
                INSTALL_GEMINI_CLI="true"
                shift
                ;;
            --codex-cli)
                INSTALL_CODEX_CLI="true"
                shift
                ;;
            --uv)
                INSTALL_UV="true"
                shift
                ;;
            --specify-cli)
                INSTALL_SPECIFY_CLI="true"
                shift
                ;;
            --mount-claude)
                MOUNT_CLAUDE_CONFIG="true"
                shift
                ;;
            --mount-oss)
                MOUNT_OSS_PROJECTS="true"
                shift
                ;;
            --mount-docker)
                MOUNT_DOCKER_SOCKET="true"
                shift
                ;;
            --db-host)
                POSTGRES_HOST="$2"
                shift 2
                ;;
            --db-port)
                POSTGRES_PORT="$2"
                shift 2
                ;;
            --db-name)
                POSTGRES_DB="$2"
                shift 2
                ;;
            --db-user)
                POSTGRES_USER="$2"
                shift 2
                ;;
            --db-password)
                POSTGRES_PASSWORD="$2"
                shift 2
                ;;
            --db-network)
                DOCKER_NETWORK="$2"
                shift 2
                ;;
            --no-env)
                CREATE_ENV_FILE="false"
                shift
                ;;
            --no-gitignore)
                ADD_TO_GITIGNORE="false"
                shift
                ;;
            --no-backup)
                BACKUP_EXISTING="false"
                shift
                ;;
            --skip-validation)
                SKIP_VALIDATION="true"
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
}

# ============================================================================
# Interactive Mode
# ============================================================================

prompt_choice() {
    local prompt="$1"
    local default="$2"
    local response

    read -p "$prompt [$default]: " response
    echo "${response:-$default}"
}

prompt_yes_no() {
    local prompt="$1"
    local default="$2"
    local response

    if [ "$default" = "true" ]; then
        read -p "$prompt [Y/n]: " response
        case "$response" in
            [nN]|[nN][oO]) echo "false" ;;
            *) echo "true" ;;
        esac
    else
        read -p "$prompt [y/N]: " response
        case "$response" in
            [yY]|[yY][eE][sS]) echo "true" ;;
            *) echo "false" ;;
        esac
    fi
}

interactive_mode() {
    echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}     DevContainer Template Installer - Interactive Mode${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo ""

    # Template selection
    echo -e "${BLUE}Available Templates:${NC}"
    echo "  1) base                      - Minimal Node.js setup"
    echo "  2) node-typescript           - TypeScript ready"
    echo "  3) node-typescript-postgres  - TypeScript + PostgreSQL"
    echo "  4) node-ai-stack            - Full AI stack (kitchen sink)"
    echo ""

    read -p "Select template [1-4, default: 1]: " template_choice
    case "$template_choice" in
        2) TEMPLATE="node-typescript" ;;
        3) TEMPLATE="node-typescript-postgres" ;;
        4) TEMPLATE="node-ai-stack" ;;
        *) TEMPLATE="base" ;;
    esac

    log_info "Selected template: $TEMPLATE"
    echo ""

    # Target directory
    TARGET_DIR=$(prompt_choice "Target directory" "${TARGET_DIR:-.}")
    echo ""

    # Template-specific configuration
    if [ "$TEMPLATE" = "node-typescript-postgres" ] || [ "$TEMPLATE" = "node-ai-stack" ]; then
        echo -e "${BLUE}Database Configuration:${NC}"

        local configure_db=$(prompt_yes_no "Configure PostgreSQL connection?" "false")
        if [ "$configure_db" = "true" ]; then
            POSTGRES_HOST=$(prompt_choice "PostgreSQL host" "${POSTGRES_HOST:-localhost}")
            POSTGRES_PORT=$(prompt_choice "PostgreSQL port" "${POSTGRES_PORT:-5432}")
            POSTGRES_DB=$(prompt_choice "Database name" "${POSTGRES_DB}")
            POSTGRES_USER=$(prompt_choice "Database user" "${POSTGRES_USER}")
            read -s -p "Database password (hidden): " POSTGRES_PASSWORD
            echo ""
            DOCKER_NETWORK=$(prompt_choice "Docker network (leave empty if not using)" "${DOCKER_NETWORK}")
        fi
        echo ""
    fi

    if [ "$TEMPLATE" = "node-ai-stack" ]; then
        echo -e "${BLUE}AI Stack Configuration:${NC}"

        # User configuration
        HOST_USERNAME=$(prompt_choice "Host username" "${HOST_USERNAME:-$USER}")
        HOST_HOME=$(prompt_choice "Host home directory" "${HOST_HOME:-$HOME}")
        echo ""

        # AI tools
        echo -e "${BLUE}AI Tools Installation:${NC}"
        INSTALL_CLAUDE_CODE=$(prompt_yes_no "Install Claude Code CLI?" "false")
        INSTALL_GEMINI_CLI=$(prompt_yes_no "Install Gemini CLI?" "false")
        INSTALL_CODEX_CLI=$(prompt_yes_no "Install OpenAI Codex CLI?" "false")
        INSTALL_UV=$(prompt_yes_no "Install uv (Python package manager)?" "false")

        if [ "$INSTALL_UV" = "true" ]; then
            PYTHON_VERSION=$(prompt_choice "Python version" "${PYTHON_VERSION:-3.12.3}")
            INSTALL_SPECIFY_CLI=$(prompt_yes_no "Install specify-cli?" "false")
        fi
        echo ""

        # Mounts
        echo -e "${BLUE}File System Mounts:${NC}"
        MOUNT_CLAUDE_CONFIG=$(prompt_yes_no "Mount Claude configuration?" "false")

        if [ "$MOUNT_CLAUDE_CONFIG" = "true" ]; then
            CLAUDE_CONFIG_PATH=$(prompt_choice "Claude config path" "${CLAUDE_CONFIG_PATH:-$HOST_HOME/.claude}")
        fi

        MOUNT_OSS_PROJECTS=$(prompt_yes_no "Mount OSS projects?" "false")

        if [ "$MOUNT_OSS_PROJECTS" = "true" ]; then
            OSS_PROJECTS_PATH=$(prompt_choice "OSS projects directory" "${OSS_PROJECTS_PATH:-$HOST_HOME/projects/oss}")
            OSS_PROJECT_1=$(prompt_choice "First project name (leave empty to skip)" "")
            if [ -n "$OSS_PROJECT_1" ]; then
                OSS_PROJECT_2=$(prompt_choice "Second project name (leave empty to skip)" "")
            fi
        fi

        echo ""
        echo -e "${YELLOW}⚠  SECURITY WARNING${NC}"
        echo "Docker socket mount gives container full access to host Docker daemon."
        echo "Only enable for trusted personal projects."
        MOUNT_DOCKER_SOCKET=$(prompt_yes_no "Mount Docker socket?" "false")
        echo ""
    fi

    # Installation options
    echo -e "${BLUE}Installation Options:${NC}"
    CREATE_ENV_FILE=$(prompt_yes_no "Create .env file from template?" "${CREATE_ENV_FILE:-true}")
    ADD_TO_GITIGNORE=$(prompt_yes_no "Add .devcontainer/.env to .gitignore?" "${ADD_TO_GITIGNORE:-true}")
    BACKUP_EXISTING=$(prompt_yes_no "Backup existing .devcontainer directory?" "${BACKUP_EXISTING:-true}")
    echo ""

    # Confirmation
    echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}Configuration Summary${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo "Template:        $TEMPLATE"
    echo "Target:          $TARGET_DIR"

    if [ "$TEMPLATE" = "node-ai-stack" ]; then
        echo "Host User:       $HOST_USERNAME"
        echo "AI Tools:        Claude=$INSTALL_CLAUDE_CODE Gemini=$INSTALL_GEMINI_CLI Codex=$INSTALL_CODEX_CLI"
        echo "Python (uv):     $INSTALL_UV"
        echo "Mounts:          Claude=$MOUNT_CLAUDE_CONFIG OSS=$MOUNT_OSS_PROJECTS Docker=$MOUNT_DOCKER_SOCKET"
    fi

    if [ "$TEMPLATE" = "node-typescript-postgres" ] || [ "$TEMPLATE" = "node-ai-stack" ]; then
        if [ -n "$POSTGRES_DB" ]; then
            echo "Database:        $POSTGRES_USER@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
        fi
    fi

    echo "Create .env:     $CREATE_ENV_FILE"
    echo "Update .gitignore: $ADD_TO_GITIGNORE"
    echo "Backup existing: $BACKUP_EXISTING"
    echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo ""

    local confirm=$(prompt_yes_no "Proceed with installation?" "true")
    if [ "$confirm" != "true" ]; then
        log_warning "Installation cancelled by user"
        exit 0
    fi
}

# ============================================================================
# Validation
# ============================================================================

validate_configuration() {
    local errors=0

    log_verbose "Validating configuration..."

    # Validate template exists
    if [ ! -d "${SCRIPT_DIR}/${TEMPLATE}" ]; then
        log_error "Template directory not found: ${SCRIPT_DIR}/${TEMPLATE}"
        log_info "Available templates: base, node-typescript, node-typescript-postgres, node-ai-stack"
        ((errors++))
    fi

    # Validate target directory
    if [ ! -d "$TARGET_DIR" ]; then
        log_warning "Target directory does not exist: $TARGET_DIR"
        log_info "Directory will be created during installation"
    fi

    # Template-specific validation
    if [ "$TEMPLATE" = "node-ai-stack" ]; then
        if [ -z "$HOST_USERNAME" ]; then
            log_warning "HOST_USERNAME not set - will use current user: $USER"
            HOST_USERNAME="$USER"
        fi

        if [ -z "$HOST_HOME" ]; then
            log_warning "HOST_HOME not set - will use: $HOME"
            HOST_HOME="$HOME"
        fi

        # Validate mount paths
        if [ "$MOUNT_CLAUDE_CONFIG" = "true" ]; then
            local claude_path="${CLAUDE_CONFIG_PATH:-$HOST_HOME/.claude}"
            if [ ! -d "$claude_path" ]; then
                log_warning "Claude config directory not found: $claude_path"
                log_info "Mount will be configured but may not work until directory exists"
            fi
        fi

        if [ "$MOUNT_OSS_PROJECTS" = "true" ] && [ -n "$OSS_PROJECTS_PATH" ]; then
            if [ ! -d "$OSS_PROJECTS_PATH" ]; then
                log_warning "OSS projects directory not found: $OSS_PROJECTS_PATH"
            fi
        fi

        # Security warning for Docker socket
        if [ "$MOUNT_DOCKER_SOCKET" = "true" ] && [ "$DRY_RUN" = "false" ]; then
            log_warning "Docker socket mount enabled - container will have full access to host Docker daemon"
        fi
    fi

    if [ $errors -gt 0 ]; then
        log_error "Validation failed with $errors error(s)"
        return 1
    fi

    log_verbose "Validation passed"
    return 0
}

# ============================================================================
# Installation Functions
# ============================================================================

backup_existing() {
    local devcontainer_dir="${TARGET_DIR}/.devcontainer"

    if [ -d "$devcontainer_dir" ] && [ "$BACKUP_EXISTING" = "true" ]; then
        local backup_path="${TARGET_DIR}/${BACKUP_DIR}"

        log_info "Backing up existing .devcontainer to: $backup_path"

        if [ "$DRY_RUN" = "true" ]; then
            log_dry_run "Would move: $devcontainer_dir -> $backup_path"
        else
            # Create backup with timestamp if directory already exists
            if [ -d "$backup_path" ]; then
                local timestamp=$(date +%Y%m%d_%H%M%S)
                backup_path="${backup_path}.${timestamp}"
                log_warning "Backup directory exists, using: $backup_path"
            fi

            mv "$devcontainer_dir" "$backup_path"
            log_success "Backup created: $backup_path"
        fi
    fi
}

copy_template() {
    local template_dir="${SCRIPT_DIR}/${TEMPLATE}"
    local devcontainer_dir="${TARGET_DIR}/.devcontainer"

    log_info "Copying template: $TEMPLATE"

    if [ "$DRY_RUN" = "true" ]; then
        log_dry_run "Would copy: $template_dir -> $devcontainer_dir"

        # Show what files would be copied
        log_verbose "Files to be copied:"
        find "$template_dir" -type f | while read -r file; do
            local rel_path="${file#$template_dir/}"
            log_verbose "  - $rel_path"
        done
    else
        mkdir -p "$devcontainer_dir"
        cp -r "$template_dir"/* "$devcontainer_dir/"
        chmod +x "$devcontainer_dir/post-create.sh" 2>/dev/null || true
        log_success "Template copied successfully"
    fi
}

create_env_file() {
    local env_template="${TARGET_DIR}/.devcontainer/.env.template"
    local env_file="${TARGET_DIR}/.devcontainer/.env"

    # Only create .env for templates that have .env.template
    if [ ! -f "$env_template" ]; then
        log_verbose "No .env.template found, skipping .env creation"
        return 0
    fi

    if [ "$CREATE_ENV_FILE" != "true" ]; then
        log_verbose "Skipping .env file creation (disabled)"
        return 0
    fi

    log_info "Creating .env file from template"

    if [ "$DRY_RUN" = "true" ]; then
        log_dry_run "Would create: $env_file"
        log_verbose "Configuration values:"
        log_verbose "  HOST_USERNAME=$HOST_USERNAME"
        log_verbose "  HOST_HOME=$HOST_HOME"
        log_verbose "  INSTALL_CLAUDE_CODE=$INSTALL_CLAUDE_CODE"
        log_verbose "  INSTALL_UV=$INSTALL_UV"
        log_verbose "  MOUNT_CLAUDE_CONFIG=$MOUNT_CLAUDE_CONFIG"
        log_verbose "  MOUNT_DOCKER_SOCKET=$MOUNT_DOCKER_SOCKET"
        if [ -n "$POSTGRES_DB" ]; then
            log_verbose "  POSTGRES_DB=$POSTGRES_DB"
            log_verbose "  POSTGRES_USER=$POSTGRES_USER"
            log_verbose "  POSTGRES_HOST=$POSTGRES_HOST"
        fi
    else
        # Copy template
        cp "$env_template" "$env_file"

        # Replace configuration values
        sed -i "s|^HOST_USERNAME=.*|HOST_USERNAME=${HOST_USERNAME}|" "$env_file"
        sed -i "s|^HOST_HOME=.*|HOST_HOME=${HOST_HOME}|" "$env_file"
        sed -i "s|^INSTALL_CLAUDE_CODE=.*|INSTALL_CLAUDE_CODE=${INSTALL_CLAUDE_CODE}|" "$env_file"
        sed -i "s|^INSTALL_GEMINI_CLI=.*|INSTALL_GEMINI_CLI=${INSTALL_GEMINI_CLI}|" "$env_file"
        sed -i "s|^INSTALL_CODEX_CLI=.*|INSTALL_CODEX_CLI=${INSTALL_CODEX_CLI}|" "$env_file"
        sed -i "s|^INSTALL_UV=.*|INSTALL_UV=${INSTALL_UV}|" "$env_file"
        sed -i "s|^INSTALL_SPECIFY_CLI=.*|INSTALL_SPECIFY_CLI=${INSTALL_SPECIFY_CLI}|" "$env_file"
        sed -i "s|^PYTHON_VERSION=.*|PYTHON_VERSION=${PYTHON_VERSION}|" "$env_file"
        sed -i "s|^MOUNT_CLAUDE_CONFIG=.*|MOUNT_CLAUDE_CONFIG=${MOUNT_CLAUDE_CONFIG}|" "$env_file"
        sed -i "s|^MOUNT_OSS_PROJECTS=.*|MOUNT_OSS_PROJECTS=${MOUNT_OSS_PROJECTS}|" "$env_file"
        sed -i "s|^MOUNT_DOCKER_SOCKET=.*|MOUNT_DOCKER_SOCKET=${MOUNT_DOCKER_SOCKET}|" "$env_file"

        if [ -n "$CLAUDE_CONFIG_PATH" ]; then
            sed -i "s|^CLAUDE_CONFIG_PATH=.*|CLAUDE_CONFIG_PATH=${CLAUDE_CONFIG_PATH}|" "$env_file"
        fi

        if [ -n "$OSS_PROJECTS_PATH" ]; then
            sed -i "s|^OSS_PROJECTS_PATH=.*|OSS_PROJECTS_PATH=${OSS_PROJECTS_PATH}|" "$env_file"
        fi

        if [ -n "$OSS_PROJECT_1" ]; then
            sed -i "s|^OSS_PROJECT_1=.*|OSS_PROJECT_1=${OSS_PROJECT_1}|" "$env_file"
        fi

        if [ -n "$OSS_PROJECT_2" ]; then
            sed -i "s|^OSS_PROJECT_2=.*|OSS_PROJECT_2=${OSS_PROJECT_2}|" "$env_file"
        fi

        # Database configuration (for postgres templates)
        if [ -n "$POSTGRES_DB" ]; then
            sed -i "s|^POSTGRES_HOST=.*|POSTGRES_HOST=${POSTGRES_HOST}|" "$env_file"
            sed -i "s|^POSTGRES_PORT=.*|POSTGRES_PORT=${POSTGRES_PORT}|" "$env_file"
            sed -i "s|^POSTGRES_DB=.*|POSTGRES_DB=${POSTGRES_DB}|" "$env_file"
            sed -i "s|^POSTGRES_USER=.*|POSTGRES_USER=${POSTGRES_USER}|" "$env_file"
            sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" "$env_file"
        fi

        if [ -n "$DOCKER_NETWORK" ]; then
            sed -i "s|^DOCKER_NETWORK=.*|DOCKER_NETWORK=${DOCKER_NETWORK}|" "$env_file"
        fi

        log_success ".env file created: $env_file"
    fi
}

configure_mounts() {
    local devcontainer_json="${TARGET_DIR}/.devcontainer/devcontainer.json"

    # Only for node-ai-stack template
    if [ "$TEMPLATE" != "node-ai-stack" ]; then
        return 0
    fi

    log_info "Configuring mounts in devcontainer.json"

    if [ "$DRY_RUN" = "true" ]; then
        log_dry_run "Would configure mounts in: $devcontainer_json"
        [ "$MOUNT_DOCKER_SOCKET" = "true" ] && log_verbose "  - Docker socket"
        [ "$MOUNT_CLAUDE_CONFIG" = "true" ] && log_verbose "  - Claude config"
        [ "$MOUNT_OSS_PROJECTS" = "true" ] && log_verbose "  - OSS projects"
        return 0
    fi

    # Uncomment Docker socket mount if enabled
    if [ "$MOUNT_DOCKER_SOCKET" = "true" ]; then
        sed -i 's|// "source=/var/run/docker.sock|"source=/var/run/docker.sock|' "$devcontainer_json"
        log_verbose "Enabled Docker socket mount"
    fi

    # Uncomment Claude config mount if enabled
    if [ "$MOUNT_CLAUDE_CONFIG" = "true" ]; then
        sed -i 's|// "source=\${localEnv:CLAUDE_CONFIG_PATH}|"source=${localEnv:CLAUDE_CONFIG_PATH}|' "$devcontainer_json"
        log_verbose "Enabled Claude config mount"
    fi

    # Uncomment OSS project mounts if enabled
    if [ "$MOUNT_OSS_PROJECTS" = "true" ]; then
        sed -i 's|// "source=\${localEnv:OSS_PROJECTS_PATH}|"source=${localEnv:OSS_PROJECTS_PATH}|' "$devcontainer_json"
        log_verbose "Enabled OSS projects mounts"
    fi

    # Uncomment Docker network if configured
    if [ -n "$DOCKER_NETWORK" ]; then
        sed -i 's|// "runArgs": \["--network=|"runArgs": ["--network=|' "$devcontainer_json"
        log_verbose "Enabled Docker network configuration"
    fi

    log_success "Mounts configured"
}

update_gitignore() {
    if [ "$ADD_TO_GITIGNORE" != "true" ]; then
        log_verbose "Skipping .gitignore update (disabled)"
        return 0
    fi

    local gitignore="${TARGET_DIR}/.gitignore"

    log_info "Updating .gitignore"

    if [ "$DRY_RUN" = "true" ]; then
        log_dry_run "Would add to .gitignore: .devcontainer/.env"
    else
        # Create .gitignore if it doesn't exist
        if [ ! -f "$gitignore" ]; then
            touch "$gitignore"
        fi

        # Add .devcontainer/.env if not already present
        if ! grep -q "^.devcontainer/\\.env$" "$gitignore" 2>/dev/null; then
            echo "" >> "$gitignore"
            echo "# DevContainer environment variables (contains secrets)" >> "$gitignore"
            echo ".devcontainer/.env" >> "$gitignore"
            log_success "Added .devcontainer/.env to .gitignore"
        else
            log_verbose ".devcontainer/.env already in .gitignore"
        fi
    fi
}

show_next_steps() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}     Installation Complete!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Next steps:"
    echo ""
    echo "  1. Review the generated configuration:"
    echo "     ${TARGET_DIR}/.devcontainer/"
    echo ""

    if [ -f "${TARGET_DIR}/.devcontainer/.env" ]; then
        echo "  2. Verify your .env settings:"
        echo "     ${TARGET_DIR}/.devcontainer/.env"
        echo ""
    fi

    if [ "$TEMPLATE" = "node-ai-stack" ]; then
        echo "  3. If using mounts, uncomment the relevant lines in:"
        echo "     ${TARGET_DIR}/.devcontainer/devcontainer.json"
        echo ""
    fi

    echo "  4. Open the project in VS Code"
    echo ""
    echo "  5. Command Palette → 'Dev Containers: Reopen in Container'"
    echo ""
    echo "Documentation:"
    echo "  - Main README: ${SCRIPT_DIR}/README.md"
    echo "  - Template README: ${SCRIPT_DIR}/${TEMPLATE}/README.md"
    echo ""

    if [ "$BACKUP_EXISTING" = "true" ] && [ -d "${TARGET_DIR}/${BACKUP_DIR}" ]; then
        echo "Note: Your previous .devcontainer was backed up to:"
        echo "      ${TARGET_DIR}/${BACKUP_DIR}"
        echo ""
    fi

    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
}

# ============================================================================
# Main Installation Flow
# ============================================================================

main() {
    # Load default configuration
    load_config

    # Parse command-line arguments (overrides config)
    parse_arguments "$@"

    # Interactive mode if requested
    if [ "$INTERACTIVE" = "true" ]; then
        interactive_mode
    fi

    # Convert relative target to absolute
    TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd || echo "$TARGET_DIR")"

    # Header
    if [ "$DRY_RUN" = "true" ]; then
        echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
        echo -e "${CYAN}     DRY RUN MODE - No changes will be made${NC}"
        echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
        echo ""
    fi

    log_info "DevContainer Template Installer"
    log_info "Template: $TEMPLATE"
    log_info "Target: $TARGET_DIR"
    echo ""

    # Validate configuration
    if [ "$SKIP_VALIDATION" != "true" ]; then
        if ! validate_configuration; then
            log_error "Validation failed. Use --skip-validation to bypass (not recommended)"
            exit 1
        fi
        echo ""
    fi

    # Perform installation steps
    backup_existing
    copy_template
    create_env_file
    configure_mounts
    update_gitignore

    # Show completion message
    if [ "$DRY_RUN" = "true" ]; then
        echo ""
        echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
        echo -e "${CYAN}     DRY RUN COMPLETE${NC}"
        echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
        echo ""
        echo "No changes were made. Run without --dry-run to perform installation."
    else
        show_next_steps
    fi
}

# Run main function
main "$@"
