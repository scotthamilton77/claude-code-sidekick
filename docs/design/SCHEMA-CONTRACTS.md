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
│   ├── services/                  # Service-specific schemas and interfaces
│   │   ├── config.ts              # Configuration service interfaces
│   │   ├── state.ts               # Session state schemas
│   │   ├── staging.ts             # Staging service interface
│   │   ├── transcript.ts          # Transcript service interface
│   │   ├── daemon-client.ts       # Daemon client interface
│   │   ├── daemon-status.ts       # Daemon status schemas
│   │   ├── persona.ts             # Persona definition schemas
│   │   ├── reminder-coordinator.ts # Reminder coordination interface
│   │   ├── service-factory.ts     # Service factory interface
│   │   └── index.ts               # Service re-exports
│   ├── context.ts                 # RuntimeContext (CLIContext, DaemonContext)
│   ├── events.ts                  # Event schemas (HookEvent, TranscriptEvent, logging events)
│   ├── handler-registry.ts        # HandlerRegistry interface, filters, result types
│   ├── hook-input.ts              # Claude Code hook input Zod schemas
│   ├── llm.ts                     # LLM provider interfaces (LLMProvider, ProfileProviderFactory)
│   ├── logger.ts                  # Logger interface
│   ├── paths.ts                   # RuntimePaths interface
│   ├── tasks.ts                   # Task-related types
│   ├── setup-status.ts            # Setup status types
│   └── index.ts                   # Main export
├── dist/                          # Compiled JS/DTS
└── package.json
```

### 2.2 Build Pipeline

The build process is two-fold:

1. **TypeScript Compilation**: `tsc` generates `.d.ts` and `.js` files for internal package consumption.
2. **Schema Generation**: A custom script (`scripts/generate-schemas.ts`) iterates over exported Zod schemas and uses `zod-to-json-schema` to write `.json` files to:
   - `dist/schemas/` (for npm distribution)
   - `../../assets/sidekick/schemas/` (authoritative source for the repo)

## 3. Core Schemas

### 3.1 Configuration (`packages/sidekick-core/src/config.ts`)

Configuration Zod schemas live in `packages/sidekick-core/src/config.ts` (not in the types package), with minimal service interfaces in `packages/types/src/services/config.ts` to avoid circular dependencies.

The configuration uses a **profile-based LLM system** (see `docs/design/LLM_PROFILES.md`):

- **LLM**: `{ defaultProfile: string, profiles: Record<string, LlmProfile>, fallbacks: Record<string, LlmProfile>, global: { debugDumpEnabled } }`
- **Features**: `{ [featureName]: { enabled: boolean, settings: Record<string, unknown> } }`
- **Logging**: `{ level: "debug" | "info" | "warn" | "error", format: "pretty" | "json", consoleEnabled: boolean }`

LLM providers now include `'emulator'` in addition to `'claude-cli' | 'openai' | 'openrouter' | 'custom'`.

### 3.2 Events (`src/events/`)

Defines the unified event model per **docs/design/flow.md §3**. All events flow through the same handler dispatch system.

#### EventContext

Shared context for all events (defined in `packages/types/src/events.ts`):

```typescript
interface EventContext {
  sessionId: string // Required: correlates all events in a session
  timestamp: number // Unix timestamp (ms)
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
type TranscriptEventType = 'UserPrompt' | 'AssistantMessage' | 'ToolCall' | 'ToolResult' | 'Compact' | 'BulkProcessingComplete'

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
    isBulkProcessing?: boolean // True during first-time historical replay
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

Derived metrics maintained by TranscriptService (defined in `packages/types/src/events.ts`):

```typescript
interface TranscriptMetrics {
  turnCount: number // Total user prompts in session
  toolsThisTurn: number // Tools since last UserPrompt (auto-resets)
  toolCount: number // Total tool invocations across session
  messageCount: number // Total messages (user + assistant + system)
  tokenUsage: TokenUsageMetrics // Detailed token metrics from API responses
  currentContextTokens: number | null // Current context window tokens (resets on compact)
  isPostCompactIndeterminate: boolean // True after compact until first usage block
  toolsPerTurn: number // Average tools per turn
  lastProcessedLine: number // Watermark for incremental processing
  lastUpdatedAt: number // Timestamp of last metrics update
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

#### SessionStateSnapshot

Runtime state snapshot for a session (defined in `packages/types/src/services/state.ts`):

```typescript
interface SessionStateSnapshot {
  sessionId: string
  timestamp: number // Unix timestamp (ms) of this snapshot
  summary?: SessionSummaryState
  resume?: ResumeMessageState
  metrics?: TranscriptMetricsState
}
```

### 3.4 IPC Protocol (`packages/sidekick-core/src/ipc/`)

Defines the contract between the CLI (client) and the Background Daemon (server).

- **Transport**: Unix Domain Socket (Linux/macOS) or Named Pipe (Windows).
- **Format**: JSON-RPC 2.0 over Newline-Delimited JSON (NDJSON) framing.
- **Semantics**: Request/response protocol. CLI sends JSON-RPC calls, Daemon returns results.

The IPC implementation lives in `packages/sidekick-core/src/ipc/` with `client.ts`, `server.ts`, and `protocol.ts`.

Per **docs/design/flow.md §2.1**, while the IPC uses request/response, the CLI does not wait for heavy Daemon processing. The Daemon acknowledges receipt quickly, then performs background work asynchronously. Results are staged as files for CLI consumption on subsequent hook invocations.

**IPC Message Schema** (JSON-RPC 2.0):

```typescript
// Wire format: JSON-RPC 2.0, NDJSON framed (one JSON object per line)
// Request:  {"jsonrpc":"2.0","method":"hookEvent","params":{...},"id":1}\n
// Response: {"jsonrpc":"2.0","result":"ok","id":1}\n
```

**Connection Lifecycle**:

1. CLI connects to socket (path at `<project>/.sidekick/sidekickd.sock`)
2. CLI sends JSON-RPC request with hook event data
3. Daemon acknowledges receipt
4. CLI disconnects (or keeps connection for subsequent calls)
5. Daemon processes event asynchronously

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

The statusline configuration schema is defined in `packages/feature-statusline/src/types.ts` (`StatuslineConfigSchema`):

```typescript
interface StatuslineConfig {
  enabled: boolean
  format: string // Template string with {placeholders}
  thresholds: {
    tokens: { warning: number; critical: number }
    cost: { warning: number; critical: number }
    logs: { warning: number; critical: number }
  }
  theme: {
    useNerdFonts: boolean | 'full' | 'safe' | 'ascii'
    supportedMarkdown: { bold: boolean; italic: boolean; code: boolean }
    colors: {
      model: string
      tokens: string
      title: string
      summary: string
      cwd: string
      duration: string
      branch?: string
    }
  }
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

**Decision**: Keep the Zod definitions in `packages/sidekick-core/src/config.ts`. Minimal service interfaces live in `packages/types/src/services/config.ts` to avoid circular dependencies.

### 7.2 IPC Transport

**Decision**: Use Node.js native `net` module with **Unix Domain Sockets** (Linux/macOS) or **Named Pipes** (Windows) using **JSON-RPC 2.0 over Newline Delimited JSON (NDJSON)** framing.

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

- **Socket Resolution**: The socket path is at `<project-root>/.sidekick/sidekickd.sock`. This ensures all sessions in the project discover the same daemon.
- **Multiplexing**: The `net.Server` handles concurrent connections from multiple CLI processes.
- **Session Context**: Every `SidekickEvent` includes `context.sessionId` so the Daemon knows which session the event originates from.

### 7.4 Strictness

**Decision**: Use `z.strict()` by default for all schemas to prevent "config sprawl" where users add unknown keys that are silently ignored.
