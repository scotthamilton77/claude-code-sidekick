# Sidekick Plugin for Claude Code

Opinionated AI coding companion with personas, session tracking, and contextual nudges.

## Features

- **Personas**: 17+ unique AI personalities to customize your coding experience
- **Session Tracking**: Track session context, costs, and progress
- **Smart Prompts**: Context-aware reminders and suggestions
- **Statusline**: Real-time session metrics in your terminal

## Installation

### Via Claude Code Marketplace (Recommended)

```bash
# Add the marketplace
claude plugin marketplace add scotthamilton77/claude-code-sidekick

# Install the plugin
claude plugin install sidekick@claude-code-sidekick

# Enable for all projects (user scope) or current project only
claude plugin enable sidekick@claude-code-sidekick --scope user
# or
claude plugin enable sidekick@claude-code-sidekick --scope project
```

After installation, hooks use `npx @scotthamilton77/sidekick` to run commands. The npm package is fetched automatically on first use.

### Manual Installation (via --plugin-dir)

For development or testing, you can point Claude Code directly at the plugin:

```bash
claude --plugin-dir=/path/to/claude-code-sidekick/packages/sidekick-plugin
```

## Configuration

Use the `/sidekick-config` skill in Claude Code to configure sidekick interactively, or configure manually:

### Configuration Locations

| Scope | Location | Use When |
|-------|----------|----------|
| User | `~/.sidekick/` | Personal defaults across all projects |
| Project | `.sidekick/` | Project-specific, shared with team |

### Quick Settings

Create `.sidekick/sidekick.config` or `~/.sidekick/sidekick.config`:

```bash
# Change default LLM profile
llm.defaultProfile=creative

# Customize statusline format
features.statusline.settings.format={model} | {tokenPercentageActual}
```

### Change Persona

```bash
# List available personas
npx @scotthamilton77/sidekick persona list

# Set persona for current session
npx @scotthamilton77/sidekick persona set marvin --session-id=<session-id>
```

## Available Personas

- **Marvin** - The paranoid android from Hitchhiker's Guide
- **Skippy** - The irreverent AI from Expeditionary Force
- **Jarvis** - The sophisticated AI assistant
- **Data** - The logical android from Star Trek
- And 12+ more...

## Documentation

- [User Guide](https://github.com/scotthamilton77/claude-code-sidekick/blob/main/docs/USER-GUIDE.md)
- [Developer Guide](https://github.com/scotthamilton77/claude-code-sidekick/blob/main/docs/DEVELOPER-GUIDE.md)
- [Architecture](https://github.com/scotthamilton77/claude-code-sidekick/blob/main/docs/ARCHITECTURE.md)

## License

MIT
