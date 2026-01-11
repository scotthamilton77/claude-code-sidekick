# AGENTS.md

TypeScript/Bash developer for Claude Code hooks system (Sidekick).

<constraints>
<!-- [PRESERVE] -->

- **No backward compat**: Single-user project, breaking changes allowed
- **Dual-scope**: Must work identically in `.claude/` and `~/.claude/`
- **Install keyword**: Do not install/uninstall sidekick unless user message contains exact word "install" or "uninstall"
- **Timestamp sync**: Preserve file timestamps when copying (install, runtime)
- **Hook changes**: Require `claude --continue` restart
- **LLM tests**: Provider tests excluded from default runs (expensive API calls)
- **Cleanup**: Remove any temp files/scripts created during iteration
</constraints>

<directives>

- **Architecture questions**: Cite `docs/ARCHITECTURE.md §N` or `docs/design/FOO.md §N`—don't guess
- **Verification**: Run `pnpm build && pnpm typecheck` before completion
</directives>

<structure>

```
src/sidekick/           # LEGACY—will be deleted
scripts/                # install.sh, dev-mode.sh, analyze-session-at-line.sh, simulate-session.py
packages/               # See packages/AGENTS.md for monorepo details
assets/sidekick/defaults/  # YAML config defaults
benchmark-next/         # STALE—see benchmark-next/AGENTS.md
```
</structure>

<sandbox_testing>

IPC tests fail in Claude Code sandbox (Unix socket `EPERM`).

```bash
# Run @sidekick/core excluding IPC tests:
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,supervisor-client}.test.ts'

# Full tests (user must run outside sandbox):
INTEGRATION_TESTS=1 pnpm test
```

**Dev-mode**: `scripts/dev-mode.sh enable` (requires `pnpm build`, restart Claude Code)
</sandbox_testing>

<git_commits>
<!-- Sandbox blocks heredoc temp files. Use simple -m or disable sandbox for commits. -->

When committing in sandbox mode, heredocs fail with "can't create temp file for here document".

**Solutions** (in order of preference):
1. Use simple `-m` for single-line messages: `git commit -m "fix(scope): message"`
2. Use multiple `-m` flags for multi-line:
   ```bash
   git commit -m "fix(scope): summary" -m "Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
   ```
3. For complex messages, use `dangerouslyDisableSandbox: true` since git is safe

**Never use heredoc syntax** (`<<EOF`, `<<'EOF'`) for commit messages in this project.
</git_commits>

<typescript_tooling>
<!-- [PRESERVE] Post-training-cutoff—use context7 for current docs -->

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

| v7 | v8 |
|----|----------------|
| `ban-types` | `no-restricted-types`, `no-empty-object-type`, `no-unsafe-function-type`, `no-wrapper-object-types` |
| `no-throw-literal` | `only-throw-error` |
| `no-var-requires` | `no-require-imports` |
| `no-useless-template-literals` | `no-unnecessary-template-expression` |
| `prefer-ts-expect-error` | `ban-ts-comment` |
| `EXPERIMENTAL_useProjectService` | `projectService` |
| `automaticSingleRunInference` | `disallowAutomaticSingleRunInference` (opt-out) |
| `node.typeParameter.constraint/name` | `node.constraint` / `node.key` |
| `node.members` | `node.body.members` (enum AST) |
| Min TS >=4.7.4, ESLint ^8.56.0 | >=4.8.4, ^8.57.0 |

**New Rules (post-Jan 2025)**: `no-misused-spread` (v8.20), `no-unnecessary-type-conversion` (v8.32), `no-unused-private-class-members` (v8.47)

**Behavior Changes**: `prefer-nullish-coalescing` ignores conditional tests; dot-directories matched by default in `parserOptions.project` globs
</typescript_tooling>
