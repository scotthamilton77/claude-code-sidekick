---
name: sidekick-config
description: Use when user asks to configure, customize, or set up sidekick. Use when user wants to change LLM models, personas, statusline, reminders, or override any sidekick settings. Also use when user wants to change/set/switch the session persona.
---

# Sidekick Configuration

## Overview

Guide users through configuring sidekick interactively. Ask what they want to configure, help them choose the right scope and method, and create files in the correct locations.

**Key principle:** Always ask before assuming. Configuration choices depend on user intent.

## When to Use

- User mentions "configure sidekick", "customize sidekick", "set up sidekick"
- User wants to change LLM models/profiles
- User wants to customize the statusline format
- User wants to add or change personas
- User wants to change/set/switch the session persona (e.g., "change persona to marvin", "set persona", "switch to GLaDOS")
- User wants to adjust reminders or other features
- User wants to modify prompt templates
- User asks about sidekick configuration options

## Interactive Flow

```dot
digraph config_flow {
    rankdir=TB;
    node [shape=box];

    start [label="User wants to configure sidekick" shape=ellipse];
    ask_what [label="Ask: What do you want to configure?\n(LLM, statusline, persona, prompts, reminders)" shape=diamond];
    ask_scope [label="Ask: User-level or project-level?\n(~/.sidekick/ vs .sidekick/)" shape=diamond];
    ask_method [label="Single setting or broader changes?" shape=diamond];
    sidekick_config [label="Use sidekick.config\n(surgical, one line)"];
    yaml_file [label="Copy default, modify YAML\n(full control)"];
    explain_reload [label="Explain: Changes apply immediately\n(most settings hot-reload)"];

    start -> ask_what;
    ask_what -> ask_scope;
    ask_scope -> ask_method;
    ask_method -> sidekick_config [label="single setting"];
    ask_method -> yaml_file [label="multiple/complex"];
    sidekick_config -> explain_reload;
    yaml_file -> explain_reload;
}
```

**CRITICAL: Always ask these questions before creating files:**
1. What do you want to configure?
2. Should this be user-level (~/.sidekick/) or project-level (.sidekick/)?
3. Single setting change or broader modifications?

## Choosing Configuration Method

| Method | When to Use | Example |
|--------|-------------|---------|
| **sidekick.config** | Single setting, quick tweak | Change one threshold |
| **YAML file** | Multiple settings, complex objects | Custom LLM profile |
| **Asset override** | Modify prompts, reminders, personas | Custom prompt template |

### sidekick.config (Surgical Changes)

Best for one-off settings using dot-notation:

```bash
# .sidekick/sidekick.config or ~/.sidekick/sidekick.config
llm.defaultProfile=creative
features.statusline.settings.format={model} | {tokenPercentageActual}
features.reminders.settings.pause_and_reflect_threshold=100
features.session-summary.settings.personas.resumeFreshnessHours=8
core.logging.level=debug
```

### YAML Files (Broader Changes)

Best for complex objects or multiple related settings. Copy the default file and modify:

1. Find default: `assets/sidekick/defaults/{domain}.defaults.yaml`
2. Copy to: `.sidekick/{domain}.yaml` or `~/.sidekick/{domain}.yaml`
3. Modify as needed

## Configuration Scopes

| Scope | Location | Use When | Persists |
|-------|----------|----------|----------|
| **User** | `~/.sidekick/` | Personal defaults across all projects | Yes |
| **Project** | `.sidekick/` | Project-specific, shared with team | Yes (git) |
| **Local** | `.sidekick/*.local` | Personal overrides, untracked | No |

**Override order (highest to lowest):**
1. `.sidekick/{domain}.yaml.local` - Project local (untracked)
2. `.sidekick/{domain}.yaml` - Project (tracked)
3. `~/.sidekick/{domain}.yaml` - User
4. `assets/sidekick/defaults/` - Bundled defaults

## Detailed Reference Documentation

| Topic | Reference File | Default Location |
|-------|----------------|------------------|
| LLM models & profiles | [resources/LLM.md](resources/LLM.md) | `assets/sidekick/defaults/llm.defaults.yaml` |
| Features (statusline, reminders, session-summary) | [resources/FEATURES.md](resources/FEATURES.md) | `assets/sidekick/defaults/features/*.defaults.yaml` |
| Core (logging, paths, daemon) | [resources/CORE.md](resources/CORE.md) | `assets/sidekick/defaults/core.defaults.yaml` |
| Prompt templates | [resources/PROMPTS.md](resources/PROMPTS.md) | `assets/sidekick/prompts/` |
| Personas | [resources/PERSONAS.md](resources/PERSONAS.md) | `assets/sidekick/personas/` |
| Reminders | [resources/REMINDERS.md](resources/REMINDERS.md) | `assets/sidekick/reminders/` |

## Quick Examples

### Change Default LLM Model

**Surgical (sidekick.config):**
```bash
llm.defaultProfile=creative
```

**Full control (llm.yaml):**
```yaml
# .sidekick/llm.yaml
defaultProfile: my-cheap-profile

profiles:
  my-cheap-profile:
    provider: openrouter
    model: google/gemma-3-4b-it
    temperature: 0
    maxTokens: 500
    timeout: 10
```

### Customize Statusline

**Surgical:**
```bash
features.statusline.settings.format={model} | {tokenPercentageActual}
```

**Full control:**
```yaml
# .sidekick/features.yaml
statusline:
  enabled: true
  settings:
    format: "{model} | {tokenPercentageActual}"
    theme:
      useNerdFonts: ascii
```

### Change Session Persona

The assistant has access to the current session ID via `<session-info>` in the context. To change the persona for the current session:

```bash
node packages/sidekick-cli/dist/bin.js persona <persona-id> --session-id=<session-id>
```

**Example:** If session ID is `abc-123` and user wants GLaDOS:
```bash
node packages/sidekick-cli/dist/bin.js persona glados --session-id=abc-123
```

See [resources/PERSONAS.md](resources/PERSONAS.md) for available personas and creating custom ones.

### Add Custom Persona

**Location:** `.sidekick/personas/` or `~/.sidekick/personas/` (NOT `assets/sidekick/personas/`)

```yaml
# ~/.sidekick/personas/pirate.yaml
id: pirate
display_name: Captain
theme: "A swashbuckling pirate captain"
personality_traits: [adventurous, dramatic]
tone_traits: [nautical, bold]
statusline_empty_messages:
  - "Ahoy! Ready to plunder some code?"
snarky_examples:
  - "Arr, that code be messier than Davy Jones' locker!"
resume_examples:
  - "Ye were sailin' the seas of [topic]. Continue?"
```

### Modify Prompt Template

Copy and customize:
```bash
cp assets/sidekick/prompts/snarky-message.prompt.txt .sidekick/assets/prompts/
# Then edit .sidekick/assets/prompts/snarky-message.prompt.txt
```

## Asset Override Cascade

For prompts, reminders, and other assets:

1. `.sidekick/assets.local/` - Untracked project overrides
2. `.sidekick/assets/` - Tracked project overrides
3. `~/.sidekick/assets/` - User overrides
4. `assets/sidekick/` - Bundled defaults

## Hot-Reloading

**Most settings apply immediately.** Only these require `claude --continue`:
- Daemon/IPC connection settings
- Hook-related changes

## Common Mistakes

| Mistake | Correct Approach |
|---------|-----------------|
| Put persona in `assets/sidekick/personas/` | Use `.sidekick/personas/` or `~/.sidekick/personas/` |
| Wrap features.yaml content under `features:` | Feature names at root: `statusline:`, not `features: statusline:` |
| Assume project scope | Ask user: user-level or project-level? |
| Use YAML for single setting | Use `sidekick.config` for surgical changes |
| Say "restart required" | Most changes hot-reload automatically |

## Debugging

```bash
# View loaded config
cat ~/.sidekick/llm.yaml
cat .sidekick/features.yaml
cat .sidekick/sidekick.config

# Enable debug logging
echo "core.logging.level=debug" >> .sidekick/sidekick.config
echo "llm.global.debugDumpEnabled=true" >> .sidekick/sidekick.config

# Check daemon logs
tail -f .sidekick/logs/daemon.log
```
