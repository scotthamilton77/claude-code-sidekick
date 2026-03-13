# Project Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the Sidekick Monitoring UI to discover known projects via a file-based registry at `~/.sidekick/projects/`.

**Architecture:** The daemon registers its project on startup and heartbeats hourly to keep the registry fresh. A `ProjectRegistryService` in `@sidekick/core` owns path encoding/decoding and registry I/O. The UI backend reads the registry and auto-prunes stale/dead entries on startup.

**Tech Stack:** TypeScript, Zod v4, Node.js `fs/promises`, Vitest

**Design Doc:** `docs/plans/2026-03-12-project-registry-design.md`

---

## Task 1: Add `ProjectRegistryEntry` type and Zod schema to `@sidekick/types`

**Files:**
- Modify: `packages/sidekick-types/src/state.ts` (add schema + type at end of file)
- Modify: `packages/sidekick-types/src/index.ts` (add export)

**Step 1: Add the schema and type**

Add to end of `packages/sidekick-types/src/state.ts`:

```typescript
/** Schema for a project registry entry in ~/.sidekick/projects/{encoded}/registry.json */
export const ProjectRegistryEntrySchema = z.object({
  /** Absolute filesystem path to the project root */
  path: z.string(),
  /** Human-readable project name (derived from directory name) */
  displayName: z.string(),
  /** ISO 8601 timestamp of last daemon activity */
  lastActive: z.string().datetime(),
})

export type ProjectRegistryEntry = z.infer<typeof ProjectRegistryEntrySchema>
```

**Step 2: Export from index**

Add to `packages/sidekick-types/src/index.ts`:

```typescript
export { ProjectRegistryEntrySchema, type ProjectRegistryEntry } from './state.js'
```

**Step 3: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 4: Commit**

```
feat(types): add ProjectRegistryEntry schema for project discovery
```

---

## Task 2: Add `projects.retentionDays` to daemon config schema

**Files:**
- Modify: `packages/sidekick-core/src/config.ts` (extend `DaemonSchema`)
- Modify: `assets/sidekick/defaults/core.defaults.yaml` (add default)

**Step 1: Write the failing test**

Create: `packages/sidekick-core/src/__tests__/config-project-registry.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { createConfigService } from '../config.js'
import { createAssetResolver, getDefaultAssetsDir } from '../assets.js'

describe('projects.retentionDays config', () => {
  it('defaults to 30 days', () => {
    const assetResolver = createAssetResolver({
      defaultAssetsDir: getDefaultAssetsDir(),
      projectRoot: '/tmp/nonexistent',
    })
    const config = createConfigService({ assetResolver })
    expect(config.core.daemon.projects.retentionDays).toBe(30)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/__tests__/config-project-registry.test.ts`
Expected: FAIL — `projects` doesn't exist on daemon config

**Step 3: Extend DaemonSchema in config.ts**

In `packages/sidekick-core/src/config.ts`, replace the `DaemonSchema`:

```typescript
const ProjectsSchema = z
  .object({
    retentionDays: z.number().min(1),
  })
  .strict()

const DaemonSchema = z
  .object({
    idleTimeoutMs: z.number().min(0),
    shutdownTimeoutMs: z.number().min(0),
    projects: ProjectsSchema,
  })
  .strict()
```

**Step 4: Add default to core.defaults.yaml**

In `assets/sidekick/defaults/core.defaults.yaml`, add under `daemon:`:

```yaml
  # Project registry settings (for UI discovery)
  projects:
    # Auto-prune projects older than this many days (0 to disable)
    retentionDays: 30
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/__tests__/config-project-registry.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat(config): add projects.retentionDays to daemon config (default 30)
```

---

## Task 3: Create `ProjectRegistryService` in `@sidekick/core`

This is the core service — path encoding/decoding, read/write/list/prune operations.

**Files:**
- Create: `packages/sidekick-core/src/project-registry.ts`
- Create: `packages/sidekick-core/src/__tests__/project-registry.test.ts`
- Modify: `packages/sidekick-core/src/index.ts` (add export)

**Step 1: Write the failing tests**

Create `packages/sidekick-core/src/__tests__/project-registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import {
  encodeProjectDir,
  decodeProjectDir,
  ProjectRegistryService,
} from '../project-registry.js'

// --- Encoding/Decoding ---

describe('encodeProjectDir', () => {
  it('replaces slashes with dashes', () => {
    expect(encodeProjectDir('/Users/scott/src/project')).toBe('-Users-scott-src-project')
  })

  it('handles root path', () => {
    expect(encodeProjectDir('/')).toBe('-')
  })
})

describe('decodeProjectDir', () => {
  it('restores slashes from dashes', () => {
    expect(decodeProjectDir('-Users-scott-src-project')).toBe('/Users/scott/src/project')
  })

  it('handles root path', () => {
    expect(decodeProjectDir('-')).toBe('/')
  })

  it('roundtrips with encodeProjectDir', () => {
    const original = '/Users/scott/src/projects/claude-code-sidekick'
    expect(decodeProjectDir(encodeProjectDir(original))).toBe(original)
  })
})

// --- ProjectRegistryService ---

function createTestDir(): string {
  const dir = join(tmpdir(), `test-registry-${randomBytes(8).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('ProjectRegistryService', () => {
  let registryRoot: string
  let service: ProjectRegistryService

  beforeEach(() => {
    registryRoot = createTestDir()
    service = new ProjectRegistryService(registryRoot)
  })

  afterEach(() => {
    if (existsSync(registryRoot)) {
      rmSync(registryRoot, { recursive: true })
    }
  })

  describe('register()', () => {
    it('creates registry entry for a project', async () => {
      const projectDir = '/Users/scott/src/my-project'
      await service.register(projectDir)

      const entryDir = join(registryRoot, '-Users-scott-src-my-project')
      const entryFile = join(entryDir, 'registry.json')
      expect(existsSync(entryFile)).toBe(true)

      const entry = JSON.parse(readFileSync(entryFile, 'utf-8'))
      expect(entry.path).toBe(projectDir)
      expect(entry.displayName).toBe('my-project')
      expect(entry.lastActive).toBeDefined()
    })

    it('updates lastActive on re-registration', async () => {
      const projectDir = '/Users/scott/src/my-project'
      await service.register(projectDir)

      const entryFile = join(registryRoot, '-Users-scott-src-my-project', 'registry.json')
      const first = JSON.parse(readFileSync(entryFile, 'utf-8'))

      // Small delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 10))
      await service.register(projectDir)

      const second = JSON.parse(readFileSync(entryFile, 'utf-8'))
      expect(new Date(second.lastActive).getTime()).toBeGreaterThanOrEqual(
        new Date(first.lastActive).getTime()
      )
    })
  })

  describe('list()', () => {
    it('returns empty array when no projects registered', async () => {
      const entries = await service.list()
      expect(entries).toEqual([])
    })

    it('returns all registered projects', async () => {
      await service.register('/Users/scott/project-a')
      await service.register('/Users/scott/project-b')

      const entries = await service.list()
      expect(entries).toHaveLength(2)
      expect(entries.map(e => e.displayName).sort()).toEqual(['project-a', 'project-b'])
    })

    it('skips directories without registry.json', async () => {
      mkdirSync(join(registryRoot, '-Users-scott-orphan'), { recursive: true })
      const entries = await service.list()
      expect(entries).toEqual([])
    })

    it('skips entries with invalid JSON', async () => {
      const badDir = join(registryRoot, '-Users-scott-bad')
      mkdirSync(badDir, { recursive: true })
      writeFileSync(join(badDir, 'registry.json'), 'not json')

      const entries = await service.list()
      expect(entries).toEqual([])
    })
  })

  describe('prune()', () => {
    it('removes entries whose path no longer exists', async () => {
      // Register a non-existent project path
      const fakePath = join(tmpdir(), `nonexistent-${randomBytes(4).toString('hex')}`)
      await service.register(fakePath)

      const before = await service.list()
      expect(before).toHaveLength(1)

      const pruned = await service.prune({ retentionDays: 30 })
      expect(pruned).toHaveLength(1)
      expect(pruned[0].reason).toBe('path-missing')

      const after = await service.list()
      expect(after).toEqual([])
    })

    it('removes entries older than retentionDays', async () => {
      // Create a real directory so path-exists check passes
      const realDir = createTestDir()
      await service.register(realDir)

      // Backdate the entry to 60 days ago
      const encoded = encodeProjectDir(realDir)
      const entryFile = join(registryRoot, encoded, 'registry.json')
      const entry = JSON.parse(readFileSync(entryFile, 'utf-8'))
      entry.lastActive = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
      writeFileSync(entryFile, JSON.stringify(entry))

      const pruned = await service.prune({ retentionDays: 30 })
      expect(pruned).toHaveLength(1)
      expect(pruned[0].reason).toBe('age-exceeded')

      rmSync(realDir, { recursive: true })
    })

    it('keeps fresh entries with valid paths', async () => {
      const realDir = createTestDir()
      await service.register(realDir)

      const pruned = await service.prune({ retentionDays: 30 })
      expect(pruned).toEqual([])

      const entries = await service.list()
      expect(entries).toHaveLength(1)

      rmSync(realDir, { recursive: true })
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/__tests__/project-registry.test.ts`
Expected: FAIL — module not found

**Step 3: Implement ProjectRegistryService**

Create `packages/sidekick-core/src/project-registry.ts`:

```typescript
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ProjectRegistryEntrySchema, type ProjectRegistryEntry } from '@sidekick/types'

/**
 * Encode an absolute project path to a directory name.
 * Mirrors Claude Code's ~/.claude/projects/ convention: replace '/' with '-'.
 */
export function encodeProjectDir(absPath: string): string {
  return absPath.replace(/\//g, '-')
}

/**
 * Decode an encoded directory name back to an absolute path.
 */
export function decodeProjectDir(encoded: string): string {
  // Leading dash becomes leading slash, remaining dashes become slashes
  return encoded.replace(/-/g, '/')
}

export interface PruneOptions {
  retentionDays: number
}

export interface PruneResult {
  path: string
  reason: 'path-missing' | 'age-exceeded'
}

const REGISTRY_FILE = 'registry.json'

/**
 * Manages the project registry at ~/.sidekick/projects/.
 * Each registered project gets a subdirectory named by its encoded path,
 * containing a registry.json with metadata.
 */
export class ProjectRegistryService {
  constructor(private readonly registryRoot: string) {}

  /**
   * Register or update a project in the registry.
   * Creates the directory and writes registry.json with current timestamp.
   */
  async register(projectDir: string): Promise<void> {
    const encoded = encodeProjectDir(projectDir)
    const entryDir = join(this.registryRoot, encoded)
    const entryFile = join(entryDir, REGISTRY_FILE)

    await fs.mkdir(entryDir, { recursive: true })

    const entry: ProjectRegistryEntry = {
      path: projectDir,
      displayName: basename(projectDir),
      lastActive: new Date().toISOString(),
    }

    // Atomic write: temp file + rename
    const tmpPath = `${entryFile}.${Date.now()}.tmp`
    await fs.writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf-8')
    await fs.rename(tmpPath, entryFile)
  }

  /**
   * List all valid registered projects.
   * Skips entries with missing/invalid registry.json.
   */
  async list(): Promise<ProjectRegistryEntry[]> {
    if (!existsSync(this.registryRoot)) {
      return []
    }

    const entries: ProjectRegistryEntry[] = []
    const dirents = await fs.readdir(this.registryRoot, { withFileTypes: true })

    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue

      const entryFile = join(this.registryRoot, dirent.name, REGISTRY_FILE)
      try {
        const raw = await fs.readFile(entryFile, 'utf-8')
        const parsed = ProjectRegistryEntrySchema.parse(JSON.parse(raw))
        entries.push(parsed)
      } catch {
        // Skip invalid entries silently
      }
    }

    return entries
  }

  /**
   * Prune stale registry entries.
   * Removes entries where the project path no longer exists
   * or lastActive is older than retentionDays.
   */
  async prune(options: PruneOptions): Promise<PruneResult[]> {
    if (!existsSync(this.registryRoot)) {
      return []
    }

    const pruned: PruneResult[] = []
    const cutoff = Date.now() - options.retentionDays * 24 * 60 * 60 * 1000
    const dirents = await fs.readdir(this.registryRoot, { withFileTypes: true })

    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue

      const entryDir = join(this.registryRoot, dirent.name)
      const entryFile = join(entryDir, REGISTRY_FILE)

      let entry: ProjectRegistryEntry
      try {
        const raw = await fs.readFile(entryFile, 'utf-8')
        entry = ProjectRegistryEntrySchema.parse(JSON.parse(raw))
      } catch {
        // Can't read entry — remove the directory
        await fs.rm(entryDir, { recursive: true })
        continue
      }

      let reason: PruneResult['reason'] | null = null

      if (!existsSync(entry.path)) {
        reason = 'path-missing'
      } else if (new Date(entry.lastActive).getTime() < cutoff) {
        reason = 'age-exceeded'
      }

      if (reason) {
        await fs.rm(entryDir, { recursive: true })
        pruned.push({ path: entry.path, reason })
      }
    }

    return pruned
  }
}
```

**Step 4: Export from index.ts**

Add to `packages/sidekick-core/src/index.ts`:

```typescript
export {
  encodeProjectDir,
  decodeProjectDir,
  ProjectRegistryService,
  type PruneOptions,
  type PruneResult,
} from './project-registry'
```

**Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/__tests__/project-registry.test.ts`
Expected: PASS

**Step 6: Run full build + typecheck**

Run: `pnpm build && pnpm typecheck`
Expected: PASS

**Step 7: Commit**

```
feat(core): add ProjectRegistryService for UI project discovery
```

---

## Task 4: Integrate registry into daemon startup + hourly heartbeat

**Files:**
- Modify: `packages/sidekick-daemon/src/daemon.ts`

**Step 1: Write the failing test**

Create: `packages/sidekick-daemon/src/__tests__/project-registry-integration.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { ProjectRegistryService } from '@sidekick/core'

function createTestDir(): string {
  const dir = join(tmpdir(), `test-daemon-reg-${randomBytes(8).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('Daemon project registry integration', () => {
  let registryRoot: string
  let projectDir: string

  beforeEach(() => {
    registryRoot = createTestDir()
    projectDir = createTestDir()
  })

  afterEach(() => {
    for (const dir of [registryRoot, projectDir]) {
      if (existsSync(dir)) rmSync(dir, { recursive: true })
    }
  })

  it('registers project on startup', async () => {
    const service = new ProjectRegistryService(registryRoot)
    await service.register(projectDir)

    const entries = await service.list()
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe(projectDir)
  })

  it('updates lastActive on heartbeat', async () => {
    const service = new ProjectRegistryService(registryRoot)
    await service.register(projectDir)

    const first = (await service.list())[0]
    await new Promise(r => setTimeout(r, 10))
    await service.register(projectDir)
    const second = (await service.list())[0]

    expect(new Date(second.lastActive).getTime()).toBeGreaterThanOrEqual(
      new Date(first.lastActive).getTime()
    )
  })
})
```

**Step 2: Run test to verify it passes** (this tests the service, not the daemon wiring — the wiring is verified by build + manual test)

Run: `pnpm --filter @sidekick/daemon test -- --run packages/sidekick-daemon/src/__tests__/project-registry-integration.test.ts`
Expected: PASS

**Step 3: Wire registry into daemon.ts**

Add to daemon class fields (after `private evictionTimer`):

```typescript
private registryHeartbeatInterval: ReturnType<typeof setInterval> | null = null
private registryService: ProjectRegistryService
```

In the constructor, after the `userStateService` is created (~line 236), add:

```typescript
// Project registry for UI discovery (~/.sidekick/projects/)
const registryRoot = path.join(homedir(), '.sidekick', 'projects')
this.registryService = new ProjectRegistryService(registryRoot)
```

Add import at top of file:

```typescript
import { ProjectRegistryService } from '@sidekick/core'
```

In `start()`, after step 12 (startEvictionTimer), add:

```typescript
// 13. Register project and start registry heartbeat (hourly)
await this.registerProject()
this.startRegistryHeartbeat()
```

Add new private methods:

```typescript
private async registerProject(): Promise<void> {
  try {
    await this.registryService.register(this.projectDir)
    this.logger.info('Project registered for UI discovery', { projectDir: this.projectDir })
  } catch (err) {
    this.logger.warn('Failed to register project', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

private static readonly REGISTRY_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

private startRegistryHeartbeat(): void {
  this.registryHeartbeatInterval = setInterval(() => {
    void this.registerProject()
  }, Daemon.REGISTRY_HEARTBEAT_INTERVAL_MS)

  this.registryHeartbeatInterval.unref()
  this.logger.debug('Registry heartbeat started', {
    intervalMs: Daemon.REGISTRY_HEARTBEAT_INTERVAL_MS,
  })
}

private stopRegistryHeartbeat(): void {
  if (this.registryHeartbeatInterval) {
    clearInterval(this.registryHeartbeatInterval)
    this.registryHeartbeatInterval = null
  }
}
```

In `stop()`, after `this.stopEvictionTimer()`, add:

```typescript
// Stop registry heartbeat
this.stopRegistryHeartbeat()
```

**Step 4: Run build + typecheck**

Run: `pnpm build && pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```
feat(daemon): register project on startup, heartbeat hourly for UI discovery
```

---

## Task 5: Final verification and lint

**Step 1: Run full verification suite**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: PASS

**Step 2: Run all relevant tests**

Run: `pnpm --filter @sidekick/core test -- --run` and `pnpm --filter @sidekick/daemon test -- --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: PASS

**Step 3: Commit any lint fixes if needed**

---

Plan complete and saved to `docs/plans/2026-03-12-project-registry-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?
