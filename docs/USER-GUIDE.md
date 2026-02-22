# Sidekick User Guide

Sidekick is a Claude Code hooks companion that adds session summaries, reminders, a statusline, personas, and a monitoring UI to your Claude Code sessions. It runs as a background daemon, processing hook events asynchronously without blocking your conversation.

---

## Table of Contents

- [Installation](#installation)
- [Setup Wizard](#setup-wizard)
- [Configuration](#configuration)
- [CLI Commands](#cli-commands)
- [Features](#features)
- [Personas](#personas)
- [Troubleshooting](#troubleshooting)

---

## Installation

### Prerequisites

| Tool | Version | Install (macOS) |
|------|---------|-----------------|
| [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) | Latest | [Install guide](https://docs.claude.com/en/docs/claude-code) |
| [Node.js](https://nodejs.org/) | >=20.x | [nodejs.org](https://nodejs.org/) |

Sidekick also requires an **OpenRouter API key** for LLM-powered features (session titles, topic classification, completion detection, and persona messages). Get one at [openrouter.ai](https://openrouter.ai/).

### Run the Setup Wizard

The setup wizard handles everything -- plugin installation, statusline, gitignore, personas, and API keys:

```bash
npx -y @scotthamilton77/sidekick setup
```

The wizard walks through seven steps:

1. **Plugin installation** -- installs the marketplace and plugin (offers scope selection: user, project, or local).
2. **Statusline** -- configures the Claude Code status bar (user or project scope).
3. **Git configuration** -- adds `.sidekick/` to `.gitignore` so logs and session data are not committed.
4. **API key configuration** -- configures your OpenRouter API key for all LLM features.
5. **Persona features** -- enable/disable AI personas (Marvin, Skippy, etc.).
6. **Auto-configuration** -- whether Sidekick should auto-configure when you enter a new project.
7. **Shell alias** -- optionally adds a `sidekick` shell alias to your `.zshrc` or `.bashrc` so you can type `sidekick` instead of `npx @scotthamilton77/sidekick`.

After setup completes, you should see the Sidekick statusline and persona greeting in your Claude Code session.

### What If Setup Is Incomplete?

Sidekick detects incomplete or unhealthy configurations and notifies you automatically:

- **Statusline warning** -- shows a setup message instead of the normal status bar.
- **Session messages** -- at session start and after submitting prompts, Sidekick tells Claude Code that setup is incomplete and suggests running setup.
- **In-session fix** -- use the `/sidekick-config` skill inside Claude Code to diagnose and resolve issues without leaving your session.

You can also run the doctor command from the terminal:

```bash
npx -y @scotthamilton77/sidekick doctor
```

For contributing to the Sidekick codebase, see the [Developer Guide](DEVELOPER-GUIDE.md).

---

## Setup Wizard

The setup wizard configures plugin installation, statusline, gitignore, personas, and API keys.

### Interactive Mode

```bash
npx -y @scotthamilton77/sidekick setup
```

The wizard walks through seven steps:

1. **Plugin Installation** -- verifies the marketplace and plugin are installed; offers to install if missing.
2. **Statusline Configuration** -- user-level (`~/.claude/settings.json`, works everywhere) or project-level (`.claude/settings.local.json`, this project only).
3. **Git Configuration** -- adds `.sidekick/` entries to `.gitignore` so logs and session data are not committed.
4. **API Key Configuration** -- configures your OpenRouter API key for all LLM features (session titles, topic classification, completion detection, and persona messages).
5. **Persona Features** -- enable/disable AI personas (Marvin, Skippy, etc.).
6. **Auto-Configuration** -- whether Sidekick should auto-configure when you enter a new project. Only available when the plugin is installed at user scope, since auto-configure relies on hooks firing globally.
7. **Shell Alias** -- optionally adds a `sidekick` shell alias to your `.zshrc` or `.bashrc` so you can type `sidekick` instead of `npx @scotthamilton77/sidekick`. Supported on zsh and bash only.

`install` is an alias for `setup` -- both run the same wizard.

### Non-Interactive Mode

For scripting or CI, pass flags directly:

```bash
npx -y @scotthamilton77/sidekick setup --statusline-scope=user --gitignore --personas
npx -y @scotthamilton77/sidekick setup --force   # Apply all defaults non-interactively
```

Available scripting flags:

| Flag | Description |
|------|-------------|
| `--marketplace-scope=user\|project\|local` | Install marketplace at scope |
| `--plugin-scope=user\|project\|local` | Install plugin at scope |
| `--statusline-scope=user\|project\|local` | Configure statusline scope |
| `--gitignore` / `--no-gitignore` | Update or skip .gitignore |
| `--personas` / `--no-personas` | Enable or disable personas |
| `--api-key-scope=user\|project` | Save API key from `OPENROUTER_API_KEY` env var |
| `--auto-config=auto\|manual` | Auto-configure preference (requires `--plugin-scope=user`) |
| `--alias` / `--no-alias` | Add or remove `sidekick` shell alias (zsh/bash) |
| `--check` | Check configuration status (equivalent to `sidekick doctor`) |
| `--force` | Apply all defaults without prompting |

---

## Configuration

### Cascade System

Configuration loads from multiple layers. Later layers override earlier ones:

1. **Bundled Defaults** -- `assets/sidekick/defaults/*.yaml` (shipped with Sidekick)
2. **User Domain YAML** -- `~/.sidekick/*.yaml`
3. **User Unified Config** -- `~/.sidekick/sidekick.config`
4. **Project Domain YAML** -- `.sidekick/*.yaml`
5. **Project Unified Config** -- `.sidekick/sidekick.config`
6. **Environment Variables** -- `SIDEKICK_*` prefixed vars

### Configuration Domains

Each domain is a separate YAML file:

| Domain | File | What It Controls |
|--------|------|------------------|
| Core | `core.yaml` | Logging, paths, daemon, IPC settings |
| LLM | `llm.yaml` | LLM provider, model profiles, routing |
| Transcript | `transcript.yaml` | Transcript watch debounce, metrics persistence |
| Features | `features.yaml` | Feature flags and per-feature settings |

Place overrides in `~/.sidekick/` (user-level) or `.sidekick/` (project-level).

### Quick Override (dot-notation)

The `sidekick.config` file supports dot-notation for quick changes without writing YAML:

```bash
# ~/.sidekick/sidekick.config or .sidekick/sidekick.config
core.logging.level=debug
llm.defaultProfile=creative
features.statusline.enabled=true
features.reminders.settings.pause_and_reflect_threshold=40
```

### Core Configuration (`core.yaml`)

```yaml
logging:
  level: info              # trace, debug, info, warn, error, fatal
  format: pretty           # pretty (human-readable) or json (structured)
  consoleEnabled: false    # Also log to console (in addition to file)
  # Per-component overrides:
  # components:
  #   reminders: debug
  #   statusline: trace

paths:
  state: .sidekick         # State directory (relative to project root)

daemon:
  idleTimeoutMs: 300000    # Idle shutdown: 5 minutes
  shutdownTimeoutMs: 30000 # Graceful shutdown timeout: 30 seconds

ipc:
  connectTimeoutMs: 5000
  requestTimeoutMs: 30000
  maxRetries: 3
  retryDelayMs: 100
```

### LLM Configuration (`llm.yaml`)

Sidekick uses named LLM profiles that features reference. The default profile is `fast-lite`.

```yaml
defaultProfile: fast-lite

profiles:
  fast-lite:
    provider: openrouter
    model: google/gemini-2.0-flash-lite-001
    temperature: 0
    maxTokens: 1000
    timeout: 15
    timeoutMaxRetries: 2

  creative:
    provider: openrouter
    model: google/gemini-2.5-flash-lite
    temperature: 1.2
    maxTokens: 25
    timeout: 10
    timeoutMaxRetries: 2

  creative-long:
    provider: openrouter
    model: qwen/qwen3-235b-a22b-2507
    temperature: 1.2
    maxTokens: 500
    timeout: 20
    timeoutMaxRetries: 2

fallbacks:
  cheap-fallback:
    provider: openrouter
    model: google/gemini-2.5-flash-lite
    temperature: 0
    maxTokens: 1000
    timeout: 30
    timeoutMaxRetries: 3
```

To change the default LLM or add your own profile, create `~/.sidekick/llm.yaml`:

```yaml
defaultProfile: my-custom
profiles:
  my-custom:
    provider: openrouter
    model: openai/gpt-5-nano
    temperature: 0.3
    maxTokens: 1000
    timeout: 15
```

**Provider routing** -- control which backend providers OpenRouter uses:

```yaml
profiles:
  routed-example:
    provider: openrouter
    model: openai/gpt-oss-20b
    providerAllowlist:       # Only use these (maps to provider.only)
      - deepinfra/fp4
      - groq
    providerBlocklist:       # Never use these (maps to provider.ignore)
      - azure
```

### API Key Storage

API keys can be stored in three locations (checked in this order):

1. **Project** -- `.sidekick/.env` (`OPENROUTER_API_KEY=sk-or-v1-...`)
2. **User** -- `~/.sidekick/.env` (`OPENROUTER_API_KEY=sk-or-v1-...`)
3. **Environment** -- `OPENROUTER_API_KEY` shell variable

The setup wizard handles API key configuration. You can also set it manually:

```bash
# User-level (recommended)
mkdir -p ~/.sidekick
echo "OPENROUTER_API_KEY=sk-or-v1-your-key-here" >> ~/.sidekick/.env
```

### Feature Configuration (`features.yaml`)

Each feature has an `enabled` flag and a `settings` block. Override in `~/.sidekick/features.yaml` or `.sidekick/features.yaml`:

#### Statusline

```yaml
statusline:
  enabled: true
  settings:
    format: "{personaName,prefix='[',suffix='] | '}{model,prefix='[',suffix='] | '}{contextBar} {tokenPercentageActual} | {logs} | {cwd}{branch}\n{title} | {summary}"
    thresholds:
      tokens:
        warning: 100000
        critical: 160000
      cost:
        warning: 0.5
        critical: 1.0
    theme:
      useNerdFonts: safe    # "full", "safe" (BMP-only), or "ascii"
      colors:
        model: blue
        tokens: green
        title: blue
        summary: magenta
```

Available statusline placeholders:

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{model}` | Current model name | `Opus` |
| `{contextBar}` | Visual context usage graph | `[##.\|...]` |
| `{contextWindow}` | Total context window | `200k` |
| `{tokenUsageActual}` | Current token count | `45k` |
| `{tokenPercentageActual}` | Usage as % of context | `22%` |
| `{tokenUsageEffective}` | Tokens + compaction buffer | `90k` |
| `{tokenPercentageEffective}` | Effective usage % | `45%` |
| `{logs}` | Warning/error counts | `W:0 E:0` |
| `{cost}` | Session cost | `$0.15` |
| `{duration}` | Session duration | `12m` |
| `{cwd}` | Working directory | |
| `{branch}` | Git branch | `main` |
| `{title}` | Session title | |
| `{summary}` | Session intent summary | |
| `{personaName}` | Active persona name | `Marvin` |

Conditional prefix/suffix: `{token,prefix='[',suffix='] '}` renders prefix and suffix only when the token value is non-empty.

#### Reminders

```yaml
reminders:
  enabled: true
  settings:
    pause_and_reflect_threshold: 60    # Tool calls before checkpoint
    max_verification_cycles: -1        # -1 = unlimited, 0 = disabled
    source_code_patterns:              # Globs that trigger verify-completion
      - "**/*.ts"
      - "**/*.py"
      # ... (see defaults for full list)
    completion_detection:
      enabled: true
      confidence_threshold: 0.7
      llm:
        profile: fast-lite
        fallback_profile: cheap-fallback
```

#### Session Summary

```yaml
session-summary:
  enabled: true
  settings:
    excerptLines: 80
    includeToolMessages: true
    includeToolOutputs: false
    includeAssistantThinking: false
    maxTitleWords: 8
    maxIntentWords: 15
    snarkyMessages: true
    maxSnarkyWords: 20
    maxResumeWords: 20
    countdown:
      lowConfidence: 5
      mediumConfidence: 10
      highConfidence: 10000
    personas:
      allowList: ""                    # Empty = all personas available
      resumeFreshnessHours: 4
    llm:
      sessionSummary:
        profile: fast-lite
        fallbackProfile: cheap-fallback
      snarkyComment:
        profile: creative
        fallbackProfile: cheap-fallback
      resumeMessage:
        profile: creative-long
        fallbackProfile: cheap-fallback
```

### Customizing Reminders

Reminders are YAML templates. To customize, copy from `assets/sidekick/reminders/` to `.sidekick/reminders/`:

```bash
cp assets/sidekick/reminders/pause-and-reflect.yaml .sidekick/reminders/
# Edit .sidekick/reminders/pause-and-reflect.yaml
```

Available reminders:

| Reminder | When It Fires | Blocking? |
|----------|---------------|-----------|
| `user-prompt-submit.yaml` | Every user prompt | No |
| `pause-and-reflect.yaml` | Tool usage hits threshold (default: 60) | Yes |
| `verify-completion.yaml` | Agent stops after modifying source files | Yes |
| `safe-word-liveness.yaml` | Session start (one-shot liveness probe) | No |

---

## CLI Commands

All commands support `--format=json` for structured output. Invoke commands via `npx @scotthamilton77/sidekick <command>` or just `sidekick <command>` if you have the package installed globally.

### `sessions` -- List Tracked Sessions

```bash
sidekick sessions                    # Default: table format
sidekick sessions --format=json      # JSON output
sidekick sessions --width=120        # Wider table
```

Shows session ID, title, intent, persona, and last modified time.

### `daemon` -- Manage Background Daemon

The daemon runs as a background process per project, handling hook events and managing session state.

```bash
sidekick daemon start                # Start project-local daemon
sidekick daemon stop                 # Graceful stop (fire-and-forget)
sidekick daemon stop --wait          # Stop and wait for termination
sidekick daemon status               # Check status (JSON output)
sidekick daemon kill                 # Force kill (SIGKILL)
sidekick daemon kill-all             # Kill all daemons across all projects
```

The daemon auto-starts when hooks fire. It shuts down after 5 minutes of idle time (configurable via `core.daemon.idleTimeoutMs`).

### `persona` -- Manage Session Personas

```bash
sidekick persona list                          # List all persona IDs
sidekick persona list --format=table           # Table with display names
sidekick persona set marvin --session-id=ID    # Set persona for session
sidekick persona clear --session-id=ID         # Clear (use default)
sidekick persona test skippy --session-id=ID   # Generate test message
sidekick persona test skippy --session-id=ID --type=resume
```

The `set` and `clear` commands write directly to state files (no daemon IPC required). The `test` command requires the daemon because it triggers LLM generation.

### `setup` / `install` -- Run Setup Wizard

```bash
sidekick setup                       # Interactive wizard
sidekick install                     # Alias for setup
sidekick setup --force               # Apply defaults non-interactively
sidekick setup --check               # Check status (equivalent to doctor)
sidekick setup --help                # Show all scripting flags
```

See [Setup Wizard](#setup-wizard) above for detailed flag documentation.

### `doctor` -- Health Check and Auto-Fix

Checks the health of your Sidekick installation across all scopes (project, user, environment).

```bash
sidekick doctor                          # Full health check
sidekick doctor --fix                    # Auto-fix detected issues
sidekick doctor --only=plugin,liveness   # Check specific areas only
```

**Checks performed:**

| Check | What It Verifies |
|-------|-----------------|
| `api-keys` | OpenRouter API key across project `.env`, user `.env`, and environment |
| `statusline` | Statusline configured in Claude Code settings |
| `gitignore` | `.gitignore` has sidekick entries |
| `plugin` | Claude Code plugin is installed |
| `liveness` | Hooks are actually responding (requires plugin) |
| `shell-alias` | Shell alias in `.zshrc` / `.bashrc` (informational, does not affect health) |

**Auto-fixable issues** (`--fix`):

- Missing statusline configuration (installs at user scope)
- Missing or incomplete `.gitignore` entries
- Missing plugin (installs marketplace at user scope)
- Missing user setup-status file

**Requires manual action:**

- API key issues (run `sidekick setup` interactively)
- Plugin liveness issues (use `/sidekick-config` skill in Claude Code, or run `sidekick setup`)

### `uninstall` -- Remove Sidekick

Removes the Sidekick plugin, daemon, configuration, and session data.

```bash
sidekick uninstall                    # Interactive with confirmation
sidekick uninstall --force            # No confirmation prompts
sidekick uninstall --dry-run          # Show what would be removed
sidekick uninstall --scope=project    # Only project scope
sidekick uninstall --scope=user       # Only user scope
```

**What gets removed:**

- Claude Code plugin registration
- Background daemon (graceful shutdown, then force kill)
- Statusline and hook entries from settings files
- Configuration files (`setup-status.json`, `features.yaml`)
- API key `.env` files (prompts for confirmation unless `--force`)
- Transient data (logs, sessions, state, PID files)
- `.gitignore` sidekick section
- Shell alias from `.zshrc` / `.bashrc` (if installed)

### `ui` -- Launch Monitoring UI

```bash
sidekick ui                          # Launch at http://localhost:3000
sidekick ui --port 8080              # Custom port
sidekick ui --no-open                # Don't auto-open browser
```

The UI is a React SPA showing session state, metrics, and daemon status. Press Ctrl+C to stop.

### `statusline` -- Render Statusline

This command is called automatically by Claude Code's hooks. You generally do not invoke it directly:

```bash
sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR
```

---

## Features

### Session Summary

Provides LLM-generated session titles, intent summaries, and topic classification. Uses adaptive polling -- frequency decreases as classification confidence increases.

Session data is stored in `.sidekick/sessions/<session-id>/state/session-summary.json`.

### Statusline

Displays a real-time status bar in the Claude Code terminal showing model, token usage, cost, git branch, session title, and persona. Configurable format string with conditional rendering.

### Reminders

A two-tier system:

- **Pause-and-reflect**: When tool usage exceeds the threshold (default: 60 tools per turn), injects a checkpoint asking the agent to report on progress.
- **Verify-completion**: When the agent stops after modifying source code files, injects a verification checklist requiring the agent to run tests and checks before claiming completion.

### Personas

20 character personalities that add flavor to snarky messages and resume greetings. Each persona has its own personality traits, tone, and curated message sets.

---

## Personas

### Available Personas

| ID | Display Name | Theme |
|----|-------------|-------|
| `avasarala` | Avasarala | Chrisjen Avasarala from The Expanse |
| `bones` | Bones | Dr. McCoy from Star Trek |
| `c3po` | C-3PO | Protocol droid from Star Wars |
| `captain-kirk` | Captain Kirk | Capt. James T. Kirk from Star Trek TOS |
| `cavil` | Cavil | Number One/Cavil from Battlestar Galactica |
| `darth-vader` | Darth Vader | Sith Lord from Star Wars |
| `dilbert` | Dilbert | Office worker from Dilbert comics |
| `disabled` | (disabled) | No persona output |
| `eddie` | Eddie | Shipboard computer from Hitchhiker's Guide |
| `emh` | The Doctor | Emergency Medical Hologram from Voyager |
| `emperor` | Emperor Palpatine | Sith Lord from Star Wars: Return of the Jedi |
| `george` | George | George Costanza from Seinfeld |
| `glados` | GLaDOS | AI antagonist from Portal |
| `hudson` | Hudson | Private Hudson from Aliens |
| `jarvis` | J.A.R.V.I.S. | Tony Stark's AI from Iron Man / MCU |
| `kramer` | Kramer | Cosmo Kramer from Seinfeld |
| `marvin` | Marvin | Paranoid Android from Hitchhiker's Guide |
| `mr-spock` | Mr. Spock | Vulcan first officer from Star Trek TOS |
| `mr-t` | Mr. T | B.A. Baracus from The A-Team |
| `pointy-haired-boss` | PHB | Pointy-Haired Boss from Dilbert |
| `ripley` | Ripley | Ellen Ripley from Alien |
| `rodney-mckay` | Rodney McKay | Dr. McKay from Stargate Atlantis |
| `scotty` | Scotty | Montgomery Scott from Star Trek |
| `seven-of-nine` | Seven of Nine | Former Borg drone from Star Trek Voyager |
| `sheldon` | Sheldon | Sheldon Cooper from The Big Bang Theory |
| `sidekick` | Sidekick | Default snarky assistant |
| `skippy` | Skippy | The Magnificent from Expeditionary Force |
| `tars` | TARS | Robot from Interstellar (humor at 75%) |
| `yoda` | Yoda | Jedi Master from Star Wars |

### Restricting Available Personas

In `features.yaml`, use `allowList` to limit which personas are available:

```yaml
session-summary:
  settings:
    personas:
      allowList: "sidekick,marvin,skippy"
```

An empty `allowList` (default) means all personas are available.

### Custom Personas

Place a YAML file in `.sidekick/personas/` (project-level) or `~/.sidekick/personas/` (user-level). Required fields:

```yaml
id: my-persona
display_name: My Persona
theme: "Short description of the personality."
personality_traits:
  - witty
  - knowledgeable
tone_traits:
  - sarcastic
  - concise
statusline_empty_messages:
  - "Waiting for something to happen..."
snarky_examples:
  - "Oh look, another refactor. How original."
snarky_welcome_examples:
  - "Back again? Let's see what breaks this time."
```

---

## Troubleshooting

### Logs

Sidekick logs to `.sidekick/logs/` (project-level). The main log file is `.sidekick/sidekick.log`.

```bash
# Tail logs in real time
tail -f .sidekick/sidekick.log

# Enable debug logging via config
# Add to .sidekick/sidekick.config:
core.logging.level=debug

# Or via environment variable
SIDEKICK_LOG_LEVEL=debug
```

Per-component log levels can be set in `core.yaml`:

```yaml
logging:
  level: info
  components:
    reminders: debug
    statusline: trace
```

### Daemon Is Not Running

```bash
# Check status
sidekick daemon status

# Start it manually
sidekick daemon start

# If stuck, kill and restart
sidekick daemon kill
sidekick daemon start
```

The daemon auto-starts when hooks fire. If it keeps dying, check `.sidekick/sidekick.log` for errors.

### Statusline Not Showing

1. **Run doctor**: `sidekick doctor` checks statusline configuration.
2. **Auto-fix**: `sidekick doctor --fix` can install the statusline configuration automatically.
3. **Check settings.json**: The statusline must be configured in `~/.claude/settings.json` (user-level) or `.claude/settings.json` (project-level) or `.claude/settings.local.json` (project-local):
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR"
     }
   }
   ```
4. **In-session fix**: Use the `/sidekick-config` skill inside Claude Code to diagnose and resolve setup issues.

### Personas Not Working

1. **Run doctor**: `sidekick doctor --only=api-keys` checks API key health.
2. **API key missing**: LLM features (including personas) require an OpenRouter API key. Run `sidekick setup` to configure one, or set `OPENROUTER_API_KEY` in your environment.
3. **API key invalid**: The doctor check validates keys. Look for `invalid` status in the scopes output.

### Plugin Not Detected

```bash
# Run doctor to check plugin status
sidekick doctor --only=plugin,liveness

# Auto-fix: installs the marketplace and plugin at user scope
sidekick doctor --fix
```

The doctor check reports plugin installation status (`plugin`, `dev-mode`, `both`, or `none`) and liveness (whether hooks are responding).

### Full Reset

```bash
# Uninstall everything (with confirmation)
sidekick uninstall

# Preview what would be removed
sidekick uninstall --dry-run

# Uninstall without confirmation
sidekick uninstall --force

# Kill all daemons across all projects
sidekick daemon kill-all
```

### Common Error: IPC Timeout

If commands hang or return timeout errors, the daemon may be in a bad state:

```bash
sidekick daemon kill
sidekick daemon start
```

Check for stale socket files in `/tmp/` (named `sidekick-*.sock`). The `uninstall` command removes these.

### State Directory Layout

Session state lives under `.sidekick/` at the project root:

```
.sidekick/
  sidekick.log              # Main log file
  logs/                     # Additional log files
  sessions/
    <session-id>/
      state/
        session-summary.json    # Title, intent, classification
        session-persona.json    # Active persona selection
        snarky-message.json     # Latest snarky comment
        resume-message.json     # Welcome-back message
  state/                    # Global state files
  setup-status.json         # Setup wizard state
  .env                      # API keys (project-level)
```

User-level state is under `~/.sidekick/`:

```
~/.sidekick/
  .env                      # API keys (user-level)
  setup-status.json         # User setup preferences
  state/                    # User-level state
  daemons/                  # PID files for all project daemons
  *.yaml                    # User config overrides
  sidekick.config           # User dot-notation overrides
```
