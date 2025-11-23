# LLM Providers

## Scope

LLM adapters (Claude, OpenAI, OpenRouter, etc.), leveraging circuit breakers, timeouts, failovers, and retry logic.

## Outstanding Questions / Concerns

- **Adapter Interface**: Need canonical TypeScript interface (request/response types, streaming contract) so feature packages share expectations.
- **Credential Sourcing**: Clarify how providers obtain API keys—config fields vs environment variables—and how secrets are redacted from logs.
- **Circuit Breaker State**: Decide whether breaker metrics live inside the supervisor (single writer) or in-process within each adapter.
- **Failover Policy**: Document how we pick fallback providers/models when a request fails, including user-configurable ordering.
- **Shared HTTP Client**: Determine whether adapters reuse a common fetch/agent with telemetry hooks to avoid inconsistent instrumentation.
