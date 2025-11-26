# Low-Level Design: Schema & Contracts

## 1. Overview

The `packages/schema-contracts` package serves as the **single source of truth** for all data structures, API interfaces, and configuration formats used across the Sidekick ecosystem. It ensures type safety for the TypeScript runtime (`sidekick-core`, `sidekick-cli`) and provides language-agnostic JSON Schemas for external tools (Python scripts).

### 1.1 Goals
- **Type Safety**: Export TypeScript interfaces and Zod schemas for runtime validation.
- **Interoperability**: Generate JSON Schemas for Python/Bash tools to validate data without Node.js dependencies.
- **Centralization**: Prevent drift between the runtime's understanding of data and the static assets.

## 2. Package Architecture

### 2.1 Directory Structure
```
packages/schema-contracts/
├── src/
│   ├── config/          # Configuration file schemas (sidekick.jsonc)
│   ├── session/         # Session transcript and state schemas
│   ├── features/        # Feature-specific schemas (reminders, statusline)
│   ├── ipc/             # Supervisor IPC message protocols
│   ├── prompts/         # Prompt template frontmatter schemas
│   └── index.ts         # Main export
├── scripts/
│   └── generate-schemas.ts # Build script to emit JSON Schemas
├── dist/                # Compiled JS/DTS
└── package.json
```

### 2.2 Build Pipeline
The build process is two-fold:
1.  **TypeScript Compilation**: `tsc` generates `.d.ts` and `.js` files for internal package consumption.
2.  **Schema Generation**: A custom script (`scripts/generate-schemas.ts`) iterates over exported Zod schemas and uses `zod-to-json-schema` to write `.json` files to:
    - `dist/schemas/` (for npm distribution)
    - `../../assets/sidekick/schemas/` (authoritative source for the repo)

## 3. Core Schemas

### 3.1 Configuration (`src/config/`)
Defines the structure of `sidekick.jsonc`.
- **User Config**: Global settings (LLM provider keys, default model, telemetry opt-out).
- **Project Config**: Per-project overrides (enabled features, project-specific prompt variables).

**Key Fields**:
- `llm`: `{ provider: "claude-cli" | "openai" | "openrouter" | "custom", model: string, ... }`
- `features`: `{ [featureName]: { enabled: boolean, ...config } }`
- `logging`: `{ level: "debug" | "info", redactor: string[] }`

### 3.2 Session & State (`src/session/`)
Defines the structure of session files and shared state.
- **Session State**: The runtime state of the current session.
- **Transcript**: The conversation history format (if standardized beyond raw text).

**Key Fields**:
- `sessionId`: UUID
- `startTime`: ISO8601
- `messages`: Array of standardized message objects (User, Assistant, Tool).

### 3.3 IPC Protocol (`src/ipc/`)
Defines the contract between the CLI (client) and the Background Supervisor (server).
- **Transport**: Unix Domain Socket (or Named Pipe on Windows).
- **Format**: JSON-RPC 2.0 style messages.

**Schema**:
```typescript
type IpcMessage = 
  | { type: 'REQUEST', id: string, method: string, params: any }
  | { type: 'RESPONSE', id: string, result?: any, error?: any }
  | { type: 'EVENT', event: string, payload: any };
```

### 3.4 Feature Contracts (`src/features/`)
Each feature (Reminders, Statusline) defines its data models here.
- **Reminders**: `{ id: string, dueAt: string, content: string, status: 'pending' | 'fired' }`
- **Statusline**: `{ components: string[], refreshInterval: number }`

### 3.5 Prompt Frontmatter (`src/prompts/`)
Defines the YAML frontmatter allowed in `.prompt.txt` files.
- `description`: String
- `variables`: Array of required variable names.
- `temperature`: Number (0-1)
- `tools`: List of allowed tools.

## 4. Asset Synchronization

To ensure `assets/sidekick` remains the canonical source for non-TypeScript tools:
1.  **Development**: When schemas are modified in `src/`, the developer runs `pnpm build`.
2.  **Generation**: The build script updates `assets/sidekick/schemas/*.json`.
3.  **Commit**: These JSON files are committed to git, allowing Python tools to read them directly without needing a Node.js build step.

## 5. Versioning Strategy

- **Semantic Versioning**: The package follows SemVer.
- **Breaking Changes**: Changes to Zod schemas that reject previously valid data are **major** changes.
- **Lockstep**: Since this is a monorepo, `sidekick-core` and `schema-contracts` are versioned and released together.

## 6. Recommendations & Open Decisions

### 6.1 Config Schema Location
**Decision**: Keep the *Zod definition* in `schema-contracts`. `sidekick-core` imports it to validate loaded config. This prevents circular dependencies and allows standalone validation tools.

### 6.2 IPC Transport
**Decision**: Use Node.js native `net` module with **Unix Domain Sockets** (Linux/macOS) or **Named Pipes** (Windows) using **Newline Delimited JSON (NDJSON)**.

**Options Considered**:
1.  **Raw `net` Sockets (Selected)**:
    *   *Pros*: Zero dependencies, lowest latency, standard Node.js API, simple text-based protocol (NDJSON) is easy to debug.
    *   *Cons*: Requires implementing simple framing (splitting by `\n`) and manual reconnection logic.
2.  **`node-ipc`**:
    *   *Pros*: Handles reconnection, broadcasting, and complex eventing out of the box.
    *   *Cons*: External dependency (violates "No Unnecessary Code"), history of supply chain security issues, overkill for a simple 1:1 Supervisor-CLI relationship.
3.  **HTTP over UDS**:
    *   *Pros*: Familiar request/response model, easy to debug with `curl --unix-socket`.
    *   *Cons*: HTTP header overhead is unnecessary for high-frequency internal ops, stateless nature doesn't map as well to "event subscription" without SSE/WebSockets.

**Rationale**:
The "Sidekick" philosophy prioritizes **Simplicity** and **No Unnecessary Code**. A raw socket server in the supervisor that listens for `\n`-terminated JSON objects is <50 lines of code. It avoids the bloat of HTTP and the risk of external IPC libraries. Since we control both client (`sidekick-core`) and server (Supervisor), we can enforce a strict schema without needing protocol negotiation.

### 6.3 Concurrency & Scope (Addressing Multiple Sessions)
To satisfy the **Single Writer** principle (Target Arch §3.3), the Supervisor must be a **Singleton per Project**. Multiple terminal windows (sessions) within the same project connect to the *same* Supervisor instance.

-   **Socket Resolution**: The socket path is derived from a stable hash of the project root path (e.g., `~/.sidekick/ipc/proj-<hash>.sock`). This ensures all sessions in the project discover the same supervisor.
-   **Multiplexing**: The `net.Server` handles concurrent connections from multiple CLI processes.
-   **Session Context**: Every IPC request must include the `sessionId` so the Supervisor knows which context the request originates from.

**Updated IPC Schema**:
```typescript
type IpcMessage = 
  | { type: 'REQUEST', id: string, sessionId: string, method: string, params: any }
  | { type: 'RESPONSE', id: string, result?: any, error?: any }
  | { type: 'EVENT', event: string, payload: any }; // Events can be broadcast or targeted
```

### 6.4 Strictness
**Decision**: Use `z.strict()` by default for all schemas to prevent "config sprawl" where users add unknown keys that are silently ignored.
