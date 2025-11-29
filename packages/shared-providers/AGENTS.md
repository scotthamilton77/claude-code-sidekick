# AGENTS.md — @sidekick/shared-providers

## Role

LLM provider abstraction layer—unified interface for OpenAI, OpenRouter, Anthropic CLI.

## Architecture

```
ProviderFactory → AbstractProvider → (OpenAINativeProvider | AnthropicCliProvider)
       ↓
  FallbackProvider (chains multiple providers)
       ↓
    LLMService (high-level wrapper with telemetry)
```

## Constraints

- **Tests excluded by default**: Provider tests make real API calls—run explicitly with `pnpm test --include-llm`
- **Zod version conflict**: `openai@4.x` requires `zod@^3.23.8`, workspace uses `zod@^4.1.13`—warning expected until OpenAI 6.x
- **No direct SDK usage elsewhere**: All LLM calls in other packages must go through `LLMService`
- **Error hierarchy**: `ProviderError` → `RateLimitError`, `AuthError`, `TimeoutError`

## Adding a Provider

1. Extend `AbstractProvider` in `src/providers/`
2. Implement `complete(request: LLMRequest): Promise<LLMResponse>`
3. Add to `ProviderFactory.create()` switch
4. Add integration test (tagged `@llm` for exclusion)

## Reference

- `docs/design/LLM-PROVIDERS.md` for retry/fallback semantics
