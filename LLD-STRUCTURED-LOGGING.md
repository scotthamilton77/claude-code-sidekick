# Structured Logging & Telemetry

## Scope

Placeholder for the observability stack LLD. Captures `pino` logging conventions, telemetry events, correlation IDs, and exporter strategy across CLI, supervisor, and features.

## To Be Defined

- Core logging interface exposed by `sidekick-core` and how features obtain scoped loggers.
- Metric event schema (counters, timers) and how they are emitted/consumed.
- Log routing for interactive vs hook mode, including dual-scope file destinations.
- Redaction policy for sensitive data (API keys, user prompts).
