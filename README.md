# Claude Code Configuration Lab

**Experimental proving ground for Claude Code hooks, commands, agents, and skills**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

This repository serves as a development and testing environment for [Claude Code](https://claude.com/claude-code) configurations before deploying them to your global `~/.claude` directory. It implements a dual-scope architecture where all capabilities work identically in both project-local and user-global contexts.

### Key Features

- **Hook System**: Conversation tracking, topic classification, and response monitoring
- **Bidirectional Sync**: Seamless transfer between project and global configurations
- **Command Templates**: Experimental slash command patterns for development workflows
- **Dual-Scope Testing**: Validate configurations locally before global deployment
- **Comprehensive Testing**: Test harnesses for setup scripts and hook behavior

## Quick Start

### Prerequisites

**Required for all functionality:**

| Tool | Version | Check Command | Install (macOS) |
|------|---------|---------------|-----------------|
| [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) | Latest | `claude --version` | `npm install -g @anthropic-ai/claude-code` |
| [Node.js](https://nodejs.org/) | ≥20.x | `node --version` | `brew install node` |
| [pnpm](https://pnpm.io/) | 9.12.2 | `pnpm --version` | `npm install -g pnpm@9.12.2` or `corepack enable` |
| [jq](https://stedolan.github.io/jq/) | ≥1.6 | `jq --version` | `brew install jq` |
| Git | ≥2.x | `git --version` | `brew install git` |
| Bash | ≥3.2 | `bash --version` | Built-in on macOS |

**Optional (for development scripts):**

| Tool | Version | Check Command | Install (macOS) |
|------|---------|---------------|-----------------|
| Python 3 | ≥3.9 | `python3 --version` | `brew install python3` |

**Quick install of missing tools (macOS):**

```bash
# Install Homebrew if needed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install required tools
brew install node jq

# Install pnpm (via corepack, recommended)
corepack enable && corepack prepare pnpm@9.12.2 --activate

# Or install pnpm via npm
npm install -g pnpm@9.12.2
```

### Installation

1. Clone the repository:

```bash
git clone https://github.com/scotthamilton77/claude-config.git
cd claude-config
```

2. Install dependencies and build:

```bash
pnpm install
pnpm build
```

3. Enable development mode (for local testing):

```bash
pnpm sidekick dev-mode enable
# Restart Claude Code to pick up hooks
```

## Architecture

### Directory Structure

```
.
├── .claude/                    # Project-scoped Claude configuration
│   ├── skills/                 # Claude Code skills
│   ├── agents/                 # Custom agent definitions
│   ├── CLAUDE.md               # Project instructions
│   ├── settings.json           # Permission configuration
│   ├── settings.local.json     # Local overrides (gitignored)
│   └── mcp.json                # MCP server config
├── packages/                   # TypeScript monorepo packages
│   ├── sidekick-core/          # Core services (config, transcript, logging)
│   ├── sidekick-cli/           # CLI entrypoint and hook dispatcher
│   ├── sidekick-daemon/        # Background daemon for session management
│   ├── sidekick-plugin/        # Claude Code plugin (hooks.json)
│   ├── feature-reminders/      # Reminder staging and orchestration
│   ├── feature-session-summary/# LLM-based analysis
│   ├── feature-statusline/     # Token tracking and status display
│   └── shared-providers/       # LLM provider abstractions
├── assets/sidekick/            # Shared configuration and templates
│   ├── defaults/               # YAML config defaults
│   ├── personas/               # Character personality profiles
│   ├── prompts/                # LLM prompt templates
│   └── reminders/              # Reminder templates (YAML)
├── scripts/                    # Development utilities
│   ├── dev-mode.sh             # Wrapper for dev-mode CLI
│   └── dev-hooks/              # Development hook scripts
└── development-tools/          # LLM evaluation and testing tools
```

### Hook System (Sidekick)

Sidekick is a **TypeScript-based hook system** that enhances Claude Code with session tracking, reminders, and status display.

**How It Works**:

- Claude Code invokes `npx @sidekick/cli hook <event>` at conversation events
- The CLI dispatches events to a background daemon for processing
- Features run asynchronously without blocking the conversation

**Core Features**:

- **Session Summary**: LLM-based conversation analysis with adaptive polling
- **Statusline**: Token tracking, cost display, git branch, persona indicator
- **Reminders**: Two-tier system (pause-and-reflect, verify-completion)
- **Personas**: 17 character personalities for response flavor

**Architecture**:

- **CLI** (`packages/sidekick-cli`): Hook entrypoint, dispatches to daemon
- **Daemon** (`packages/sidekick-daemon`): Background process for session management
- **Plugin** (`packages/sidekick-plugin`): Claude Code hooks.json configuration

Session state is maintained in `.sidekick/` at the project root (gitignored).

## Usage

### Development Workflow

1. **Enable dev-mode** to use local builds:
   ```bash
   pnpm sidekick dev-mode enable
   ```

2. **Make changes** to packages under `packages/`

3. **Rebuild** after changes:
   ```bash
   pnpm build
   ```

4. **Restart Claude Code** to pick up hook changes

### Testing

```bash
# Run all TypeScript tests (mocked LLM, zero API costs)
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

**Note**: LLM provider tests are excluded from default runs to prevent API charges. Run with `INTEGRATION_TESTS=1 pnpm test` for full coverage.

### Node Package Tests & Coverage

All TypeScript packages under `packages/` use Vitest with coverage enabled by default. Run the workspace tests after `pnpm install`:

```bash
pnpm test
```

Each package writes text, HTML, and LCOV coverage reports to its own `packages/<name>/coverage/` directory (gitignored). Open `coverage/index.html` inside any package to inspect the full report.

**Known Warning**: `pnpm install` emits `openai@4.x` → `zod@^3.23.8` peer complaints because we intentionally run `zod@^4.1.13` across the workspace for improved schema tooling. The OpenAI SDK still functions with zod 4, so we are ignoring the warning until we adopt OpenAI 6.x (which officially supports newer zod) or migrate to the Responses API.

## Configuration

### MCP Servers

The repository includes configurations for:

- **context7**: External documentation context

Configure in `.claude/mcp.json`.

### Configuration

Sidekick uses **YAML-based configuration** with a cascade system:

**Cascade Levels** (later overrides earlier):

1. **Bundled Defaults**: `assets/sidekick/defaults/*.yaml`
2. **User Domain YAML**: `~/.sidekick/*.yaml`
3. **User Unified Config**: `~/.sidekick/sidekick.config`
4. **Project Domain YAML**: `.sidekick/*.yaml`
5. **Project Unified Config**: `.sidekick/sidekick.config`
6. **Environment Variables**: `SIDEKICK_*` prefixed vars

**Configuration Domains**:

- `core.yaml` - Logging, paths, daemon settings
- `llm.yaml` - LLM provider configuration
- `transcript.yaml` - Transcript processing settings
- `features.yaml` - Feature flags and tuning

**Quick Override** (dot-notation in `sidekick.config`):

```bash
# .sidekick/sidekick.config
core.logging.level=debug
llm.provider=openrouter
features.statusline.enabled=true
```

### LLM Provider Configuration

Configure in `.sidekick/llm.yaml` or via environment variables:

**OpenRouter (default)**:

```yaml
provider: openrouter
model: google/gemini-2.0-flash-lite-001
```

```bash
# Environment variable for API key
export OPENROUTER_API_KEY=sk-or-v1-...
```

**OpenAI**:

```yaml
provider: openai
model: gpt-4o-mini
```

### Customizing Reminders

Reminders are YAML files in `assets/sidekick/reminders/`. Override by copying to `.sidekick/reminders/`:

```bash
# Override for this project
cp assets/sidekick/reminders/pause-and-reflect.yaml .sidekick/reminders/
# Edit .sidekick/reminders/pause-and-reflect.yaml
```

Available reminders:
- `user-prompt-submit.yaml` - On each user prompt
- `pause-and-reflect.yaml` - Tool cadence check
- `verify-completion.yaml` - On stop after modifications

## Package Structure

The Sidekick system is implemented as a TypeScript monorepo:

```
packages/
├── types/                   # Shared TypeScript types
├── sidekick-core/           # Core services (config, transcript, logging, scope)
├── shared-providers/        # LLM provider abstractions (OpenRouter default)
├── feature-reminders/       # Reminder staging and orchestration
├── feature-session-summary/ # LLM-based conversation analysis
├── feature-statusline/      # Token tracking and status display
├── sidekick-daemon/         # Background daemon for session management
├── sidekick-cli/            # CLI entrypoint and hook dispatcher
├── sidekick-plugin/         # Claude Code plugin (hooks.json)
├── sidekick-ui/             # Monitoring UI (React SPA)
└── testing-fixtures/        # Shared test mocks and factories

assets/sidekick/             # Shared configuration and templates
├── defaults/                # YAML config defaults
├── personas/                # Character personality profiles (17 personas)
├── prompts/                 # LLM prompt templates
└── reminders/               # Reminder YAML templates
```

### CLI Commands

The `pnpm sidekick` CLI provides commands for managing sessions, personas, and development:

```bash
# List all tracked sessions
pnpm sidekick sessions --format=table

# Manage background daemon
pnpm sidekick daemon status
pnpm sidekick daemon start
pnpm sidekick daemon stop

# Manage development hooks
pnpm sidekick dev-mode status
pnpm sidekick dev-mode enable
pnpm sidekick dev-mode disable
pnpm sidekick dev-mode clean      # Truncate logs, kill daemon
pnpm sidekick dev-mode clean-all  # Full cleanup including sessions

# Launch web monitoring UI
pnpm sidekick ui
```

### Persona Commands

Change or test personas for a session:

```bash
# List available personas
pnpm sidekick persona list --format=table

# Set session persona
pnpm sidekick persona set <persona-id> --session-id=<session-id>

# Clear session persona (use default)
pnpm sidekick persona clear --session-id=<session-id>

# Test persona voice with snarky or resume message generation
pnpm sidekick persona test <persona-id> --session-id=<session-id> [--type=snarky|resume]
```

**Output format**: Use `--format=json` for structured output or `--format=table` for ASCII tables.

Available personas are defined in `assets/sidekick/personas/`.

## Development Patterns

### Dual-Scope Compatibility

All scripts must work in both contexts:

- **Project scope**: `.claude/` within this repository
- **User scope**: `~/.claude/` global directory

Use environment variables (`$CLAUDE_PROJECT_DIR`) and dynamic path resolution. See `scripts/setup-reminders.sh:186-254` for implementation patterns.

### Timestamp-Based Sync

Sync scripts only copy files newer than their destinations, preserving timestamps for idempotent operations.

## Troubleshooting

### Logging

Sidekick writes logs to `.sidekick/sidekick.log`. View with:

```bash
tail -f .sidekick/sidekick.log
```

**Enable debug logging**:

```bash
# Via environment variable
SIDEKICK_LOG_LEVEL=debug pnpm sidekick daemon start

# Via config file (.sidekick/sidekick.config)
core.logging.level=debug
```

### Daemon Issues

```bash
# Check daemon status
pnpm sidekick daemon status

# Kill and restart
pnpm sidekick daemon kill
pnpm sidekick daemon start

# Full cleanup (logs, state, sockets)
pnpm sidekick dev-mode clean-all
```

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
