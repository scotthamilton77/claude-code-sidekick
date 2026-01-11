# AGENTS.md — @sidekick/core

## Role

Core runtime library—config, logging, IPC, scope resolution, asset loading.

## Architecture Notes

- **Single-writer pattern**: Only `Supervisor` writes shared state; CLI reads
- **IPC**: Unix domain sockets with NDJSON protocol (see `src/ipc/`)
- **Scope resolution**: User (`~/.claude`) vs Project (`.claude`)—must behave identically

## Key Exports by Domain

| Domain | Exports |
|--------|---------|
| Config | `ConfigService`, `SidekickConfig`, `getFeature()` with nested config |
| IPC | `IpcClient`, `IpcServer`, `IpcService`, path helpers |
| Logging | `createLogManager`, `createLoggerFacade`, runtime level changes |
| Assets | `assetResolver`, scope-aware file loading, `resolveYaml()` |
| Transcript | `TranscriptService`, token tracking, `currentContextTokens` |
| Services | `ServiceFactory`, session-scoped service creation |
| Features | `FeatureRegistry`, `FeatureContext`, handler registration |

## Constraints

- **No LLM imports**: Import `LLMService` from `@sidekick/shared-providers`, not here (circular dep)
- **Type re-exports**: Always re-export types from `@sidekick/types` for consumer convenience
- **Pino only**: Never use `console.log`—all logging through `LoggerFacade`

## Transcript Structure

Claude Code transcripts are NDJSON files where each line is a JSON object representing a conversation turn or event.

### Entry Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `user` | User message (may include system injections) | `message.content` (string or content block array) |
| `assistant` | Model response | `message.content` (string or content block array) |
| `tool_use` | Tool invocation | `name`, `input` |
| `tool_result` | Tool output | `content` |
| `thinking` | Extended thinking block | `thinking` or `content` |
| `summary` | Claude Code session hint | `summary`, `leafUuid` |
| `file-history-snapshot` | Internal bookkeeping | — |

### Content Block Arrays

User/assistant `message.content` can be a string OR an array of typed blocks:
```typescript
{ type: 'text', text: '...' }           // Human/model text
{ type: 'tool_use', name: '...', ... }  // Nested tool invocation
{ type: 'tool_result', content: '...' } // Nested tool output
{ type: 'thinking', thinking: '...' }   // Nested thinking
```

### System-Injected Content

User-role messages may contain system content that isn't from the human:
- `<system-reminder>...</system-reminder>` — Sidekick/Claude Code injections
- `hook feedback:` — Hook response messages
- `<local-command-stdout>...</local-command-stdout>` — Slash command output

### Special Flags

| Flag | Meaning |
|------|---------|
| `isMeta: true` | System-injected disclaimer/caveat, not user content |
| `leafUuid` | For summaries: references the message this summary describes |
| `uuid` | Unique identifier for the entry |

## Reference

- `docs/design/CORE-RUNTIME.md` for RuntimeContext, services, bootstrap
- `docs/design/CONFIG-SYSTEM.md` for cascade order and schema
- `docs/design/STRUCTURED-LOGGING.md` for log event schema
- `docs/design/TRANSCRIPT-PROCESSING.md` for TranscriptService details
