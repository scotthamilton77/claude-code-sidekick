# Low-Level Design: Schema & Contracts

## 1. Overview

The `packages/types` package serves as the **single source of truth** for all data structures, API interfaces, and configuration formats used across the Sidekick ecosystem. It ensures type safety for the TypeScript runtime (`sidekick-core`, `sidekick-cli`) and provides language-agnostic JSON Schemas for external tools (Python scripts).

### 1.1 Goals

- **Type Safety**: Export TypeScript interfaces and Zod schemas for runtime validation.
- **Interoperability**: Generate JSON Schemas for Python/Bash tools to validate data without Node.js dependencies.
- **Centralization**: Prevent drift between the runtime's understanding of data and the static assets.

### 1.2 Related Documents

- **docs/design/flow.md**: Canonical event model, hook flows, handler registration (§3 Event Taxonomy)
- **docs/design/FEATURE-REMINDERS.md**: Reminder schemas and YAML definitions (§3.3, §8.1)
- **docs/design/CONFIG-SYSTEM.md**: Configuration file structure and cascade semantics

## 2. Package Architecture

### 2.1 Directory Structure

```
packages/types/
├── src/
│   ├── services/        # Service-specific schemas
│   │   ├── config.ts    # Configuration file schemas
│   │   ├── state.ts     # Session state schemas
│   │   └── ...
│   ├── events.ts        # Event schemas (HookEvent, TranscriptEvent)
│   ├── llm.ts           # LLM provider interfaces
│   └── index.ts         # Main export
├── scripts/
│   └── generate-schemas.ts # Build script to emit JSON Schemas
├── dist/                # Compiled JS/DTS
└── package.json
```

### 2.2 Build Pipeline

The build process is two-fold:

1. **TypeScript Compilation**: `tsc` generates `.d.ts` and `.js` files for internal package consumption.
2. **Schema Generation**: A custom script (`scripts/generate-schemas.ts`) iterates over exported Zod schemas and uses `zod-to-json-schema` to write `.json` files to:
   - `dist/schemas/` (for npm distribution)
   - `../../assets/sidekick/schemas/` (authoritative source for the repo)

## 3. Core Schemas

### 3.1 Configuration (`src/config/`)

Defines the structure of `sidekick.yaml`.

- **User Config**: Global settings (LLM provider keys, default model, telemetry opt-out).
- **Project Config**: Per-project overrides (enabled features, project-specific prompt variables).

**Key Fields**:

- `llm`: `{ provider: "claude-cli" | "openai" | "openrouter" | "custom", model: string, ... }`
- `features`: `{ [featureName]: { enabled: boolean, ...config } }`
- `logging`: `{ level: "debug" | "info", redactor: string[] }`

### 3.2 Events (`src/events/`)

Defines the unified event model per **docs/design/flow.md §3**. All events flow through the same handler dispatch system.

#### EventContext

Shared context for all events:

```typescript
interface EventContext {
  sessionId: string // Required: correlates all events in a session
  timestamp: number // Unix timestamp (ms)
  scope?: 'project' | 'user' // Which scope this event occurred in
  correlationId?: string // Unique ID for the CLI command execution
  traceId?: string // Optional: links causally-related events
}
```

#### HookEvent

Discriminated union for Claude Code hook invocations. Each hook type has a specific payload shape:

```typescript
interface SessionStartHookEvent {
  kind: 'hook'
  hook: 'SessionStart'
  context: EventContext
  payload: {
    startType: 'startup' | 'resume' | 'clear' | 'compact'
    transcriptPath: string
  }
}

interface SessionEndHookEvent {
  kind: 'hook'
  hook: 'SessionEnd'
  context: EventContext
  payload: {
    endReason: 'clear' | 'logout' | 'prompt_input_exit' | 'other'
  }
}

interface UserPromptSubmitHookEvent {
  kind: 'hook'
  hook: 'UserPromptSubmit'
  context: EventContext
  payload: {
    prompt: string
    transcriptPath: string
    cwd: string
    permissionMode: string
  }
}

interface PreToolUseHookEvent {
  kind: 'hook'
  hook: 'PreToolUse'
  context: EventContext
  payload: {
    toolName: string
    toolInput: Record<string, unknown>
  }
}

interface PostToolUseHookEvent {
  kind: 'hook'
  hook: 'PostToolUse'
  context: EventContext
  payload: {
    toolName: string
    toolInput: Record<string, unknown>
    toolResult: unknown
  }
}

interface StopHookEvent {
  kind: 'hook'
  hook: 'Stop'
  context: EventContext
  payload: {
    transcriptPath: string
    permissionMode: string
    stopHookActive: boolean
  }
}

interface PreCompactHookEvent {
  kind: 'hook'
  hook: 'PreCompact'
  context: EventContext
  payload: {
    transcriptPath: string
    transcriptSnapshotPath: string
  }
}

type HookEvent =
  | SessionStartHookEvent
  | SessionEndHookEvent
  | UserPromptSubmitHookEvent
  | PreToolUseHookEvent
  | PostToolUseHookEvent
  | StopHookEvent
  | PreCompactHookEvent

type HookName = HookEvent['hook']
```

#### TranscriptEvent

Emitted by TranscriptService when new entries appear in the transcript file:

```typescript
type TranscriptEventType = 'UserPrompt' | 'AssistantMessage' | 'ToolCall' | 'ToolResult' | 'Compact'

interface TranscriptEvent {
  kind: 'transcript'
  eventType: TranscriptEventType
  context: EventContext
  payload: {
    lineNumber: number
    entry: TranscriptEntry // Raw JSONL entry
    content?: string
    toolName?: string // For ToolCall/ToolResult
  }
  metadata: {
    transcriptPath: string
    metrics: TranscriptMetrics // Snapshot after this event
  }
}
```

#### SidekickEvent (Unified)

```typescript
type SidekickEvent = HookEvent | TranscriptEvent

// Type guards
function isHookEvent(event: SidekickEvent): event is HookEvent {
  return event.kind === 'hook'
}

function isTranscriptEvent(event: SidekickEvent): event is TranscriptEvent {
  return event.kind === 'transcript'
}
```

### 3.3 Session & State (`src/session/`)

Defines session-level structures.

#### TranscriptMetrics

Derived metrics maintained by TranscriptService:

```typescript
interface TranscriptMetrics {
  turnCount: number // Total user prompts in session
  toolCount: number // Total tool invocations in session
  toolsThisTurn: number // Tools since last UserPrompt (auto-resets)
  totalTokens: number // Estimated total tokens in transcript
}
```

#### TranscriptEntry

Raw JSONL entry from Claude Code transcript file:

```typescript
interface TranscriptEntry {
  type: string // Entry type (user, assistant, tool_use, tool_result, etc.)
  timestamp?: string // ISO8601 timestamp
  // Additional fields vary by entry type
  [key: string]: unknown
}
```

#### SessionState

Runtime state for a session:

```typescript
interface SessionState {
  sessionId: string
  startTime: number // Unix timestamp (ms)
  scope: 'project' | 'user'
  transcriptPath: string
  metrics: TranscriptMetrics
}
```

### 3.4 IPC Protocol (`src/ipc/`)

Defines the contract between the CLI (client) and the Background Daemon (server).

- **Transport**: Unix Domain Socket (Linux/macOS) or Named Pipe (Windows).
- **Format**: Newline-Delimited JSON (NDJSON).
- **Semantics**: Fire-and-forget events (CLI → Daemon). No request/response for hook events.

Per **docs/design/flow.md §2.1**, the CLI and Daemon communicate asynchronously:

- CLI sends `SidekickEvent` to Daemon via IPC
- Daemon "responds" by staging files that CLI reads on subsequent hook invocations
- No synchronous IPC response is expected for hook events

**IPC Message Schema**:

```typescript
// CLI → Daemon: events flow one-way
type IpcMessage = SidekickEvent

// Wire format: NDJSON (one JSON object per line)
// Example: {"kind":"hook","hook":"SessionStart","context":{...},"payload":{...}}\n
```

**Connection Lifecycle**:

1. CLI connects to socket (path derived from project root hash)
2. CLI writes NDJSON event
3. CLI disconnects (or keeps connection for subsequent events)
4. Daemon processes event asynchronously

### 3.5 Feature Contracts (`src/features/`)

Each feature defines its data models here.

#### Reminders

Per **docs/design/FEATURE-REMINDERS.md §3.3**, staged reminders use this schema:

**StagedReminder** (JSON file):

```typescript
interface StagedReminder {
  name: string // Unique identifier (e.g., "AreYouStuckReminder")
  blocking: boolean // Whether to block the action
  priority: number // Higher = consumed first when multiple staged
  persistent: boolean // If true, file is not deleted on consumption
  // Text fields (all optional, pre-interpolated from YAML template)
  userMessage?: string // Shown to user in chat UI
  additionalContext?: string // Injected as system context
  reason?: string // Used as blocking reason
}
```

**File Location**: `.sidekick/sessions/{session_id}/stage/{hook_name}/{reminder_name}.json`

**ReminderDefinition** (YAML source file):

Per **docs/design/FEATURE-REMINDERS.md §8.1**:

```typescript
interface ReminderDefinition {
  id: string // Must match filename (e.g., "are-you-stuck")
  blocking: boolean
  priority: number
  persistent: boolean
  // Content fields (support {{variable}} interpolation)
  userMessage?: string
  additionalContext?: string
  reason?: string
}
```

**File Location**: `assets/sidekick/reminders/{id}.yaml` (with cascade overrides)

#### Statusline

```typescript
interface StatuslineConfig {
  components: string[] // Ordered list of component IDs
  refreshInterval: number // Milliseconds between updates
}
```

### 3.6 Prompt Frontmatter (`src/prompts/`)

Defines the YAML frontmatter allowed in `.prompt.txt` files.

```typescript
interface PromptFrontmatter {
  description?: string
  variables?: string[] // Required variable names
  temperature?: number // 0-1
  tools?: string[] // Allowed tool names
}
```

## 4. Handler Registration (`src/handlers/`)

Per **docs/design/flow.md §2.3**, handlers register with filters:

```typescript
interface HandlerRegistration {
  id: string // Unique handler identifier
  priority: number // Higher runs first
  filter: HandlerFilter
  handler: EventHandler
}

type HandlerFilter =
  | { kind: 'hook'; hooks: HookName[] }
  | { kind: 'transcript'; eventTypes: TranscriptEventType[] }
  | { kind: 'all' }

type EventHandler = (event: SidekickEvent, ctx: HandlerContext) => Promise<HandlerResult | void>

interface HandlerResult {
  response?: HookResponse // For hook events
  stop?: boolean // If true, skip remaining handlers
}
```

## 5. Asset Synchronization

To ensure `assets/sidekick` remains the canonical source for non-TypeScript tools:

1. **Development**: When schemas are modified in `src/`, the developer runs `pnpm build`.
2. **Generation**: The build script updates `assets/sidekick/schemas/*.json`.
3. **Commit**: These JSON files are committed to git, allowing Python tools to read them directly without needing a Node.js build step.

## 6. Versioning Strategy

- **Semantic Versioning**: The package follows SemVer.
- **Breaking Changes**: Changes to Zod schemas that reject previously valid data are **major** changes.
- **Lockstep**: Since this is a monorepo, `sidekick-core` and `schema-contracts` are versioned and released together.

## 7. Recommendations & Open Decisions

### 7.1 Config Schema Location

**Decision**: Keep the _Zod definition_ in `schema-contracts`. `sidekick-core` imports it to validate loaded config. This prevents circular dependencies and allows standalone validation tools.

### 7.2 IPC Transport

**Decision**: Use Node.js native `net` module with **Unix Domain Sockets** (Linux/macOS) or **Named Pipes** (Windows) using **Newline Delimited JSON (NDJSON)**.

**Options Considered**:

1. **Raw `net` Sockets (Selected)**:
   - _Pros_: Zero dependencies, lowest latency, standard Node.js API, simple text-based protocol (NDJSON) is easy to debug.
   - _Cons_: Requires implementing simple framing (splitting by `\n`) and manual reconnection logic.
2. **`node-ipc`**:
   - _Pros_: Handles reconnection, broadcasting, and complex eventing out of the box.
   - _Cons_: External dependency (violates "No Unnecessary Code"), history of supply chain security issues, overkill for a simple 1:1 Daemon-CLI relationship.
3. **HTTP over UDS**:
   - _Pros_: Familiar request/response model, easy to debug with `curl --unix-socket`.
   - _Cons_: HTTP header overhead is unnecessary for high-frequency internal ops, stateless nature doesn't map as well to event-based model.

**Rationale**:
The "Sidekick" philosophy prioritizes **Simplicity** and **No Unnecessary Code**. A raw socket server in the daemon that listens for `\n`-terminated JSON objects is <50 lines of code. It avoids the bloat of HTTP and the risk of external IPC libraries. Since we control both client (`sidekick-core`) and server (Daemon), we can enforce a strict schema without needing protocol negotiation.

### 7.3 Concurrency & Scope (Multiple Sessions)

To satisfy the **Single Writer** principle (Target Arch §3.3), the Daemon must be a **Singleton per Project**. Multiple terminal windows (sessions) within the same project connect to the _same_ Daemon instance.

- **Socket Resolution**: The socket path is derived from a stable hash of the project root path (e.g., `~/.sidekick/ipc/proj-<hash>.sock`). This ensures all sessions in the project discover the same daemon.
- **Multiplexing**: The `net.Server` handles concurrent connections from multiple CLI processes.
- **Session Context**: Every `SidekickEvent` includes `context.sessionId` so the Daemon knows which session the event originates from.

### 7.4 Strictness

**Decision**: Use `z.strict()` by default for all schemas to prevent "config sprawl" where users add unknown keys that are silently ignored.
