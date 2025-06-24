# Installation Scripts

This directory contains scripts to install Claude Code planning commands to either user-level or project-level directories.

## User-Level Installation

Install commands globally for your user account (`~/.claude/commands/`):

### install-commands.sh (Bash/Linux/macOS)
```bash
# Make executable and run
chmod +x scripts/install-commands.sh
./scripts/install-commands.sh

# With backup
./scripts/install-commands.sh --backup
```

### install-commands.ps1 (PowerShell/Windows)
```powershell
# Run directly
.\scripts\install-commands.ps1

# With backup
.\scripts\install-commands.ps1 -Backup

# Show help
.\scripts\install-commands.ps1 -Help
```

## Project-Level Installation

Install commands for the current project (`./.claude/commands/`):

### install-commands-project.sh (Bash/Linux/macOS)
```bash
# Install to current directory
./scripts/install-commands-project.sh

# Install to specific project
./scripts/install-commands-project.sh --target /path/to/project

# With backup
./scripts/install-commands-project.sh --backup
```

### install-commands-project.ps1 (PowerShell/Windows)
```powershell
# Install to current directory
.\scripts\install-commands-project.ps1

# Install to specific project
.\scripts\install-commands-project.ps1 -Target "C:\path\to\project"

# With backup and help
.\scripts\install-commands-project.ps1 -Backup
.\scripts\install-commands-project.ps1 -Help
```

## What Gets Installed

All scripts copy command files (*.md) from `./commands/**` preserving directory structure:

**User-Level Installation:**
- `/commands/plan/plan-create.md` → `~/.claude/commands/plan/plan-create.md`
- `/commands/plan/plan-decompose.md` → `~/.claude/commands/plan/plan-decompose.md`
- Commands accessible as `/plan-create` or `/user:plan-create`

**Project-Level Installation:**
- `/commands/plan/plan-create.md` → `./.claude/commands/plan/plan-create.md`
- `/commands/plan/plan-decompose.md` → `./.claude/commands/plan/plan-decompose.md`
- Commands accessible as `/plan-create` or `/project:plan-create`

## Features

- ✅ **Preserves directory structure**
- ✅ **Overwrites existing files** (with warning)
- ✅ **Optional backup** of existing commands
- ✅ **Colorized output** for better visibility
- ✅ **Error handling** and validation
- ✅ **Cross-platform support** (Bash + PowerShell)

## Command Precedence

When duplicate commands exist in both locations:

- **User-Level**: `~/.claude/commands/` → `/user:plan-create`
- **Project-Level**: `./.claude/commands/` → `/project:plan-create`
- **Unprefixed**: `/plan-create` → **Precedence depends on Claude Code implementation**

## Post-Installation

After running the scripts, planning commands will be available:

**User-Level Commands:**
```bash
/plan-create "Build a customer portal"          # May use user or project version
/user:plan-create "Build a customer portal"     # Explicitly use user version
```

**Project-Level Commands:**
```bash
/project:plan-create "Build a customer portal"  # Explicitly use project version
/project:plan-decompose "plan-customer-portal"
```

## Project-Level Benefits

- **Project-specific customization** of commands
- **Version control** commands with your project
- **Team sharing** of customized workflows
- **Override user defaults** for specific projects

## Prerequisites

- Ensure Atlas MCP is configured (see `../mcp.json`)
- Verify Claude Code CLI is properly installed
- For project-level: `.claude/` directory will be created automatically