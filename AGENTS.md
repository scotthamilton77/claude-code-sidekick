# AGENTS.md

## Role

TypeScript/Bash developer for Claude Code hooks system (Sidekick).

## Constraints [PRESERVE]

- **No backward compatibility**: Single-user project, breaking changes allowed
- **Dual-scope**: Must work identically in `.claude/` and `~/.claude/`
- **Sidekick Install authorization**: Do not install or uninstall sidekick unless user message contains exact word "install" or "uninstall"
- **Timestamp sync**: Preserve file timestamps when copying (install, runtime)
- **Hook changes**: Require `claude --continue` restart
- **LLM tests**: Provider tests excluded from default runs (expensive API calls)

## Critical Directives

- **Architecture questions**: Cite `docs/ARCHITECTURE.md §N` or `docs/design/FOO.md §N`—don't guess
- **Verification**: Run `pnpm build && pnpm typecheck` before completion—build excludes test files

## Project Structure

```
src/sidekick/           # LEGACY CODE - WILL EVENTUALLY BE DELETED

scripts/
├── install.sh          # Deploy --user, --project, or --both
├── dev-mode.sh         # enable|disable|status|clean
├── dev-hooks/          # Thin wrappers → workspace CLI
├── analyze-session-at-line.sh  # Surgical session debug
├── simulate-session.py         # Session simulation
└── tests/              # run-unit-tests.sh (mocked, free)

packages/               # Node/TS migration workspace (see docs/ARCHITECTURE.md)
├── types/             # Shared TypeScript types (leaf dependency)
├── sidekick-core/     # Core runtime: config, logging, IPC, transcript, services
├── shared-providers/  # LLM provider abstractions (OpenRouter default)
├── testing-fixtures/  # Test utilities and mocks
├── feature-reminders/ # Reminder staging/consumption (pause-and-reflect, verify-completion)
├── feature-session-summary/ # LLM-based conversation analysis
├── feature-statusline/ # Token tracking, context bar, git branch display
├── sidekick-supervisor/ # Orchestration: session management, context metrics
├── sidekick-cli/      # CLI wrapper and hook dispatcher
└── sidekick-ui/       # Monitoring UI (React SPA mockup)

assets/sidekick/defaults/  # External YAML defaults (see README.md inside)
├── core.defaults.yaml     # logging, paths, supervisor, ipc
├── llm.defaults.yaml      # provider, model, temperature
├── transcript.defaults.yaml
└── features/              # Feature-specific defaults

benchmark-next/         # ⚠️ STALE—see benchmark-next/AGENTS.md
```

## Dev-Mode

Test TS CLI without install: `scripts/dev-mode.sh enable` (requires `pnpm build` first, restart Claude Code after).

## Sandbox Mode Testing

Development is done in Claude Code sandbox mode. Some tests require operations the sandbox blocks:

| Package | Tests | Failure Reason |
|---------|-------|----------------|
| `@sidekick/core` | `ipc.test.ts`, `ipc-service.test.ts`, `supervisor-client.test.ts` | Unix socket `listen()` blocked (`EPERM`) |

**Run @sidekick/core with IPC tests excluded:**
```bash
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,supervisor-client}.test.ts'
```

**Run all tests** (requires user to run manually outside sandbox):
```bash
INTEGRATION_TESTS=1 pnpm test
```

## TypeScript Tooling [PRESERVE]

Post-training-cutoff versions—use context7 for current docs:

**Versions**: eslint 9.39.1, typescript-eslint 8.48.0, typescript 5.9.3

**ESLint v9 Flat Config** (Claude trained on legacy `.eslintrc.*`):
- Config: `eslint.config.js` with `export default []`
- `extends` → `...tseslint.configs.recommended`
- `plugins` → object: `plugins: { '@typescript-eslint': tseslint }`
- `parser` → `languageOptions: { parser }`
- `parserOptions.project` → `languageOptions.parserOptions.projectService: true`
- `ignorePatterns` → `ignores: []` in dedicated config object
- `overrides` → separate config objects with `files: []` property
- Root `package.json` requires `"type": "module"` for ESM config

**v7 → v8 Breaking Changes**:

| v7 | v8 Replacement |
|----|----------------|
| `ban-types` | Split → `no-restricted-types`, `no-empty-object-type`, `no-unsafe-function-type`, `no-wrapper-object-types` |
| `no-throw-literal` | `only-throw-error` |
| `no-var-requires` | `no-require-imports` |
| `no-useless-template-literals` | `no-unnecessary-template-expression` |
| `prefer-ts-expect-error` | `ban-ts-comment` |
| `EXPERIMENTAL_useProjectService` | `projectService` |
| `automaticSingleRunInference` (opt-in) | `disallowAutomaticSingleRunInference` (opt-out) |
| `node.typeParameter.constraint/name` | `node.constraint` / `node.key` (mapped type AST) |
| `node.members` | `node.body.members` (enum AST) |
| Min TS >=4.7.4 | >=4.8.4 |
| Min ESLint ^8.56.0 | ^8.57.0 |

**New Rules (post-Jan 2025)**: `no-misused-spread` (v8.20), `no-unnecessary-type-conversion` (v8.32), `no-unused-private-class-members` (v8.47)

**Behavior Changes**:

- `prefer-nullish-coalescing`: Now ignores conditional tests by default
- Dot-directories (`.foo/`) matched by default in `parserOptions.project` globs
