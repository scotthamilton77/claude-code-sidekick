# Claude Code Configuration Lab

**Experimental proving ground for Claude Code hooks, commands, agents, and skills**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

This repository serves as a development and testing environment for [Claude Code](https://claude.com/claude-code) configurations before deploying them to your global `~/.claude` directory. It implements a dual-scope architecture where all capabilities work identically in both project-local and user-global contexts.

## TODOs

## Sidekick
- llm quality and speed benchmark testing needed
   - try with and without system prompt separate from user prompt
- 2>&1 issues - see below
- CURL timeouts - are we too aggressive?
   - do we need timeout retries?
- DRY issues
   - llm.sh DRY
   - transcript pre-processing
   - topic-extraction and generate-resume have lots of overlap - DRY!
   - json schema vs. prompt overlap
   1. Shared transcript extraction (lines 26-59 in topic-extraction.sh, lines 49-76 in generate-resume.sh)
      - Move to lib/transcript.sh as transcript_extract_excerpt()
   2. Shared model config (lines 207-234 in topic-extraction.sh, lines 90-116 in generate-resume.sh)
      - Already centralized in lib/llm.sh, just ensure both use it consistently
   3. Shared preprocessing (jq filters for stripping attributes)
      - Could be a constant in lib/json.sh
- json schema for resume message generator
- incorporate https://github.com/johannschopplich/toon
- We need some quality memories on the models, e.g. our current gemma is failing miserably to return the right json; we could try a more advanced gemma model, or else we'll need to upgrade
- remove .claudeignore if not useful
- tracking and reminders
   - make sure we log when it happens
   - do we want to have multiple reminders with different cadences?
- PLAN.MD (executing ARCH.md)
   - standardize parameter names and styles in the scripts (e.g. --project-dir vs. not, internally using output_dir, etc.)
- tune the topic extracter to follow the last n turns (delta + 10?) - this combined with previous goal snapshot might be cheaper?
- tune the instructions for the topic extraction (little shorter, more cynical)
- allow for different personalities - either explicit at install time or random per project or random per session or just random
   - moods: cynical, sarcastic, snarky, nerdy, arrogant, moody
   - persona: angry klingon, skeptical vulcan, Scotty, Bones
   - themes: scifi, crime drama, daytime television, soap opera, classic 80s tv sitcom, seinfeld & friends
- allow a "concise" topic mode during setup that chooses concise template files
   - allow the line length hints to be configurable
   - allow the statusline topic format to be configurable
   - maybe just allow for project-level overrides (template file input parameter and/or user and project level overrides)
- statusline token counter and context % are way off?  If we can't get close to /context, let's remove the %
- log rotation and log level to info by default
- BUG: uninstall from project leaves empty hooks folder
- how do subagents work - can we detect their connection to the parent agent, and do we care?  (for statusline, maybe not, but for analytics?)
- skills and agents - review carefully and attribute to https://github.com/obra/superpowers

### stdout/stderr analysis

✅ GOOD USES

1. Silencing checks (don't care about output at all):
if ps -p "$pid" >/dev/null 2>&1; then
   # Just checking existence
fi
2. Logging both streams together:
./run-benchmark.sh 2>&1 | tee log.txt  # Interleaved stdout/stderr in log
3. Test validation (intentionally checking all output):
output=$(command 2>&1)  # Test framework needs to validate errors

❌ BAD USES (Your Bug!)

Capturing function output in command substitution:
result=$(my_function 2>&1)  # PROBLEM: mixes return data with error messages

This breaks when:
- Function outputs data to stdout (the "return value")
- Function outputs errors to stdout (should be stderr!)
- Caller expects clean data but gets garbage mixed in

🔧 The Fix

Option 1: Fix the function (preferred for libraries):
llm_invoke_with_provider() {
   if [ $exit_code -eq 0 ]; then
         echo "$result"  # Data to stdout
         return 0
   else
         # ALL error output to stderr
         echo "=== LLM INVOCATION FAILED ===" >&2
         echo "Provider: $provider" >&2
         echo "Model: $model" >&2
         return 1
   fi
}

# Now caller doesn't need 2>&1
result=$(llm_invoke_with_provider "$provider" "$model" "$prompt")

Option 2: Use temp files (when you need error details):
error_file=$(mktemp)
if result=$(my_function 2>"$error_file"); then
   # Success: result has clean data
else
   # Failure: can read error details from error_file
   errors=$(cat "$error_file")
fi
rm -f "$error_file"

🎯 The Real Problem

Your codebase has two conflicting design patterns:

1. Pattern A (library functions): Return data via stdout, errors via stderr
2. Pattern B (your similarity.sh:293-299): Return errors via stdout "for RAW_FILE capture"

When you mix these patterns with 2>&1, chaos ensues.

Recommendation

Refactor llm_invoke_with_provider in similarity.sh:290-308 to send ALL error output to stderr. The "RAW_FILE" argument in the comment is misleading - you're not in the benchmark script
context there, you're in a library function that should follow stderr conventions.

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

**Available Plugins** (6 total):
- **topic-extraction**: LLM-based conversation analysis with adaptive polling
- **resume**: Async background resume generation when topic changes significantly
- **statusline**: Enhanced statusline with token tracking, git branch, topic display
- **tracking**: Response counter for session management
- **reminder**: Periodic static reminders at configurable cadence (depends on tracking)
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

Sidekick uses a four-level configuration cascade (later sources override earlier):

1. **Defaults**: `src/sidekick/config.defaults`
2. **User Global**: `~/.claude/hooks/sidekick/sidekick.conf` (user-wide overrides)
3. **Project Deployed**: `.claude/hooks/sidekick/sidekick.conf` (ephemeral, deleted on uninstall)
4. **Project Versioned**: `.sidekick/sidekick.conf` (**highest priority**, persistent, can be committed)

**Recommended approach**: Use `.sidekick/sidekick.conf` for team-wide project settings that should be version-controlled.

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

## Development Patterns

### Dual-Scope Compatibility

All scripts must work in both contexts:
- **Project scope**: `.claude/` within this repository
- **User scope**: `~/.claude/` global directory

Use environment variables (`$CLAUDE_PROJECT_DIR`) and dynamic path resolution. See `scripts/setup-reminders.sh:186-254` for implementation patterns.

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
