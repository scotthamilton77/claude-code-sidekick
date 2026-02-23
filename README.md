# Sidekick

**A hook-driven companion for Claude Code: session tracking, reminders, personas, and a monitoring UI**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

Sidekick is a TypeScript monorepo that extends [Claude Code](https://claude.com/claude-code) with a hook-driven daemon, session tracking, reminders, persona system, and a monitoring UI. It implements a dual-scope architecture where all capabilities work identically in both project-local (`.claude/`) and user-global (`~/.claude/`) contexts.

### Key Features

- **Hook System**: Conversation tracking, topic classification, and response monitoring via TypeScript daemon
- **Session Summary**: LLM-based conversation analysis with adaptive polling
- **Statusline**: Token tracking, cost display, git branch, and persona indicator
- **Reminders**: Two-tier system (pause-and-reflect, verify-completion) for workflow nudges
- **Personas**: 20 character personalities for response flavor
- **Dual-Scope Parity**: Identical behavior in project (`.claude/`) and user (`~/.claude/`) scopes
- **Monitoring UI**: React-based time-travel debugging interface

## Quick Start

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) | Latest | [Install guide](https://docs.claude.com/en/docs/claude-code) |
| [Node.js](https://nodejs.org/) | >=20.x | [nodejs.org](https://nodejs.org/) |

### Installation

Run the setup wizard — it handles plugin installation, statusline, gitignore, and API keys:

```bash
npx -y @scotthamilton77/sidekick setup
```

For detailed configuration options, see the [User Guide](docs/USER-GUIDE.md). For development and contributing, see the [Developer Guide](docs/DEVELOPER-GUIDE.md).

## Architecture

### Directory Structure

```
.
├── .claude/                    # Claude Code configuration (settings, hooks, MCP)
├── packages/                   # TypeScript monorepo packages (12 packages)
├── assets/sidekick/            # YAML config defaults, personas, prompt templates
└── scripts/                    # Development and publishing utilities
```

See the [Developer Guide](docs/DEVELOPER-GUIDE.md) for the full package breakdown and dependency graph.

### Hook System (Sidekick)

Sidekick is a **TypeScript-based hook system** that enhances Claude Code with session tracking, reminders, and status display.

**How It Works**:

- Claude Code invokes `npx @scotthamilton77/sidekick hook <event>` at conversation events
- The CLI dispatches events to a background daemon for processing
- Features run asynchronously without blocking the conversation

**Core Features**:

- **Session Summary**: LLM-based conversation analysis with adaptive polling
- **Statusline**: Token tracking, cost display, git branch, persona indicator
- **Reminders**: Two-tier system (pause-and-reflect, verify-completion)
- **Personas**: 20 character personalities for response flavor

**Architecture**:

- **CLI** (`packages/sidekick-cli`): Hook entrypoint, dispatches to daemon
- **Daemon** (`packages/sidekick-daemon`): Background process for session management
- **Plugin** (`packages/sidekick-plugin`): Claude Code hooks.json configuration

Session state is maintained in `.sidekick/` at the project root (gitignored).

## Usage

See the [User Guide](docs/USER-GUIDE.md) for detailed feature documentation, CLI commands, configuration, and troubleshooting.

## Contributing

See the [Developer Guide](docs/DEVELOPER-GUIDE.md) for build instructions, testing, and architecture details.

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

Built for [Claude Code](https://docs.claude.com/en/docs/claude-code) by Anthropic.

## Links

- [Claude Code Documentation](https://docs.claude.com/en/docs/claude-code)
- [Issue Tracker](https://github.com/scotthamilton77/claude-code-sidekick/issues)
- [Changelog](https://github.com/scotthamilton77/claude-code-sidekick/commits/main)
