# Sidekick Plugin for Claude Code

Opinionated AI coding companion with personas, session tracking, and contextual nudges.

## Features

- **Personas**: 17+ unique AI personalities to customize your coding experience
- **Session Tracking**: Track session context, costs, and progress
- **Smart Prompts**: Context-aware reminders and suggestions
- **Statusline**: Real-time session metrics in your terminal

## Installation

### Via Claude Code Plugin (Recommended)

```bash
# In a Claude Code session:
/plugin install sidekick
/plugin enable sidekick --user   # For all projects
# or
/plugin enable sidekick --project  # For current project only
```

### Manual Installation

1. Install the CLI globally:
   ```bash
   npm i -g @sidekick/cli
   ```

2. Add hooks to your Claude Code settings (`~/.claude/settings.json`):
   ```json
   {
     "hooks": {
       "SessionStart": [{ "hooks": [{ "type": "command", "command": "sidekick hook session-start" }] }],
       "SessionEnd": [{ "hooks": [{ "type": "command", "command": "sidekick hook session-end" }] }],
       "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "sidekick hook user-prompt-submit" }] }],
       "PreToolUse": [{ "hooks": [{ "type": "command", "command": "sidekick hook pre-tool-use" }] }],
       "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "sidekick hook post-tool-use" }] }],
       "Stop": [{ "hooks": [{ "type": "command", "command": "sidekick hook stop" }] }],
       "PreCompact": [{ "hooks": [{ "type": "command", "command": "sidekick hook pre-compact" }] }]
     },
     "statusLine": { "type": "command", "command": "sidekick statusline --hook" }
   }
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
npx @sidekick/cli persona list

# Set persona for current session
npx @sidekick/cli persona set marvin --session-id=<session-id>
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
