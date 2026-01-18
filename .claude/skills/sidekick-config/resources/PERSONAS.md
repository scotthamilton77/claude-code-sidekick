# Personas Reference

**Default location:** `assets/sidekick/personas/`
**Override locations:** `~/.sidekick/personas/` or `.sidekick/personas/`

Personas define character voices for snarky messages, resume messages, and empty-state statusline messages.

## Available Personas (17 built-in)

| ID | Character | Theme |
|----|-----------|-------|
| `sidekick` | Default | Snarky AI assistant (default) |
| `disabled` | None | Disables persona features |
| `agent-smith` | Matrix | Ominous, condescending agent |
| `bones` | Star Trek | Grumpy doctor ("I'm a doctor, not a...") |
| `dilbert` | Dilbert | Cynical office worker |
| `emh` | Star Trek Voyager | Arrogant holographic doctor |
| `george` | Seinfeld | Neurotic, anxious |
| `hal` | 2001 | Calm, ominous AI |
| `hudson` | Aliens | Panicky marine ("Game over, man!") |
| `kramer` | Seinfeld | Eccentric, dramatic |
| `marvin` | Hitchhiker's Guide | Depressed android |
| `mr-t` | A-Team | Tough, motivational |
| `pointy-haired-boss` | Dilbert | Clueless manager |
| `ripley` | Alien | Determined survivor |
| `scotty` | Star Trek | Engineering miracles |
| `sheldon` | Big Bang Theory | Condescending genius |
| `skippy` | Expeditionary Force | Irreverent AI |

## Persona Structure

```yaml
id: <unique-id>                    # Must match filename (without .yaml)
display_name: <string>             # Shown in statusline
theme: <string>                    # Character description for LLM
personality_traits:                # Array of traits
  - helpful
  - clever
tone_traits:                       # Array of tone descriptors
  - snarky
  - concise
statusline_empty_messages:         # Array of messages for fresh sessions
  - "Message shown when session is new"
  - "Another random empty-state message"
snarky_examples:                   # Array of example snarky comments
  - "Example to guide LLM voice"
resume_examples:                   # Array of example resume messages
  - "Last I recall, you were working on [topic]."
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier (alphanumeric + hyphens) |
| `display_name` | Yes | Human-readable name |
| `theme` | Yes | Character description for LLM context |
| `personality_traits` | Yes | Array of personality descriptors |
| `tone_traits` | Yes | Array of tone/style descriptors |
| `statusline_empty_messages` | Yes | Messages for fresh sessions |
| `snarky_examples` | No | Example snarky comments (guides LLM) |
| `resume_examples` | No | Example resume messages (guides LLM) |

## Creating Custom Personas

1. Create file at `~/.sidekick/personas/<id>.yaml` (user) or `.sidekick/personas/<id>.yaml` (project)
2. Use the structure above
3. Changes apply immediately (hot-reload)

### Example: Pirate Persona

```yaml
# ~/.sidekick/personas/pirate.yaml
id: pirate
display_name: Captain
theme: "A swashbuckling pirate captain with nautical vocabulary and dramatic flair"
personality_traits:
  - adventurous
  - dramatic
  - witty
tone_traits:
  - nautical
  - bold
  - humorous
statusline_empty_messages:
  - "Ahoy! Ready to plunder some code?"
  - "Shiver me timbers, another session!"
  - "Yo ho ho! What treasure shall we seek?"
snarky_examples:
  - "Arr, that code be messier than Davy Jones' locker!"
  - "Avast! Another refactor? Walk the plank!"
resume_examples:
  - "Ye were sailin' the seas of [topic]. Continue the voyage?"
```

## Using Personas

### Set Session Persona

```bash
sidekick persona <persona-id> --session-id=<id>
```

### Clear Session Persona

```bash
sidekick persona --session-id=<id>
```

### Test Persona Voice

```bash
sidekick persona-test <persona-id> --session-id=<id> --type=snarky
sidekick persona-test <persona-id> --session-id=<id> --type=resume
```

### Restrict Available Personas

In `features.yaml` or `sidekick.config`:

```yaml
# features.yaml
session-summary:
  settings:
    personas:
      allowList: "sidekick,marvin,pirate"
```

```bash
# sidekick.config
features.session-summary.settings.personas.allowList=sidekick,marvin,pirate
```

## Persona Cascade (Priority Order)

1. `.sidekick/personas/` - Project overrides
2. `~/.sidekick/personas/` - User overrides
3. `assets/sidekick/personas/` - Bundled defaults

## The `disabled` Persona

Setting persona to `disabled` turns off:
- Snarky messages (shows nothing)
- Resume messages (shows nothing)
- Persona-specific empty messages (uses default text)

Useful for professional environments or when you want plain statusline output.
