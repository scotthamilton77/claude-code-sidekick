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

- **Architecture questions**: Cite `docs/ARCHITECTURE.md` or `docs/design/FOO.md`—don't guess
- **Verification**: Run `pnpm build && pnpm typecheck` before completion
</directives>

<structure>

```
src/sidekick/              # LEGACY—will be deleted
scripts/                   # install.sh, dev-mode.sh, analyze-session-at-line.sh
packages/                  # See packages/AGENTS.md for monorepo details
assets/sidekick/defaults/  # YAML config defaults
assets/sidekick/personas/  # Character personality profiles (17 personas)
assets/sidekick/prompts/   # LLM prompt templates with persona interpolation
development-tools/llm-eval/ # LLM evaluation tools (relocated from benchmark-next/)
```
</structure>

<bd_invocation>                                                                                                                                                                   
Run bd directly as a bash command: `bd <command> [args]`                                                                                                                          
</bd_invocation>

<sidekick_invocation>
To invoke sidekick's CLI: `pnpm sidekick <command> [args]`

**Commands:** (add --json or --format=json for structured output, --format=table for ASCII tables)
- `persona list` - list the available persona ids
- `persona set {persona-id} --session-id={session-id}` - change that session's selected persona
- `persona clear --session-id={session-id}` - clear that session's selected persona
- `persona test {persona-id} --session-id={session-id} [--type=snarky|resume]` - test the "voice" of that session's selected persona
- `sessions` - list all tracked sessions (table format unless --format=json specified)
- `daemon start|stop|status|kill` - manage the background daemon
- `dev-mode enable|disable|status|clean|clean-all` - manage development hooks
- `ui` - launch the web monitoring UI
</sidekick_invocation>

<sandbox_testing>

IPC tests fail in Claude Code sandbox (Unix socket `EPERM`).

```bash
# Run @sidekick/core excluding IPC tests:
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'

# Full tests (user must run outside sandbox):
INTEGRATION_TESTS=1 pnpm test
```

**Dev-mode**: `pnpm sidekick dev-mode enable` or `scripts/dev-mode.sh enable` (requires `pnpm build`, restart Claude Code)
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

<task-tracking>
<!-- [PRESERVE] Command syntax injected via session hook—this covers project-specific semantics only -->

**Sandbox note**: Run bd with `dangerouslyDisableSandbox: true` (Unix socket EPERM in sandbox).

### Issue Types

`bug` | `feature` | `task` | `epic` | `chore`

### Epics

Children are **parallel by default**—only explicit deps create sequence. Epic-level deps block all children.

### Default Acceptance Criteria

For code tasks, always append: `Build passes. Typecheck passes. Tests pass.`

Skip for: docs-only, design/research, epic planning, no-code chores.

### Discovered Work

Out-of-scope issues → new bead with `discovered-from:<parent-id>` dep. Don't fix inline.

### Workflow Extensions

- **Parent chain**: Mark parent as `in_progress` when claiming child
- **Parent context**: Check `bd show <parent-id>` for acceptance criteria and sibling tasks
- **Agent reviews**: Use code-review and code-simplifier skills before user review
- **Cascade closure**: After closing, if all siblings closed → close parent recursively

### Rules

- ✅ Use bd for ALL tracking, `--json` for programmatic use
- ❌ No markdown TODO lists unless user explicitly requests
</task-tracking>
