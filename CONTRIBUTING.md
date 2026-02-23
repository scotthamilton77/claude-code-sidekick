# Contributing to Sidekick

Thanks for taking the time to contribute. Sidekick is a Claude Code hooks companion built as a TypeScript monorepo.

For the full developer guide (architecture, dependency graph, testing strategy, configuration system), see **[docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md)**.

## Code of Conduct

Be respectful, professional, and constructive.

## How Can I Contribute?

### Reporting Bugs (Users)

If you're a **user** who found a bug, open a [GitHub Issue](https://github.com/scotthamilton77/claude-code-sidekick/issues). Include:

- **Clear description** of the problem
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
- **Environment details** (OS, Claude Code version, Node.js version, pnpm version)
- **Relevant logs** from `.sidekick/sidekick.log` if applicable

### Suggesting Enhancements (Users)

Enhancement suggestions from users are also tracked as [GitHub Issues](https://github.com/scotthamilton77/claude-code-sidekick/issues).

### Finding Work (Developers)

Development work is tracked with **beads** (`bd`), a git-backed issue tracker. GitHub Issues are for user-facing bug reports and feature requests; beads is for developer-facing task tracking.

```bash
# See what's available to work on
bd ready

# View details of a specific issue
bd show <id>

# Found a bug while developing? Create a bead, not a GitHub Issue
bd create --title="Fix race condition in daemon startup" --type=bug --priority=2
```

### Working on an Issue

All work happens on **branches** — never commit directly to `main`.

```bash
# 1. Claim the issue
bd update <id> --status=in_progress

# 2. Create a branch
git checkout -b feat/short-description

# 3. Do the work, commit with semantic prefixes
git commit -m "feat(daemon): add graceful shutdown"

# 4. Verify before pushing
pnpm build && pnpm typecheck && pnpm lint && pnpm test

# 5. Push and open a PR against main
git push -u origin feat/short-description
gh pr create

# 6. Close the issue when the PR is merged
bd close <id>
bd sync
```

### Pull Requests

1. **Create your branch** from `main` (never commit directly to `main`)
2. **Install dependencies**: `pnpm install`
3. **Build**: `pnpm build`
4. **Verify before submitting**:
   ```bash
   pnpm build       # Build all packages
   pnpm typecheck   # Type-check (includes test files)
   pnpm lint        # ESLint all packages
   pnpm test        # Unit tests (mocked LLM, zero API costs)
   ```
5. **Follow existing patterns** in `packages/` (see [Cross-Package Conventions](docs/DEVELOPER-GUIDE.md#cross-package-conventions))
6. **Update documentation** for significant changes:
   - `README.md` for user-facing changes
   - `AGENTS.md` / `packages/AGENTS.md` for architectural changes
   - `docs/design/` for design-level changes
7. **Write clear commit messages** using semantic format:
   - `feat(scope):` for new features
   - `fix(scope):` for bug fixes
   - `docs(scope):` for documentation
   - `test(scope):` for tests
   - `refactor(scope):` for refactoring
   - `chore(scope):` for maintenance

## Quick Start for Development

```bash
git clone https://github.com/scotthamilton77/claude-code-sidekick.git
cd claude-code-sidekick
pnpm install
pnpm build
```

Enable dev-mode to test hooks locally (within this project only):

```bash
pnpm sidekick dev-mode enable
```

After making changes:

```bash
pnpm build                    # Rebuild
pnpm typecheck && pnpm test   # Verify
```

See the [Developer Guide](docs/DEVELOPER-GUIDE.md#development-workflow) for the full workflow, including daemon management, log inspection, and persona testing.

## Development Toolchain

Beyond Node.js and pnpm, the development workflow uses several additional tools:

- **beads** (`bd`): Issue tracking for multi-session work — `brew install beads`
- **Claude Code plugins**: code-review, code-simplifier, context7, superpowers (from `claude-plugins-official`), and beads (from `steveyegge/beads`). See the [Developer Guide prerequisites](docs/DEVELOPER-GUIDE.md#claude-code-plugins) for install commands.
- **agents-config** (optional): The maintainer's Claude Code skills and personas. Not required for building or contributing — the devcontainer installs it automatically if present.

> **Fastest path**: Use the [devcontainer](docs/DEVELOPER-GUIDE.md#dev-container-recommended) — it installs everything automatically.

## Project Structure

This is a pnpm monorepo with packages under `packages/`. The full dependency graph and package descriptions are in the [Developer Guide](docs/DEVELOPER-GUIDE.md#package-dependency-graph).

```
packages/
  types/                   # Shared TypeScript types (leaf node)
  sidekick-core/           # Core services (config, transcript, logging)
  shared-providers/        # LLM provider abstractions
  testing-fixtures/        # Shared test mocks and factories
  feature-reminders/       # Reminder staging and orchestration
  feature-session-summary/ # LLM-based conversation analysis
  feature-statusline/      # Token tracking and status display
  sidekick-daemon/         # Background daemon for session management
  sidekick-cli/            # CLI entrypoint and hook dispatcher
  sidekick-dist/           # npm distribution bundle (@scotthamilton77/sidekick)
  sidekick-plugin/         # Claude Code plugin (hooks.json)
  sidekick-ui/             # Monitoring UI (React SPA)
```

## Testing

```bash
# All tests (default -- mocked LLM, zero API costs)
pnpm test

# Single package
pnpm --filter @sidekick/core test

# Type check
pnpm typecheck

# Lint (with auto-fix)
pnpm lint:fix
```

**IPC tests in sandbox**: IPC tests fail inside the Claude Code sandbox (Unix socket `EPERM`). Exclude them when running from a sandboxed environment:

```bash
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
```

**LLM provider tests**: Excluded from default runs to prevent API charges. Enable explicitly:

```bash
INTEGRATION_TESTS=1 pnpm test
```

See the [Testing Strategy](docs/DEVELOPER-GUIDE.md#testing-strategy) section for details on test infrastructure, fixtures, and coverage.

## Coding Style

### TypeScript

- Use **strict mode** (enforced by tsconfig)
- **Explicit return types** for public functions
- **No `any`** except in test files
- **Prefer `const`** over `let`
- **500 lines per file**, **20 lines per method** (enforced by code review)
- **CommonJS output** for all runtime packages (`"type": "commonjs"`)
- Follow ESLint rules (auto-fixed with `pnpm lint:fix`)

### Cross-Package Rules

- **Logging**: Always via `pino` from `@sidekick/core`. Never `console.log`.
- **Configuration**: Via `ConfigService` from `@sidekick/core`. Never import `dotenv` directly.
- **Types**: Shared interfaces live in `@sidekick/types`.
- **Testing**: Use mocks/factories from `@sidekick/testing-fixtures`.
- **LLM calls**: Always via `@sidekick/shared-providers`. Never call LLM SDKs directly.
- **Import order**: `@sidekick/types` -> `@sidekick/core` -> feature packages (prevents circular deps).

### Configuration Files

- Use **YAML** for configuration files
- Follow the cascade pattern in `assets/sidekick/defaults/`
- Override locally in `.sidekick/` (gitignored)

## Adding New Packages

See the [Adding a New Package](docs/DEVELOPER-GUIDE.md#adding-a-new-package) section in the Developer Guide for the full checklist.

Summary:

1. Create directory under `packages/`
2. Add `package.json` with `@sidekick/` scope and `"type": "commonjs"`
3. Add to `vitest.workspace.ts` if it has tests
4. Export from `src/index.ts` with explicit type exports
5. Run `pnpm install && pnpm build` to verify

## Documentation Standards

- **Update AGENTS.md** for architectural changes
- **Update README.md** for user-facing changes
- **Inline comments** for non-obvious code
- **Design docs** in `docs/design/` for significant new features

## Questions?

Open an issue with the `question` label.

## Attribution

By contributing, you agree that your contributions will be licensed under the MIT License.
