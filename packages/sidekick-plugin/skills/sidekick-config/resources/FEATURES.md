# Features Configuration Reference

**Default files:**
- `assets/sidekick/defaults/features.defaults.yaml` (top-level)
- `assets/sidekick/defaults/features/statusline.defaults.yaml`
- `assets/sidekick/defaults/features/reminders.defaults.yaml`
- `assets/sidekick/defaults/features/session-summary.defaults.yaml`

**Override locations:** `~/.sidekick/features.yaml` or `.sidekick/features.yaml`

## Structure

```yaml
# Each feature at root level (NOT under "features:" wrapper)
statusline:
  enabled: <boolean>
  settings:
    # feature-specific settings

reminders:
  enabled: <boolean>
  settings:
    # feature-specific settings

session-summary:
  enabled: <boolean>
  settings:
    # feature-specific settings
```

---

## Statusline Feature

Controls the status display shown during sessions.

### Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `format` | string | (complex) | Format string with placeholders |
| `thresholds.tokens.warning` | number | 100000 | Yellow at this token count |
| `thresholds.tokens.critical` | number | 160000 | Red at this token count |
| `thresholds.cost.warning` | number | 0.5 | Yellow at this cost ($) |
| `thresholds.cost.critical` | number | 1.0 | Red at this cost ($) |
| `thresholds.logs.warning` | number | 5 | Yellow at this warning count |
| `thresholds.logs.critical` | number | 1 | Red at any error |
| `theme.useNerdFonts` | mixed | `safe` | Symbol mode (see below) |
| `theme.supportedMarkdown.bold` | boolean | true | Convert `**text**` to bold |
| `theme.supportedMarkdown.italic` | boolean | true | Convert `*text*` to italic |
| `theme.supportedMarkdown.code` | boolean | true | Convert `` `text` `` to dim |
| `theme.colors.*` | string | varies | ANSI color assignments |

### Format Placeholders

| Placeholder | Example Output | Description |
|-------------|---------------|-------------|
| `{personaName}` | `Sidekick` | Current persona (empty if disabled) |
| `{model}` | `Opus` | Current model name |
| `{contextBar}` | `▓▓▒\|░░░` | Visual context usage graph |
| `{contextWindow}` | `200k` | Total context size |
| `{tokenUsageActual}` | `45k` | Current tokens |
| `{tokenUsageEffective}` | `90k` | Tokens + compaction buffer |
| `{tokenPercentageActual}` | `22%` | Actual % of context |
| `{tokenPercentageEffective}` | `45%` | Effective % with buffer |
| `{logs}` | `⚠0 ✗0` | Warning/error counts |
| `{cost}` | `$0.15` | Session cost |
| `{duration}` | `12m` | Session duration |
| `{cwd}` | `/Users/...` | Current directory |
| `{branch}` | `⎇ main` | Git branch |
| `{title}` | `Debug LLM...` | Session title |
| `{summary}` | `Fixing...` | Session summary |

### Symbol Modes (useNerdFonts)

| Value | Description |
|-------|-------------|
| `true` or `"full"` | All Unicode including emojis |
| `"safe"` | BMP-only (avoids VS Code width issues) |
| `false` or `"ascii"` | ASCII-only for max compatibility |

### Colors

Available: `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `brightRed`, `brightGreen`, `brightYellow`

---

## Reminders Feature

Controls automated reminders during development.

### Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `pause_and_reflect_threshold` | number | 60 | Tool calls before checkpoint |
| `source_code_patterns` | array | [...] | Glob patterns triggering verify-completion |
| `max_verification_cycles` | number | 0 | Re-eval limit (0=unlimited) |
| `completion_detection.enabled` | boolean | true | Smart completion classification |
| `completion_detection.confidence_threshold` | number | 0.7 | Minimum confidence to block |
| `completion_detection.llm.profile` | string | `fast-lite` | LLM for classification |
| `completion_detection.llm.fallback_profile` | string | `cheap-fallback` | Fallback LLM |

### Source Code Patterns (default)

Triggers verify-completion reminder when editing:
- `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx` (TypeScript/JavaScript)
- `**/*.py` (Python)
- `**/*.go`, `**/*.rs`, `**/*.java`, `**/*.kt`, `**/*.scala` (Go, Rust, JVM)
- `**/*.c`, `**/*.cpp`, `**/*.h`, `**/*.hpp` (C/C++)
- `**/*.rb`, `**/*.php`, `**/*.cs`, `**/*.swift`, `**/*.sh` (Others)
- `**/*.yaml`, `**/*.yml`, `**/*.toml` (Config)
- `**/package.json`, `**/tsconfig.json`, `**/Dockerfile`, `**/Makefile`

---

## Session Summary Feature

Controls session title, intent tracking, and persona-driven messages.

### Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `llm.sessionSummary.profile` | string | `fast-lite` | LLM for summaries |
| `llm.snarkyComment.profile` | string | `creative` | LLM for snarky messages |
| `llm.resumeMessage.profile` | string | `creative-long` | LLM for resume messages |
| `excerptLines` | number | 80 | Transcript lines for analysis |
| `includeToolMessages` | boolean | true | Include [TOOL]: lines |
| `includeToolOutputs` | boolean | false | Include tool output content |
| `includeAssistantThinking` | boolean | false | Include thinking blocks |
| `keepHistory` | boolean | false | Keep summary history |
| `maxTitleWords` | number | 8 | Max words in title |
| `maxIntentWords` | number | 12 | Max words in intent |
| `snarkyMessages` | boolean | true | Enable snarky comments |
| `countdown.lowConfidence` | number | 5 | Refresh after N tools (low) |
| `countdown.mediumConfidence` | number | 10 | Refresh after N tools (medium) |
| `countdown.highConfidence` | number | 10000 | Refresh after N tools (high) |
| `bookmark.confidenceThreshold` | number | 0.8 | Min confidence for bookmark |
| `bookmark.resetThreshold` | number | 0.7 | Confidence to reset bookmark |
| `personas.allowList` | string | "" | Comma-separated allowed personas |
| `personas.resumeFreshnessHours` | number | 4 | Max age for resume messages |

---

## Surgical Changes (sidekick.config)

```bash
# Disable statusline
features.statusline.enabled=false

# Minimal statusline format
features.statusline.settings.format={model} | {tokenPercentageActual}

# Increase pause-and-reflect threshold
features.reminders.settings.pause_and_reflect_threshold=100

# Disable completion detection (always block)
features.reminders.settings.completion_detection.enabled=false

# Change resume message freshness to 8 hours
features.session-summary.settings.personas.resumeFreshnessHours=8

# Restrict personas
features.session-summary.settings.personas.allowList=sidekick,marvin
```

## Full Override

Copy the feature-specific default file to `.sidekick/features.yaml` and modify. Example:

```yaml
# .sidekick/features.yaml
statusline:
  enabled: true
  settings:
    format: "{model} | {tokenPercentageActual}"

reminders:
  enabled: true
  settings:
    pause_and_reflect_threshold: 100
```
