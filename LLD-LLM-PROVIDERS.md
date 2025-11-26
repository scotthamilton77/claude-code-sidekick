# LLM Providers Low-Level Design

## 1. Overview

The `shared-providers` package provides a unified, type-safe interface for interacting with various Large Language Model (LLM) providers. It leverages official open-source SDKs where available (e.g., OpenAI Node.js library) to minimize maintenance burden, while providing a consistent abstraction for the rest of the Sidekick system.

## 2. Core Architecture

### 2.1 Design Principles

- **Unified Interface**: All providers implement a strict `LLMProvider` interface.
- **SDK Leverage**: Use official SDKs (e.g., `openai` npm package) for OpenAI and OpenRouter.
- **Statelessness**: The providers themselves are stateless; configuration is injected.
- **Resilience**: Rely on SDK built-in retries where available; implement simple fallbacks for high availability.
- **Observability**: Deep integration with the structured logging and redaction system.

### 2.2 Package Structure

```
packages/shared-providers/
├── src/
│   ├── index.ts            # Public API exports
│   ├── interface.ts        # LLMProvider, LLMRequest, LLMResponse types
│   ├── factory.ts          # ProviderFactory for instantiating providers
│   ├── errors.ts           # Standardized error types
│   ├── fallback.ts         # FallbackProvider wrapper
│   └── providers/
│       ├── base.ts         # Abstract base class (logging, redaction)
│       ├── anthropic-cli.ts # Claude CLI wrapper implementation
│       ├── openai-native.ts # OpenAI SDK implementation (handles OpenAI & OpenRouter)
└── test/                   # Unit and integration tests
```

## 3. Interfaces & Types

### 3.1 `LLMProvider` Interface

```typescript
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMRequest {
  messages: Message[];
  system?: string; // System prompt
  model?: string;  // Override configured model
  temperature?: number;
  maxTokens?: number;
  // Flexible map for provider-specific parameters (e.g. top_p, frequency_penalty)
  additionalParams?: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  model: string;   // The actual model used
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  // Raw response for debugging/telemetry
  rawResponse: {
    status: number;
    body: string; // JSON string of the full response
  };
}

export interface LLMProvider {
  /**
   * Unique identifier for the provider (e.g., "openai")
   */
  id: string;

  /**
   * Send a completion request to the LLM.
   */
  complete(request: LLMRequest): Promise<LLMResponse>;
}
```

## 4. Component Details

### 4.1 `ProviderFactory`

The factory is responsible for instantiating the correct provider based on the configuration.

```typescript
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
1.  **Environment Variables** (Recommended): `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (for CLI auth if needed), `OPENROUTER_API_KEY`.
2.  **Configuration File**: `llm.apiKey` in `config.jsonc`.

### 6.2 Redaction

The `Logger` passed to the provider MUST have a `Redactor` configured.
- **SDK Logging**: We will NOT use the SDK's built-in console logging. We will capture errors and log them via our structured logger to ensure redaction.
