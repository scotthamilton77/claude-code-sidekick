# AGENTS.md

## Role

Bash expert for dual-scope Claude Code hooks system (Sidekick), transitioning to Node/TypeScript runtime.

**Current**: Bash runtime (`src/sidekick/`). Migration planned per `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.

## Constraints [PRESERVE]

- **No backward compatibility**: Single-user project, breaking changes allowed
- **Dual-scope testing**: Must work identically in `.claude/` and `~/.claude/` contexts
- **Install authorization**: Abort unless user message contains exact word "install" or "uninstall"
- **Timestamp sync**: Sync file timestamps when copying files (install, runtime)
- **Restart required**: Hook changes require `claude --continue` restart
- **LLM test isolation**: Provider tests excluded from default runs (expensive API calls)
- **Zod version conflict**: `openai@4.x` wants `zod@^3.23.8`, workspace uses `zod@^4.1.13`—accept warning until OpenAI 6.x

## Critical Directives

- **Architecture questions**: Cite `docs/ARCHITECTURE.md §N` or `docs/design/FOO.md §N`, don't guess

## Project Structure

```
src/sidekick/           # Source (edit here)
├── features/*.sh       # Plugins (add features here)
├── handlers/*.sh       # Framework (NEVER edit)
├── lib/*.sh            # Shared libs
└── *.defaults          # Config domains (4 files)

scripts/
├── install.sh          # Deploy --user, --project, or --both
├── dev-mode.sh         # Toggle dev-mode hooks (see below)
├── dev-hooks/          # Thin wrappers → workspace CLI
├── analyze-session-at-line.sh  # Surgical session debug
├── simulate-session.py         # Session simulation
└── tests/              # run-unit-tests.sh (mocked, free)

packages/               # Node/TS migration workspace (see docs/ARCHITECTURE.md)
├── sidekick-core/     # Core runtime library
├── sidekick-supervisor/ # Orchestration layer
├── sidekick-cli/      # CLI wrapper
├── sidekick-ui/       # Monitoring UI (React SPA mockup)
├── shared-providers/  # LLM provider abstractions
├── testing-fixtures/  # Test utilities
└── types/             # Shared TypeScript types

assets/sidekick/defaults/  # External YAML defaults (see README.md inside)
├── core.defaults.yaml     # logging, paths, supervisor, ipc
├── llm.defaults.yaml      # provider, model, temperature
├── transcript.defaults.yaml
└── features/              # Feature-specific defaults

benchmark-next/         # ⚠️ STALE—see benchmark-next/AGENTS.md
```

## Commands

| Task | Command |
|------|---------|
| Build | `pnpm build` (from root, never bare `tsc`) |
| Typecheck (incl tests) | `pnpm typecheck` |
| Lint | `pnpm lint` (zero warnings) |
| Coverage | `pnpm test:coverage` |
| Clean artifacts | `find packages/*/src \( -name "*.js" -o -name "*.d.ts" \) -delete` |
| Dev-mode enable | `scripts/dev-mode.sh enable` |
| Dev-mode disable | `scripts/dev-mode.sh disable` |
| Dev-mode status | `scripts/dev-mode.sh status` |
| Dev-mode clean | `scripts/dev-mode.sh clean` (truncate logs, kill supervisor, check zombies) |

⚠️ Run **both** `pnpm build` AND `pnpm typecheck` before completion—build excludes test files.

## Dev-Mode Testing

Dev-mode allows testing the TypeScript CLI (`packages/sidekick-cli/dist/bin.js`) without a full install. It registers hooks in `.claude/settings.local.json` pointing to `scripts/dev-hooks/`, which delegate to the workspace CLI.

**Enable**: `scripts/dev-mode.sh enable` → registers all 7 hooks + statusline
**Disable**: `scripts/dev-mode.sh disable` → removes dev hooks
**Check status**: `scripts/dev-mode.sh status` → shows enabled/disabled + CLI build state

**How to tell if enabled**:
- Run `scripts/dev-mode.sh status` (shows `Dev-mode: ENABLED/DISABLED`)
- Check `.claude/settings.local.json` for hooks containing `dev-hooks` in path

**Prerequisites**: `pnpm build` (CLI must be built). After enable/disable, restart Claude Code.

## Reference Docs

```
docs/
├── ARCHITECTURE.md        # High-level target architecture
├── ROADMAP.md             # Phased migration roadmap (task tracking)
└── design/                # Low-level design specifications
    ├── CLI.md             # CLI framework, hook dispatcher
    ├── CONFIG-SYSTEM.md   # Configuration cascade, YAML schemas
    ├── CORE-RUNTIME.md    # RuntimeContext, services, bootstrap
    ├── SUPERVISOR.md      # Background process, IPC, state mgmt
    ├── TRANSCRIPT-PROCESSING.md  # TranscriptService, metrics
    ├── STRUCTURED-LOGGING.md     # Pino logging, event schema
    ├── SCHEMA-CONTRACTS.md       # Zod schemas, type contracts
    ├── LLM-PROVIDERS.md          # Provider adapters, retry/fallback
    ├── TEST-FIXTURES.md          # Mocks, factories, test harnesses
    ├── flow.md                   # Complete event flows
    └── FEATURE-*.md              # Feature-specific designs
```

## TypeScript Tooling [PRESERVE]

Post-training-cutoff versions—use context7 for current docs:

**Explicit Versions**: eslint 9.39.1, typescript-eslint 8.48.0, typescript 5.9.3

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
