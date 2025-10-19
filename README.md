# Claude Code Configuration Lab

**Experimental proving ground for Claude Code hooks, commands, agents, and skills**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

This repository serves as a development and testing environment for [Claude Code](https://claude.com/claude-code) configurations before deploying them to your global `~/.claude` directory. It implements a dual-scope architecture where all capabilities work identically in both project-local and user-global contexts.

## TODOs

- statusline is coupled to the reminders; we should make this modular to allow the reminders to inject or supply a module for statusline to load dynamically

### Key Features

- **Hook System**: Conversation tracking, topic classification, and response monitoring
- **Bidirectional Sync**: Seamless transfer between project and global configurations
- **Command Templates**: Experimental slash command patterns for development workflows
- **Dual-Scope Testing**: Validate configurations locally before global deployment
- **Comprehensive Testing**: Test harnesses for setup scripts and hook behavior

## Quick Start

### Prerequisites

- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed
- `jq` for JSON manipulation: `sudo apt-get install jq` (or `brew install jq` on macOS)
- Bash shell environment

### Installation

1. Clone the repository:
```bash
git clone https://github.com/scotthamilton77/claude-config.git
cd claude-config
```

2. Configure hook permissions and statusline:
```bash
# For user-scope deployment
./scripts/setup.sh

# For project-scope testing (includes local settings)
./scripts/setup.sh --include-local
```

3. Test the installation:
```bash
./tests/test-setup.sh
```

## Architecture

### Directory Structure

```
.
├── .claude/                    # Project-scoped Claude configuration
│   ├── hooks/                  # Conversation event handlers
│   │   ├── write-topic.sh      # Topic classification
│   │   ├── write-unclear-topic.sh
│   │   ├── response-tracker.sh # Response monitoring
│   │   └── cache/              # Runtime state (gitignored)
│   ├── skills/                 # Claude Code skills
│   ├── agents/                 # Custom agent definitions
│   ├── CLAUDE.md               # Project instructions
│   ├── settings.json           # Permission configuration
│   ├── settings.local.json     # Local overrides
│   ├── mcp.json                # MCP server config
│   └── statusline.sh           # Dynamic status generator
├── backlog/                    # Command template library
│   ├── commands-to-explore/    # Experimental commands
│   ├── commands/plan/          # Planning commands
│   └── commands/proto/         # Prototypes
├── scripts/                    # Sync infrastructure
│   ├── setup.sh                # Permission/statusline setup
│   ├── pull-from-claude.sh     # Import from ~/.claude
│   ├── push-to-claude.sh       # Export to ~/.claude
│   └── sync-claude.sh          # Bidirectional sync
└── tests/                      # Test harnesses
```

### Hook System

Hooks execute at conversation events to enhance Claude Code behavior:

- **write-topic.sh**: Analyzes user intent and records conversation metadata
- **write-unclear-topic.sh**: Handles vague/ambiguous requests with cynical feedback
- **response-tracker.sh**: Monitors response count and injects periodic reminders

All hooks maintain state in `.claude/hooks/reminders/tmp/` (excluded from version control).

## Usage

### Developing New Configurations

1. **Create/modify** configurations in `.claude/` directory
2. **Test locally** using project-scoped hooks
3. **Verify** dual-scope compatibility
4. **Deploy** to global config:
   ```bash
   ./scripts/push-to-claude.sh
   ```

### Synchronization Workflow

```bash
# Import changes from global config (test external modifications)
./scripts/pull-from-claude.sh

# Export tested changes to global config
./scripts/push-to-claude.sh

# Bidirectional sync (import → export)
./scripts/sync-claude.sh
```

### Testing

```bash
# Test setup script functionality
./tests/test-setup.sh

# Test response tracker behavior
./tests/test-response-tracker.sh
```

## Configuration

### Sync Exclusions

Edit `.claudeignore` to exclude files from sync operations:

```
.credentials.json
*.local.json
hooks/reminders/tmp/
*.backup
```

Supports glob patterns for both files and directories.

### MCP Servers

The repository includes configurations for:
- **context7**: External documentation context
- **sequential-thinking**: Advanced reasoning assistance
- **zen**: Specialized Python-based tooling
- **memory**: Conversation memory management

Configure in `.claude/mcp.json`.

## Development Patterns

### Dual-Scope Compatibility

All scripts must work in both contexts:
- **Project scope**: `.claude/` within this repository
- **User scope**: `~/.claude/` global directory

Use environment variables (`$CLAUDE_PROJECT_DIR`) and dynamic path resolution. See `scripts/setup.sh:186-254` for implementation patterns.

### Timestamp-Based Sync

Sync scripts only copy files newer than their destinations, preserving timestamps for idempotent operations.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

Built for [Claude Code](https://docs.claude.com/en/docs/claude-code) by Anthropic.

## Links

- [Claude Code Documentation](https://docs.claude.com/en/docs/claude-code)
- [Issue Tracker](https://github.com/scotthamilton77/claude-config/issues)
- [Changelog](https://github.com/scotthamilton77/claude-config/commits/main)
