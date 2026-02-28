# LLM Providers Low-Level Design

## 1. Overview

The `shared-providers` package provides a unified, type-safe interface for interacting with various Large Language Model (LLM) providers. It leverages official open-source SDKs where available (e.g., OpenAI Node.js library) to minimize maintenance burden, while providing a consistent abstraction for the rest of the Sidekick system.

### 1.1 System Context

LLM providers operate exclusively within the **Daemon** (async side) of the CLI/Daemon architecture defined in **docs/design/flow.md §2.1**:

```
┌─────────────────────────────────────────────────────────────┐
│ Claude Code                                                 │
└─────────────────────┬───────────────────────────────────────┘
                      │ Hook invocation
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ CLI (synchronous)                                           │
│  • Reads staged files                                       │
│  • Returns hook responses                                   │
│  • NO LLM calls                                             │
└─────────────────────┬───────────────────────────────────────┘
                      │ IPC event
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Daemon (asynchronous)                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Handler Registry                                       │ │
│  │  ├─ UpdateSessionSummary ──► LLMProvider.complete()    │ │
│  │  ├─ [Future features]   ──► LLMProvider.complete()     │ │
│  │  └─ ...                                                │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ProviderFactory                                        │ │
│  │  └─ Instantiated at Daemon startup                 │ │
│  │  └─ Provider instance shared via HandlerContext        │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Key Points**:

- Providers are instantiated once at Daemon startup
- Handlers access the provider via `HandlerContext.llm`
- LLM calls inherit session context for log correlation
- Provider operations are internal events (logged, don't trigger handlers)

## 2. Core Architecture

### 2.1 Design Principles

- **Unified Interface**: All providers implement a strict `LLMProvider` interface.
- **SDK Leverage**: Use official SDKs (e.g., `openai` npm package) for OpenAI and OpenRouter.
- **Statelessness**: Providers are stateless; configuration and session context are injected per-call.
- **Resilience**: Rely on SDK built-in retries where available; implement simple fallbacks for high availability.
- **Observability**: Deep integration with structured logging per **docs/design/STRUCTURED-LOGGING.md**.
- **Event Model Alignment**: Providers emit internal events only (per **docs/design/flow.md §3.1**)—logged for observability but non-recursive (don't trigger handlers).

### 2.2 Package Structure

```
packages/shared-providers/
├── src/
│   ├── index.ts              # Public API exports
│   ├── factory.ts            # ProviderFactory for instantiating providers
│   ├── profile-factory.ts    # ProfileProviderFactory (profile-based provider creation)
│   ├── errors.ts             # Standardized error types
│   ├── fallback.ts           # FallbackProvider wrapper
│   ├── validation.ts         # Input validation utilities
│   ├── claude-cli-spawn.ts   # Claude CLI process spawning utilities
│   └── providers/
│       ├── base.ts           # Abstract base class (logging, redaction)
│       ├── anthropic-cli.ts  # Claude CLI wrapper implementation
│       ├── openai-native.ts  # OpenAI SDK implementation (handles OpenAI & OpenRouter)
│       └── emulators/        # Provider emulators for testing
│           ├── index.ts
│           ├── base-emulator.ts
│           ├── emulator-state.ts
│           ├── openai-emulator.ts
│           ├── openrouter-emulator.ts
│           └── claude-cli-emulator.ts
└── test/                     # Unit and integration tests
```

**Note**: Type interfaces (`LLMProvider`, `LLMRequest`, `LLMResponse`, `ProfileProviderFactory`) are defined in `packages/types/src/llm.ts`, not in the shared-providers package.

## 3. Interfaces & Types

### 3.1 `LLMProvider` Interface

```typescript
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * JSON Schema configuration for structured output.
 */
export interface JsonSchemaConfig {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface LLMRequest {
  messages: Message[];
  system?: string;          // System prompt
  model?: string;           // Override configured model
  // JSON Schema for structured output (native provider support with fallback)
  jsonSchema?: JsonSchemaConfig;
  // Flexible map for provider-specific parameters
  additionalParams?: Record<string, unknown>;
  // NOTE: temperature and maxTokens are NOT per-request.
  // They come from the profile configuration. See docs/design/LLM_PROFILES.md.
}

export interface LLMResponse {
  content: string;
  model: string;            // The actual model used
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  // Raw response for debugging/telemetry
  rawResponse: {
    status: number;
    body: string;           // JSON string of the full response
  };
}

export interface LLMProvider {
  id: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}

/**
 * Profile-based provider factory.
 * Creates providers from named profile configurations.
 */
export interface ProfileProviderFactory {
  createForProfile(profileId: string, fallbackProfileId?: string): LLMProvider;
  createDefault(): LLMProvider;
}
```

**Note**: `LLMCallContext` has been removed. Correlation context for logging is managed internally by the instrumented provider wrappers in `sidekick-core`, not passed per-request.

### 3.2 Context Propagation

Handlers invoke LLM providers with context derived from the originating event:

```typescript
// Inside a handler (e.g., UpdateSessionSummary)
async function handler(event: SidekickEvent, ctx: HandlerContext): Promise<void> {
  const response = await ctx.llm.complete({
    messages: [{ role: 'user', content: 'Summarize...' }],
    system: 'You are a session summarizer.',
    context: {
      sessionId: event.context.sessionId,
      correlationId: event.context.correlationId,
      traceId: event.context.traceId,
    },
  });
  // response.context echoes back the same IDs for downstream correlation
}
```

This enables the Monitoring UI to trace an LLM call back to its originating hook event.

## 4. Component Details

### 4.1 `ProviderFactory`

The factory is responsible for instantiating the correct provider based on configuration. It is invoked once during Daemon startup; the resulting provider instance is shared across all handlers via `HandlerContext`.

```typescript
import type { Logger } from 'pino'; // See docs/design/STRUCTURED-LOGGING.md

export class ProviderFactory {
  constructor(
    private config: Config,
    private logger: Logger
  ) {}

  create(): LLMProvider {
    const type = this.config.llm.provider;

    switch (type) {
      case 'claude-cli':
        return new AnthropicCliProvider(this.config, this.logger);
      case 'openai':
      case 'openrouter':
        // Both use the OpenAI SDK, just different base URLs/Keys
        return new OpenAINativeProvider(this.config, this.logger);
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }
}
```

**Daemon Integration** (see **docs/design/DAEMON.md**):

```typescript
// During Daemon startup
const factory = new ProviderFactory(config, logger);
const llmProvider = factory.create();

// Provider exposed to handlers via context
const handlerContext: HandlerContext = {
  llm: llmProvider,
  session: sessionState,
  transcript: transcriptService,
  // ...
};
```

### 4.2 `OpenAINativeProvider`

Uses the official `openai` Node.js library.
- **OpenRouter Support**: Configures the OpenAI client with OpenRouter's `baseURL` and API key.
- **Retries**: Configures the SDK's `maxRetries` option (default 3).
- **Mapping**: Maps `LLMRequest` to the SDK's `ChatCompletionCreateParams`.

### 4.3 `AnthropicCliProvider`

Wraps the local `claude` CLI command.
- **Mechanism**: Spawns the CLI process.
- **Retries**: Implements manual retry logic (since it's a CLI wrapper, not an SDK).

### 4.4 `FallbackProvider`

A higher-order provider that wraps a primary provider and a list of fallbacks.

```typescript
export class FallbackProvider implements LLMProvider {
  id = 'fallback-wrapper';

  constructor(
    private primary: LLMProvider,
    private fallbacks: LLMProvider[],
    private logger: Logger
  ) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    try {
      return await this.primary.complete(request);
    } catch (err) {
      this.logger.warn({ err }, 'Primary provider failed, attempting fallback');
      
      for (const provider of this.fallbacks) {
        try {
          return await provider.complete(request);
        } catch (fallbackErr) {
          this.logger.warn({ err: fallbackErr }, 'Fallback provider failed');
          // Continue to next fallback
        }
      }
      
      throw err; // All providers failed
    }
  }
}
```

## 5. Resilience & Reliability

### 5.1 Retry Strategy

- **OpenAI/OpenRouter**: We rely on the `openai` SDK's built-in retry mechanism (jittered exponential backoff) for network errors and 5xx responses.
- **Claude CLI**: We implement a simple retry loop around the child process spawn for specific exit codes or timeout errors.

### 5.2 Fallback Strategy

Instead of complex circuit breakers, we provide the `FallbackProvider` capability.
- Clients (or the Factory) can compose providers.
- Example: Configure `OpenAI` as primary, but if it fails, fall back to a lower-cost `OpenRouter` model.
- This is optional and config-driven.

## 6. Configuration & Credentials

### 6.1 Credential Precedence

Credentials are resolved in the following order:
1. **Environment Variables** (Recommended): `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (for CLI auth if needed), `OPENROUTER_API_KEY`.
2. **Configuration File**: `llm.apiKey` in `core.yaml`.

### 6.2 Redaction

The `Logger` passed to the provider MUST have a `Redactor` configured per **docs/design/STRUCTURED-LOGGING.md §4**.
- **SDK Logging**: We do NOT use SDK built-in console logging. All logs go through our structured logger to ensure redaction.
- **Request/Response Logging**: Raw payloads are redacted before logging (API keys, sensitive content patterns).

## 7. Observability

### 7.1 Internal Events

Per **docs/design/flow.md §3.1**, provider operations emit **internal events**—logged for observability but non-recursive (they don't trigger handlers). This prevents infinite loops if a handler's LLM call were to somehow trigger more handlers.

| Event             | When                          | Key Fields                                      |
| ----------------- | ----------------------------- | ----------------------------------------------- |
| `LLMCallStarted`  | Before SDK/CLI invocation     | `provider`, `model`, `sessionId`, `messageCount` |
| `LLMCallCompleted`| Successful response received  | `provider`, `model`, `sessionId`, `durationMs`, `usage` |
| `LLMCallFailed`   | Error (after retries)         | `provider`, `model`, `sessionId`, `error`, `attemptCount` |
| `LLMFallbackUsed` | Primary failed, using fallback| `primaryProvider`, `fallbackProvider`, `sessionId` |

### 7.2 Log Format

All events include correlation context from `LLMCallContext` and follow **docs/design/STRUCTURED-LOGGING.md §3.3** format:

```typescript
// Example log entry (Pino JSON)
{
  "level": 30,
  "time": 1699999999999,
  "pid": 12345,
  "name": "sidekickd",
  "msg": "LLM call completed",
  "event": "LLMCallCompleted",
  "sessionId": "abc123",
  "correlationId": "cmd-456",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "durationMs": 1234,
  "usage": { "inputTokens": 150, "outputTokens": 50 }
}
```

### 7.3 Debug Mode

When `LLM_DEBUG_DUMP_ENABLED=true`, providers write full request/response payloads to `/tmp/sidekick-llm-debug/` for debugging (redacted in production logs).

## 8. Handler Integration

### 8.1 Current Consumers

The following Daemon handlers use LLM providers:

| Handler                 | Transcript Event Trigger  | LLM Purpose                          |
| ----------------------- | ------------------------- | ------------------------------------ |
| `UpdateSessionSummary`  | `UserPrompt`, `ToolCall`  | Generate session summary, snarky message |

### 8.2 Handler Access Pattern

Handlers receive the provider via `HandlerContext` and pass event correlation context:

```typescript
// From docs/design/flow.md §2.3 handler registration
context.handlers.register({
  id: 'session-summary:update',
  priority: 80,
  filter: { kind: 'hook', hooks: ['PostToolUse'] },
  handler: async (event, ctx) => {
    const response = await ctx.llm.complete({
      messages: buildSummaryPrompt(ctx.transcript),
      context: {
        sessionId: event.context.sessionId,
        correlationId: event.context.correlationId,
      },
    });
    await ctx.session.updateSummary(response.content);
  },
});
```

### 8.3 Future Extensibility

New features requiring LLM access follow the same pattern:
1. Register handler with appropriate priority (see **docs/design/flow.md §8.2**)
2. Access provider via `ctx.llm`
3. Pass correlation context from `event.context`
4. Handle errors internally (per **docs/design/flow.md §6.2**)
