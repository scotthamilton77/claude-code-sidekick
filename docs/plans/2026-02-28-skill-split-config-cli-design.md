# Design: Skill Split & Config CLI Commands

**Date:** 2026-02-28
**Status:** Proposed
**Scope:** Plugin skills, CLI commands

## Problem

The `sidekick-config` skill is a 414-line monolith covering seven configuration domains (setup, credentials, LLM profiles, statusline, personas, reminders, prompts). This creates three compounding problems:

1. **Diagnosis:** The agent can't reliably determine which subsystem the user is asking about
2. **Execution:** The agent must hand-edit YAML files with correct structure, cascade awareness, and scope decisions — fragile and error-prone
3. **Proactive identification:** The agent lacks domain-specific context to suggest configuration improvements

The recent addition of weighted persona selection, per-persona LLM profile overrides, and allowList/blockList filtering has made the persona domain substantially more complex — it now involves interplay between five nested config fields, all under `features.session-summary.settings.personas`.

## Design Principles

- **Intent-driven, not field-driven:** The agent maps from "what do you want to achieve?" to correct configuration, rather than walking through every parameter
- **Minimum questions asked:** Sensible defaults, only ask when genuinely ambiguous
- **Correct execution guaranteed:** CLI commands validate inputs — the agent can't write malformed config if it never touches YAML directly
- **Minimal skill count:** Two skills, not many small ones — too many skills creates its own discovery/routing problem

## Solution: Two Skills + Config CLI

### Component Overview

| Component | Type | Purpose |
|-----------|------|---------|
| `sidekick-setup` | Skill (renamed from `sidekick-config`) | Onboarding, troubleshooting, general config |
| `sidekick-personas` | Skill (new) | Persona selection, voice tuning, pool curation |
| `sidekick config get/set` | CLI (new) | Reliable, validated config manipulation |

### Sequencing

1. Build `config get/set` CLI (enables everything else)
2. Write `sidekick-personas` skill (uses the new CLI)
3. Slim `sidekick-setup` skill (extraction from existing)

---

## Component 1: `sidekick-setup` Skill

Renamed from `sidekick-config` to signal "onboarding and troubleshooting" rather than "configure everything."

### Trigger Conditions

- "set up sidekick", "configure sidekick", "install sidekick"
- Credential errors, "requires apiKey", "API key not working"
- "change statusline", "customize statusline format"
- "adjust reminders", "generate reminders from CLAUDE.md"
- General config questions ("what can I configure?")

### Content — What Stays

- Doctor → setup workflow (unchanged)
- API key troubleshooting (unchanged)
- Configuration method guide (YAML files, `.local.yaml` overrides, asset overrides)
- Configuration scopes & cascade explanation
- Statusline customization
- Reminder generation from CLAUDE.md
- Prompt template overrides
- Core config (logging, daemon, paths)
- Reference table linking to resource docs
- `config get/set` CLI documentation (shared with both skills)

### Content — What Moves to `sidekick-personas`

- "Change Session Persona" section
- "Add Custom Persona" section
- Persona-related quick examples
- Persona triggers in "When to Use"

### Content — What Gets Added

- Cross-reference: "For persona configuration, see `sidekick-personas` skill"
- `config get/set` CLI commands in tooling section

### Estimated Size

~250 lines (down from 414).

### Resource Files

Retains all current resource files. The `PERSONAS.md` resource is shared — both skills reference it, but the setup skill only links to it for reference, while the personas skill actively uses it for discovery.

---

## Component 2: `sidekick-personas` Skill

An intent-driven skill that maps user goals to correct configuration actions.

### Trigger Conditions

- "change persona", "switch persona", "set persona to X"
- "set up persona weights", "I keep getting the same persona"
- "only show Star Trek personas", "block Marvin"
- "persona messages aren't great", "make it funnier/snarkier"
- "create a custom persona", "add a pirate persona"
- "configure persona LLM", "use a different model for personas"

### Core Structure: Intent Recipes

Each recipe specifies the minimum questions needed, sensible defaults, CLI commands to execute, and a verification step.

**Scope question (required for persistent config changes):** Before applying any change that writes to config or persona files, the agent must ask: "Should this apply to your user settings (all projects), the project (versioned, shared with team), or as a local-only override (untracked)?" This maps to `--scope=user|project|local` on `config set`, or choosing between `~/.sidekick/personas/` vs `.sidekick/personas/` for persona file creation. This is an additional question beyond the recipe-specific ones listed below. Note: session-level operations like `persona set` (which writes to ephemeral session state) do not require a scope question.

#### Recipe: Switch Persona

| Aspect | Detail |
|--------|--------|
| Example phrases | "change to skippy", "be marvin", "set persona" |
| Questions asked | 0 (persona ID is in the request) |
| Agent action | `persona set <id> --session-id=<id>` then `persona test <id>` to confirm |
| Verification | Show test output so user sees the voice |

#### Recipe: Curate the Pool

| Aspect | Detail |
|--------|--------|
| Example phrases | "only trek personas", "block marvin", "fewer personas" |
| Questions asked | 0-1 (confirm the list if ambiguous) |
| Agent action | Determine if allowList or blockList change, then `config set` |
| Verification | `config get` to show resulting pool |

Curating uses allowList vs blockList:
- "Only show X, Y, Z" → set allowList
- "Never show X" → add to blockList
- "Remove X from rotation" → either add to blockList OR set weight to 0

#### Recipe: Weight the Pool

| Aspect | Detail |
|--------|--------|
| Example phrases | "more darth vader", "less sidekick", "favour skippy" |
| Questions asked | 0 (intent maps directly to weight adjustment) |
| Agent action | `config set` on weights path |
| Verification | `config get` weights to confirm |

Weight guidance for the agent:
- "more X" → set weight 50-100 (relative to default of 1)
- "much more X" → set weight 100+
- "less X" → set weight to 0.1-0.5
- "never X" → set weight to 0 (or add to blockList)

#### Recipe: Improve Voice Quality

| Aspect | Detail |
|--------|--------|
| Example phrases | "messages feel generic", "not funny enough", "improve persona quality" |
| Questions asked | 1 (which personas, or all?) |
| Agent action | Set LLM profile override to `creative-long`, then `persona test` to demo |
| Verification | `persona test` shows improved output |

LLM profile selection logic for the agent:
- "funnier/snarkier/more creative" → `creative-long` (higher quality model, more tokens)
- "faster responses" → `fast-lite` (trade quality for speed)
- "cheaper" → `cheap-fallback`

#### Recipe: Create Custom Persona

| Aspect | Detail |
|--------|--------|
| Example phrases | "make a pirate persona", "create custom persona" |
| Questions asked | 2-3 (name/id, theme, tone keywords) |
| Agent action | Write YAML to `~/.sidekick/personas/` or `.sidekick/personas/` |
| Verification | `persona list` to confirm it appears, `persona test` for voice |

Template the agent uses:
```yaml
id: <user-provided>
display_name: <derived from id>
theme: "<user-provided, 1-2 sentences>"
personality_traits: [<derived from theme>]
tone_traits: [<user-provided or derived>]
statusline_empty_messages:
  - "<agent generates 5-10 in-character messages>"
snarky_examples:
  - "<agent generates 3-5, max 15 words each>"
snarky_welcome_examples:
  - "<agent generates 3-5, max 10 words each>"
```

#### Recipe: Bulk Configure

| Aspect | Detail |
|--------|--------|
| Example phrases | "set up my persona preferences", "configure personas" |
| Questions asked | 3-5 (guided walkthrough) |
| Agent action | Compound: list → curate → weight → test |
| Flow | 1. Show available personas 2. "Which do you want?" (allowList) 3. "Any favourites?" (weights) 4. "Want to test the voice quality?" (persona test) |

### Resource Files

- References shared `PERSONAS.md` for persona catalogue (IDs, display names, themes)
- Does NOT load `LLM.md`, `FEATURES.md`, or other general config resources — the `config get/set` CLI abstracts those away

### Estimated Size

~200 lines — deliberately compact because the CLI does the heavy lifting.

---

## Component 3: `config get/set` CLI Commands

The enabler that makes intent-driven configuration reliable. The agent constructs the right values from user intent; the CLI validates and writes them correctly.

### Command Interface

```bash
# READ — returns cascade-resolved value (what's actually in effect)
sidekick config get <dot.path>
sidekick config get <dot.path> --scope=project   # specific scope only
sidekick config get <dot.path> --json             # structured output

# WRITE — writes to specified scope (default: project)
sidekick config set <dot.path> <value> [--scope=user|project|local]

# LIST — show all overrides at a scope
sidekick config list [--scope=user|project|local]

# UNSET — remove an override (fall back to next cascade level)
sidekick config unset <dot.path> [--scope=user|project|local]
```

### Dot-Path Resolution

The first path segment determines the config domain, which maps to exactly one YAML file per scope. There are four domains:

| Domain | YAML File | Local Override |
|--------|-----------|----------------|
| `core` | `config.yaml` | `config.local.yaml` |
| `llm` | `llm.yaml` | `llm.local.yaml` |
| `transcript` | `transcript.yaml` | `transcript.local.yaml` |
| `features` | `features.yaml` | `features.local.yaml` |

Remaining path segments map to nested YAML keys within the domain file:

| Dot Path | File | YAML Structure |
|----------|------|----------------|
| `llm.defaultProfile` | `llm.yaml` | `defaultProfile:` |
| `llm.profiles.my-profile` | `llm.yaml` | `profiles: my-profile:` |
| `features.statusline.settings.format` | `features.yaml` | `statusline: settings: format:` |
| `features.session-summary.settings.personas.weights.skippy` | `features.yaml` | `session-summary: settings: personas: weights: skippy:` |
| `core.logging.level` | `config.yaml` | `logging: level:` |

All feature settings (statusline, reminders, session-summary) live in a single `features.yaml` file — there are no per-feature files.

### Value Parsing

The `set` command auto-detects value types:

| Input | Detected Type | Result |
|-------|---------------|--------|
| `42` | number | `42` |
| `0.8` | number | `0.8` |
| `true` / `false` | boolean | `true` / `false` |
| `"hello"` or `hello` | string | `"hello"` |
| `'{"key":"val"}'` | JSON object | parsed and merged |
| `'["a","b"]'` | JSON array | parsed and set |

### Scope Resolution

**Read (`get`):** By default, returns the cascade-resolved value — what's actually in effect after all layers merge. With `--scope`, returns only the value set at that specific scope (or empty if not overridden there).

**Write (`set`):** Defaults to `project` scope (`.sidekick/`). The `--scope` flag selects:
- `project` → `.sidekick/{domain}.yaml`
- `user` → `~/.sidekick/{domain}.yaml`
- `local` → `.sidekick/{domain}.local.yaml`

**Unset (`unset`):** Removes the key from the specified scope's file. The cascade falls through to the next level.

### Validation

The CLI validates against the config schema:

| Validation | Example |
|------------|---------|
| Unknown paths rejected | `config set features.nonexistent.foo bar` → error |
| Type enforcement | `config set ...weights.skippy "high"` → error (must be number) |
| Enum enforcement | `config set core.logging.level verbose` → error (must be debug\|info\|warn\|error) |
| JSON structure validation | `config set llm.profiles.x '{bad json}'` → error |

### Comment Preservation & File Seeding

`config set` must preserve YAML comments in existing files. Use the `yaml` package's `parseDocument` API (comment-aware AST) rather than plain parse/serialize.

When creating a new file (e.g., user has no `features.yaml` yet), seed it from the bundled defaults file (`assets/sidekick/defaults/features.defaults.yaml`). This gives the user all the inline documentation from the defaults as a starting point, with their override applied on top.

### Implementation Notes

- The cascade resolution logic already exists in the config loader — `get` wraps it
- The `set` side is new work: parsing dot-paths into nested YAML keys, reading the existing domain file via `parseDocument`, deep-merging while preserving comments, and writing back
- The domain-to-file mapping is defined in `DOMAIN_FILES` in `config.ts` — the CLI reuses this
- New file creation copies from `EXTERNAL_DEFAULTS_FILES` mapping for comment seeding

### Examples — Persona Skill Usage

```bash
# Agent: "Switch to Skippy" (session-level, no scope question needed)
sidekick persona set skippy --session-id=abc-123
sidekick persona test skippy --session-id=abc-123

# Agent: "Only Star Trek personas" (agent asks scope first)
sidekick config set features.session-summary.settings.personas.allowList \
  "bones,scotty,spock,emh,7-of-9,kirk" --scope=user

# Agent: "More Darth Vader" (agent asks scope first)
sidekick config set features.session-summary.settings.personas.weights.darth-vader 100 --scope=project

# Agent: "Persona messages feel generic" — upgrade LLM profile (agent asks scope first)
sidekick config set features.session-summary.settings.personas.llmProfiles.skippy creative-long --scope=user
sidekick persona test skippy --session-id=abc-123 --type=snarky

# Agent: "What's my current persona setup?" (reads cascade-resolved value)
sidekick config get features.session-summary.settings.personas --json
```

---

## What's NOT In Scope

- No new persona CLI subcommands (existing `persona set/list/test/clear` suffice)
- No dedicated LLM profile subcommands (JSON values in `config set` cover it)
- No changes to the config cascade or resolution logic itself
- No changes to the daemon or hook system
- No changes to the persona selection algorithm
- No proactive suggestion system (agent diagnostics may be a future enhancement)

## Testing Strategy

### CLI Tests

- `config get` with various dot-paths across all domains
- `config get` cascade resolution (local overrides project overrides user overrides bundled)
- `config get --scope` returns scope-specific value
- `config set` writes correct YAML structure
- `config set` with JSON values for complex objects
- `config set --scope` writes to correct file
- `config unset` removes key and cascade falls through
- Validation: unknown paths, wrong types, malformed JSON

### Skill Tests (per writing-skills methodology)

- Baseline: agent attempts persona config WITHOUT skill, document failures
- With skill: agent correctly executes intent recipes
- Pressure test: ambiguous requests ("make it better") — agent asks minimum questions
- Edge cases: nonexistent persona IDs, conflicting allowList/blockList

## Resolved Questions

1. **~~Comment preservation~~:** Yes — use `yaml` package's `parseDocument` API. When creating new files, seed from bundled defaults for documentation.
2. **~~Feature YAML file mapping~~:** Single `features.yaml` per scope. Four domains, four files, no per-feature splitting.
3. **~~Write target~~:** YAML files only. The `sidekick.config` dot-notation file has been removed from the codebase.
4. **~~Scope selection~~:** The agent must ask the user which scope (user, project, local) before applying config changes.
