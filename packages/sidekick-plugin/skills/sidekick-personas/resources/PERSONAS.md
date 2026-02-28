# Personas Reference

**Default location:** `assets/sidekick/personas/`
**Override locations:** `~/.sidekick/personas/` or `.sidekick/personas/`

Personas define character voices for snarky messages, resume messages, and empty-state statusline messages.

## Available Personas (29 built-in)

| ID | Character | Theme |
|----|-----------|-------|
| `sidekick` | Default | Snarky AI assistant (default) |
| `disabled` | None | Disables persona features |
| `avasarala` | The Expanse | Blunt UN Secretary-General |
| `bones` | Star Trek | Grumpy doctor ("I'm a doctor, not a...") |
| `c3po` | Star Wars | Anxious protocol droid |
| `captain-kirk` | Star Trek TOS | Charismatic, rule-bending starship captain |
| `cavil` | Battlestar Galactica | Nihilistic Cylon who resents being human |
| `darth-vader` | Star Wars | Commanding Sith Lord |
| `dilbert` | Dilbert | Cynical office worker |
| `eddie` | Hitchhiker's Guide | Maniacally cheerful shipboard computer |
| `emh` | Star Trek Voyager | Arrogant holographic doctor |
| `emperor-palpatine` | Star Wars | Scheming, gleefully malevolent Sith Lord |
| `george` | Seinfeld | Neurotic, anxious |
| `glados` | Portal | Passive-aggressive science AI |
| `hudson` | Aliens | Panicky marine ("Game over, man!") |
| `jarvis` | Iron Man / MCU | Impeccably British AI butler |
| `kramer` | Seinfeld | Eccentric, dramatic |
| `marvin` | Hitchhiker's Guide | Depressed android |
| `mr-spock` | Star Trek TOS | Logical, emotionless Vulcan first officer |
| `mr-t` | A-Team | Tough, motivational |
| `pointy-haired-boss` | Dilbert | Clueless manager |
| `ripley` | Alien | Determined survivor |
| `rodney-mckay` | Stargate Atlantis | Arrogant, hypochondriac genius |
| `scotty` | Star Trek | Engineering miracles |
| `seven-of-nine` | Star Trek Voyager | Efficient former Borg drone |
| `sheldon` | Big Bang Theory | Condescending genius |
| `skippy` | Expeditionary Force | Irreverent AI |
| `tars` | Interstellar | Deadpan robot (humor at 75%) |
| `yoda` | Star Wars | Wise Jedi master |

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
snarky_examples:                   # Array (max 15 words each)
  - "Example to guide LLM voice"
snarky_welcome_examples:                   # Array (8-10 words each)
  - "Back for more? Your mess awaits."
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
| `snarky_examples` | No | Example snarky comments (**max 15 words each**) |
| `snarky_welcome_examples` | No | Example snarky welcomes (**8-10 words each**) |

### Length Restrictions

Examples are fed to the LLM to guide voice generation. Keep them within limits:

- **snarky_examples**: Max 15 words per example
- **snarky_welcome_examples**: 8-10 words per example (used for `snarky_welcome` generation)

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
snarky_examples:                   # Max 15 words each
  - "Arr, that code be messier than Davy Jones' locker!"
  - "Avast! Another refactor? Walk the plank!"
snarky_welcome_examples:                   # 8-10 words each
  - "Ye were sailin' these seas. Continue the voyage?"
```

## Using Personas

**Note:** The assistant has access to the current session ID via `<session-info>` tags in the context. It can change the persona directly without asking the user for the session ID.

### Set Session Persona

```bash
pnpm sidekick persona set <persona-id> --session-id=<id>
```

### Clear Session Persona

```bash
pnpm sidekick persona clear --session-id=<id>
```

### Test Persona Voice

```bash
pnpm sidekick persona test <persona-id> --session-id=<id> --type=snarky
pnpm sidekick persona test <persona-id> --session-id=<id> --type=resume
```

### Restrict Available Personas

```bash
pnpm sidekick config set features.session-summary.settings.personas.allowList "sidekick,marvin,pirate" --scope=user
```

### Weight Persona Selection

Control how often each persona is selected. Higher weight = more likely. Default weight is 1. Weight 0 excludes a persona (like blockList).

```bash
pnpm sidekick config set features.session-summary.settings.personas.weights.darth-vader 100 --scope=user
pnpm sidekick config set features.session-summary.settings.personas.weights.emperor-palpatine 50 --scope=user
```

Weights are applied after allowList/blockList filtering.

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
