# OpenRouter Provider Routing Design

**Date**: 2026-01-18
**Status**: Approved
**Task**: claude-config-luw (10.2.1 OpenRouter Provider Routing)

## Overview

Add per-profile provider allowlist/blocklist support for OpenRouter, allowing users to control which upstream providers handle their requests.

## Configuration

Two optional fields added to LLM profiles:

```yaml
profiles:
  fast-lite:
    provider: openrouter
    model: google/gemini-2.0-flash-lite-001
    providerAllowlist: ["google"]        # Only use these providers (maps to OpenRouter's "only")
    providerBlocklist: ["deepinfra"]     # Never use these providers (maps to OpenRouter's "ignore")
```

**Rules**:
- Both fields are optional arrays of strings (OpenRouter provider names)
- If `providerAllowlist` is set, only those providers are used
- If `providerBlocklist` is set, those providers are excluded
- Both can be set together (allowlist takes precedence, blocklist filters within)
- Only applies when `provider: openrouter` - ignored for other providers

## Implementation

### Files Changed

1. **`packages/types/src/llm.ts`** - Add types for provider routing fields
2. **`packages/shared-providers/src/providers/openai-native.ts`** - Handle provider routing in requests
3. **`packages/shared-providers/src/factory.ts`** - Pass config through to provider

### API Mapping

Configuration fields map to OpenRouter's `provider` object:

| Config Field | OpenRouter Field |
|--------------|------------------|
| `providerAllowlist` | `provider.only` |
| `providerBlocklist` | `provider.ignore` |

### Request Injection

The `provider` object is injected into API requests when either field is configured:

```typescript
// In OpenAINativeProvider.complete()
const providerRouting = this.buildProviderRouting()
// Returns { provider: { only: [...], ignore: [...] } } or {}

const completion = await this.client.chat.completions.create({
  model,
  messages,
  ...providerRouting,
  ...request.additionalParams,
})
```

## Testing

- Unit tests verify `provider` object construction
- Unit tests verify empty object when no routing configured
- Integration tests (manual) verify OpenRouter accepts the parameters

## References

- [OpenRouter Provider Routing Docs](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter API Parameters](https://openrouter.ai/docs/api/reference/parameters)
