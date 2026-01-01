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

## Reference

- `docs/design/CORE-RUNTIME.md` for RuntimeContext, services, bootstrap
- `docs/design/CONFIG-SYSTEM.md` for cascade order and schema
- `docs/design/STRUCTURED-LOGGING.md` for log event schema
