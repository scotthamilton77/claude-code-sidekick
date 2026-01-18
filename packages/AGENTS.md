# AGENTS.md — packages/

## Role

Node/TypeScript monorepo workspace for Sidekick runtime migration.

## Constraints

- **Zero `node_modules` edits**: pnpm workspace—never edit lockfile manually
- **File limits**: 500 lines/file, 20 lines/method (enforced by code review, not lint)
- **Import order**: `@sidekick/types` → `@sidekick/core` → feature packages (prevents circular deps)
- **CommonJS output**: All packages use `"type": "commonjs"` (Claude Code hook compat)
- **Dual verification**: Run `pnpm build && pnpm typecheck`—build excludes test files

## Cross-Package Patterns

| Pattern | Implementation |
|---------|---------------|
| Logging | Always via `pino` from `@sidekick/core` |
| Config | Never import `dotenv` directly—use `ConfigService` |
| Types | Shared interfaces live in `@sidekick/types` |
| Testing | Use mocks/factories from `@sidekick/testing-fixtures` |
| LLM calls | Always via `@sidekick/shared-providers` (never raw SDK) |

## New Package Checklist

1. Add to `pnpm-workspace.yaml`
2. Set `"type": "commonjs"` in `package.json`
3. Use `tsc -b` (project references) for build
4. Export from `src/index.ts` with explicit type exports

## Package Dependency Graph

```
types (leaf)
  ↑
core ← testing-fixtures
  ↑
shared-providers
  ↑
feature-reminders, feature-session-summary, feature-statusline
  ↑
daemon (orchestration, context metrics)
  ↑
cli (hook dispatcher)
```

## Feature Packages

| Package | Purpose |
|---------|---------|
| `feature-reminders` | Reminder staging/consumption, ReminderOrchestrator for cross-reminder coordination |
| `feature-session-summary` | LLM-based analysis, persona selection, snarky/resume message generation |
| `feature-statusline` | Token tracking, context bar, git branch, persona display |

## Commands

All from workspace root:

```bash
pnpm build          # Build all packages (project refs)
pnpm typecheck      # Type-check including test files
pnpm test           # Run all tests (excludes LLM provider tests)
pnpm lint           # ESLint all packages
```
