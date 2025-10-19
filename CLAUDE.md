# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

This repository serves as the **experimental proving ground** for Claude Code configuration development. It enables testing and debugging of commands, hooks, agents, skills, and other Claude Code capabilities in a project-scoped environment before deploying them to the user's global `~/.claude` directory.

**Critical Design Principle**: All scripts and capabilities must operate identically whether invoked from:
- **Project scope**: `.claude/` directory within this repository
- **User scope**: `~/.claude/` global configuration directory

This dual-scope requirement ensures configurations can be tested locally before global deployment.

## Architecture Overview

The repository is organized around three main systems:

- **Experimental Command Templates**: `backlog/commands-to-explore/` and `backlog/commands/` contain markdown-based command specifications for development tasks
- **Hook System**: Scripts in `.claude/hooks/` handle conversation tracking, response monitoring, and topic classification
- **Synchronization Infrastructure**: Shell scripts in `scripts/` manage bidirectional sync between project `.claude/` and global `~/.claude` configurations

### Key Components

#### Command System
- `backlog/commands-to-explore/`: Experimental command templates under development
- `backlog/commands/plan/`: Planning and project management commands
- `backlog/commands/proto/`: Prototype command patterns

#### Hook System
- `.claude/hooks/write-topic.sh`: Records clear conversation topics with metadata
- `.claude/hooks/write-unclear-topic.sh`: Handles vague/ambiguous user requests
- `.claude/hooks/reminders/response-tracker.sh`: Monitors Claude responses and provides periodic reminders
- `.claude/hooks/reminders/tmp/`: Runtime state for hook operations (excluded from version control)

#### Configuration Files
- `.claude/CLAUDE.md`: Project-specific instructions (mirrors global `~/.claude/CLAUDE.md`)
- `.claude/mcp.json`: Model Context Protocol server configurations (context7, sequential-thinking, zen, memory)
- `.claude/settings.json`: Project-scoped permissions and configuration
- `.claude/settings.local.json`: Local overrides (excluded from sync)
- `.claude/statusline.sh`: Dynamic status line generator
- `.claudeignore`: Sync exclusion patterns (supports file and directory wildcards)

#### Synchronization Scripts
- `scripts/pull-from-claude.sh`: Import files from `~/.claude` → `.claude/`
- `scripts/push-to-claude.sh`: Export files from `.claude/` → `~/.claude`
- `scripts/sync-claude.sh`: Bidirectional sync (pull → push)
- `scripts/setup.sh`: Initialize hook permissions and statusline configuration (supports `--include-local` flag)

## Common Commands

### Initial Setup
```bash
# Configure hook permissions and statusline for user scope
./scripts/setup.sh

# Also configure project-local settings (for testing in project scope)
./scripts/setup.sh --include-local
```

### Configuration Sync
```bash
# Import from global config (test changes made in ~/.claude)
./scripts/pull-from-claude.sh

# Export to global config (deploy tested changes)
./scripts/push-to-claude.sh

# Bidirectional sync (import then export)
./scripts/sync-claude.sh
```

### Testing
```bash
# Test setup.sh functionality (comprehensive test suite)
./tests/test-setup.sh

# Test response tracker hook behavior
./tests/test-response-tracker.sh
```

### Development Workflow
1. Modify configurations in `.claude/` directory
2. Test locally in project scope (hooks run from `.claude/hooks/`)
3. Verify dual-scope compatibility
4. Deploy to user scope via `./scripts/push-to-claude.sh`

## MCP Server Configuration

The repository uses several MCP (Model Context Protocol) servers:
- **context7**: External SSE server for enhanced context
- **sequential-thinking**: NPX-based thinking assistance
- **zen**: Local Python-based server for specialized functionality  
- **memory**: NPX-based memory management

## Development Patterns

### Dual-Scope Compatibility
All scripts must support both deployment contexts:
- **Project scope**: Paths relative to `$CLAUDE_PROJECT_DIR/.claude/`
- **User scope**: Paths relative to `~/.claude/`

Use environment variables and dynamic path resolution to ensure portability. See `setup.sh:186-254` for context detection patterns.

### Hook System Architecture
Hooks execute at specific conversation events:
- **UserPromptSubmit**: Triggered before Claude processes user input
  - `write-topic.sh`: Analyzes intent, records topic metadata
  - `write-unclear-topic.sh`: Handles ambiguous/vague requests
  - `response-tracker.sh`: Maintains response count, injects periodic reminders

State files in `.claude/hooks/reminders/tmp/` persist across conversations (gitignored).

### Synchronization Behavior
- Timestamp-based copying: only files newer than destination are transferred
- `.claudeignore` supports glob patterns for files and directories
- `settings.local.json` and cache files automatically excluded from sync
- Sync operations are idempotent and safe to run repeatedly

### Command Template Structure
Markdown-based specifications include:
- Purpose/requirements sections
- Process flows (often with Mermaid diagrams)
- Bash code blocks for execution
- Atlas MCP integration (where applicable)

## Critical Constraints

- **Never modify files outside project directory** without explicit authorization
- **All hooks must be permission-approved** in `settings.json` before execution
- **Dual-scope testing required** before deploying to `~/.claude`
- **Timestamp preservation** critical for sync correctness