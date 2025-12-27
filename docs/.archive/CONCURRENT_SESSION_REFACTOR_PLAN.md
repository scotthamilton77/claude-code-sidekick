# Session Management Architecture Refactor

## Scott's code review

## Problem Statement

When `/clear` is executed, the supervisor receives a `SessionStart` event with a NEW session ID, but:
1. `StagingService` continues using the OLD session's staging path
2. `TranscriptService` continues watching the OLD session's transcript
3. Reminders get staged to the wrong session directory

The root cause: `initializeSession()` returns early if `this.transcriptService` exists, without checking if the session ID changed.

---

## Chosen Approach: Factory Pattern with Session-Scoped Wrappers

Requirements:
- **Concurrent sessions**: Multiple Claude Code windows in same project must work
- **Factory abstraction**: Hide singleton vs prototype details from callers
- **Clean interface**: No sessionId on every method - wrappers inject it
- **Future-proof**: Can make StagingService stateful later without interface changes

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ServiceFactory                              │
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │ getStagingService() │    │ getTranscriptService()          │ │
│  │   (sessionId)       │    │   (sessionId, transcriptPath)   │ │
│  └──────────┬──────────┘    └───────────────┬─────────────────┘ │
└─────────────┼───────────────────────────────┼───────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────┐    ┌─────────────────────────────────┐
│ SessionScopedStaging    │    │ TranscriptServiceImpl           │
│ (wrapper)               │    │ (actual instance per session)   │
│ ┌─────────────────────┐ │    │                                 │
│ │ sessionId: "abc123" │ │    │ sessionId: "abc123"             │
│ │ core: singleton ────┼─┼───▶│ watchers, timers, metrics       │
│ └─────────────────────┘ │    └─────────────────────────────────┘
│                         │
│ stageReminder(hook, ..) │    ┌─────────────────────────────────┐
│   → core.stage(         │    │ TranscriptServiceImpl           │
│       sessionId,        │    │ (another session)               │
│       hook, ...)        │    │ sessionId: "def456"             │
└─────────────────────────┘    └─────────────────────────────────┘
              │
              ▼
┌─────────────────────────┐
│ StagingServiceCore      │
│ (stateless singleton)   │
│                         │
│ stage(sessionId, ...)   │
│   → derives path from   │
│     sessionId           │
└─────────────────────────┘
```

| Component | Pattern | Lifecycle |
|-----------|---------|-----------|
| **ServiceFactory** | Singleton per supervisor | Long-lived |
| **StagingServiceCore** | Stateless singleton | Long-lived |
| **SessionScopedStaging** | Lightweight wrapper | Per-request or cached |
| **TranscriptService** | Session-keyed instances | Created on demand, evicted on TTL/SessionEnd |

---

## Implementation Plan

### Phase 1: Create Service Factory Infrastructure

**New Files:**
- `packages/types/src/services/service-factory.ts` - Factory types
- `packages/sidekick-core/src/service-factory.ts` - Factory implementation

**Factory Interface:**
```typescript
export interface ServiceFactory {
  getStagingService(sessionId: string): StagingService
  getTranscriptService(sessionId: string, transcriptPath: string): Promise<TranscriptService>
  shutdownSession(sessionId: string): Promise<void>
  evictStaleSessions(): Promise<number>
}
```

### Phase 2: Implement StagingService Core + Wrapper

**Files:**
- `packages/sidekick-core/src/staging-service.ts` - Refactor to Core + Wrapper

**Two-Layer Design:**
```typescript
// Internal core - stateless, takes sessionId on each call
class StagingServiceCore {
  private getStagingRoot(sessionId: string): string {
    return join(this.options.stateDir, 'sessions', sessionId, 'stage')
  }

  async stageReminder(sessionId: string, hookName: string, ...): Promise<void> {
    // ... existing logic with dynamic path
  }
}

// Session-scoped wrapper - implements StagingService interface (unchanged!)
class SessionScopedStagingService implements StagingService {
  constructor(private readonly core: StagingServiceCore, private readonly sessionId: string) {}

  async stageReminder(hookName: string, reminderName: string, data: StagedReminder): Promise<void> {
    return this.core.stageReminder(this.sessionId, hookName, reminderName, data)
  }
  // ... all methods delegate to core with sessionId injected
}
```

**Key Benefit:** `StagingService` interface is UNCHANGED. Callers don't need updates.

### Phase 3: Implement ServiceFactoryImpl

**Files:**
- `packages/sidekick-core/src/service-factory.ts`

**Session-Keyed Map with TTL:**
```typescript
class ServiceFactoryImpl implements ServiceFactory {
  private readonly stagingCore: StagingServiceCore
  private readonly transcriptServices = new Map<string, TranscriptService>()
  private readonly sessionLastAccess = new Map<string, number>()
  private readonly SESSION_TTL_MS = 30 * 60 * 1000  // 30 minutes

  getStagingService(sessionId: string): StagingService {
    this.touchSession(sessionId)
    return new SessionScopedStagingService(this.stagingCore, sessionId)
  }

  async getTranscriptService(sessionId: string, transcriptPath: string): Promise<TranscriptService> {
    this.touchSession(sessionId)
    let service = this.transcriptServices.get(sessionId)
    if (!service) {
      service = new TranscriptServiceImpl({...})
      await service.initialize(sessionId, transcriptPath)
      this.transcriptServices.set(sessionId, service)
    }
    return service
  }

  async shutdownSession(sessionId: string): Promise<void> {
    const service = this.transcriptServices.get(sessionId)
    if (service) {
      await service.shutdown()
      this.transcriptServices.delete(sessionId)
    }
    this.sessionLastAccess.delete(sessionId)
  }

  async evictStaleSessions(): Promise<number> {
    const now = Date.now()
    let evicted = 0
    for (const [sessionId, lastAccess] of this.sessionLastAccess) {
      if (now - lastAccess > this.SESSION_TTL_MS) {
        await this.shutdownSession(sessionId)
        evicted++
      }
    }
    return evicted
  }
}
```

### Phase 4: Integrate Factory into Supervisor

**Files:**
- `packages/sidekick-supervisor/src/supervisor.ts`

**Changes:**
```typescript
class Supervisor {
  private serviceFactory: ServiceFactory

  // Build context per-request using factory
  private async buildHandlerContext(sessionId: string, transcriptPath: string): Promise<SupervisorContext> {
    return {
      role: 'supervisor',
      sessionId,
      staging: this.serviceFactory.getStagingService(sessionId),
      transcript: await this.serviceFactory.getTranscriptService(sessionId, transcriptPath),
      // ... other fields
    }
  }

  private async handleSessionEnd(event: HookEvent): Promise<void> {
    const sessionId = event.context?.sessionId
    if (sessionId) {
      await this.serviceFactory.shutdownSession(sessionId)
    }
  }
}
```

### Phase 5: Update Handler Context Flow

**Files:**
- `packages/sidekick-supervisor/src/supervisor.ts`
- `packages/sidekick-core/src/handler-registry.ts`

**Key Change:**
```typescript
// Before: Singleton context set once
this.handlerRegistry.setContext(supervisorContext)

// After: Context built per-request with session-scoped services
async handleHookInvoke(request: HookInvokeRequest): Promise<HookResponse> {
  const sessionId = request.event.context?.sessionId
  const transcriptPath = request.event.payload?.transcriptPath
  const ctx = await this.buildHandlerContext(sessionId, transcriptPath)
  return this.handlerRegistry.invokeHook(request.hook, request.event, ctx)
}
```

### Phase 6: Add Eviction Timer

**Files:**
- `packages/sidekick-supervisor/src/supervisor.ts`

```typescript
class Supervisor {
  private evictionTimer: ReturnType<typeof setInterval> | null = null

  async start(): Promise<void> {
    this.evictionTimer = setInterval(() => {
      void this.serviceFactory.evictStaleSessions()
    }, 5 * 60 * 1000)  // Every 5 minutes
  }

  async shutdown(): Promise<void> {
    if (this.evictionTimer) clearInterval(this.evictionTimer)
  }
}
```

---

## Files Summary

### New Files
1. `packages/types/src/services/service-factory.ts` - ServiceFactory interface
2. `packages/sidekick-core/src/service-factory.ts` - ServiceFactoryImpl

### Must Modify
1. `packages/sidekick-core/src/staging-service.ts` - Split into Core + SessionScoped wrapper
2. `packages/sidekick-supervisor/src/supervisor.ts` - Use factory, per-request context
3. `packages/sidekick-core/src/handler-registry.ts` - Accept context per invocation
4. `packages/testing-fixtures/src/mocks/MockStagingService.ts` - Add mock factory

### Interface Unchanged (Key Benefit!)
- `packages/types/src/services/staging.ts` - **NO CHANGES** to StagingService interface
- All callers of StagingService - **NO CHANGES** needed

### Must Update Tests
- `packages/sidekick-core/src/__tests__/staging-service.test.ts` - Test Core + wrapper
- `packages/sidekick-supervisor/src/__tests__/staging-lifecycle.test.ts` - Test factory
- Add new: `packages/sidekick-core/src/__tests__/service-factory.test.ts`

---

## Migration Strategy

1. **Phase 1** - Create ServiceFactory interface and types
2. **Phase 2** - Refactor StagingService to Core + wrapper (internal change, interface preserved)
3. **Phase 3** - Implement ServiceFactoryImpl with transcript map
4. **Phase 4** - Integrate factory into Supervisor
5. **Phase 5** - Update handler invocation to pass context per-request
6. **Phase 6** - Add eviction timer

**Key Advantage:** StagingService interface unchanged = minimal caller updates.

Recommend:
- Feature branch with thorough testing
- Run `pnpm build && pnpm typecheck` after each phase
- Test concurrent session scenario manually after completion
