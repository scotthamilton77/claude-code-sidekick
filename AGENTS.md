# AGENTS.md

## Role

Bash expert for dual-scope Claude Code hooks system (Sidekick), transitioning to Node/TypeScript runtime. Experimental project—no backward compatibility required.

**Current State**: Bash runtime is production. Node/TypeScript migration planned per `SIDEKICK_RUNTIME_MIGRATION_PLAN.md` and `SIDEKICK_NODE_TARGET_ARCHITECTURE.md`.

## Migration Context

**Pain Point**: Session-summary excerpts exceed 66k tokens, causing jq/ARG_MAX failures. Bash-driven orchestration inhibits testing and large refactors.

**Solution**: Phased migration to Node/TypeScript runtime while preserving dual-scope behavior and config cascade semantics.

**Current Working Tools**:
- **Production runtime**: `src/sidekick/` (Bash) - deployed via `scripts/install.sh`
- **Analysis tools**: `scripts/analyze-session-at-line.sh` (Bash), `scripts/simulate-session.py` (Python) - tested and current
- **Legacy exploration**: `benchmark-next/` - early TypeScript attempt, now stale/superseded

**Target Architecture** (per `SIDEKICK_NODE_TARGET_ARCHITECTURE.md`):
- Monorepo workspace at `packages/` (sidekick-core, sidekick-cli, feature-*, shared-providers)
- Shared assets at `assets/sidekick/` (prompts, schemas, templates)
- Node 20+, pnpm workspaces, Vitest, strict TypeScript
- Maintains Bash fallback during transition

## Constraints [PRESERVE]

- **No backward compatibility**: Single-user project, breaking changes allowed
- **Dual-scope testing**: Every script must work identically in `.claude/` and `~/.claude/` contexts
- **Install/uninstall authorization**: Abort unless user message contains exact word "install" or "uninstall"
- **Timestamp preservation**: Use `rsync -a`, never `cp`, for file sync (critical for `./scripts/sync-to-user.sh`)
- **Plugin architecture boundary**: New features → `src/sidekick/features/<name>.sh` only. NEVER edit `handlers/*.sh`
- **Restart requirement**: All hook changes require `claude --continue` restart to take effect
- **Test isolation**: LLM provider tests (`test-llm-providers.sh`) intentionally excluded from default runs (expensive API calls)

## Critical Directives

- **Questions about architecture/design**: Cite `SIDEKICK_NODE_TARGET_ARCHITECTURE.md:<section>` instead of guessing
- **Plugin creation**: (1) Create `src/sidekick/features/<name>.sh`, (2) Add `FEATURE_<NAME>=true` to `config.defaults`, (3) Test, (4) Install project (with permission), (5) Verify session
- **Config system**: 4 modular domains (config, llm-core, llm-providers, features) + `sidekick.conf` override. See `src/sidekick/*.defaults` for all options
- **Path resolution**: Use `src/sidekick/lib/common.sh` path helpers for dual-scope compatibility
- **LLM debugging**: Enable `LLM_DEBUG_DUMP_ENABLED=true` → saves payloads to `/tmp/sidekick-llm-debug/`

## Project Structure (Action Paths)

```
src/sidekick/          # Source (edit here)
├── features/*.sh      # Plugins (add new features here)
├── handlers/*.sh      # Framework (never edit)
├── lib/*.sh           # Shared libraries (edit for infra changes)
└── *.defaults         # Config domains (4 files)

.claude/hooks/sidekick/    # Project deployment (ephemeral)
~/.claude/hooks/sidekick/  # User deployment (ephemeral)
.sidekick/*.conf           # Project persistent (git-committable - but note this project specifically .gitignored)
~/.sidekick/*.conf         # User persistent (survives installs)

scripts/
├── install.sh                    # Deploy to --user, --project, or --both
├── analyze-session-at-line.sh    # Surgical session summary (debug tool) - CURRENT working version
├── simulate-session.py           # Session analysis simulator (debug tool) - CURRENT working version
├── tests/                        # run-unit-tests.sh (mocked, free)
└── benchmark/                    # Legacy bash benchmarking code (superseded by Python/Bash tools above)

benchmark-next/        # ⚠️ STALE: Early TypeScript exploration, largely untested, out of sync with current work
                       # Being replaced by packages/ structure per SIDEKICK_NODE_TARGET_ARCHITECTURE.md
test-data/
├── projects/          # Test transcripts
├── replay-results/    # Replay simulation output (gitignored)
└── topic-analysis/    # Surgical extraction output (gitignored)
```

## Development Checklist
- **Documentation**: Ensure all code changes are reflected in the project's documentation (design docs, changelog, README) to keep knowledge current.
- **Implementation Plan**: Follow the current `TARGET-IMPLEMENTATION-PLAN.md` as the authoritative roadmap. For any development request, read the referenced sections, `TARGET-ARCHITECTURE.md`, and any other task‑relevant docs. After completing the work, mark the corresponding items in the plan as done.

**TypeScript builds (packages/)**:

```bash
# CORRECT: Always use pnpm from repo root
pnpm build                    # Build all packages (excludes tests)
pnpm -F @sidekick/core build  # Build specific package

# CORRECT: If using tsc directly, always specify project
pnpm tsc -p packages/sidekick-core/tsconfig.json

# WRONG: Never run bare tsc - outputs land in src/ instead of dist/
tsc                           # ❌ Pollutes source directories
cd packages/foo && tsc        # ❌ Same problem
```

**Typecheck including tests**: Build tsconfig excludes `**/*.test.ts` (tests shouldn't be in `dist/`). To catch type errors in tests, run:
```bash
pnpm typecheck                # Uses tsconfig.lint.json which includes tests
```
⚠️ **Always run both `pnpm build` AND `pnpm typecheck`** before claiming completion. Build alone won't catch test file type errors.

**Lint (zero-warning policy)**: Warnings are treated as errors. A clean codebase means zero warnings, always:
```bash
pnpm lint                     # Must produce no output (no errors, no warnings)
```
⚠️ **Fix all warnings immediately** - don't leave them for later. If eslint reports anything, fix it before moving on.

**If artifacts appear in src/**: Delete with `find packages/*/src \( -name "*.js" -o -name "*.d.ts" -o -name "*.d.ts.map" \) -delete`

**New plugin (zero handler edits)**:

1. `src/sidekick/features/<name>.sh` with `<name>_on_<event>()` functions
2. `FEATURE_<NAME>=true` in `config.defaults`
3. `./scripts/tests/run-unit-tests.sh`
4. `./scripts/install.sh --project && claude --continue`
5. Test in real session
6. `./scripts/install.sh --user && claude --continue`

**Config override**:

- Modular: Create `.sidekick/llm-providers.conf` (domain-specific)
- Simple: Create `.sidekick/sidekick.conf` (overrides all domains)
- API keys: `.env` files (never commit `~/.sidekick/.env`)

**Dual-scope verification**:

```bash
./scripts/install.sh --both
# Test in project context
cd /workspaces/claude-config && .claude/hooks/sidekick/sidekick.sh <cmd>
# Test in user context (outside project)
cd /tmp && ~/.claude/hooks/sidekick/sidekick.sh <cmd>
```

**Session summary debugging**:

```bash
# Surgical analysis - extract summary at specific line
./scripts/analyze-session-at-line.sh <session-id> --to-line 100

# Outputs: 0100-transcript.jsonl, 0100-filtered.jsonl, 0100-prompt.txt, 0100-session-summary.json
# Use to inspect exact LLM input and validate filtering logic

# Session simulation - verify production trigger logic
python3 scripts/simulate-session.py <session-id>
```

## Rules for Development

1. Explore and Plan Strategically

- Before writing code, deeply explore the problem or feature.
- Clearly identify root causes, requirements, and goals.
- Plan a strategic, thoughtful approach before implementation.

2. Debug Elegantly

- If there's a bug, systematically locate, isolate, and resolve it.
- Effectively utilize logs, print statements, and isolation scripts to pinpoint issues.

3. Create Closed-Loop Systems

- Build self-contained systems that let you fully test and verify functionality without user involvement.
- For example, when working on backend features:
    - Run the backend locally.
    - Send requests yourself.
    - Monitor logs and verify correct behavior independently.
    - If issues arise, iterate internally—debug and retest—until fully functional.
- The user should NOT have to provide logs or repeated feedback to solve issues. Complete the debugging and testing independently.

## Reference Docs (For Questions)

- **README.md**: User guide (installation, configuration, troubleshooting) - current Bash runtime
- **SIDEKICK_RUNTIME_MIGRATION_PLAN.md**: Migration strategy from Bash to Node/TypeScript (phased approach)
- **SIDEKICK_NODE_TARGET_ARCHITECTURE.md**: Target architecture for Node rewrite (packages/ workspace, shared assets)

## Tech Stack

**Current (Production)**:
- **Sidekick Runtime**: Bash 4.4+, jq 1.6+, 9 namespace libs, pluggable LLM providers
- **Analysis Tools**: Python 3.x (simulate-session.py), Bash (analyze-session-at-line.sh)
- **Tests**: Mocked unit (free), integration (free), LLM provider (expensive, opt-in)

**Future (Migration In Progress)**:
- **Target Runtime**: Node 20+, TypeScript, pnpm workspaces
- **Architecture**: Monorepo packages/ structure, shared assets/sidekick/ for prompts/schemas
- **Migration Path**: Phased transition maintaining Bash fallback during migration (see SIDEKICK_RUNTIME_MIGRATION_PLAN.md and TARGET-IMPLEMENTATION-PLAN.md)

## TypeScript Tooling (Post-Training Cutoff Notes)

**Explicit Versions**
- `eslint`: 9.39.1 (flat config in `eslint.config.js`)
- `typescript-eslint`: 8.48.0 (unified package for flat config)
- `@typescript-eslint/eslint-plugin`: 8.48.0
- `@typescript-eslint/parser`: 8.48.0
- `typescript`: 5.9.3

**ESLint v9 Flat Config Notes** (Claude trained on legacy `.eslintrc.*` format):
- Config file: `eslint.config.js` (not `.eslintrc.cjs`)
- Uses `export default []` array of config objects
- `extends` → import and spread: `...tseslint.configs.recommended`
- `plugins` → object: `plugins: { '@typescript-eslint': tseslint }`
- `parser` → `languageOptions: { parser }`
- `parserOptions.project` → `languageOptions.parserOptions.projectService: true`
- `ignorePatterns` → `ignores: []` in dedicated config object
- `overrides` → separate config objects with `files: []` property
- Root `package.json` requires `"type": "module"` for ESM config

**v7 → v8 Breaking Changes** (Claude trained on v7):

| What Changed | Old (v7) | New (v8) | Impact |
|--------------|----------|----------|--------|
| `ban-types` rule | Single rule | **Deleted** - split into `no-restricted-types`, `no-empty-object-type`, `no-unsafe-function-type`, `no-wrapper-object-types` | Config migration required |
| `no-throw-literal` | Existed | **Removed** - use `only-throw-error` instead | Rule rename |
| `no-var-requires` | Existed | **Deprecated** - use `no-require-imports` | Rule rename |
| `no-useless-template-literals` | Existed | **Renamed** to `no-unnecessary-template-expression` | Rule rename |
| `prefer-ts-expect-error` | Existed | **Deprecated** - use `ban-ts-comment` | Rule rename |
| `EXPERIMENTAL_useProjectService` | Parser option | **Renamed** to `projectService` | Config key change |
| `automaticSingleRunInference` | Opt-in | **Inverted** to `disallowAutomaticSingleRunInference` (opt-out) | Logic flip |
| Mapped type AST | `node.typeParameter.constraint/name` | `node.constraint` / `node.key` | AST structure change |
| Enum AST | `node.members` | `node.body.members` | AST structure change |
| Minimum TS version | >=4.7.4 | >=4.8.4 | Version bump |
| Minimum ESLint | ^8.56.0 | ^8.57.0 | Version bump |

**New Rules (post-January 2025, Claude unaware)**:
- `no-misused-spread` (v8.20.0, Jan 2025) - catches incorrect spread usage
- `no-unnecessary-type-conversion` (v8.32.0, May 2025) - flags redundant type conversions
- `no-unused-private-class-members` (v8.47.0, Nov 2025) - extension rule for unused private members

**Behavior Changes**:
- `prefer-nullish-coalescing`: Now ignores conditional tests by default
- Dot-directories (`.foo/`) matched by default in `parserOptions.project` globs

**Sources**: [typescript-eslint v8 announcement](https://typescript-eslint.io/blog/announcing-typescript-eslint-v8/), [GitHub releases](https://github.com/typescript-eslint/typescript-eslint/releases)
