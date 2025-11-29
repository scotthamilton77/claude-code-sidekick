# AGENTS.md

## Role

Bash expert for dual-scope Claude Code hooks system (Sidekick), transitioning to Node/TypeScript runtime.

**Current**: Bash runtime (`src/sidekick/`). Migration planned per `TARGET-ARCHITECTURE.md` and `TARGET-IMPLEMENTATION-PLAN.md`.

## Constraints [PRESERVE]

- **No backward compatibility**: Single-user project, breaking changes allowed
- **Dual-scope testing**: Must work identically in `.claude/` and `~/.claude/` contexts
- **Install authorization**: Abort unless user message contains exact word "install" or "uninstall"
- **Timestamp sync**: Sync file timestamps when copying files (install, runtime)
- **Restart required**: Hook changes require `claude --continue` restart
- **LLM test isolation**: Provider tests excluded from default runs (expensive API calls)
- **Zod version conflict**: `openai@4.x` wants `zod@^3.23.8`, workspace uses `zod@^4.1.13`—accept warning until OpenAI 6.x

## Critical Directives

- **Architecture questions**: Cite `TARGET-ARCHITECTURE.md:<section>`, don't guess

## Project Structure

```
src/sidekick/           # Source (edit here)
├── features/*.sh       # Plugins (add features here)
├── handlers/*.sh       # Framework (NEVER edit)
├── lib/*.sh            # Shared libs
└── *.defaults          # Config domains (4 files)

scripts/
├── install.sh          # Deploy --user, --project, or --both
├── analyze-session-at-line.sh  # Surgical session debug
├── simulate-session.py         # Session simulation
└── tests/              # run-unit-tests.sh (mocked, free)

packages/               # Node/TS migration workspace (see TARGET-ARCHITECTURE.md)
├── sidekick-core/     # Core runtime library
├── sidekick-supervisor/ # Orchestration layer
├── sidekick-cli/      # CLI wrapper
├── sidekick-ui/       # Monitoring UI (React SPA mockup)
├── shared-providers/  # LLM provider abstractions
├── testing-fixtures/  # Test utilities
└── types/             # Shared TypeScript types

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

⚠️ Run **both** `pnpm build` AND `pnpm typecheck` before completion—build excludes test files.

## Reference Docs

| Doc | Purpose |
|-----|---------|
| `TARGET-ARCHITECTURE.md` | Target Node rewrite architecture |
| `TARGET-IMPLEMENTATION-PLAN.md` | Phased migration roadmap |
| `README.md` | Current Bash runtime user guide |

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
