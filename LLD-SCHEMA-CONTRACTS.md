# Schema & Assets

## Scope

`schema-contracts`, Zod schemas, TypeScript definitions, static asset resolution (`assets/sidekick`), compatibility.

## Outstanding Questions / Concerns

- **Generation Pipeline**: Need explicit steps for generating TS types + JSON Schema, including tooling (e.g., `ts-json-schema-generator`) and how outputs sync with Python tools.
- **Versioning Strategy**: Define how breaking schema changes are communicated to downstream packages and external tooling; consider semantic versioning or manifest hash.
- **Asset Packaging**: Clarify how prompts/templates move from `assets/sidekick` into npm distributions and installer rsync flows (respecting timestamp constraints from `AGENTS.md`).
- **Testing**: Specify snapshot/golden tests ensuring schema assets stay aligned with runtime expectations.
