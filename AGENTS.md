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

**Commands:** (add --json to return a structured response)
- `persona list` - list the available persona ids
- `persona set {persona-id} --session-id={session-id}` - change that session's selected persona
- `persona clear --session-id={session-id}` - clear that session's selected persona
- `persona test {persona-id} --session-id={session-id} [--type=snarky|resume]` - test the "voice" of that session's selected persona
- `sessions` - list all tracked sessions (table format unless --json specified)
- `dev-mode enable|disable|status|clean|clean-all` - manage development hooks
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
<!-- [PRESERVE] -->
## Issue Tracking with bd (beads)

Use **bd** for ALL issue tracking. Command reference is injected via session hook—this section covers semantics and workflow.

**Sandbox note**: Run bd with `dangerouslyDisableSandbox: true` to avoid 5-second timeout. The sandbox blocks Unix socket connections to the bd daemon, causing fallback to slower direct mode.

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks (phases, milestones)
- `chore` - Maintenance (dependencies, tooling)

### Epics and Dependencies

**Use epics** for multi-task work. Children are **parallel by default**—only explicit deps create sequence.

**Dependency semantics**: `bd dep add B A` means "B needs A" (B is blocked until A closes).

**Epic-level deps**: Block all children until satisfied.
```bash
bd dep add <epic-9.6> <task-9.5.1>   # All of 9.6 waits for 9.5.1
```

### Important Fields

| Flag | Purpose | Example |
|------|---------|---------|
| `--acceptance` | Done-when criteria | `--acceptance="Tests pass, no lint errors"` |
| `--design` | Design notes/approach | `--design="Use adapter pattern"` |
| `--labels` | Tags (comma-sep) | `--labels refactoring,phase-9` |
| `--defer` | Hide until date | `--defer "next monday"` |

### Default Acceptance Criteria

When creating implementation tasks (type: task, bug, feature), **always include standard quality gates** in acceptance criteria unless explicitly inappropriate for the task type.

**Standard criteria for code changes:**
```
Build passes. Typecheck passes. Tests pass.
```

Append these after task-specific criteria:
```bash
bd create "Implement persona selection" --type task \
  --acceptance "Selection persisted to session-persona.json. Build passes. Typecheck passes. Tests pass."
```

**Discovered work protocol:**
- Out-of-scope issues found during implementation → create new bead with `discovered-from:<parent-id>` dependency
- Don't fix unrelated problems inline; track them for separate work

**Skip standard criteria for:**
- Documentation-only tasks
- Design/research/investigation tasks
- Epic planning tasks
- Chores that don't touch code (e.g., dependency updates with no code changes)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task**: `bd update <id> --status in_progress`
   - Also mark parent chain as in_progress (if parent is still `open`, update it too, recursively up)
3. **Check parent context**: If task has a parent, run `bd show <parent-id>` recursively to see parent's acceptance criteria, description, and sibling tasks
4. **Work on it**: Implement, test, document
5. **Discover new work?** Create linked issue with `--deps discovered-from:<parent-id>`
6. **Clean up**: Make sure there are no typescript or lint issues or test failures
7. **Initiate agent reviews**: Use the code review and code simplifier skills and/or agents
8. **Pause and let the user review**
9. **Complete**: Only once the user agrees the work is done and explicitly asks for a commit: `bd close <id>`
   - **Cascade parent closure**: After closing, check if task has a parent. If all sibling tasks are now closed, close the parent too. Repeat recursively up the tree.

### Rules

- ✅ Use bd for ALL task tracking
- ✅ Use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ❌ Do NOT create markdown TODO lists or use external trackers unless explicitly asked to by the user
</task-tracking>
