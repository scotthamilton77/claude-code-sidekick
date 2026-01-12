# Claude Code Configuration Lab

**Experimental proving ground for Claude Code hooks, commands, agents, and skills**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

This repository serves as a development and testing environment for [Claude Code](https://claude.com/claude-code) configurations before deploying them to your global `~/.claude` directory. It implements a dual-scope architecture where all capabilities work identically in both project-local and user-global contexts.

## TODOs

### Sidekick

- finish ROADMAP.md
- finish PLAN.MD (executing ARCH.md)
- can we be resilient to json file errors?  I just ran into a case of the session-summary.json being generated with trash after the last } which made it unreadable
- allow for different personalities - either explicit at install time or random per project or random per session or just random
  - moods: cynical, sarcastic, snarky, nerdy, arrogant, moody
  - persona: skippy, angry klingon, skeptical vulcan, Scotty, Bones, Dilbert
  - themes: scifi, crime drama, daytime television, soap opera, classic 80s tv sitcom, seinfeld & friends
- log rotation and log level to info by default
- BUG: uninstall from project leaves empty hooks folder
- how do subagents work - can we detect their connection to the parent agent, and do we care? (for statusline, maybe not, but for analytics?)

### Nice to Haves

- add automatic ralph wigguming?
- add support for task id extraction?
- add stakes and psychology to the user prompt reminder?  https://medium.com/@ichigoSan/i-accidentally-made-claude-45-smarter-heres-how-23ad0bf91ccf
- should this be a claude code plugin? There are plugin hooks referenced here: https://code.claude.com/docs/en/hooks
- take the reminder against the transcript to ask AI to evaluate which parts of the reminder may be most relevant for the situation and context
  - if we do this, we should have a 2 stage pipeline: pre-process CLAUDE.md's into stage 1 (more verbose/complete), then use that against context to generate point-in-time reminder
- add to the UserPromptSubmit a trigger to evaluate the user's prompt to see if the user is asking claude to do something that it should have already done, and record that as a possible RL item to factor into the reminder
- would it make sense to scan the ToDos and suggest to Claude to add to its todos any specific items relevant to the reminders? (Would this be more context-efficient?)
- make stop hook smarter?
  - Break it up into subsections that are conditional based on observed patterns of behavior, e.g. modification of files through bash commands, docs vs. source code mods, etc. if we just did a build or lint or ran tests, we can exclude that part
- feedback loops
  - Add a "confession" at the end of a task where the agent confesses what they did wrong, use for a learnings log?
  - learning mode? investigate https://medium.com/coding-nexus/rip-fine-tuning-how-stanfords-ace-framework-teaches-ai-to-learn-without-retraining-510f412d8579
- let's set up domain-specific agents to own packages or significant portions of packages where all changes to those packages require the domain agents to "sign off"

## Agents and Skills and Hooks

- testing https://github.com/diet103/claude-code-infrastructure-showcase - specifically the hooks integrated with skill intent and build purity
  - read through https://www.reddit.com/r/ClaudeAI/comments/1oivjvm/claude_code_is_a_beast_tips_from_6_months_of/ (same repo reference)
  - I might have lost prettier? (see settings copy.json)
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

**Available Plugins** (6 total):

- **session-summary**: LLM-based conversation analysis with adaptive polling
- **resume**: Async background resume generation when session summary changes significantly
- **statusline**: Enhanced statusline with token tracking, context bar, git branch, error/warning indicators
- **tracking**: Turn and tool counters for session management
- **reminder**: Two-tier reminder system: pause-and-reflect (tool cadence) and verify-completion (stop hook)
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

**Development & Analysis Tools**:

```bash
# Surgical session summary - analyze transcript at specific line
./scripts/analyze-topic-at-line.sh <session-id> --to-line 100

# Saves 4 artifacts: raw transcript, filtered (LLM input), prompt, topic
# Output: test-data/topic-analysis/<session-id>/0100-*.{jsonl,txt,json}

# Session simulation - verify production trigger logic
python3 scripts/simulate-session.py <session-id>

# Useful for tuning extraction logic and observing summary changes over time
```

**Legacy Setup Tests** (for reminder system migration):

```bash
./tests/test-setup-reminders.sh
./tests/test-cleanup-reminders.sh
./tests/test-response-tracker.sh
```

### Node Package Tests & Coverage

All TypeScript packages under `packages/` use Vitest with coverage enabled by default. Run the workspace tests after `pnpm install`:

```bash
pnpm test
```

Each package writes text, HTML, and LCOV coverage reports to its own `packages/<name>/coverage/` directory (gitignored). Open `coverage/index.html` inside any package to inspect the full report.

**Known Warning**: `pnpm install` emits `openai@4.x` → `zod@^3.23.8` peer complaints because we intentionally run `zod@^4.1.13` across the workspace for improved schema tooling. The OpenAI SDK still functions with zod 4, so we are ignoring the warning until we adopt OpenAI 6.x (which officially supports newer zod) or migrate to the Responses API.

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

Sidekick uses **modular configuration** with a five-level cascade (later sources override earlier):

**Modular Domains**:

- `config` - Feature flags, global settings
- `llm-core` - LLM infrastructure (provider, circuit breaker, timeouts)
- `llm-providers` - Provider-specific configs (API keys, models)
- `features` - Feature tuning parameters

**Cascade Levels**:

1. **Defaults**: `src/sidekick/*.defaults` (required, modular)
2. **User Installed**: `~/.claude/hooks/sidekick/*.conf` (optional, ephemeral)
3. **User Persistent**: `~/.sidekick/*.conf` (optional, survives install/uninstall)
4. **Project Deployed**: `.claude/hooks/sidekick/*.conf` (optional, ephemeral)
5. **Project Versioned**: `.sidekick/*.conf` (**highest priority**, persistent, can be committed)

**Templates**: After installation, `.sidekick/` and `~/.sidekick/` contain `*.conf.template` files. Rename to `*.conf` to activate.

**Override Strategies**:

- **Modular**: Create domain-specific .conf files (e.g., `llm-providers.conf` for LLM settings only)
- **Simple**: Use `sidekick.conf` to override any setting from any domain (single file, loads last)

**Example - Override LLM provider settings**:

```bash
# Rename template and customize (survives install/uninstall)
cd ~/.sidekick
mv llm-providers.conf.template llm-providers.conf
# Edit to set your provider and API key
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

**Environment Variables via `.env` Files**:

API keys and other settings can be configured via `.env` files instead of config files:

- **`~/.sidekick/.env`**: User-wide persistent (works in both user-only and project scopes)
- **Project root `.env`**: Shared with other tools (docker-compose, etc.)
- **`.sidekick/.env`**: Project sidekick-specific (highest priority)

Example `.env` file:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
OPENAI_API_KEY=sk-...
```

`.env` files are sourced automatically during `config_load()` and variables are auto-exported. Cascade: `~/.sidekick/.env` → project root `.env` → `.sidekick/.env` (latter wins).

**Use Case**: Put global API keys in `~/.sidekick/.env`, project-specific overrides in `.sidekick/.env`. Never commit `.env` to git.

See `src/sidekick/config.defaults` for all available options and `ARCH.md` for detailed provider documentation.

### Customizing Prompts and Reminders

Sidekick prompts and reminders use a 4-level file cascade, allowing you to override defaults without modifying installed files:

**Prompts** (`session-summary.prompt.txt`, `resume.prompt.txt`, `*.schema.json`):

1. `~/.claude/hooks/sidekick/prompts/` - User-wide installed (ephemeral)
2. `~/.sidekick/prompts/` - User-wide persistent
3. `.claude/hooks/sidekick/prompts/` - Project installed (ephemeral)
4. `.sidekick/prompts/` - Project persistent (git-committable)

**Reminders** (three types):

1. `user-prompt-submit.yaml` - Fires on each user prompt submission
2. `pause-and-reflect.yaml` - Unified cadence-based reminder (replaces are-you-stuck and time-for-user-update); fires based on tool count threshold (default: 40)
3. `verify-completion.yaml` - Fires on stop hook after file modifications; includes source code pattern filtering to reduce false positives

Each reminder type uses the same 4-level cascade:

1. `~/.claude/hooks/sidekick/reminders/` - User-wide installed (ephemeral)
2. `~/.sidekick/reminders/` - User-wide persistent
3. `.claude/hooks/sidekick/reminders/` - Project installed (ephemeral)
4. `.sidekick/reminders/` - Project persistent (git-committable)

**Reminder Templates**: The install script creates `.template` files for all three types in both `~/.sidekick/reminders/` (user scope) and `.sidekick/reminders/` (project scope). **Rename to remove `.template` suffix to activate your custom reminder**.

**Configuration** (via `assets/sidekick/defaults/features/reminders.defaults.yaml`):

```yaml
reminders:
  pause_and_reflect_threshold: 40  # Tool count threshold for pause-and-reflect
  verify_completion:
    enabled: true
    source_patterns:                # Skip verification for these file patterns
      - "*.test.ts"
      - "*.spec.ts"
```

**Usage Examples**:

```bash
# Override session summary prompt for all projects
mkdir -p ~/.sidekick/prompts
cp assets/sidekick/prompts/session-summary.prompt.txt ~/.sidekick/prompts/
# Edit ~/.sidekick/prompts/session-summary.prompt.txt

# Override pause-and-reflect reminder for this project
cp assets/sidekick/reminders/pause-and-reflect.yaml .sidekick/reminders/
# Edit .sidekick/reminders/pause-and-reflect.yaml
git add .sidekick/reminders/pause-and-reflect.yaml
git commit -m "Add custom pause-and-reflect reminder"

# Override verify-completion reminder for all projects
cp assets/sidekick/reminders/verify-completion.yaml ~/.sidekick/reminders/
# Edit ~/.sidekick/reminders/verify-completion.yaml
```

The first existing file in the cascade wins. Use `.sidekick/` for persistent overrides that survive install/uninstall.

## Node Runtime Migration (In Progress)

The Sidekick system is being migrated from Bash to Node/TypeScript for improved testability and maintainability. The migration is tracked in `docs/ROADMAP.md`.

### Current Status

| Phase   | Description                      | Status      |
| ------- | -------------------------------- | ----------- |
| Phase 1 | Bootstrap CLI & Runtime Skeleton | Complete    |
| Phase 2 | Configuration & Asset Resolution | Complete    |
| Phase 3 | Structured Logging & Telemetry   | Complete    |
| Phase 4 | Core Services & Providers        | Complete    |
| Phase 5 | Daemon & Background Tasks        | Complete    |
| Phase 6 | Feature Enablement & Integration | In Progress |
| Phase 7 | Installation & Distribution      | Pending     |

### Package Structure

```
packages/
├── types/                   # Shared TypeScript types
├── sidekick-core/           # Core services (config, transcript, logging, scope)
├── shared-providers/        # LLM provider abstractions (OpenRouter default)
├── feature-reminders/       # Reminder staging (pause-and-reflect, verify-completion)
├── feature-session-summary/ # LLM-based conversation analysis
├── feature-statusline/      # Token tracking, context bar, git branch, log metrics
├── sidekickd/               # Orchestration, context metrics, session management
├── sidekick-cli/            # CLI entrypoint and hook dispatcher
└── sidekick-ui/             # Monitoring UI (React SPA mockup)

assets/sidekick/             # Shared prompts, schemas, defaults
├── defaults/                # External YAML defaults (config cascade layer 0)
├── prompts/
└── reminders/
```

### Running the Node CLI (Development)

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Type check
pnpm tsc --noEmit

# Execute CLI directly
node packages/sidekick-cli/dist/bin.js session-start --hook
```

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

- `log_debug/log_info/log_warn`: Can be enabled via `--log-to-console` flag
- `log_error`: ALWAYS visible (critical errors bypass flag)
- Hook scripts use default behavior (console logging disabled) to prevent log pollution in JSON output

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

1. `--log-to-console` CLI flag
2. `SIDEKICK_CONSOLE_LOGGING` environment variable
3. `SIDEKICK_CONSOLE_LOGGING` config file setting
4. Default: `false` (console logging disabled)

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
