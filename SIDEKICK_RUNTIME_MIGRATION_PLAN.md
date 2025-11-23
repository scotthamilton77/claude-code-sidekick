# Sidekick Runtime Migration Plan

_Last updated: 2025-11-23_

## 1. Context & Pain Points

- Session-summary excerpts exceed 66k tokens, causing `jq`/ARG_MAX failures in Bash pipelines and blocking dependent features like snarky resumes (`README.md`, lines 18-29).
- Sidekick must keep identical behavior in user (`~/.claude`) and project (`.claude/`) scopes with strict installer/uninstaller safety checks (`ARCH.md`, `scripts/uninstall.sh`).
- Bash-driven plugin orchestration, logging, and JSON handling add brittleness, inhibit unit testing, and make large-refactor work (e.g., personas, log rotation) risky.
- Track 2 already targets a TypeScript rewrite for benchmarking (`benchmark-next/README.md`), showing appetite for a typed, modern toolchain.

## 2. Goals

1. **Reliability** – Stream multi-100k token transcripts without CLI argument limits while preserving current hook semantics.
2. **Developer Scalability** – Adopt a maintainable language/tooling stack with first-class testing, logging, and dependency management.
3. **Packaging Simplicity** – Provide a project-scoped CLI first (Option A), with a clear path to optional user/global installs later.
4. **Compatibility** – Maintain config cascade, plugin toggles, and existing hook commands during the transition.
5. **Observability** – Improve logging/metrics to debug long-running background work (session summary, reminders, resume).

## 3. Candidate Stack Overview

| Stack                     | Packaging Expectation                                                              | Strengths                                                                                                                      | Concerns                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Python + uv**           | `uv run sidekick ...` for project scope; `uv tool install` for optional user scope | Native streaming IO, excellent text/JSON tooling, already used in repo (`scripts/simulate-session.py`), easy to wrap Bash shim | Need to mirror plugin loader + config cascade; dual-distribution story relies on uv adoption; TypeScript investments stay siloed |
| **Node/TypeScript + npx** | `npx @sidekick/cli ...` for project scope; `npm i -g` for optional user scope      | Aligns with `benchmark-next` roadmap, shared provider abstractions, type safety, async orchestration, huge ecosystem           | Requires disciplined packaging (TS->JS build), CLI bootstrap for Bash hooks, Node runtime dependency everywhere                  |

## 4. Recommendation Snapshot

- **Primary Track**: Proceed with **Node/TypeScript** CLI targeting Option A (project-scoped `npx` entry) to capitalize on Track 2 momentum and deliver a single modern runtime across benchmarking + hooks.
- **Fallback Track**: Maintain a lightweight **Python+uv** prototype plan in case Node integration uncovers blockers (e.g., deployment restrictions, performance gaps).

## 5. Phased Plan (Project-Scope First)

### Phase 0 – Alignment & Design (Week 0)

- ✅ Document pain points & success criteria (this plan).
- Review `ARCH.md` + `CLAUDE.md` constraints with maintainers to confirm no hidden blockers for a Node CLI.
- Decide repo layout (e.g., `packages/sidekick-cli`) and agree on shared coding standards with `benchmark-next`.

### Phase 1 – Minimal Runnable Prototype (Weeks 1-2)

1. **Bootstrap Package**
   - Scaffold TS project (tsconfig, eslint) co-located with `benchmark-next` tooling or new `packages/` folder.
   - **Reuse `benchmark-next` Core**: Extract `src/lib/` from `benchmark-next` into `packages/sidekick-core` to jumpstart config, logging, and LLM providers.
   - Implement entry command `sidekick runtime-check` stub runnable via `npx ts-node` for local dev.
2. **Transcription Pipeline Spike**
   - Re-implement `_session_summary_extract_excerpt` in TS using streaming file reads to prove resolution of ARG_MAX issue (leverage `benchmark-next/src/lib/transcript`).
   - Compare output parity against existing Bash for regression confidence.
3. **Hook Shim**
   - Wrap existing `sidekick.sh` to call `node dist/cli.js <command>` when present, falling back to Bash behavior otherwise (toggle via env). This keeps install/uninstall unchanged for now.

### Phase 2 – Feature Parity Slice (Weeks 3-5)

1. **Configuration Loader**
   - Adapt `benchmark-next` config loader to support full Sidekick cascade (parse `.defaults` and `.conf` via shell-compatible parser or convert to TOML/JSON internally).
2. **Plugin Loader Bridge**
   - Introduce a TS plugin registry mirroring `features/*.sh` contracts; initially load only `session-summary` logic.
3. **LLM Invocation Module**
   - Reuse provider design from `benchmark-next` (Claude CLI, OpenAI, OpenRouter); ensure isolation behavior matches Bash implementation.
4. **Logging & Telemetry**
   - Adopt `pino` logging from `benchmark-next` with file + console targets; map to existing `.sidekick/sessions/<id>/sidekick.log` layout.

### Phase 3 – Project-Scope Pilot (Weeks 6-7)

- Run hooks via new CLI inside this repo only (Option A).
- Regression checklist: session summary freshness, reminders cadence, statusline output, resume generation, uninstall script safety.
- Capture metrics vs. Bash (latency per hook, memory footprint).

### Phase 4 – User-Scope Rollout Readiness (Weeks 8-9)

- Package CLI for `npm publish` with dual install instructions (`npx` project / `npm i -g`).
- Update `scripts/install.sh` / `scripts/uninstall.sh` to detect Node CLI and manage symlinks/copies safely.
- Write migration guide + fallback instructions (how to opt out back to Bash).

### Phase 5 – Fallback & Contingency Actions (Parallel)

- Stand up Python+uv prototype for session-summary streaming so the core blocker (ARG_MAX) has a proven escape hatch.
- Maintain compatibility tests ensuring Bash, Node, and Python shims can co-exist until rollout completes.

## 6. Workstreams & Owners (TBD)

1. **Runtime & Packaging** – Scaffold TS CLI, build pipeline, lint/test automation.
2. **Feature Porting** – Incrementally port plugins (session-summary → resume → reminders → statusline).
3. **DevEx & Docs** – Update `README.md`, `ARCH.md`, and add CLI docs; capture uv fallback instructions.
4. **Testing & Tooling** – Extend unit/integration tests to cover new runtime (Vitest + existing bash harnesses).
5. **Rollout & Support** – Coordinate pilot, gather feedback, manage toggle flags.

## 7. Risks & Mitigations

- **Dual Runtime Drift**: Bash + Node implementations diverge → enforce shared fixture tests and scriptable parity checks.
- **Node Dependency Footprint**: Some environments may lack Node 20+ → document install steps, keep Bash shim as fallback.
- **Config Parsing Differences**: Shell-style `.conf` files may include advanced constructs → create parser tests using current fixtures before switching.
- **Timeline Pressure**: Large scope; keep milestone reviews at each phase to allow pivot to Python+uv fallback if needed.

## 8. Open Questions

1. When should we commit to removing Bash entirely vs. leaving it as a long-term fallback?
2. Do we need to align CLI versioning with `benchmark-next`, or can Sidekick ship independently?
3. What telemetry (if any) is acceptable for measuring adoption/performance within user workspaces?

## 9. Immediate Next Steps

1. Confirm stakeholder agreement on this phased plan and Node-first approach.
2. Create repo structure for the TS CLI and wire up initial `npx` runnable command.
3. Draft acceptance criteria for the Phase 1 streaming spike (input/output parity with current Bash).
4. Schedule pilot readiness review before touching user-scope installers.
