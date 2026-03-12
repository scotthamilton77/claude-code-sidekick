# Plugin System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a lightweight plugin system for Sidekick that enables tool-specific reminder extensions, prompt enrichment, and hot-reloadable plugin management.

**Architecture:** Plugins are self-contained folders with metadata, detection scripts, reminders, and trigger configs. A PluginRegistry service loads at daemon startup, resolves plugins via asset cascade, and provides trigger data to handlers. Three trigger types: absence (VC-style), reactive (pattern-match), and prompt-enrichment (script-based context generation).

**Tech Stack:** TypeScript, Zod, chokidar, vitest

**Design Doc:** `docs/plans/2026-03-11-plugin-system-design.md`

---

### Task 1: Plugin Types & Schemas

**Depends on:** Nothing (foundation task)

**Files:**
- Create: `packages/types/src/services/plugin-registry.ts`
- Modify: `packages/types/src/services/index.ts` (add barrel export)

**Context:** Define all TypeScript types and Zod schemas that the rest of the plugin system depends on. Follows existing pattern in `packages/types/src/services/` — one file per service. Zod schemas follow the same conventions as `packages/feature-reminders/src/types.ts` (VerificationToolConfigSchema, etc.) and `packages/types/src/services/state.ts` (ReminderThrottleEntrySchema, etc.).

**Step 1: Write failing test for Zod schema validation**

Create: `packages/types/src/services/__tests__/plugin-registry.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import {
  PluginManifestEntrySchema,
  PluginManifestSchema,
  AbsenceTriggerSchema,
  ReactiveTriggerSchema,
  PromptEnrichmentTriggerSchema,
  TriggerSchema,
  PluginMetadataSchema,
} from '../plugin-registry.js'

describe('PluginManifestEntrySchema', () => {
  it('validates a minimal manifest entry', () => {
    const entry = {
      enabled: true,
      detected_at: '2026-03-10T14:30:00Z',
      source: 'bundled',
      version: '1.0.0',
    }
    expect(PluginManifestEntrySchema.parse(entry)).toEqual(entry)
  })

  it('rejects entry missing required fields', () => {
    expect(() => PluginManifestEntrySchema.parse({ enabled: true })).toThrow()
  })
})

describe('PluginManifestSchema', () => {
  it('validates a plugins manifest', () => {
    const manifest = {
      plugins: {
        superpowers: {
          enabled: true,
          detected_at: '2026-03-10T14:30:00Z',
          source: 'bundled',
          version: '1.0.0',
        },
      },
    }
    expect(PluginManifestSchema.parse(manifest)).toEqual(manifest)
  })

  it('defaults plugins to empty object', () => {
    expect(PluginManifestSchema.parse({})).toEqual({ plugins: {} })
  })
})

describe('AbsenceTriggerSchema', () => {
  it('validates a complete absence trigger', () => {
    const trigger = {
      id: 'vc-code-review',
      type: 'absence' as const,
      hook: 'Stop',
      stage_when: { source_edited: true },
      clear_when: [
        { tool: 'Agent', pattern: 'code-review' },
        { tool: 'Bash', pattern: 'code-review' },
      ],
      reminder: 'vc-code-review',
      clearing_threshold: 3,
      enabled: true,
    }
    expect(AbsenceTriggerSchema.parse(trigger)).toEqual(trigger)
  })

  it('defaults enabled to true', () => {
    const trigger = {
      id: 'vc-code-review',
      type: 'absence',
      hook: 'Stop',
      stage_when: { source_edited: true },
      clear_when: [{ tool: 'Agent', pattern: 'code-review' }],
      reminder: 'vc-code-review',
      clearing_threshold: 3,
    }
    const result = AbsenceTriggerSchema.parse(trigger)
    expect(result.enabled).toBe(true)
  })
})

describe('ReactiveTriggerSchema', () => {
  it('validates a reactive trigger with captures', () => {
    const trigger = {
      id: 'beads-claim-context',
      type: 'reactive' as const,
      hook: 'PostToolUse',
      match: { tool: 'Bash', pattern: 'bd update .* --status=in_progress' },
      captures: [{ name: 'bead_id', pattern: 'bd update (\\S+)', group: 1 }],
      reminder: 'beads-claim-context',
      enabled: true,
    }
    expect(ReactiveTriggerSchema.parse(trigger)).toEqual(trigger)
  })

  it('defaults captures to empty array', () => {
    const trigger = {
      id: 'test',
      type: 'reactive',
      hook: 'PostToolUse',
      match: { tool: 'Bash', pattern: 'test' },
      reminder: 'test-reminder',
    }
    const result = ReactiveTriggerSchema.parse(trigger)
    expect(result.captures).toEqual([])
  })
})

describe('PromptEnrichmentTriggerSchema', () => {
  it('validates a prompt enrichment trigger', () => {
    const trigger = {
      id: 'beads-hierarchy',
      type: 'prompt-enrichment' as const,
      match: { tool: 'Bash', pattern: 'bd update .* --status=in_progress' },
      captures: [{ name: 'bead_id', pattern: 'bd update (\\S+)', group: 1 }],
      enrichment: {
        command: './enrich-claim.sh',
        target: 'session-summary',
        clear_on_consumption: true,
      },
      enabled: true,
    }
    expect(PromptEnrichmentTriggerSchema.parse(trigger)).toEqual(trigger)
  })
})

describe('TriggerSchema (discriminated union)', () => {
  it('discriminates absence triggers', () => {
    const trigger = {
      id: 't1',
      type: 'absence',
      hook: 'Stop',
      stage_when: { source_edited: true },
      clear_when: [{ tool: 'Bash', pattern: 'test' }],
      reminder: 'r1',
      clearing_threshold: 3,
    }
    const result = TriggerSchema.parse(trigger)
    expect(result.type).toBe('absence')
  })

  it('discriminates reactive triggers', () => {
    const trigger = {
      id: 't2',
      type: 'reactive',
      hook: 'PostToolUse',
      match: { tool: 'Bash', pattern: 'test' },
      reminder: 'r2',
    }
    const result = TriggerSchema.parse(trigger)
    expect(result.type).toBe('reactive')
  })

  it('discriminates prompt-enrichment triggers', () => {
    const trigger = {
      id: 't3',
      type: 'prompt-enrichment',
      match: { tool: 'Bash', pattern: 'test' },
      enrichment: {
        command: './test.sh',
        target: 'session-summary',
        clear_on_consumption: true,
      },
    }
    const result = TriggerSchema.parse(trigger)
    expect(result.type).toBe('prompt-enrichment')
  })
})

describe('PluginMetadataSchema', () => {
  it('validates plugin metadata with detection', () => {
    const meta = {
      id: 'superpowers',
      name: 'Superpowers Plugin',
      description: 'Code review reminders',
      version: '1.0.0',
      capabilities: ['reminders'],
      detection: { command: './detect.sh' },
    }
    expect(PluginMetadataSchema.parse(meta)).toEqual(meta)
  })

  it('validates builtin plugin (no detection)', () => {
    const meta = {
      id: 'verification',
      name: 'Verification Tools',
      description: 'Built-in VC tools',
      version: '1.0.0',
      capabilities: ['reminders'],
      builtin: true,
    }
    const result = PluginMetadataSchema.parse(meta)
    expect(result.builtin).toBe(true)
  })
})
```

Run: `pnpm --filter @sidekick/types test -- src/__tests__/plugin-registry`
Expected: FAIL (module not found)

**Step 2: Implement types and schemas**

Create: `packages/types/src/services/plugin-registry.ts`

```typescript
/**
 * Plugin Registry Types
 *
 * Type definitions and Zod schemas for the plugin system.
 * Plugins contribute reminders, triggers, and prompt enrichment content.
 *
 * @see docs/plans/2026-03-11-plugin-system-design.md
 */

import { z } from 'zod'

// ============================================================================
// Trigger Types
// ============================================================================

/** Capture group extraction from tool input/output */
export const TriggerCaptureSchema = z.object({
  name: z.string(),
  pattern: z.string(),
  group: z.number(),
})

export type TriggerCapture = z.infer<typeof TriggerCaptureSchema>

/** Match criteria for reactive/enrichment triggers */
export const TriggerMatchSchema = z.object({
  tool: z.string(),
  pattern: z.string(),
})

export type TriggerMatch = z.infer<typeof TriggerMatchSchema>

/** Clear-when criteria for absence triggers */
export const ClearWhenSchema = z.object({
  tool: z.string(),
  pattern: z.string(),
})

export type ClearWhen = z.infer<typeof ClearWhenSchema>

/** Stage-when criteria for absence triggers */
export const StageWhenSchema = z.object({
  source_edited: z.boolean(),
})

export type StageWhen = z.infer<typeof StageWhenSchema>

/** Shared trigger properties */
const BaseTriggerSchema = z.object({
  id: z.string(),
  priority: z.number().optional(),
  enabled: z.boolean().default(true),
})

/**
 * Absence trigger: "X happened but Y didn't follow"
 * Modeled after existing VC-tools state machine.
 */
export const AbsenceTriggerSchema = BaseTriggerSchema.extend({
  type: z.literal('absence'),
  hook: z.string(),
  stage_when: StageWhenSchema,
  clear_when: z.array(ClearWhenSchema).min(1),
  reminder: z.string(),
  clearing_threshold: z.number().int().positive(),
})

export type AbsenceTrigger = z.infer<typeof AbsenceTriggerSchema>

/**
 * Reactive trigger: "X just happened, inject context"
 * Pattern-matches a tool call and immediately stages a reminder.
 */
export const ReactiveTriggerSchema = BaseTriggerSchema.extend({
  type: z.literal('reactive'),
  hook: z.string(),
  match: TriggerMatchSchema,
  captures: z.array(TriggerCaptureSchema).default([]),
  reminder: z.string(),
})

export type ReactiveTrigger = z.infer<typeof ReactiveTriggerSchema>

/** Enrichment script configuration */
export const EnrichmentConfigSchema = z.object({
  command: z.string(),
  target: z.string(),
  clear_on_consumption: z.boolean().default(true),
})

export type EnrichmentConfig = z.infer<typeof EnrichmentConfigSchema>

/**
 * Prompt enrichment trigger: "X happened, run a script, stage context"
 * Runs a plugin-provided script and stages output for LLM prompts.
 */
export const PromptEnrichmentTriggerSchema = BaseTriggerSchema.extend({
  type: z.literal('prompt-enrichment'),
  match: TriggerMatchSchema,
  captures: z.array(TriggerCaptureSchema).default([]),
  enrichment: EnrichmentConfigSchema,
})

export type PromptEnrichmentTrigger = z.infer<typeof PromptEnrichmentTriggerSchema>

/** Discriminated union of all trigger types */
export const TriggerSchema = z.discriminatedUnion('type', [
  AbsenceTriggerSchema,
  ReactiveTriggerSchema,
  PromptEnrichmentTriggerSchema,
])

export type Trigger = z.infer<typeof TriggerSchema>

/** Type discriminant for querying triggers */
export type TriggerType = 'absence' | 'reactive' | 'prompt-enrichment'

// ============================================================================
// Plugin Metadata (plugin.yaml)
// ============================================================================

/** Plugin capabilities */
export const PluginCapabilitySchema = z.enum(['reminders'])

export type PluginCapability = z.infer<typeof PluginCapabilitySchema>

/** Detection configuration */
export const PluginDetectionSchema = z.object({
  command: z.string(),
})

export type PluginDetection = z.infer<typeof PluginDetectionSchema>

/**
 * Plugin metadata schema — parsed from plugin.yaml.
 * Built-in plugins set `builtin: true` and omit detection.
 */
export const PluginMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  capabilities: z.array(PluginCapabilitySchema).min(1),
  builtin: z.boolean().default(false),
  detection: PluginDetectionSchema.optional(),
})

export type PluginMetadata = z.infer<typeof PluginMetadataSchema>

// ============================================================================
// Plugin Manifest (plugins.yaml)
// ============================================================================

/** Single entry in the plugins manifest */
export const PluginManifestEntrySchema = z.object({
  enabled: z.boolean(),
  detected_at: z.string(),
  source: z.string(),
  version: z.string(),
})

export type PluginManifestEntry = z.infer<typeof PluginManifestEntrySchema>

/** Root plugins manifest (scoped: project or user) */
export const PluginManifestSchema = z.object({
  plugins: z.record(z.string(), PluginManifestEntrySchema).default({}),
})

export type PluginManifest = z.infer<typeof PluginManifestSchema>

// ============================================================================
// Triggers File (triggers.yaml)
// ============================================================================

/** Triggers file schema — the triggers/ folder contains triggers.yaml */
export const TriggersFileSchema = z.object({
  triggers: z.array(TriggerSchema).default([]),
})

export type TriggersFile = z.infer<typeof TriggersFileSchema>

// ============================================================================
// Resolved Plugin (runtime)
// ============================================================================

/** Detection result from detect.sh */
export interface PluginDetectionResult {
  detected: boolean
  scope?: 'user' | 'project'
}

/**
 * Fully resolved plugin at runtime.
 * Combines metadata, manifest entry, resolved folder path, and loaded triggers.
 */
export interface ResolvedPlugin {
  /** Plugin metadata from plugin.yaml */
  metadata: PluginMetadata
  /** Manifest entry (enabled/detected status) */
  manifest: PluginManifestEntry
  /** Resolved folder path (after cascade) */
  folderPath: string
  /** Loaded triggers from triggers.yaml */
  triggers: Trigger[]
}

// ============================================================================
// PluginRegistry Interface
// ============================================================================

/**
 * Plugin registry service interface.
 * Manages plugin lifecycle: loading manifests, resolving folders,
 * providing trigger data to handlers, and hot-reload via file watching.
 *
 * @see docs/plans/2026-03-11-plugin-system-design.md §PluginRegistry Service
 */
export interface PluginRegistry {
  /** Load manifest files from both scopes */
  loadManifests(): Promise<void>

  /** Resolve plugin folders via asset cascade, load metadata + triggers */
  resolvePlugins(): Promise<void>

  /** Get all triggers of a specific type from enabled plugins, with source plugin ID */
  getTriggers(type: TriggerType): { pluginId: string; trigger: Trigger }[]

  /** Get all enabled, resolved plugins */
  getEnabledPlugins(): ResolvedPlugin[]

  /** Check if a specific plugin is enabled */
  isEnabled(pluginId: string): boolean

  /** Resolve a reminder from a plugin's reminders/ folder */
  resolvePluginReminder(pluginId: string, reminderId: string): string | null

  /** Begin hot-reload file watching */
  startWatching(): void

  /** Stop file watchers and clean up */
  stopWatching(): void
}
```

**Step 3: Add barrel export**

In `packages/types/src/services/index.ts`, add:
```typescript
export * from './plugin-registry.js'
```

**Step 4: Verify tests pass**

Run: `pnpm --filter @sidekick/types test -- src/__tests__/plugin-registry`
Expected: PASS

**Step 5: Verify build**

Run: `pnpm --filter @sidekick/types build`
Expected: PASS

**Step 6: Commit**

```
feat(types): add plugin system types and Zod schemas
```

---

### Task 2: PluginRegistry Service (Core)

**Depends on:** Task 1

**Files:**
- Create: `packages/sidekick-core/src/plugin-registry.ts`
- Create: `packages/sidekick-core/src/__tests__/plugin-registry.test.ts`
- Modify: `packages/sidekick-core/src/index.ts` (add export)

**Context:** Implementation follows the ServiceFactory pattern in `packages/sidekick-core/src/service-factory.ts`. The registry loads manifests from `.sidekick/plugins.yaml` and `~/.sidekick/plugins.yaml`, resolves plugin folders via the asset cascade (project → user → bundled), reads `plugin.yaml` and `triggers/triggers.yaml` from each, and provides query methods.

**Step 1: Write failing tests for PluginRegistryImpl**

Create: `packages/sidekick-core/src/__tests__/plugin-registry.test.ts`

Test cases:
1. `loadManifests()` reads from both scope paths, merges with project overriding user
2. `loadManifests()` handles missing manifest files gracefully (empty manifest)
3. `resolvePlugins()` resolves plugin folders via cascade order: project → user → bundled
4. `resolvePlugins()` loads plugin.yaml metadata and triggers/triggers.yaml
5. `resolvePlugins()` skips disabled plugins (enabled: false in manifest)
6. `getTriggers('absence')` returns only absence triggers from enabled plugins
7. `getTriggers('reactive')` returns only reactive triggers from enabled plugins
8. `getEnabledPlugins()` returns all resolved, enabled plugins
9. `isEnabled()` returns correct boolean for known/unknown plugin IDs
10. `resolvePluginReminder()` reads reminder YAML from plugin's reminders/ folder via cascade

Key test setup pattern — use temp directories with fixture plugin structures:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as yaml from 'js-yaml'
import { PluginRegistryImpl } from '../plugin-registry.js'
import { createFakeLogger } from '@sidekick/testing-fixtures'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-test-'))
}

function writePluginFixture(
  baseDir: string,
  pluginId: string,
  metadata: Record<string, unknown>,
  triggers?: Record<string, unknown>[],
  reminders?: Record<string, string>
): void {
  const pluginDir = path.join(baseDir, 'plugins', pluginId)
  fs.mkdirSync(pluginDir, { recursive: true })
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.yaml'),
    yaml.dump(metadata)
  )
  if (triggers) {
    const triggersDir = path.join(pluginDir, 'triggers')
    fs.mkdirSync(triggersDir, { recursive: true })
    fs.writeFileSync(
      path.join(triggersDir, 'triggers.yaml'),
      yaml.dump({ triggers })
    )
  }
  if (reminders) {
    const remindersDir = path.join(pluginDir, 'reminders')
    fs.mkdirSync(remindersDir, { recursive: true })
    for (const [name, content] of Object.entries(reminders)) {
      fs.writeFileSync(path.join(remindersDir, `${name}.yaml`), content)
    }
  }
}

function writeManifest(
  dir: string,
  plugins: Record<string, { enabled: boolean; version: string }>
): void {
  const manifest = {
    plugins: Object.fromEntries(
      Object.entries(plugins).map(([id, opts]) => [
        id,
        {
          enabled: opts.enabled,
          detected_at: '2026-03-10T14:30:00Z',
          source: 'bundled',
          version: opts.version,
        },
      ])
    ),
  }
  fs.writeFileSync(
    path.join(dir, 'plugins.yaml'),
    yaml.dump(manifest)
  )
}
```

Run: `pnpm --filter @sidekick/core test -- src/__tests__/plugin-registry`
Expected: FAIL (module not found)

**Step 2: Implement PluginRegistryImpl**

Create: `packages/sidekick-core/src/plugin-registry.ts`

Constructor takes options:
```typescript
export interface PluginRegistryOptions {
  /** Project .sidekick/ directory (e.g., /path/to/project/.sidekick) */
  projectSidekickDir: string
  /** User ~/.sidekick/ directory (e.g., ~/.sidekick) */
  userSidekickDir?: string
  /** Bundled assets/sidekick/ directory (for bundled plugins) */
  assetsDir?: string
  /** Logger */
  logger: Logger
}
```

Implementation outline:
- `loadManifests()`: Read and parse `plugins.yaml` from projectSidekickDir and userSidekickDir. Merge with project-scope winning on conflict. Handle missing files with empty defaults.
- `resolvePlugins()`: For each enabled plugin in merged manifest, search cascade (projectSidekickDir/plugins/{id} → userSidekickDir/plugins/{id} → assetsDir/plugins/{id}) for first folder containing `plugin.yaml`. Parse metadata and triggers. Store in internal `Map<string, ResolvedPlugin>`.
- `getTriggers(type)`: Filter all triggers from resolved plugins by type discriminant. Return `{ pluginId, trigger }[]` to preserve plugin source for `resolvePluginReminder()` calls.
- `getEnabledPlugins()`: Return all values from resolved plugins map.
- `isEnabled(pluginId)`: Check merged manifest.
- `resolvePluginReminder(pluginId, reminderId)`: Read `reminders/{reminderId}.yaml` from the plugin's resolved folder, walking the cascade.

Run: `pnpm --filter @sidekick/core test -- src/__tests__/plugin-registry`
Expected: PASS

**Step 3: Export from package**

Add to `packages/sidekick-core/src/index.ts`:
```typescript
export { PluginRegistryImpl, type PluginRegistryOptions } from './plugin-registry.js'
```

**Step 4: Verify build**

Run: `pnpm --filter @sidekick/core build && pnpm --filter @sidekick/core test -- src/__tests__/plugin-registry`
Expected: PASS

**Step 5: Commit**

```
feat(core): implement PluginRegistryImpl with cascade resolution
```

---

### Task 3: PluginRegistry Hot-Reload

**Depends on:** Task 2

**Files:**
- Modify: `packages/sidekick-core/src/plugin-registry.ts` (add startWatching/stopWatching)
- Modify: `packages/sidekick-core/src/__tests__/plugin-registry.test.ts` (add watcher tests)

**Context:** Follow `packages/sidekick-daemon/src/config-watcher.ts` exactly: chokidar `watch()`, debounce timers (100ms), `ready` promise pattern, `stop()` cleanup. Watch manifest files and plugin folders. On change, re-read manifests and re-resolve affected plugins.

**Step 1: Write failing tests for hot-reload**

Add test cases:
1. `startWatching()` creates chokidar watchers for manifest files and plugin folders
2. Manifest file change triggers `loadManifests()` + `resolvePlugins()` re-run
3. Plugin folder file change triggers re-resolve of that plugin only
4. `stopWatching()` closes all watchers
5. Changes are debounced (rapid changes result in single re-resolve)

Mock chokidar using `vi.mock('chokidar')` with a fake FSWatcher that emits events on demand.

```typescript
// Key test pattern — mock chokidar to emit events
import { vi } from 'vitest'
import { EventEmitter } from 'node:events'

class FakeWatcher extends EventEmitter {
  close = vi.fn().mockResolvedValue(undefined)
}

vi.mock('chokidar', () => ({
  watch: vi.fn(() => {
    const watcher = new FakeWatcher()
    // Emit ready on next tick
    setTimeout(() => watcher.emit('ready'), 0)
    return watcher
  }),
}))
```

Run: `pnpm --filter @sidekick/core test -- src/__tests__/plugin-registry`
Expected: FAIL (startWatching not implemented)

**Step 2: Implement startWatching() and stopWatching()**

Follow `config-watcher.ts` line 105-170 pattern:
- Create watchers for: `${projectSidekickDir}/plugins.yaml`, `${userSidekickDir}/plugins.yaml`, `${projectSidekickDir}/plugins/*/`, `${userSidekickDir}/plugins/*/`
- Depth 1 for plugin folders (plugin.yaml and triggers/ files)
- `ignoreInitial: true`, `usePolling: false`
- On `add`/`change`/`unlink`: debounce 100ms, then re-load manifests + re-resolve
- Track `readyPromise` for tests to await
- `stopWatching()`: close all watchers, clear debounce timers

**Step 3: Add event emission**

Add `on(event: 'plugin:reloaded', handler: () => void)` method using Node EventEmitter.
Emit `plugin:reloaded` after successful re-resolve.

Run: `pnpm --filter @sidekick/core test -- src/__tests__/plugin-registry`
Expected: PASS

**Step 4: Verify build**

Run: `pnpm --filter @sidekick/core build`
Expected: PASS

**Step 5: Commit**

```
feat(core): add hot-reload file watching to PluginRegistry
```

---

### Task 4: Wire PluginRegistry into Daemon

**Depends on:** Task 3

**Files:**
- Modify: `packages/types/src/context.ts:61-80` (add `pluginRegistry` to DaemonContext)
- Modify: `packages/sidekick-daemon/src/daemon.ts:249-310` (instantiate PluginRegistry)
- Modify: `packages/sidekick-daemon/src/daemon.ts:312-374` (start watching in `start()`)
- Modify: `packages/sidekick-daemon/src/daemon.ts:376-415` (stop watching in `stop()`)

**Context:** Follow the ConfigWatcher pattern exactly: instantiate in constructor (line 249), call `start()` in `daemon.start()` (line 351), call `stop()` in `daemon.stop()` (line 389). Add `pluginRegistry` as an optional field on DaemonContext to maintain backward compatibility during incremental rollout.

**Step 1: Add pluginRegistry to DaemonContext**

In `packages/types/src/context.ts`, add to `DaemonContext` interface (after line 75):

```typescript
  /** Optional plugin registry for extension management */
  pluginRegistry?: PluginRegistry
```

Add import:
```typescript
import type { PluginRegistry } from './services/plugin-registry.js'
```

Run: `pnpm --filter @sidekick/types build`
Expected: PASS

**Step 2: Instantiate PluginRegistry in daemon constructor**

In `packages/sidekick-daemon/src/daemon.ts`, after ConfigWatcher creation (line 256), add:

```typescript
    // Initialize Plugin Registry for extension management
    this.pluginRegistry = new PluginRegistryImpl({
      projectSidekickDir: this.stateService.rootDir(),
      userSidekickDir: path.join(homedir(), '.sidekick'),
      assetsDir: getDefaultAssetsDir(),
      logger: this.logger,
    })
```

Add field declaration, import `PluginRegistryImpl` from `@sidekick/core`.

**Step 3: Start/stop plugin registry watching**

In `daemon.start()`, after config watcher start (line 351), add:

```typescript
      // 8c. Start plugin registry watcher for hot-reload
      await this.pluginRegistry.loadManifests()
      await this.pluginRegistry.resolvePlugins()
      this.pluginRegistry.startWatching()
```

In `daemon.stop()`, after persona watcher stop (line 392), add:

```typescript
    // Stop plugin registry watcher
    this.pluginRegistry.stopWatching()
```

**Step 4: Pass pluginRegistry to handler context**

In the `createDaemonContext()` method (or wherever DaemonContext is assembled for handlers), include:

```typescript
  pluginRegistry: this.pluginRegistry,
```

**Step 5: Verify build and existing tests**

Run: `pnpm --filter @sidekick/daemon build && pnpm --filter @sidekick/daemon test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: PASS (existing tests unaffected — pluginRegistry is optional)

**Step 6: Commit**

```
feat(daemon): wire PluginRegistry into daemon lifecycle
```

---

### Task 5: Absence Trigger Handler (Generic)

**Depends on:** Task 4

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts`
- Modify/Create: `packages/feature-reminders/src/handlers/staging/__tests__/track-verification-tools.test.ts`

**Context:** Currently `TOOL_REMINDER_MAP` at line 35-40 hardcodes the mapping from tool name → reminder ID. The refactored handler queries `pluginRegistry.getTriggers('absence')` for dynamic triggers while keeping the existing `TOOL_REMINDER_MAP` as fallback during migration. The state machine logic (STAGED → VERIFIED → COOLDOWN → re-STAGED) stays unchanged.

**Step 1: Write failing test for registry-based absence triggers**

Add test case: when DaemonContext has `pluginRegistry` with absence triggers, handler uses them in addition to (or instead of) hardcoded TOOL_REMINDER_MAP.

```typescript
it('stages reminder from plugin absence trigger when source edited', async () => {
  // Setup: pluginRegistry with an absence trigger for 'vc-code-review'
  const mockRegistry = {
    getTriggers: vi.fn().mockReturnValue([{
      id: 'vc-code-review',
      type: 'absence',
      hook: 'Stop',
      stage_when: { source_edited: true },
      clear_when: [
        { tool: 'Agent', pattern: 'code-review' },
      ],
      reminder: 'vc-code-review',
      clearing_threshold: 3,
      enabled: true,
    }]),
    resolvePluginReminder: vi.fn().mockReturnValue(/* reminder YAML content */),
  }
  // ... exercise handler with file edit event
  // ... assert reminder was staged
})
```

Run: `pnpm --filter @sidekick/feature-reminders test -- src/handlers/staging/__tests__/track-verification`
Expected: FAIL

**Step 2: Refactor handler to read from PluginRegistry**

In `track-verification-tools.ts`, modify the handler to:
1. Check if `daemonCtx.pluginRegistry` exists
2. If yes, call `pluginRegistry.getTriggers('absence')` and merge with static config
3. For plugin-sourced absence triggers, use `resolvePluginReminder()` instead of core `resolveReminder()`
4. Keep existing `TOOL_REMINDER_MAP` as fallback when no pluginRegistry is available

Key change — the handler builds the tool→reminder map dynamically:

```typescript
function buildToolReminderMap(
  staticMap: Record<string, string>,
  pluginTriggers: AbsenceTrigger[]
): Record<string, string> {
  const map = { ...staticMap }
  for (const trigger of pluginTriggers) {
    // Plugin triggers extend (not replace) the static map
    map[trigger.id] = trigger.reminder
  }
  return map
}
```

**Step 3: Update clear_when matching**

For plugin-sourced absence triggers, clear_when uses tool name + regex pattern matching (design doc §Absence Triggers), not the existing `findMatchingPattern()` which uses `ToolPattern` arrays. Add a new match function:

```typescript
function matchesClearWhen(
  toolName: string,
  command: string,
  clearWhen: ClearWhen[]
): boolean {
  return clearWhen.some(
    (cw) => cw.tool === toolName && new RegExp(cw.pattern).test(command)
  )
}
```

**Step 4: Verify all existing tests still pass**

Run: `pnpm --filter @sidekick/feature-reminders test`
Expected: PASS (backward compatible — no pluginRegistry means existing behavior)

**Step 5: Commit**

```
feat(reminders): extend absence trigger handler to read from PluginRegistry
```

---

### Task 6: Reactive Trigger Handler

**Depends on:** Task 4

**Files:**
- Create: `packages/feature-reminders/src/handlers/staging/handle-reactive-triggers.ts`
- Create: `packages/feature-reminders/src/handlers/staging/__tests__/handle-reactive-triggers.test.ts`
- Modify: `packages/feature-reminders/src/handlers/staging/index.ts` (register handler)

**Context:** New handler that listens for ToolCall transcript events, pattern-matches tool name + input against reactive triggers from the PluginRegistry, extracts capture groups as template variables, and stages the referenced reminder with captured variables. Follows existing handler registration pattern in `track-verification-tools.ts` lines 49-83.

**Step 1: Write failing tests**

Test cases:
1. Ignores events when no pluginRegistry on DaemonContext
2. Matches tool name + command pattern from reactive trigger
3. Extracts capture groups and passes as template context to `resolveReminder()`
4. Stages the resolved reminder for the trigger's hook
5. Does not stage when pattern doesn't match
6. Respects `enabled: false` on individual triggers
7. Handles multiple reactive triggers independently (one match doesn't block others)

```typescript
it('stages reminder when tool matches reactive trigger pattern', async () => {
  const trigger = {
    id: 'beads-claim-context',
    type: 'reactive' as const,
    hook: 'PostToolUse',
    match: { tool: 'Bash', pattern: 'bd update .* --status=in_progress' },
    captures: [{ name: 'bead_id', pattern: 'bd update (\\S+)', group: 1 }],
    reminder: 'beads-claim-context',
    enabled: true,
  }
  // ... mockRegistry.getTriggers('reactive') returns [trigger]
  // ... fire ToolCall event with command 'bd update SK-42 --status=in_progress'
  // ... assert stageReminder called with context { bead_id: 'SK-42' }
})
```

Run: `pnpm --filter @sidekick/feature-reminders test -- src/handlers/staging/__tests__/handle-reactive`
Expected: FAIL (module not found)

**Step 2: Implement handler**

Create `handle-reactive-triggers.ts`:

```typescript
export function registerReactiveTriggersHandler(context: RuntimeContext): void {
  if (!isDaemonContext(context)) return

  context.handlers.register({
    id: 'reminders:reactive-triggers',
    priority: 55,  // Below VC-tools (60) but above general handlers
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    handler: async (event: SidekickEvent, ctx: HandlerContext) => {
      if (!isTranscriptEvent(event)) return
      if (event.metadata.isBulkProcessing) return

      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return
      const daemonCtx = ctx as unknown as DaemonContext
      if (!daemonCtx.pluginRegistry) return

      const toolName = event.payload.toolName
      if (!toolName) return

      const command = extractToolInput(event)?.command as string | undefined
      const triggerEntries = daemonCtx.pluginRegistry.getTriggers('reactive')

      for (const { pluginId, trigger } of triggerEntries) {
        if (!trigger.enabled) continue
        if (trigger.type !== 'reactive') continue
        if (trigger.match.tool !== toolName) continue

        const input = command ?? JSON.stringify(extractToolInput(event))
        if (!new RegExp(trigger.match.pattern).test(input)) continue

        // Extract captures
        const captureContext: Record<string, string> = {}
        for (const capture of trigger.captures) {
          const match = input.match(new RegExp(capture.pattern))
          if (match && match[capture.group]) {
            captureContext[capture.name] = match[capture.group]
          }
        }

        // Resolve and stage reminder from plugin (pluginId from getTriggers)
        const reminderContent = daemonCtx.pluginRegistry.resolvePluginReminder(
          pluginId,
          trigger.reminder
        )
        if (!reminderContent) continue

        const reminder = resolveReminderFromContent(reminderContent, captureContext)
        if (!reminder) continue

        await stageReminder(daemonCtx, trigger.hook as HookName, {
          ...reminder,
          stagedAt: { timestamp: Date.now(), turnCount: 0, toolsThisTurn: 0, toolCount: 0 },
        })
      }
    },
  })
}
```

**Step 3: Register handler**

Add to `packages/feature-reminders/src/handlers/staging/index.ts`:
```typescript
export { registerReactiveTriggersHandler } from './handle-reactive-triggers.js'
```

Wire registration in daemon's `registerStagingHandlers()`.

**Step 4: Verify all tests pass**

Run: `pnpm --filter @sidekick/feature-reminders test`
Expected: PASS

**Step 5: Commit**

```
feat(reminders): add reactive trigger handler for plugin pattern-matching
```

---

### Task 7: Prompt Enrichment Pipeline

**Depends on:** Task 4

**Files:**
- Create: `packages/feature-reminders/src/handlers/staging/handle-prompt-enrichment.ts`
- Create: `packages/feature-reminders/src/handlers/staging/__tests__/handle-prompt-enrichment.test.ts`
- Create: `packages/sidekick-core/src/prompt-enrichment.ts` (file lifecycle utilities)
- Create: `packages/sidekick-core/src/__tests__/prompt-enrichment.test.ts`

**Context:** This is the most complex task — new capability with a file lifecycle. Trigger match fires enrichment script, output appends to `.sidekick/sessions/{sessionId}/prompts/{target}/{trigger-id}.txt`. Prompt builders scan the folder and include content, then delete files marked `clear_on_consumption`. Multiple firings append to the same file.

**Step 1: Write failing tests for enrichment file utilities**

Test the file lifecycle:
1. `appendEnrichmentOutput()` creates directory structure and appends to file
2. `appendEnrichmentOutput()` appends on subsequent calls (not overwrites)
3. `scanEnrichmentFolder()` returns all `.txt` files in a target folder
4. `consumeEnrichmentFiles()` reads and deletes files marked clear_on_consumption
5. Handles missing directories gracefully

```typescript
describe('appendEnrichmentOutput', () => {
  it('creates directories and writes output file', async () => {
    const sessionDir = path.join(tmpDir, 'sessions', 'sess-1')
    await appendEnrichmentOutput({
      sessionDir,
      target: 'session-summary',
      triggerId: 'beads-hierarchy',
      content: 'parent: SK-1\n',
    })
    const filePath = path.join(
      sessionDir, 'prompts', 'session-summary', 'beads-hierarchy.txt'
    )
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('parent: SK-1\n')
  })

  it('appends on subsequent calls', async () => {
    // ... call twice, verify concatenated content
  })
})
```

Run: `pnpm --filter @sidekick/core test -- src/__tests__/prompt-enrichment`
Expected: FAIL

**Step 2: Implement enrichment file utilities**

Create `packages/sidekick-core/src/prompt-enrichment.ts`:

```typescript
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface AppendEnrichmentOptions {
  sessionDir: string
  target: string
  triggerId: string
  content: string
}

export async function appendEnrichmentOutput(options: AppendEnrichmentOptions): Promise<void> {
  const dir = path.join(options.sessionDir, 'prompts', options.target)
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${options.triggerId}.txt`)
  await fs.appendFile(filePath, options.content)
}

export interface EnrichmentFile {
  triggerId: string
  content: string
  filePath: string
}

export async function scanEnrichmentFolder(
  sessionDir: string,
  target: string
): Promise<EnrichmentFile[]> {
  const dir = path.join(sessionDir, 'prompts', target)
  try {
    const files = await fs.readdir(dir)
    const results: EnrichmentFile[] = []
    for (const file of files) {
      if (!file.endsWith('.txt')) continue
      const filePath = path.join(dir, file)
      const content = await fs.readFile(filePath, 'utf-8')
      results.push({
        triggerId: file.replace(/\.txt$/, ''),
        content,
        filePath,
      })
    }
    return results
  } catch {
    return [] // Directory doesn't exist yet
  }
}

export async function consumeEnrichmentFiles(
  sessionDir: string,
  target: string,
  clearTriggerIds: Set<string>
): Promise<void> {
  const dir = path.join(sessionDir, 'prompts', target)
  try {
    const files = await fs.readdir(dir)
    for (const file of files) {
      const triggerId = file.replace(/\.txt$/, '')
      if (clearTriggerIds.has(triggerId)) {
        await fs.unlink(path.join(dir, file))
      }
    }
  } catch {
    // Directory doesn't exist — nothing to consume
  }
}
```

Run: `pnpm --filter @sidekick/core test -- src/__tests__/prompt-enrichment`
Expected: PASS

**Step 3: Write failing tests for enrichment trigger handler**

Test cases:
1. Matches trigger pattern, runs enrichment command via `child_process.exec`
2. Passes capture groups as environment variables to the command
3. Appends command stdout to enrichment file
4. Ignores command stderr (logged but not appended)
5. Handles command failure gracefully (logs error, does not stage)
6. Respects enabled: false

Run: `pnpm --filter @sidekick/feature-reminders test -- src/handlers/staging/__tests__/handle-prompt-enrichment`
Expected: FAIL

**Step 4: Implement enrichment trigger handler**

Create `handle-prompt-enrichment.ts`. Pattern: same as reactive handler but runs a command instead of staging a reminder.

```typescript
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
const execAsync = promisify(exec)

// ... in handler:
const { stdout } = await execAsync(trigger.enrichment.command, {
  cwd: plugin.folderPath,
  env: { ...process.env, ...captureContext },
  timeout: 10000,  // 10s timeout for enrichment scripts
})

if (stdout.trim()) {
  await appendEnrichmentOutput({
    sessionDir: daemonCtx.stateService.sessionRootDir(sessionId),
    target: trigger.enrichment.target,
    triggerId: trigger.id,
    content: stdout,
  })
}
```

**Step 5: Verify all tests pass**

Run: `pnpm --filter @sidekick/core test -- src/__tests__/prompt-enrichment && pnpm --filter @sidekick/feature-reminders test -- src/handlers/staging/__tests__/handle-prompt-enrichment`
Expected: PASS

**Step 6: Commit**

```
feat(core,reminders): add prompt enrichment pipeline with file lifecycle
```

---

### Task 8: First Plugin — Superpowers Code Review

**Depends on:** Tasks 5, 6

**Files:**
- Create: `assets/sidekick/plugins/superpowers/plugin.yaml`
- Create: `assets/sidekick/plugins/superpowers/detect.sh`
- Create: `assets/sidekick/plugins/superpowers/triggers/triggers.yaml`
- Create: `assets/sidekick/plugins/superpowers/reminders/vc-code-review.yaml`
- Create: integration test file

**Context:** This is the first real plugin — validates the architecture end-to-end before migrating existing VC-tools. The superpowers plugin detects whether the superpowers skill suite is installed and provides an absence trigger for code review.

**Step 1: Create plugin metadata**

Create `assets/sidekick/plugins/superpowers/plugin.yaml`:

```yaml
id: superpowers
name: Superpowers Plugin
description: Code review and quality reminders for superpowers skill suite
version: 1.0.0
capabilities:
  - reminders
detection:
  command: "./detect.sh"
```

**Step 2: Create detection script**

Create `assets/sidekick/plugins/superpowers/detect.sh`:

```bash
#!/bin/bash
# Detect superpowers skill suite installation
# Checks for .claude/skills/ directory with superpowers skills

if [ -d ".claude/skills" ]; then
  # Check for any superpowers-related skill files
  if ls .claude/skills/*superpowers* 1>/dev/null 2>&1 || \
     ls .claude/skills/*code-review* 1>/dev/null 2>&1; then
    echo '{"detected": true, "scope": "project"}'
    exit 0
  fi
fi

# Also check user-level skills
if [ -d "$HOME/.claude/skills" ]; then
  if ls "$HOME/.claude/skills"/*superpowers* 1>/dev/null 2>&1 || \
     ls "$HOME/.claude/skills"/*code-review* 1>/dev/null 2>&1; then
    echo '{"detected": true, "scope": "user"}'
    exit 0
  fi
fi

echo '{"detected": false}'
exit 0
```

Run: `chmod +x assets/sidekick/plugins/superpowers/detect.sh`

**Step 3: Create triggers**

Create `assets/sidekick/plugins/superpowers/triggers/triggers.yaml`:

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
      - tool: Skill
        pattern: "code-reviewer"
    reminder: vc-code-review
    clearing_threshold: 3
    enabled: true
```

**Step 4: Create reminder**

Create `assets/sidekick/plugins/superpowers/reminders/vc-code-review.yaml`:

```yaml
id: vc-code-review
blocking: false
priority: 40
persistent: false

additionalContext: |
  <vc-code-review>
  You have modified source files but have not run a code review.
  Use the code-reviewer agent or skill before claiming completion.
  This catches bugs, style issues, and architectural drift early.
  </vc-code-review>

userMessage: "Code review recommended: source files modified without review"
reason: "Source files modified without subsequent code review verification"
```

**Step 5: Write integration test**

Test that PluginRegistryImpl can load the superpowers plugin from the bundled assets directory:

```typescript
it('loads superpowers plugin from bundled assets', async () => {
  // Write a manifest enabling the plugin
  writeManifest(projectDir, { superpowers: { enabled: true, version: '1.0.0' } })

  const registry = new PluginRegistryImpl({
    projectSidekickDir: projectDir,
    assetsDir: path.resolve(__dirname, '../../../../assets/sidekick'),
    logger: createFakeLogger(),
  })
  await registry.loadManifests()
  await registry.resolvePlugins()

  expect(registry.isEnabled('superpowers')).toBe(true)
  const plugins = registry.getEnabledPlugins()
  expect(plugins).toHaveLength(1)
  expect(plugins[0].metadata.id).toBe('superpowers')

  const absenceTriggers = registry.getTriggers('absence')
  expect(absenceTriggers).toHaveLength(1)
  expect(absenceTriggers[0].pluginId).toBe('superpowers')
  expect(absenceTriggers[0].trigger.id).toBe('vc-code-review')
})
```

Run: `pnpm --filter @sidekick/core test -- src/__tests__/plugin-registry`
Expected: PASS

**Step 6: Commit**

```
feat: add superpowers code-review plugin (first plugin)
```

---

### Task 9: VC-Tools Migration to Built-in Plugin

**Depends on:** Task 8 (architecture validated with first plugin)

**Files:**
- Create: `assets/sidekick/plugins/verification/plugin.yaml`
- Create: `assets/sidekick/plugins/verification/triggers/triggers.yaml`
- Move: `assets/sidekick/reminders/vc-*.yaml` → `assets/sidekick/plugins/verification/reminders/`
- Modify: `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts` (remove TOOL_REMINDER_MAP hardcoding)
- Modify: `packages/feature-reminders/src/reminder-utils.ts` (add plugin reminder resolution path)
- Keep: `assets/sidekick/reminders/verify-completion.yaml` (wrapper stays in core — not plugin-specific)

**Context:** This is the highest-risk task — touching a working, tested system. The key safety net is that the PluginRegistry was already validated with the superpowers plugin. The verification plugin uses `builtin: true` (always enabled, no detect.sh). Existing test suite must pass without modification.

**Step 1: Create verification plugin metadata**

Create `assets/sidekick/plugins/verification/plugin.yaml`:

```yaml
id: verification
name: Verification Tools
description: Built-in build, typecheck, test, and lint verification tracking
version: 1.0.0
capabilities:
  - reminders
builtin: true
```

**Step 2: Create verification triggers from existing config**

Create `assets/sidekick/plugins/verification/triggers/triggers.yaml`:

Translate the four entries from `TOOL_REMINDER_MAP` + the verification_tools config from `reminders.defaults.yaml` into absence triggers:

```yaml
triggers:
  - id: vc-build
    type: absence
    hook: Stop
    stage_when:
      source_edited: true
    clear_when:
      - tool: Bash
        pattern: "\\b(tsc|esbuild|pnpm.*build|npm run build|yarn.*build|mvn compile|gradle.*build|go build|cargo build|make|cmake --build|docker build)\\b"
    reminder: vc-build
    clearing_threshold: 3
    enabled: true

  - id: vc-typecheck
    type: absence
    hook: Stop
    stage_when:
      source_edited: true
    clear_when:
      - tool: Bash
        pattern: "\\b(tsc --noEmit|pnpm.*typecheck|npm run typecheck|yarn.*typecheck|mypy|pyright|pytype|go vet)\\b"
    reminder: vc-typecheck
    clearing_threshold: 3
    enabled: true

  - id: vc-test
    type: absence
    hook: Stop
    stage_when:
      source_edited: true
    clear_when:
      - tool: Bash
        pattern: "\\b(vitest|jest|pnpm.*test|npm test|yarn.*test|pytest|python -m pytest|python -m unittest|mvn test|gradle.*test|go test|cargo test|dotnet test|make test)\\b"
    reminder: vc-test
    clearing_threshold: 3
    enabled: true

  - id: vc-lint
    type: absence
    hook: Stop
    stage_when:
      source_edited: true
    clear_when:
      - tool: Bash
        pattern: "\\b(eslint|pnpm.*lint|npm run lint|yarn.*lint|ruff|flake8|pylint|golangci-lint|cargo clippy|ktlint|dotnet format)\\b"
    reminder: vc-lint
    clearing_threshold: 5
    enabled: true
```

**Step 3: Move reminder files**

```bash
mkdir -p assets/sidekick/plugins/verification/reminders/
mv assets/sidekick/reminders/vc-build.yaml assets/sidekick/plugins/verification/reminders/
mv assets/sidekick/reminders/vc-typecheck.yaml assets/sidekick/plugins/verification/reminders/
mv assets/sidekick/reminders/vc-test.yaml assets/sidekick/plugins/verification/reminders/
mv assets/sidekick/reminders/vc-lint.yaml assets/sidekick/plugins/verification/reminders/
```

Keep `assets/sidekick/reminders/verify-completion.yaml` in core — the wrapper reminder is not plugin-specific.

**Step 4: Update PluginRegistry to auto-load builtin plugins**

Modify `resolvePlugins()`: builtin plugins are always resolved even without a manifest entry. Scan `assetsDir/plugins/*/plugin.yaml`, check for `builtin: true`, and auto-include.

**Step 5: Remove TOOL_REMINDER_MAP from track-verification-tools.ts**

Replace the static `TOOL_REMINDER_MAP` at lines 35-40 with a dynamic lookup:

```typescript
// Before (static):
const TOOL_REMINDER_MAP: Record<string, string> = {
  build: ReminderIds.VC_BUILD,
  typecheck: ReminderIds.VC_TYPECHECK,
  test: ReminderIds.VC_TEST,
  lint: ReminderIds.VC_LINT,
}

// After (dynamic, with static fallback):
function getToolReminderMap(pluginRegistry?: PluginRegistry): Record<string, string> {
  if (pluginRegistry) {
    const triggerEntries = pluginRegistry.getTriggers('absence')
    const map: Record<string, string> = {}
    for (const { trigger } of triggerEntries) {
      if (trigger.type === 'absence') {
        map[trigger.id] = trigger.reminder
      }
    }
    if (Object.keys(map).length > 0) return map
  }
  // Fallback: hardcoded map for when no registry is available
  return {
    build: ReminderIds.VC_BUILD,
    typecheck: ReminderIds.VC_TYPECHECK,
    test: ReminderIds.VC_TEST,
    lint: ReminderIds.VC_LINT,
  }
}
```

Update `ensureToolReminderStaged()` to check plugin reminder resolution first:

```typescript
async function ensureToolReminderStaged(
  daemonCtx: DaemonContext,
  reminderId: string,
  stagedNames: Set<string>,
  pluginId?: string
): Promise<boolean> {
  if (stagedNames.has(reminderId)) return true

  // Try plugin reminder first (pluginId comes from getTriggers result)
  let reminder: StagedReminder | null = null
  if (daemonCtx.pluginRegistry && pluginId) {
    const content = daemonCtx.pluginRegistry.resolvePluginReminder(pluginId, reminderId)
    if (content) {
      reminder = resolveReminderFromContent(content, {})
    }
  }

  // Fall back to core reminder resolution
  if (!reminder) {
    reminder = resolveReminder(reminderId, { context: {}, assets: daemonCtx.assets })
  }

  if (!reminder) {
    daemonCtx.logger.warn('Failed to resolve VC tool reminder', { reminderId })
    return false
  }

  await stageReminder(daemonCtx, 'Stop', {
    ...reminder,
    stagedAt: { timestamp: Date.now(), turnCount: 0, toolsThisTurn: 0, toolCount: 0 },
  })
  return true
}
```

**Step 6: Verify ALL existing tests pass**

This is the critical safety check. Every existing VC-tools test must pass unchanged.

Run: `pnpm --filter @sidekick/feature-reminders test && pnpm --filter @sidekick/core test -- src/__tests__/plugin-registry`
Expected: PASS

**Step 7: Verify build**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: PASS

**Step 8: Commit**

```
refactor: migrate VC-tools to built-in verification plugin
```

---

### Task 10: Setup Integration

**Depends on:** Task 2

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts` (add plugin discovery phase)
- Create: `packages/sidekick-cli/src/commands/setup/plugin-discovery.ts`
- Create: `packages/sidekick-cli/src/commands/setup/__tests__/plugin-discovery.test.ts`

**Context:** `sidekick setup` gains a plugin discovery phase. For each plugin folder across all cascade levels, run `detect.sh` and write enabled plugins to the scope-appropriate manifest. Existing `enabled: false` overrides are preserved on re-run. Builtin plugins are auto-written without detection.

**Step 1: Write failing tests for plugin discovery**

Test cases:
1. `discoverPlugins()` finds plugin folders across cascade levels (bundled, user, project)
2. Runs `detect.sh` for each non-builtin plugin
3. Writes detected plugins to the correct scope manifest (project or user)
4. Preserves existing `enabled: false` overrides
5. Builtin plugins are added without running detect.sh
6. Handles detect.sh failures gracefully (treats as not detected)
7. Handles missing detect.sh (logs warning, treats as not detected)

```typescript
describe('discoverPlugins', () => {
  it('detects plugin via detect.sh and writes to project manifest', async () => {
    // Create a plugin with detect.sh that returns detected: true, scope: project
    writePluginFixture(assetsDir, 'test-plugin', {
      id: 'test-plugin',
      name: 'Test',
      description: 'Test plugin',
      version: '1.0.0',
      capabilities: ['reminders'],
      detection: { command: './detect.sh' },
    })
    writeDetectScript(
      path.join(assetsDir, 'plugins', 'test-plugin'),
      '{"detected": true, "scope": "project"}'
    )

    await discoverPlugins({ projectSidekickDir: projectDir, assetsDir, logger })

    const manifest = yaml.load(
      fs.readFileSync(path.join(projectDir, 'plugins.yaml'), 'utf-8')
    )
    expect(manifest.plugins['test-plugin'].enabled).toBe(true)
  })

  it('preserves enabled: false override on re-run', async () => {
    // Write manifest with enabled: false
    writeManifest(projectDir, { 'test-plugin': { enabled: false, version: '1.0.0' } })
    // ... run discovery again
    // ... assert enabled is still false
  })
})
```

Run: `pnpm --filter @sidekick/cli test -- src/commands/setup/__tests__/plugin-discovery`
Expected: FAIL (module not found)

**Step 2: Implement discoverPlugins()**

Create `packages/sidekick-cli/src/commands/setup/plugin-discovery.ts`:

```typescript
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as yaml from 'js-yaml'
import type { Logger } from '@sidekick/types'
import {
  PluginMetadataSchema,
  PluginManifestSchema,
  type PluginManifest,
  type PluginDetectionResult,
} from '@sidekick/types'

const execAsync = promisify(exec)

export interface PluginDiscoveryOptions {
  projectSidekickDir: string
  userSidekickDir?: string
  assetsDir?: string
  logger: Logger
}

export async function discoverPlugins(options: PluginDiscoveryOptions): Promise<void> {
  const { projectSidekickDir, userSidekickDir, assetsDir, logger } = options

  // 1. Find all plugin folders across cascade levels
  const pluginDirs = await findPluginFolders(projectSidekickDir, userSidekickDir, assetsDir)

  // 2. Load existing manifests (to preserve enabled: false overrides)
  const projectManifest = await loadExistingManifest(path.join(projectSidekickDir, 'plugins.yaml'))
  const userManifest = userSidekickDir
    ? await loadExistingManifest(path.join(userSidekickDir, 'plugins.yaml'))
    : { plugins: {} }

  // 3. For each plugin, detect and update manifest
  for (const [pluginId, pluginDir] of pluginDirs) {
    const metadataPath = path.join(pluginDir, 'plugin.yaml')
    const metadataContent = await fs.readFile(metadataPath, 'utf-8')
    const metadata = PluginMetadataSchema.parse(yaml.load(metadataContent))

    if (metadata.builtin) {
      // Builtin: auto-enable in project manifest
      if (!projectManifest.plugins[pluginId]
        || projectManifest.plugins[pluginId].enabled !== false) {
        projectManifest.plugins[pluginId] = {
          enabled: true,
          detected_at: new Date().toISOString(),
          source: 'bundled',
          version: metadata.version,
        }
      }
      continue
    }

    // Run detect.sh
    if (!metadata.detection?.command) {
      logger.warn('Plugin has no detection command', { pluginId })
      continue
    }

    try {
      const { stdout } = await execAsync(metadata.detection.command, {
        cwd: pluginDir,
        timeout: 5000,
      })
      const result = JSON.parse(stdout.trim()) as PluginDetectionResult

      if (result.detected) {
        const targetManifest = result.scope === 'user' ? userManifest : projectManifest
        const existing = targetManifest.plugins[pluginId]

        // Preserve enabled: false override
        if (existing?.enabled === false) continue

        targetManifest.plugins[pluginId] = {
          enabled: true,
          detected_at: new Date().toISOString(),
          source: 'bundled',
          version: metadata.version,
        }
        logger.info('Plugin detected', { pluginId, scope: result.scope })
      }
    } catch (err) {
      logger.warn('Plugin detection failed', {
        pluginId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 4. Write updated manifests
  await writeManifest(path.join(projectSidekickDir, 'plugins.yaml'), projectManifest)
  if (userSidekickDir) {
    await writeManifest(path.join(userSidekickDir, 'plugins.yaml'), userManifest)
  }
}
```

**Step 3: Wire into handleSetupCommand()**

In `packages/sidekick-cli/src/commands/setup/index.ts`, add a plugin discovery step after existing setup phases:

```typescript
// Plugin discovery phase
await discoverPlugins({
  projectSidekickDir: sidekickDir,
  userSidekickDir: userSidekickDir,
  assetsDir: getDefaultAssetsDir(),
  logger,
})
```

**Step 4: Verify tests pass**

Run: `pnpm --filter @sidekick/cli test -- src/commands/setup/__tests__/plugin-discovery`
Expected: PASS

**Step 5: Verify full build**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: PASS

**Step 6: Commit**

```
feat(cli): add plugin discovery phase to setup command
```

---

## Summary

| Task | Description | Est. Size | Dependencies |
|------|-------------|-----------|--------------|
| 1 | Plugin types & Zod schemas | S | None |
| 2 | PluginRegistryImpl (core) | M | 1 |
| 3 | Hot-reload file watching | S | 2 |
| 4 | Wire into daemon lifecycle | S | 3 |
| 5 | Absence trigger handler refactor | M | 4 |
| 6 | Reactive trigger handler (new) | M | 4 |
| 7 | Prompt enrichment pipeline (new) | L | 4 |
| 8 | Superpowers plugin (first plugin) | S | 5, 6 |
| 9 | VC-tools migration (built-in plugin) | L | 8 |
| 10 | Setup integration (detection) | M | 2 |

**Parallelization:** Tasks 5, 6, 7, and 10 can run in parallel after Task 4. Task 8 requires 5+6. Task 9 requires 8.

**Risk order:** Tasks 1-4 are low risk (new code). Task 9 is highest risk (refactoring working system). Tasks 5-8 are medium risk. Task 10 is low-medium risk.
