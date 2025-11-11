# Claude Code Configuration Lab

**Experimental proving ground for Claude Code hooks, commands, agents, and skills**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

This repository serves as a development and testing environment for [Claude Code](https://claude.com/claude-code) configurations before deploying them to your global `~/.claude` directory. It implements a dual-scope architecture where all capabilities work identically in both project-local and user-global contexts.

## TODOs

### Sidekick

- tracking and reminders
  - option to automate the turn-cadence-reminder.md message on install ("most urgent stuff from CLAUDEs")
   - STATUS: this is working, but: (a) should generate the .txt file, not the .template file, and (b) we still need the tool-cadence version generated
- response tracker
   - what if we include in the sleeper process a watch of the tanscript to also count additional messages beyond user submitted?  we might watch for "informative" updates based on the message type?
- sleeper process
   - is this per session?  what happens when a new session is started?  Does the sleeper just time out without further API calls (it should)?
- PLAN.MD (executing ARCH.md)
  - standardize parameter names and styles in the scripts (e.g. --project-dir vs. not, internally using output_dir, etc.)
- should this be a claude code plugin?  There are plugin hooks referenced here: https://code.claude.com/docs/en/hooks
- tune the topic extracter to follow the last n turns (delta + 10?) - this combined with previous goal snapshot might be cheaper?
- tune the instructions for the topic extraction (little shorter, more cynical)
- improve analysis and snarkiness
   - analysis
      - should call out rationale, keywords
      - should over-weight existing/current stated goals
   - we need 2 API calls, one for the analysis (low-temp), another for the snark (configurable temperature)
   - this would allow us to use different models
- allow for different personalities - either explicit at install time or random per project or random per session or just random
  - moods: cynical, sarcastic, snarky, nerdy, arrogant, moody
  - persona: angry klingon, skeptical vulcan, Scotty, Bones
  - themes: scifi, crime drama, daytime television, soap opera, classic 80s tv sitcom, seinfeld & friends
- allow a "concise" topic mode during setup that chooses concise template files
  - allow the line length hints to be configurable
  - allow the statusline topic format to be configurable
  - maybe just allow for project-level overrides (template file input parameter and/or user and project level overrides)
- statusline token counter and context % are way off? If we can't get close to /context, let's remove the %
- log rotation and log level to info by default
- BUG: uninstall from project leaves empty hooks folder
- how do subagents work - can we detect their connection to the parent agent, and do we care? (for statusline, maybe not, but for analytics?)
- skills and agents - review carefully and attribute to https://github.com/obra/superpowers
- learning mode? investigate https://medium.com/coding-nexus/rip-fine-tuning-how-stanfords-ace-framework-teaches-ai-to-learn-without-retraining-510f412d8579
- is it time to move to something more robust than bash?
   - incorporate https://github.com/johannschopplich/toon

## Agents and Skills

- agents, skills, CLAUDE.md, settings.json - I've moved these into src/.claude/ for now - we'll need to make these installable/uninstallable as components too
- Can we have a skill and/or agent that intersects the task list and plan for when claude starts to execute a plan and (a) checks it against the user request and requirements to catch scope creep and (b) checks against unnecessary complexity keeping YAGNI and DRY and KISS principles in play?
- sync, push - these should not clobber settings and mcp, but rather merge; for claude.md, ask to replace

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
./scripts/setup-reminders.sh

# For project-scope testing (includes local settings)
./scripts/setup-reminders.sh --project
```

3. Test the installation:

```bash
./tests/test-setup-reminders.sh
./tests/test-cleanup-reminders.sh
```

## Architecture

### Directory Structure

```
.
├── .claude/                    # Project-scoped Claude configuration
│   ├── hooks/                  # Conversation event handlers
│   │   └── reminders/          # LEGACY: Reminder-related hooks (see Sidekick)
│   │       ├── write-topic.sh      # Topic classification
│   │       ├── write-unclear-topic.sh
│   │       └── response-tracker.sh # Response monitoring
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
│   ├── setup-reminders.sh      # Permission/statusline setup
│   ├── cleanup-reminders.sh    # Remove permissions/statusline
│   ├── pull-from-claude.sh     # Import from ~/.claude
│   ├── push-to-claude.sh       # Export to ~/.claude
│   └── sync-claude.sh          # Bidirectional sync
└── tests/                      # Test harnesses
```

### Hook System (Sidekick)

The Sidekick system provides a **plugin-based hook architecture** that executes at conversation events to enhance Claude Code behavior.

**How It Works**:

- Claude invokes `sidekick.sh <hook-type>` at conversation events (SessionStart, UserPromptSubmit, Statusline)
- Each invocation **discovers and loads all enabled plugins** in dependency order
- Plugins implement hook functions (e.g., `tracking_on_user_prompt_submit()`) which get invoked if defined
- **Dependency resolution** ensures plugins load in correct order (e.g., reminder loads after tracking)

**Available Plugins** (7 total):

- **topic-extraction**: LLM-based conversation analysis with adaptive polling
- **resume**: Async background resume generation when topic changes significantly
- **statusline**: Enhanced statusline with token tracking, git branch, topic display
- **tracking**: Turn and tool counters for session management
- **reminder**: Three-tier reminder system (turn-cadence, tool-cadence, tools-per-turn) with independent thresholds
- **post-tool-use**: Tool activity tracking with cadence-based and threshold-based reminders
- **cleanup**: Automatic garbage collection of old session directories

**Plugin Features**:

- **Declarative dependencies**: Plugins declare `PLUGIN_DEPENDS="other-plugin"` for explicit ordering
- **Selective implementation**: Plugins implement only the hooks they need (not all plugins run on every event)
- **Independent toggles**: Each plugin has `FEATURE_<NAME>=true/false` config flag
- **Topological sort**: Dependency graph automatically resolved (detects cycles and missing deps)

See `ARCH.md` for complete architecture documentation and `CLAUDE.md` for plugin development guide. Sidekick maintains session state in `.sidekick/sessions/` at the project root (gitignored).

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

**Sidekick Test Suite**:

```bash
# Run all unit tests (mocked LLM, zero API costs)
./scripts/tests/run-unit-tests.sh

# Run all integration tests (mocked data, zero API costs)
./scripts/tests/run-integration-tests.sh

# EXPENSIVE: Test real LLM providers (makes actual API calls)
./scripts/tests/integration/test-llm-providers.sh
```

**IMPORTANT**: Unit and integration tests use mocks - no API costs. The `test-llm-providers.sh` suite is intentionally excluded from default test runs to prevent accidental charges.

**Legacy Setup Tests** (for reminder system migration):

```bash
./tests/test-setup-reminders.sh
./tests/test-cleanup-reminders.sh
./tests/test-response-tracker.sh
```

## Configuration

### Sync Exclusions

Edit `.claudeignore` to exclude files from sync operations:

```
.credentials.json
*.local.json
.sidekick/*.log         # Exclude log files (e.g., sidekick.log)
.sidekick/sessions/     # Exclude session data
*.backup
```

**Note**: `.sidekick/sidekick.conf` and `.sidekick/README.md` are NOT excluded and can be committed for team-wide configuration.

Supports glob patterns for both files and directories.

### MCP Servers

The repository includes configurations for:

- **context7**: External documentation context
- **sequential-thinking**: Advanced reasoning assistance
- **zen**: Specialized Python-based tooling
- **memory**: Conversation memory management

Configure in `.claude/mcp.json`.

### Sidekick Configuration Cascade

Sidekick uses a five-level configuration cascade (later sources override earlier):

1. **Defaults**: `src/sidekick/config.defaults`
2. **User Installed**: `~/.claude/hooks/sidekick/sidekick.conf` (ephemeral, deleted on uninstall)
3. **User Persistent**: `~/.sidekick/sidekick.conf` (survives install/uninstall)
4. **Project Deployed**: `.claude/hooks/sidekick/sidekick.conf` (ephemeral, deleted on uninstall)
5. **Project Versioned**: `.sidekick/sidekick.conf` (**highest priority**, persistent, can be committed)

**Recommended approach**: Use `.sidekick/sidekick.conf` for team-wide project settings that should be version-controlled. Use `~/.sidekick/sidekick.conf` for personal preferences that apply across all projects.

**Example - Personal preferences for all projects**:
```bash
# Create persistent user config (survives install/uninstall)
mkdir -p ~/.sidekick
cat > ~/.sidekick/sidekick.conf <<'EOF'
LOG_LEVEL=debug
TOPIC_CADENCE_HIGH=15
EOF
```

### LLM Provider Configuration

Sidekick supports pluggable LLM backends for conversation analysis and resume generation. Configure in any config file above:

**Claude CLI (default)**:

```bash
LLM_PROVIDER=claude-cli
LLM_CLAUDE_MODEL=haiku  # haiku, sonnet, opus
```

**OpenAI API**:

```bash
LLM_PROVIDER=openai-api
LLM_OPENAI_API_KEY=sk-...
LLM_OPENAI_MODEL=gpt-4-turbo
```

**OpenRouter API**:

```bash
LLM_PROVIDER=openrouter
LLM_OPENROUTER_API_KEY=sk-or-...
LLM_OPENROUTER_MODEL=sao10k/l3-lunaris-8b  # or anthropic/claude-3.5-sonnet, meta-llama/llama-3.1-8b-instruct
```

**Custom Provider**:

```bash
LLM_PROVIDER=custom
LLM_CUSTOM_BIN=/usr/local/bin/ollama
LLM_CUSTOM_MODEL=llama2
LLM_CUSTOM_COMMAND={BIN} run {MODEL} < {PROMPT_FILE}
```

See `src/sidekick/config.defaults` for all available options and `ARCH.md` for detailed provider documentation.

### Customizing Prompts and Reminders

Sidekick prompts and reminders use a 4-level file cascade, allowing you to override defaults without modifying installed files:

**Prompts** (`topic.prompt.txt`, `resume.prompt.txt`, `*.schema.json`):
1. `~/.claude/hooks/sidekick/prompts/` - User-wide installed (ephemeral)
2. `~/.sidekick/prompts/` - User-wide persistent
3. `.claude/hooks/sidekick/prompts/` - Project installed (ephemeral)
4. `.sidekick/prompts/` - Project persistent (git-committable)

**Reminders** (three types):
1. `turn-cadence-reminder.txt` - Fires every N user prompts (default: 4)
2. `tool-cadence-reminder.txt` - Fires every N total tool calls (default: 50)
3. `tools-per-turn-reminder.txt` - Fires when single turn exceeds threshold (default: 20 tools, interruptive)

Each reminder type uses the same 4-level cascade:
1. `~/.claude/hooks/sidekick/reminders/` - User-wide installed (ephemeral)
2. `~/.sidekick/reminders/` - User-wide persistent
3. `.claude/hooks/sidekick/reminders/` - Project installed (ephemeral)
4. `.sidekick/reminders/` - Project persistent (git-committable)

**Reminder Templates**: The install script creates `.template` files for all three types in both `~/.sidekick/reminders/` (user scope) and `.sidekick/reminders/` (project scope). **Rename to remove `.template` suffix to activate your custom reminder**.

**Configuration**:
```bash
# config.defaults or sidekick.conf
TURN_CADENCE=4                  # Every 4 user prompts
TOOL_CADENCE=50                 # Every 50 total tool calls
TOOLS_PER_TURN_THRESHOLD=20     # When single response exceeds 20 tools
```

**Usage Examples**:

```bash
# Override topic extraction prompt for all projects
mkdir -p ~/.sidekick/prompts
cp ~/.claude/hooks/sidekick/prompts/topic.prompt.txt ~/.sidekick/prompts/
# Edit ~/.sidekick/prompts/topic.prompt.txt

# Override turn-cadence reminder for this project (using template)
mv .sidekick/reminders/turn-cadence-reminder.txt.template .sidekick/reminders/turn-cadence-reminder.txt
# Edit .sidekick/reminders/turn-cadence-reminder.txt
git add .sidekick/reminders/turn-cadence-reminder.txt
git commit -m "Add custom turn-cadence reminder"

# Override tools-per-turn reminder for all projects (using template)
mv ~/.sidekick/reminders/tools-per-turn-reminder.txt.template ~/.sidekick/reminders/tools-per-turn-reminder.txt
# Edit ~/.sidekick/reminders/tools-per-turn-reminder.txt
```

The first existing file in the cascade wins. Use `.sidekick/` for persistent overrides that survive install/uninstall.

## Development Patterns

### Dual-Scope Compatibility

All scripts must work in both contexts:

- **Project scope**: `.claude/` within this repository
- **User scope**: `~/.claude/` global directory

Use environment variables (`$CLAUDE_PROJECT_DIR`) and dynamic path resolution. See `scripts/setup-reminders.sh:186-254` for implementation patterns.

### Timestamp-Based Sync

Sync scripts only copy files newer than their destinations, preserving timestamps for idempotent operations.

## Troubleshooting

### Console vs File Logging

Sidekick uses a two-tier logging system:

**Console Logging (stderr)**:
- `log_debug/log_info/log_warn`: Can be suppressed via `--no-console-logging` flag
- `log_error`: ALWAYS visible (critical errors bypass suppression)
- Hook scripts automatically use `--no-console-logging` to prevent log pollution in JSON output

**File Logging**:
- ALWAYS enabled regardless of console logging setting
- Session logs: `.sidekick/sessions/<session_id>/sidekick.log`
- Global log: `.sidekick/sidekick.log`

**To view logs when console output is suppressed**:
```bash
# View current session logs
tail -f .sidekick/sessions/*/sidekick.log | sort -r | head -100

# View all logs
tail -f .sidekick/sidekick.log
```

**To enable console logging for debugging**:
```bash
# Via environment variable
SIDEKICK_CONSOLE_LOGGING=true sidekick.sh session-start < input.json

# Via config file (~/.sidekick/sidekick.conf or .sidekick/sidekick.conf)
echo "SIDEKICK_CONSOLE_LOGGING=true" >> ~/.sidekick/sidekick.conf
```

**Precedence** (highest to lowest):
1. `--no-console-logging` CLI flag
2. `SIDEKICK_CONSOLE_LOGGING` environment variable
3. `SIDEKICK_CONSOLE_LOGGING` config file setting
4. Default: `true` (console logging enabled)

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
