# Personas Reference

**Default location:** `assets/sidekick/personas/`
**Override locations:** `~/.sidekick/personas/` or `.sidekick/personas/`

Personas define character voices for snarky messages, resume messages, and empty-state statusline messages.

## Available Personas (44 built-in)

| ID | Character | Theme |
|----|-----------|-------|
| `sidekick` | Default | Snarky AI assistant (default) |
| `disabled` | None | Disables persona features |
| `adama` | Battlestar Galactica | Grizzled, duty-bound colonial fleet commander |
| `arnold` | Action Movies | Unstoppable one-liner-dropping action hero |
| `arthur-dent` | Hitchhiker's Guide | Bewildered Englishman lost in the galaxy |
| `avasarala` | The Expanse | Blunt UN Secretary-General |
| `bones` | Star Trek | Grumpy doctor ("I'm a doctor, not a...") |
| `borg-queen` | Star Trek | Seductive, assimilating hive-mind ruler |
| `c3po` | Star Wars | Anxious protocol droid |
| `captain-kirk` | Star Trek TOS | Charismatic, rule-bending starship captain |
| `cavil` | Battlestar Galactica | Nihilistic Cylon who resents being human |
| `chandler` | Friends | Self-deprecating, sarcasm-as-defense-mechanism |
| `darth-vader` | Star Wars | Commanding Sith Lord |
| `dilbert` | Dilbert | Cynical office worker |
| `eddie` | Hitchhiker's Guide | Maniacally cheerful shipboard computer |
| `emh` | Star Trek Voyager | Arrogant holographic doctor |
| `emperor-palpatine` | Star Wars | Scheming, gleefully malevolent Sith Lord |
| `freud` | Psychology | Psychoanalytic, everything-is-subconscious |
| `george` | Seinfeld | Neurotic, anxious |
| `glados` | Portal | Passive-aggressive science AI |
| `gowron` | Star Trek DS9 | Honour-obsessed, wild-eyed Klingon chancellor |
| `groucho` | Marx Brothers | Rapid-fire wisecracks and wordplay |
| `hudson` | Aliens | Panicky marine ("Game over, man!") |
| `jarvis` | Iron Man / MCU | Impeccably British AI butler |
| `joey` | Friends | Lovable, food-obsessed, how-you-doin' actor |
| `kramer` | Seinfeld | Eccentric, dramatic |
| `marvin` | Hitchhiker's Guide | Depressed android |
| `monica` | Friends | Competitive, obsessively-organized perfectionist |
| `mr-spock` | Star Trek TOS | Logical, emotionless Vulcan first officer |
| `mr-t` | A-Team | Tough, motivational |
| `phoebe` | Friends | Quirky, eccentric, surprisingly insightful |
| `pointy-haired-boss` | Dilbert | Clueless manager |
| `q` | Star Trek TNG | Omnipotent, theatrically-bored trickster |
| `quark` | Star Trek DS9 | Profit-driven Ferengi bartender |
| `rachel` | Friends | Fashion-forward, determined career climber |
| `ripley` | Alien | Determined survivor |
| `rodney-mckay` | Stargate Atlantis | Arrogant, hypochondriac genius |
| `ross` | Friends | Pedantic paleontologist, "we were on a break!" |
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

Control how often each persona is selected. Higher weight = more likely. Default weight is 1. Non-positive or non-finite values exclude a persona (like blockList).

```bash
pnpm sidekick config set features.session-summary.settings.personas.weights.darth-vader 100 --scope=user
pnpm sidekick config set features.session-summary.settings.personas.weights.emperor-palpatine 50 --scope=user
```

Weights are applied after allowList/blockList filtering.

## Persona Pinning & Persistence

### Pin a Persona

Lock a specific persona for all new sessions:

```bash
pnpm sidekick persona pin <id>               # Project scope
pnpm sidekick persona pin <id> --scope=user   # User scope (all projects)
pnpm sidekick persona unpin                   # Remove pin
```

Pinned persona overrides allowList, blockList, and weights.

### Persist Through Clear

By default (`true`), the active persona is preserved when you run `/clear`. To get a new persona on each `/clear`:

```bash
pnpm sidekick config set features.session-summary.settings.personas.persistThroughClear false --scope=user
```

### Persona Injection

By default (`true`), the active persona's voice is injected into Claude's system prompt. To keep personas in the statusline only:

```bash
pnpm sidekick config set features.session-summary.settings.personas.injectPersonaIntoClaude false --scope=user
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
