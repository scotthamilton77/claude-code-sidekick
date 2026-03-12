# Plugin System for Sidekick Reminder Extensions

## Overview

A lightweight plugin system that lets Sidekick discover, load, and manage extension plugins. Plugins can contribute reminder triggers and prompt enrichment content. The system follows Sidekick's existing asset cascade pattern and supports hot-reload.

## Goals

- Enable tool-specific reminders (e.g., superpowers code-review, beads hierarchy context)
- Allow users to define custom plugins alongside bundled defaults
- Refactor existing VC-tools (build, test, lint, typecheck) into a built-in plugin
- Support hot-reload without daemon restart
- Design infrastructure broad enough for future consumers (session state tracking)

## Non-Goals (v1)

- Plugin CLI (`sidekick plugin list/enable/disable`) — manual YAML editing for now
- Plugin dependencies or plugin-to-plugin communication
- Session state tracking consumer (future capability type)
- Individual YAML file hot-reload (manifest/folder level only)

## Architecture

### Plugin Folder Convention

Each plugin lives in a standard folder structure:

```
assets/sidekick/plugins/{plugin-id}/
├── plugin.yaml              # Metadata, detection, capabilities
├── detect.sh                # Detection script
├── reminders/               # Reminder YAML files (standard format)
│   └── vc-code-review.yaml
└── triggers/
    └── triggers.yaml        # Trigger definitions
```

### Asset Cascade for Plugins

Plugins are resolved via the same cascade as other Sidekick assets (highest priority wins):

1. `.sidekick/plugins/{id}/` — project-scope override
2. `~/.sidekick/plugins/{id}/` — user-scope override
3. `assets/sidekick/plugins/{id}/` — bundled defaults

### Plugin Metadata (`plugin.yaml`)

```yaml
id: superpowers
name: Superpowers Plugin
description: Code review and quality reminders for superpowers skill suite
version: 1.0.0
capabilities:
  - reminders       # First consumer (now)
  # - monitors      # Future consumer (session state tracking)

detection:
  command: "./detect.sh"    # Relative to plugin folder
  # Returns JSON: { "detected": true, "scope": "user" | "project" }
```

Built-in plugins (like verification) use `builtin: true` and have no `detect.sh`.

### Detection Script Contract

- `detect.sh` receives no arguments
- Outputs JSON to stdout: `{ "detected": true, "scope": "user" }` or `{ "detected": false }`
- Exit 0 = detection ran successfully (check JSON for result)
- Exit non-zero = detection failed (treat as not detected)
- Scope determines which manifest the plugin is registered in

### Plugin Manifests

Manifests are scope-specific — no cross-contamination:

- **Project scope:** `.sidekick/plugins.yaml`
- **User scope:** `~/.sidekick/plugins.yaml`

Each manifest only contains plugins detected at that scope.

```yaml
# .sidekick/plugins.yaml (project)
plugins:
  beads:
    enabled: true
    detected_at: 2026-03-10T14:30:00Z
    source: bundled
    version: 1.0.0

# ~/.sidekick/plugins.yaml (user)
plugins:
  superpowers:
    enabled: true
    detected_at: 2026-03-10T14:30:00Z
    source: bundled
    version: 1.0.0
```

**Key behaviors:**

- Re-running setup re-detects and updates the manifest
- Existing `enabled: false` overrides are preserved (user manually disabled)
- At runtime, the PluginRegistry merges both manifests — project-scope entries override user-scope entries for the same plugin ID

### Setup Integration

`sidekick setup` gains a plugin discovery phase:

1. Iterate plugin folders across all cascade levels
2. Run each `detect.sh`
3. Write enabled plugins to the scope-appropriate manifest

## Trigger System

Plugins declare triggers in `triggers/triggers.yaml`. Three first-class trigger types:

### Absence Triggers ("X happened but Y didn't follow")

Modeled after existing vc-tools. Stages a reminder when a condition is met, clears it when the expected follow-up action is observed.

```yaml
triggers:
  - id: vc-code-review
    type: absence
    hook: Stop
    stage_when:
      source_edited: true
    clear_when:
      - tool: Agent
        pattern: "code-review"
      - tool: Bash
        pattern: "code-review"
    reminder: vc-code-review
    clearing_threshold: 3
    enabled: true
```

### Reactive Triggers ("X just happened, inject context")

Pattern-match on a tool call and immediately stage a reminder.

```yaml
  - id: beads-claim-context
    type: reactive
    hook: PostToolUse
    match:
      tool: Bash
      pattern: "bd update .* --status=in_progress"
    captures:
      - name: bead_id
        pattern: "bd update (\\S+)"
        group: 1
    reminder: beads-claim-context
    enabled: true
```

### Prompt Enrichment Triggers ("X happened, run a script, stage context for LLM prompts")

Run a plugin-provided script and stage the output as context for LLM prompt generation (e.g., session summary, snarky comment).

```yaml
  - id: beads-hierarchy
    type: prompt-enrichment
    match:
      tool: Bash
      pattern: "bd update .* --status=in_progress"
    captures:
      - name: bead_id
        pattern: "bd update (\\S+)"
        group: 1
    enrichment:
      command: "./enrich-claim.sh"   # Receives captures as env vars
      target: session-summary        # Which prompt this enriches
      clear_on_consumption: true     # Delete after prompt generation reads it
```

### Shared Trigger Properties

Both absence and reactive types support:

- `priority` — override the reminder YAML's default priority (optional)
- `enabled` — per-trigger disable without removing (default: true)

### Template Variables for Reactive Triggers

For v1, reactive triggers get variables from:

- Regex capture groups from tool input/output (the `captures` field)
- Built-in context already available (sessionId, metrics, etc.)

## Prompt Enrichment Pipeline

This is a general Sidekick feature (not plugin-specific) that plugins can use.

### File Lifecycle

1. **Trigger fires** — run enrichment script with captures as env vars — **append** output to `.sidekick/sessions/{sessionId}/prompts/{target}/{trigger-id}.txt`
2. **Prompt generation fires** (e.g., session-summary) — scan target folder — include all files as additional context in the LLM prompt
3. **After consumption** — files marked `clear_on_consumption: true` get deleted

### Folder Structure

```
.sidekick/sessions/{sessionId}/prompts/
├── session-summary/
│   ├── beads-hierarchy.txt          # From beads plugin
│   └── some-core-enrichment.txt     # From core feature
└── snarky-comment/
    └── ...
```

### Accumulation

Multiple trigger firings for the same trigger ID **append** to the same file. E.g., claiming three beads in one session produces one file with all three hierarchies.

## PluginRegistry Service

New service loaded at daemon startup that manages plugin lifecycle.

### Interface

```typescript
interface PluginRegistry {
  loadManifests(): Promise<void>
  resolvePlugins(): Promise<void>
  getTriggers(type: TriggerType): { pluginId: string; trigger: Trigger }[]
  getEnabledPlugins(): ResolvedPlugin[]
  isEnabled(pluginId: string): boolean
  resolvePluginReminder(pluginId: string, reminderId: string): string | null
  startWatching(): void      // Begin hot-reload file watching
  stopWatching(): void       // Clean up watchers
}
```

### DaemonContext Extension

```typescript
interface DaemonContext {
  // ... existing fields
  pluginRegistry?: PluginRegistry  // Optional during incremental rollout
}
```

### Hot-Reload

The registry watches manifest files and plugin folders using chokidar (same pattern as existing `config-watcher.ts`):

**Watch targets:**

- `.sidekick/plugins.yaml` (project manifest)
- `~/.sidekick/plugins.yaml` (user manifest)
- `.sidekick/plugins/*/` (project plugin folders)
- `~/.sidekick/plugins/*/` (user plugin folders)

**On change:**

1. Re-read manifests
2. Re-resolve affected plugins
3. Update internal trigger/reminder maps
4. Emit `plugin:reloaded` event

Handlers query the registry each time rather than caching trigger configs locally, ensuring they always see the current state.

## VC-Tools Refactor

Existing verification tools become a built-in plugin, validating the plugin architecture.

### Migration

| Current Location | New Location |
|---|---|
| `assets/sidekick/reminders/vc-*.yaml` | `assets/sidekick/plugins/verification/reminders/vc-*.yaml` |
| `reminders.defaults.yaml` → `verification_tools` | `plugins/verification/triggers/triggers.yaml` |
| `track-verification-tools.ts` → `TOOL_REMINDER_MAP` | Reads from `PluginRegistry.getTriggers('absence')` |

### What Stays in Code

- State machine logic (STAGED → VERIFIED → COOLDOWN → re-STAGED) — behavioral, not configuration
- `verify-completion` wrapper staging logic — orchestration
- Orchestrator rules (P&R vs VC coordination) — unchanged

### Reminder Resolution

Plugin reminders resolve **only** via the plugin cascade, separate from core reminders:

- **Core reminders** → `assets/sidekick/reminders/` cascade
- **Plugin reminders** → `assets/sidekick/plugins/{id}/reminders/` cascade

No cross-contamination. A plugin reminder is only overridden via its plugin path.

## Risk Assessment

| Component | Risk | Mitigation |
|---|---|---|
| Plugin infrastructure (folders, manifests, registry) | Low | Follows existing patterns (asset cascade, config-watcher) |
| Reactive triggers | Low | Simple pattern-match handler |
| Prompt enrichment pipeline | Medium | New capability, new file lifecycle, needs integration with prompt builders |
| Hot-reload | Medium | Chokidar pattern exists, but plugin state invalidation needs care |
| VC-tools refactor | Higher | Touching working, tested system. Should come AFTER plugin infra is proven |

## Implementation Order

The VC-tools refactor is the riskiest piece. It should come after the plugin infrastructure is proven with a fresh plugin (like superpowers code-review), not before.

Recommended order:

1. Plugin folder convention + PluginRegistry service + hot-reload
2. Absence and reactive trigger handlers (reading from registry)
3. First plugin: superpowers code-review (validates the architecture)
4. Prompt enrichment pipeline (general feature)
5. VC-tools refactor into built-in plugin (proves backward compat)
6. Setup integration (detection scripts)
