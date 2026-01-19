# Reminders Reference

**Default location:** `assets/sidekick/reminders/`
**Override locations:** `~/.sidekick/assets/reminders/` or `.sidekick/assets/reminders/`

Reminders are automated messages injected during development to maintain focus and quality.

## Available Reminders

| ID | Trigger | Purpose |
|----|---------|---------|
| `pause-and-reflect` | Tool count threshold | Checkpoint for progress |
| `verify-completion` | Source code edit + completion claim | Ensure verification before done |
| `user-prompt-submit` | Every user message | Maintain focus and discipline |

---

## Reminder Structure

```yaml
id: <unique-id>                    # Identifier
blocking: <boolean>                # Block execution until acknowledged?
priority: <number>                 # Higher = fires earlier (0-100)
persistent: <boolean>              # Fire on every trigger vs once?

additionalContext: |               # Injected into assistant context
  Multi-line instructions
  for the assistant...

userMessage: <string>              # Shown to user when reminder fires

reason: <string>                   # Log/debug reason (supports {{variables}})
```

## Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `blocking` | boolean | If true, blocks until assistant addresses it |
| `priority` | number | Higher fires first (0-100, default: 50) |
| `persistent` | boolean | If true, fires every trigger; if false, fires once |
| `additionalContext` | string | Instructions injected to assistant |
| `userMessage` | string | Message shown to user |
| `reason` | string | Logging/debug info (can use `{{variables}}`) |

---

## pause-and-reflect

**Trigger:** Tool usage exceeds `pause_and_reflect_threshold` (default: 60)

**Purpose:** Checkpoint to catch spinning or unproductive loops.

**Default content:**
```
Pause. Are you making progress, or spinning?

If stuck: Tell the user what's not working and what you need.
If progressing: Give a brief update, then continue.
```

**Configuration:**
```bash
# Adjust threshold
features.reminders.settings.pause_and_reflect_threshold=100
```

---

## verify-completion

**Trigger:** Source code edit + assistant appears to claim completion

**Purpose:** Enforce verification (build, test, lint) before claiming done.

**Default content:**
```
COMPLETION VERIFICATION REQUIRED

Before claiming this task is complete, you must verify:

For Code Changes:
- Run type-check: `pnpm typecheck`
- Run build: `pnpm build`
- Run lint: `pnpm lint`
- Run relevant tests: `pnpm test`

Evidence before assertions. Don't claim success without verification.
```

**Configuration:**
```bash
# Disable smart completion detection (always block)
features.reminders.settings.completion_detection.enabled=false

# Adjust confidence threshold
features.reminders.settings.completion_detection.confidence_threshold=0.8
```

---

## user-prompt-submit

**Trigger:** Every user message

**Purpose:** Maintain focus and remind of best practices.

**Default content:**
```
Before proceeding:
- Verify first (challenge assumptions, check facts)
- Review the user's request carefully
- If unclear, ask for clarification
- Track progress with TodoWrite
- Stay focused; don't drift
- Verify work before claiming completion
```

---

## Overriding Reminders

To customize a reminder:

1. Copy from `assets/sidekick/reminders/` to override location
2. Modify the YAML
3. Changes apply immediately (hot-reload)

**User-level:** `~/.sidekick/assets/reminders/pause-and-reflect.yaml`
**Project-level:** `.sidekick/assets/reminders/pause-and-reflect.yaml`

### Example: Custom Verification Reminder

```yaml
# .sidekick/assets/reminders/verify-completion.yaml
id: verify-completion
blocking: true
priority: 50
persistent: false

additionalContext: |
  VERIFICATION CHECKLIST:

  1. Run: npm test
  2. Run: npm run lint
  3. Check for console.log statements
  4. Review git diff for unintended changes

  Don't claim done without running these.

userMessage: "Verification checkpoint..."

reason: "Custom verification for this project"
```

### Asset Cascade (Priority Order)

1. `.sidekick/assets.local/reminders/` - Untracked project overrides
2. `.sidekick/assets/reminders/` - Tracked project overrides
3. `~/.sidekick/assets/reminders/` - User overrides
4. `assets/sidekick/reminders/` - Bundled defaults

## Disabling Reminders

```yaml
# features.yaml - disable entire feature
reminders:
  enabled: false
```

Or set very high thresholds:
```bash
# sidekick.config - effectively disable pause-and-reflect
features.reminders.settings.pause_and_reflect_threshold=999999
```

## Variables in Templates

| Variable | Available In | Description |
|----------|--------------|-------------|
| `{{toolsThisTurn}}` | pause-and-reflect | Tool count since last user prompt |
| `{{sessionId}}` | user-prompt-submit | Current session ID |

---

## Generating Reminders from CLAUDE.md

Instead of manually writing reminders, ask Claude to generate them from your existing rules:

> "Generate reminders from my CLAUDE.md"

Claude will:
1. Read your CLAUDE.md and AGENTS.md files
2. Extract the most important rules relevant to each reminder type
3. Show defaults alongside suggested customizations
4. Let you review and refine before writing

**What gets customized:**
- `additionalContext` - **Always** (this is the reminder text)
- `userMessage`, `reason` - **Only if you explicitly request**
- `id`, `blocking`, `priority`, `persistent` - **Never** (copied exactly from source)

**Best for:**
- `user-prompt-submit` - Capture input processing discipline from your rules
- `verify-completion` - Capture definition of done and verification requirements

See the main skill documentation for the interactive workflow.
