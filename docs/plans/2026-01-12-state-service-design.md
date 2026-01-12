# StateService Design

## Overview

Centralized state management infrastructure for Sidekick, replacing scattered file access patterns with a unified service that provides atomic writes, Zod validation, and optional caching.

**Goals (from Phase 9.3):**
- Centralize state access behind clean abstractions
- Eliminate 90+ duplicated path constructions
- Consistent atomic writes and Zod validation
- Clean code: no @deprecation, no backward compatibility hacks

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Daemon Process                          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              StateService (with cache)                   │   │
│  │  ┌─────────────────┐  ┌────────────────────────────┐    │   │
│  │  │  PathResolver   │  │   Cache (Map<path, data>)  │    │   │
│  │  │   (internal)    │  │                            │    │   │
│  │  └─────────────────┘  └────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│         ┌────────────────────┼────────────────────┐            │
│         ▼                    ▼                    ▼            │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────────┐   │
│  │ SessionSum- │    │ Transcript  │    │  Other Session   │   │
│  │ maryState   │    │   State     │    │  Scoped Services │   │
│  │ (per-req)   │    │  (per-req)  │    │    (per-req)     │   │
│  └─────────────┘    └─────────────┘    └──────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                          CLI Process                            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │             StateService (no cache)                      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| PathResolver visibility | Package-private | Consumers use StateService, not paths directly |
| File name typing | Domain packages own filenames | Avoids coupling core to all state files |
| Schema location | With the writer | Writer defines the contract |
| Read behavior | Optional default | Throws if missing and no default provided |
| Default value type | `T \| (() => T)` | Supports lazy initialization |
| StateManager | Merged into StateService | Caching is opt-in, not a separate class |
| Cache sharing | Single instance via DI | Daemon creates one, passes to all consumers |
| Session scope | Lightweight wrapper services | Hold StateService ref + sessionId |
| StagingService | Delegates to StateService | May require `rename()` method |

## StateService Interface

```typescript
// @sidekick/core/src/state/state-service.ts

export interface StateReadResult<T> {
  data: T
  source: 'fresh' | 'stale' | 'default' | 'recovered'
  mtime?: number
}

export interface StateServiceOptions {
  cache?: boolean              // Enable in-memory caching (daemon only)
  staleThresholdMs?: number    // Default: 60000
  logger?: Logger
}

type DefaultValue<T> = T | (() => T)

export class StateService {
  constructor(projectRoot: string, options?: StateServiceOptions)

  // === Read/Write Primitives ===

  async read<T>(
    path: string,
    schema: ZodType<T>,
    defaultValue?: DefaultValue<T>
  ): Promise<StateReadResult<T>>

  async write<T>(
    path: string,
    data: T,
    schema: ZodType<T>
  ): Promise<void>

  async delete(path: string): Promise<void>

  async rename(oldPath: string, newPath: string): Promise<void>

  // === Path Accessors ===

  sessionStateDir(sessionId: string): string
  sessionStagingDir(sessionId: string): string
  globalStateDir(): string
  logsDir(): string

  sessionStatePath(sessionId: string, filename: string): string
  globalStatePath(filename: string): string
  hookStagingDir(sessionId: string, hookName: string): string

  // === Directory Operations ===

  async ensureDir(path: string): Promise<void>

  // === Cache Operations (when cache enabled) ===

  async preloadDirectory(dir: string): Promise<void>
}
```

## PathResolver (Internal)

```typescript
// @sidekick/core/src/state/path-resolver.ts
// NOT exported - internal to StateService

export class PathResolver {
  constructor(projectRoot: string, stateDir = '.sidekick')

  // Directories
  globalStateDir(): string      // .sidekick/state/
  sessionRoot(sessionId: string): string
  sessionStateDir(sessionId: string): string
  sessionStagingDir(sessionId: string): string
  hookStagingDir(sessionId: string, hookName: string): string
  logsDir(): string

  // File paths (accept trusted filenames from domain)
  globalState(filename: string): string
  sessionState(sessionId: string, filename: string): string
  stagedReminder(sessionId: string, hookName: string, reminderName: string): string
}
```

## Error Handling

```typescript
export class StateNotFoundError extends Error {
  constructor(public readonly path: string)
}

export class StateCorruptError extends Error {
  constructor(
    public readonly path: string,
    public readonly reason: 'parse_error' | 'schema_validation',
    public readonly cause: unknown
  )
}
```

**Behavior Matrix:**

| Scenario | With default | Without default |
|----------|--------------|-----------------|
| File missing | Return default, `source: 'default'` | Throw `StateNotFoundError` |
| Invalid JSON | Move to `.bak`, return default, `source: 'recovered'` | Move to `.bak`, throw `StateCorruptError` |
| Schema fails | Move to `.bak`, return default, `source: 'recovered'` | Move to `.bak`, throw `StateCorruptError` |
| Valid file | Return data, `source: 'fresh'` or `'stale'` | Return data |

## Domain Service Pattern

Feature packages create session-scoped wrappers:

```typescript
// @sidekick/feature-session-summary/src/state.ts

const SESSION_SUMMARY_FILE = 'session-summary.json'

export class SessionSummaryState {
  constructor(
    private state: StateService,
    private sessionId: string
  ) {}

  async read(): Promise<SessionSummaryState> {
    const path = this.state.sessionStatePath(this.sessionId, SESSION_SUMMARY_FILE)
    return (await this.state.read(path, SessionSummarySchema, EMPTY_SUMMARY)).data
  }

  async write(summary: SessionSummaryState): Promise<void> {
    const path = this.state.sessionStatePath(this.sessionId, SESSION_SUMMARY_FILE)
    await this.state.write(path, summary, SessionSummarySchema)
  }
}
```

**Benefits:**
- Schemas live with the writer (domain package)
- Session-scoped wrappers are cheap to create (two fields)
- StateService cache is shared across all wrappers
- No sessionId repetition in handler code

## Missing Schemas to Add

### SummaryCountdownSchema (feature-session-summary)

```typescript
export const SummaryCountdownSchema = z.object({
  remainingCycles: z.number().int().nonnegative(),
  lastUpdatedAt: z.number(),
})

export const DEFAULT_COUNTDOWN: SummaryCountdownState = {
  remainingCycles: 0,
  lastUpdatedAt: 0,
}
```

### CompactionHistorySchema (sidekick-core or daemon)

```typescript
export const CompactionEntrySchema = z.object({
  timestamp: z.number(),
  beforeTokens: z.number(),
  afterTokens: z.number(),
  messagesBefore: z.number(),
  messagesAfter: z.number(),
})

export const CompactionHistorySchema = z.object({
  entries: z.array(CompactionEntrySchema),
  lastPrunedAt: z.number().optional(),
})

export const MAX_COMPACTION_ENTRIES = 50  // Prune to last N
```

## Migration Strategy

### Phase 1: Core Infrastructure
- Create `StateService` and `PathResolver` in `@sidekick/core/src/state/`
- Add error types
- Export from package

### Phase 2: Add Missing Schemas
- `SummaryCountdownSchema` in feature-session-summary
- `CompactionHistorySchema` in sidekick-core

### Phase 3: Migrate Writers (Priority Order)
1. TranscriptService - writes transcript-metrics.json, compaction-history.json
2. Session summary handlers - writes session-summary.json, summary-countdown.json
3. Daemon IPC handlers - writes pr-baseline.json, vc-unverified.json, log metrics
4. StagingService - wire to delegate to StateService

### Phase 4: Migrate Readers
1. StateReader (feature-statusline) - becomes thin wrapper
2. UI handlers - use StateService for API endpoints
3. Resume feature - discoverPreviousResumeMessage()

### Phase 5: Cleanup
- Delete StateManager from daemon
- Remove DerivedPaths from config.ts
- Simplify StateReader

## File Structure

```
packages/sidekick-core/src/state/
├── index.ts              # Public exports
├── state-service.ts      # StateService class
├── path-resolver.ts      # PathResolver (internal, not exported)
└── errors.ts             # StateNotFoundError, StateCorruptError
```

## Testing Strategy

**Unit tests (StateService):** Real filesystem in tmpdir
- Missing file handling
- Corrupt file recovery
- Atomic write verification
- Cache behavior

**Unit tests (Domain services):** Mock StateService
- Correct paths passed
- Correct schemas used

**Integration tests:** Existing daemon tests validate end-to-end flows

## Future Enhancements (Out of Scope)

- File watching for cache invalidation (if external writers become a concern)
- Compression for large state files
- State file versioning/migration
