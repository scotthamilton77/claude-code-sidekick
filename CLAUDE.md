# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This repository is a Claude configuration management system that maintains custom command definitions and project templates for Human-AI collaborative development. The architecture is organized around:

- **Command Templates**: Stored in `backlog/commands-to-explore/` and `backlog/commands/` - these are markdown-based command specifications for various development tasks
- **Configuration Management**: The `.claude/` directory contains project-specific Claude settings that sync with the global `~/.claude` configuration
- **Synchronization Scripts**: Shell scripts in `scripts/` handle bidirectional sync between project and global Claude configurations

### Key Components

#### Command System
- `backlog/commands-to-explore/`: Collection of experimental and proposed command templates
- `backlog/commands/plan/`: Specialized planning commands for project management
- `backlog/commands/proto/`: Prototype command patterns

#### Configuration Management
- `.claude/CLAUDE.md`: Project-specific instructions (mirrors global configuration)
- `mcp.json`: Model Context Protocol server configurations including context7, sequential-thinking, zen, and memory servers
- `.claudeignore`: Specifies files/directories to exclude from synchronization

#### Synchronization System
- `scripts/pull-from-claude.sh`: Copies files from `~/.claude` to project `.claude/`
- `scripts/push-to-claude.sh`: Copies files from project `.claude/` to `~/.claude`
- `scripts/sync-claude.sh`: Performs bidirectional sync (pull then push)

## Common Commands

### Configuration Sync
```bash
# Pull updates from global Claude config
./scripts/pull-from-claude.sh

# Push local changes to global Claude config  
./scripts/push-to-claude.sh

# Bidirectional sync (recommended)
./scripts/sync-claude.sh
```

### File Operations
Since this is primarily a configuration and template repository, most operations involve:
- Editing command templates in `backlog/`
- Modifying MCP server configurations in `mcp.json`
- Managing sync exclusions in `.claudeignore`

## MCP Server Configuration

The repository uses several MCP (Model Context Protocol) servers:
- **context7**: External SSE server for enhanced context
- **sequential-thinking**: NPX-based thinking assistance
- **zen**: Local Python-based server for specialized functionality  
- **memory**: NPX-based memory management

## Development Patterns

### Command Template Structure
Commands follow markdown-based specifications with:
- Purpose and requirements sections
- Process flows (often with Mermaid diagrams)
- Bash code blocks for execution logic
- Integration with Atlas MCP for project management

### Configuration Sync Workflow
1. Modify files in project `.claude/` directory
2. Use sync scripts to propagate changes
3. Verify synchronization with timestamp-based copying (only newer files copied)

## Important Notes

- The sync scripts use timestamp-based copying - only files newer than destinations are copied
- `.claudeignore` patterns support both file and directory exclusions
- All command templates assume integration with Atlas MCP for project/task management
- The repository maintains both experimental (`commands-to-explore`) and stable (`commands`) command patterns