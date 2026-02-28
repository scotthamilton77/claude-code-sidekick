---
name: sidekick-personas
description: Use when user asks to change, switch, configure, weight, curate, or create personas. Use when persona messages feel generic, user wants to improve voice quality, or adjust persona rotation. Also use for "set up my persona preferences" or bulk persona configuration.
---

# Persona Configuration

Configure persona selection, voice quality, and custom personas using the sidekick CLI.

## When to Use

- "change persona", "switch to X", "be marvin"
- "more darth vader", "less sidekick", "favour skippy"
- "only star trek personas", "block marvin", "fewer personas"
- "messages feel generic", "not funny enough", "improve voice quality"
- "create a custom persona", "add a pirate persona"
- "configure persona LLM", "use a different model for personas"
- "set up my persona preferences"

## Scope Question (Required for Persistent Changes)

**Before ANY `config set` or persona file creation**, ask:

> Should this apply to your user settings (all projects), the project (versioned, shared with team), or as a local-only override (untracked)?

Maps to `--scope=user|project|local` on `config set`, or `~/.sidekick/personas/` vs `.sidekick/personas/` for persona files.

**Default recommendation:** For personal preferences (weights, allowList, voice quality), suggest `--scope=user`. For team-shared settings, suggest `--scope=project`.

**Exception:** `persona set` (session-level, ephemeral) does NOT need a scope question.

## CLI Reference

```bash
# Session persona (ephemeral)
pnpm sidekick persona set <id> --session-id=<session-id>
pnpm sidekick persona clear --session-id=<session-id>
pnpm sidekick persona test <id> --session-id=<session-id> [--type=snarky|resume]
pnpm sidekick persona list [--format=table]

# Persistent config (requires scope question first)
pnpm sidekick config get <dot.path> [--scope=user|project|local] [--format=json]
pnpm sidekick config set <dot.path> <value> [--scope=user|project|local]
pnpm sidekick config unset <dot.path> [--scope=user|project|local]
```

**Config base path for all persona settings:** `features.session-summary.settings.personas`

## Disambiguation

If the user's request is vague (e.g., "make it better", "improve personas"), ask what axis they mean:

- **Voice quality** (messages feel generic) → Improve Voice Quality recipe
- **Different character** (want someone else) → Switch Persona recipe
- **Pool variety** (too many/few options) → Curate the Pool recipe
- **Frequency** (see one persona too often) → Weight the Pool recipe

## Handling Unknown Persona IDs

Always run `pnpm sidekick persona list` to confirm IDs before using them. Common confusions:

| User says | Actual ID |
|-----------|-----------|
| "spock" | `mr-spock` |
| "7 of 9" / "seven" | `seven-of-nine` |
| "kirk" | `captain-kirk` |

If a user requests a persona that doesn't exist, ask: "That persona isn't built in. Want me to create it, or pick a different one?"

## Recipes

### Switch Persona

**Questions:** 0 (persona ID is in the request)

```bash
pnpm sidekick persona set <id> --session-id=<session-id>
pnpm sidekick persona test <id> --session-id=<session-id>   # Show voice to confirm
```

No scope question needed — session-level operation.

### Curate the Pool

**Questions:** 0-1 (confirm list if ambiguous). Then scope question.

| Intent | Action |
|--------|--------|
| "Only show X, Y, Z" | Set allowList (comma-separated string) |
| "Never show X" | Add to blockList |
| "Remove X from rotation" | Add to blockList OR set weight to 0 |

**Conflict rule:** Never put the same ID in both allowList and blockList. blockList takes precedence, so the persona would never appear — confusing. Pick one mechanism.

**Editing an existing list:** `config set` replaces the entire value. To add/remove one persona, first read the current list with `config get`, then set the updated comma-separated string.

```bash
# allowList — comma-separated string, NOT JSON array
pnpm sidekick config set features.session-summary.settings.personas.allowList "bones,scotty,mr-spock,emh,seven-of-nine,captain-kirk" --scope=user

# blockList
pnpm sidekick config set features.session-summary.settings.personas.blockList "marvin,c3po" --scope=project

# Verify
pnpm sidekick config get features.session-summary.settings.personas --format=json
```

**Available Star Trek personas:** `bones`, `scotty`, `mr-spock`, `emh`, `seven-of-nine`, `captain-kirk`

See [resources/PERSONAS.md](resources/PERSONAS.md) for full persona catalogue with IDs.

### Weight the Pool

**Questions:** 0 (intent maps directly). Then scope question.

**Weight guidance:**

| User says | Weight value |
|-----------|-------------|
| "more X" | 50-100 |
| "much more X" | 100+ |
| "less X" | 0.1-0.5 |
| "never X" | 0 |

**Weights are ratios:** A weight of 100 vs others at 1 means ~99% selection. Don't use extreme values like 1,000,000 — anything above 1000 is effectively "always". For "always this persona right now", use `persona set` instead.

```bash
pnpm sidekick config set features.session-summary.settings.personas.weights.darth-vader 100 --scope=project
pnpm sidekick config set features.session-summary.settings.personas.weights.sidekick 0.3 --scope=project

# Verify
pnpm sidekick config get features.session-summary.settings.personas.weights --format=json
```

### Improve Voice Quality

**Questions:** 1 (which personas, or all?). Then scope question.

Set a per-persona LLM profile override to get better output from the model.

| User says | LLM profile | Effect |
|-----------|-------------|--------|
| "funnier / snarkier / more creative" | `creative-long` | Higher quality model, more tokens |
| "faster responses" | `fast-lite` | Trade quality for speed |
| "cheaper" | `cheap-fallback` | Lower cost model |

```bash
# Per-persona override
pnpm sidekick config set features.session-summary.settings.personas.llmProfiles.skippy creative-long --scope=user

# Verify with a test
pnpm sidekick persona test skippy --session-id=<session-id> --type=snarky
```

### Create Custom Persona

**Questions:** 2-3 (name/id, theme, tone keywords). Then scope question for file location.

**File location:** `~/.sidekick/personas/<id>.yaml` (user) or `.sidekick/personas/<id>.yaml` (project)

**NEVER put custom personas in `assets/sidekick/personas/`** — that's for bundled defaults only.

```yaml
# ~/.sidekick/personas/gordon-ramsay.yaml
id: gordon-ramsay
display_name: Chef Ramsay
theme: "A fiery, perfectionist celebrity chef who demands excellence and berates mediocrity"
personality_traits:
  - perfectionist
  - intense
  - brutally honest
tone_traits:
  - explosive
  - demanding
  - theatrical
statusline_empty_messages:
  - "This kitchen is a DISASTER! Let's cook!"
  - "Right then, where's the lamb sauce?"
  - "Finally! Someone who can follow a recipe!"
snarky_examples:                    # Max 15 words each
  - "That code is so raw it's still mooing!"
  - "You call that a function? My nan writes better code!"
snarky_welcome_examples:            # Max 8-10 words each
  - "Back in the kitchen? Don't burn it this time."
```

```bash
# Verify it appears and test voice
pnpm sidekick persona list
pnpm sidekick persona test gordon-ramsay --session-id=<session-id> --type=snarky
```

### Bulk Configure

**Questions:** 3-5 (guided walkthrough). Scope question upfront.

**Flow:**

1. Show available personas: `pnpm sidekick persona list --format=table`
2. "Which do you want in rotation?" -> set allowList
3. "Any favourites?" -> set weights
4. "Want to test the voice quality?" -> `persona test`

Each step uses the corresponding recipe above (Curate → allowList, Weight → weights, etc.).

### Disable Personas

**Session-only:** `pnpm sidekick persona set disabled --session-id=<session-id>` (no scope question)

**Permanently** (scope question required): `pnpm sidekick config set features.session-summary.settings.personas.allowList "disabled" --scope=user`

The `disabled` persona turns off snarky messages, resume messages, and persona-specific empty messages.

## Common Mistakes

| Mistake | Correct |
|---------|---------|
| Use JSON array for allowList: `'["a","b"]'` | Comma-separated string: `"a,b,c"` |
| Put custom persona in `assets/sidekick/personas/` | Use `~/.sidekick/personas/` or `.sidekick/personas/` |
| Set weight to 3 for "more" | Set weight to 50-100 (default is 1) |
| Skip scope question before `config set` | Always ask user/project/local first |
| Guess persona IDs | Run `persona list` to discover exact IDs |
| Edit YAML files directly | Use `config set` CLI — it validates inputs |
| Skip verification after changes | Always `config get` or `persona test` to confirm |
| Wrong scope applied | `config unset` at wrong scope, then `config set` at correct scope |
