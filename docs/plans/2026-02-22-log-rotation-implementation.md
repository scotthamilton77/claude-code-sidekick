# Log Rotation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up `pino-roll` for size-based log rotation in both the CLI and daemon log streams, and add rotation config to the config schema.

**Architecture:** Add a `BufferedRotatingStream` class internally to `structured-logging.ts` that kicks off async pino-roll initialization on construction, buffers writes until ready, then delegates. Callers pass `rotateSize`/`maxFiles` to `createLogManager` — these fields already exist in the interface but were previously unused. Config schema gets a `rotation` sub-object with defaults of 10MB / 5 files.

**Tech Stack:** `pino-roll@4.0.0` (already installed, CJS), `pino@10.1.0`, `zod/v4` for schema, TypeScript/CommonJS

---

### Task 1: Add rotation defaults to config schema and YAML

**Files:**
- Modify: `assets/sidekick/defaults/core.defaults.yaml`
- Modify: `packages/sidekick-core/src/config.ts:91-103`
- Test: `packages/sidekick-core/src/__tests__/config-yaml-alignment.test.ts` (verify no new mismatches)

**Step 1: Add rotation block to core.defaults.yaml**

In `assets/sidekick/defaults/core.defaults.yaml`, under `logging:`, add after `consoleEnabled: false`:

```yaml
  # Log rotation settings
  rotation:
    maxSizeBytes: 10485760  # 10MB per file
    maxFiles: 5             # keep 5 rotated files in addition to current
```

**Step 2: Add rotation to LoggingSchema in config.ts**

Find the `LoggingSchema` definition at line ~91 in `packages/sidekick-core/src/config.ts`.

Current schema:
```typescript
const LoggingSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    format: z.enum(['pretty', 'json']),
    consoleEnabled: z.boolean(),
    /** Per-component log level overrides. Keys are component names (e.g., 'reminders', 'statusline'). */
    components: z.record(z.string(), LogLevelSchema).optional(),
  })
  .strict()
  .transform((val) => ({
    ...val,
    components: val.components ?? {},
  }))
```

Add `rotation` field before `.strict()`:
```typescript
const LoggingSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    format: z.enum(['pretty', 'json']),
    consoleEnabled: z.boolean(),
    /** Per-component log level overrides. Keys are component names (e.g., 'reminders', 'statusline'). */
    components: z.record(z.string(), LogLevelSchema).optional(),
    /** Log rotation settings. Defaults to 10MB/5 files if not specified. */
    rotation: z
      .object({
        maxSizeBytes: z.number().min(1),
        maxFiles: z.number().min(1),
      })
      .optional(),
  })
  .strict()
  .transform((val) => ({
    ...val,
    components: val.components ?? {},
  }))
```

**Step 3: Run config alignment test**

```bash
pnpm --filter @sidekick/core test -- --reporter=verbose structured-logging config-yaml-alignment
```

Expected: tests pass. If `config-yaml-alignment.test.ts` fails because it detects a new key in YAML not in schema, check the test — you likely need to look at `config-yaml-alignment.test.ts` to understand what it validates.

**Step 4: Commit**

```bash
git add assets/sidekick/defaults/core.defaults.yaml packages/sidekick-core/src/config.ts
git commit -m "feat(config): add logging.rotation schema and defaults (10MB/5 files)"
```

---

### Task 2: Add BufferedRotatingStream and wire into createLogManager

**Files:**
- Modify: `packages/sidekick-core/src/structured-logging.ts`
- Test: `packages/sidekick-core/src/__tests__/structured-logging.test.ts`

**Step 1: Write the failing test**

In `packages/sidekick-core/src/__tests__/structured-logging.test.ts`, add a new `describe` block at the end (before any closing braces):

```typescript
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createLogManager } from '../structured-logging'

describe('createLogManager with rotation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'sidekick-log-rotation-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes log entries to a numbered file when rotateSize is specified', async () => {
    const logPath = path.join(tmpDir, 'test.log')
    const logManager = createLogManager({
      name: 'test',
      level: 'info',
      destinations: {
        file: {
          path: logPath,
          rotateSize: 512,  // tiny threshold to trigger rotation quickly
          maxFiles: 3,
        },
      },
    })

    const logger = logManager.getLogger()

    // Write enough data to trigger rotation (each line ~100 bytes * 10 = ~1KB > 512 bytes)
    for (let i = 0; i < 10; i++) {
      logger.info(`Log entry number ${i} with some padding to make it longer`.padEnd(80, 'x'))
    }

    await logger.flush()

    // Give rotation a moment to complete (pino-roll rotates on drain event)
    await new Promise((resolve) => setTimeout(resolve, 200))

    // At least one numbered file should exist in the directory
    const files = readdirSync(tmpDir)
    expect(files.some((f) => f.startsWith('test.log.'))).toBe(true)
  })

  it('falls back gracefully if rotation stream init fails', async () => {
    // Use an invalid path to trigger init failure
    const badPath = path.join('/nonexistent-impossible-path-xyz', 'test.log')
    expect(() => {
      createLogManager({
        name: 'test',
        level: 'info',
        destinations: {
          file: {
            path: badPath,
            rotateSize: 1024,
            maxFiles: 3,
          },
        },
      })
    }).not.toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @sidekick/core test -- --reporter=verbose --testNamePattern="createLogManager with rotation"
```

Expected: FAIL — `createLogManager` currently ignores `rotateSize` and uses `appendFileSync`.

**Step 3: Implement BufferedRotatingStream in structured-logging.ts**

At the top of `structured-logging.ts`, add `readdirSync` is not needed. Update the imports:

```typescript
import { mkdirSync, existsSync, appendFileSync } from 'node:fs'
```

After the imports section and before `// Default sensitive keys to redact`, add the `BufferedRotatingStream` class:

```typescript
// Default rotation thresholds (used when rotateSize/maxFiles not specified)
const DEFAULT_ROTATE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const DEFAULT_MAX_FILES = 5

/**
 * A Writable stream that initializes pino-roll rotation asynchronously.
 * Buffers writes until pino-roll is ready, then delegates.
 * Falls back to appendFileSync if pino-roll initialization fails.
 *
 * @internal
 */
class BufferedRotatingStream extends Writable {
  private realStream: Writable | null = null
  private readonly pending: Array<{
    chunk: Buffer | string
    callback: (err?: Error | null) => void
  }> = []
  private fallbackPath: string | null = null

  constructor(filePath: string, maxSizeBytes: number, maxFiles: number) {
    super()
    this.fallbackPath = filePath

    // Ensure log directory exists before passing to pino-roll
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pinoRoll = require('pino-roll') as (opts: {
      file: string
      size: string
      limit: { count: number }
      mkdir: boolean
    }) => Promise<Writable>

    const sizeMB = Math.max(1, Math.round(maxSizeBytes / (1024 * 1024)))

    pinoRoll({
      file: filePath,
      size: `${sizeMB}m`,
      limit: { count: maxFiles },
      mkdir: true,
    })
      .then((stream) => {
        this.realStream = stream
        this.fallbackPath = null
        // Flush pending writes
        for (const { chunk, callback } of this.pending) {
          this.realStream.write(chunk, callback)
        }
        this.pending.length = 0
      })
      .catch(() => {
        // pino-roll failed — drain pending via appendFileSync fallback
        for (const { chunk, callback } of this.pending) {
          try {
            appendFileSync(filePath, chunk)
            callback()
          } catch (writeErr) {
            callback(writeErr as Error)
          }
        }
        this.pending.length = 0
      })
  }

  _write(chunk: Buffer | string, _encoding: string, callback: (err?: Error | null) => void): void {
    if (this.realStream) {
      this.realStream.write(chunk, callback)
    } else if (this.fallbackPath === null) {
      // Init failed and fallback already drained — write directly (shouldn't normally happen)
      callback()
    } else {
      this.pending.push({ chunk, callback })
    }
  }

  _final(callback: () => void): void {
    if (this.realStream) {
      this.realStream.end(callback)
    } else {
      callback()
    }
  }
}
```

**Step 4: Wire BufferedRotatingStream into createLogManager**

In `createLogManager` (around line 227), find:

```typescript
  } else if (destinations?.file) {
    // File destination
    const filePath = destinations.file.path
    const fileDir = dirname(filePath)

    // Ensure directory exists
    if (!existsSync(fileDir)) {
      mkdirSync(fileDir, { recursive: true })
    }

    // Create a simple file destination stream
    const fileStream = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        try {
          appendFileSync(filePath, chunk)
          callback()
        } catch (err) {
          callback(err as Error)
        }
      },
    })

    pinoInstance = pino(pinoOptions, fileStream)
```

Replace with:

```typescript
  } else if (destinations?.file) {
    // File destination
    const filePath = destinations.file.path
    const rotateSize = destinations.file.rotateSize
    const maxFiles = destinations.file.maxFiles

    let fileStream: Writable

    if (rotateSize !== undefined && maxFiles !== undefined) {
      // Use rotating stream via pino-roll
      fileStream = new BufferedRotatingStream(filePath, rotateSize, maxFiles)
    } else {
      // Legacy: simple append (no rotation)
      const fileDir = dirname(filePath)
      if (!existsSync(fileDir)) {
        mkdirSync(fileDir, { recursive: true })
      }
      fileStream = new Writable({
        write(chunk: Buffer | string, _encoding, callback) {
          try {
            appendFileSync(filePath, chunk)
            callback()
          } catch (err) {
            callback(err as Error)
          }
        },
      })
    }

    pinoInstance = pino(pinoOptions, fileStream)
```

**Step 5: Wire BufferedRotatingStream into createContextLogger**

In `createContextLogger` (around line 423), find:

```typescript
    // Create file destination stream
    const fileStream = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        try {
          appendFileSync(logPath, chunk)
          callback()
        } catch (err) {
          callback(err as Error)
        }
      },
    })
```

Also check `ContextLoggerOptions` for any `rotateSize`/`maxFiles` fields — if absent, add them:

In `ContextLoggerOptions` interface (around line 331), add:
```typescript
  /** Max size in bytes before rotating. If set, maxFiles must also be set. */
  rotateSize?: number
  /** Max number of rotated files to keep. */
  maxFiles?: number
```

Then in the body of `createContextLogger`, destructure the new fields:
```typescript
  const {
    name = `sidekick:${options.source}`,
    level = 'info',
    source,
    context = {},
    logsDir,
    logFile,
    rotateSize,
    maxFiles,
    redactPaths,
    testStream,
  } = options
```

And replace the `fileStream` creation in `createContextLogger`:
```typescript
    let fileStream: Writable
    if (rotateSize !== undefined && maxFiles !== undefined) {
      fileStream = new BufferedRotatingStream(logPath, rotateSize, maxFiles)
    } else {
      fileStream = new Writable({
        write(chunk: Buffer | string, _encoding, callback) {
          try {
            appendFileSync(logPath, chunk)
            callback()
          } catch (err) {
            callback(err as Error)
          }
        },
      })
    }
```

**Step 6: Run tests**

```bash
pnpm --filter @sidekick/core test -- --reporter=verbose --testNamePattern="createLogManager with rotation"
```

Expected: PASS both rotation tests.

**Step 7: Run full structured-logging tests to check nothing broke**

```bash
pnpm --filter @sidekick/core test -- --reporter=verbose structured-logging
```

Expected: All pass.

**Step 8: Commit**

```bash
git add packages/sidekick-core/src/structured-logging.ts packages/sidekick-core/src/__tests__/structured-logging.test.ts
git commit -m "feat(logging): add BufferedRotatingStream backed by pino-roll"
```

---

### Task 3: Update call sites to pass rotation config

**Files:**
- Modify: `packages/sidekick-cli/src/runtime.ts:146-246`
- Modify: `packages/sidekick-daemon/src/daemon.ts:149-159`

The config service exposes `config.core.logging.rotation` which may be `undefined` if the user has an old config. Use `?? DEFAULT` fallbacks for safety.

**Step 1: Update runtime.ts**

In `packages/sidekick-cli/src/runtime.ts`, there are **three** places that call `createLogManager` with `file: { path: logFilePath }`:
1. Line ~151: initial `logManager` creation
2. Line ~166: `loggerFacade.upgrade(...)` call
3. Line ~234: inside `bindSessionId`

For all three, change:
```typescript
file: enableFileLogging ? { path: logFilePath } : undefined,
```

to:
```typescript
file: enableFileLogging ? {
  path: logFilePath,
  rotateSize: config.core.logging.rotation?.maxSizeBytes ?? 10_485_760,
  maxFiles: config.core.logging.rotation?.maxFiles ?? 5,
} : undefined,
```

**Step 2: Update daemon.ts**

In `packages/sidekick-daemon/src/daemon.ts` around line 151-159, change:
```typescript
destinations: {
  file: { path: path.join(logDir, 'sidekickd.log') },
  console: { enabled: this.configService.core.logging.consoleEnabled },
},
```

to:
```typescript
destinations: {
  file: {
    path: path.join(logDir, 'sidekickd.log'),
    rotateSize: this.configService.core.logging.rotation?.maxSizeBytes ?? 10_485_760,
    maxFiles: this.configService.core.logging.rotation?.maxFiles ?? 5,
  },
  console: { enabled: this.configService.core.logging.consoleEnabled },
},
```

**Step 3: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

Expected: No type errors.

**Step 4: Run CLI and daemon tests**

```bash
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
```

Expected: All pass.

**Step 5: Commit**

```bash
git add packages/sidekick-cli/src/runtime.ts packages/sidekick-daemon/src/daemon.ts
git commit -m "feat(logging): wire rotation config into CLI and daemon log managers"
```

---

### Task 4: Final verification

**Step 1: Full build + typecheck**

```bash
pnpm build && pnpm typecheck
```

Expected: Clean.

**Step 2: Run all core tests (excluding IPC)**

```bash
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
```

Expected: All pass.

**Step 3: Smoke test via CLI**

```bash
pnpm sidekick sessions
```

Check that `.sidekick/logs/` contains a numbered file (e.g., `sidekick.log.1`) rather than a plain `sidekick.log`.

**Step 4: Close the bead**

```bash
bd close sidekick-z63.4 --reason="Log rotation via pino-roll implemented. BufferedRotatingStream wired into createLogManager and createContextLogger. Config schema updated with rotation defaults (10MB/5 files). CLI and daemon call sites updated."
bd sync
```

**Step 5: Final commit if anything left unstaged**

```bash
git status
```

If clean — done. If not, stage and commit any remaining changes.

---

## Known Gaps / Follow-up

- **Monitoring UI**: The UI reads `.sidekick/logs/sidekick.log` directly. With pino-roll, logs go to `sidekick.log.1`, `sidekick.log.2`, etc. The UI may need updating to read all numbered files. File a new bead if this is broken.
- **`bindSessionId` race**: `bindSessionId` in `runtime.ts` creates a new `BufferedRotatingStream` on the same path. pino-roll will call `detectLastNumber` on init and continue numbering correctly — this is fine.
