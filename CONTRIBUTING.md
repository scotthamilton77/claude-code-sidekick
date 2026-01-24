# Contributing to Claude Code Configuration Lab

Thanks for taking the time to contribute! This project serves as an experimental proving ground for Claude Code configurations.

## Code of Conduct

Be respectful, professional, and constructive.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues. When you create a bug report, include:

- **Clear description** of the problem
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
- **Environment details** (OS, Claude Code version, Node.js version)
- **Relevant logs** from `.sidekick/sidekick.log` if applicable

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When suggesting:

- **Use a clear title** describing the enhancement
- **Provide detailed explanation** of the proposed functionality
- **Explain why this would be useful** to the Claude Code community

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies**: `pnpm install`
3. **Build**: `pnpm build`
4. **Test thoroughly**:
   ```bash
   pnpm test
   pnpm typecheck
   pnpm lint
   ```
5. **Follow existing patterns** in `packages/`
6. **Update documentation** (README.md, AGENTS.md) for significant changes
7. **Write clear commit messages** using semantic format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `test:` for tests
   - `refactor:` for refactoring
   - `chore:` for maintenance

## Development Guidelines

### Project Structure

This is a TypeScript monorepo using pnpm workspaces:

```
packages/
├── sidekick-core/          # Core services (config, transcript, logging)
├── sidekick-cli/           # CLI entrypoint and hook dispatcher
├── sidekick-daemon/        # Background daemon for session management
├── sidekick-plugin/        # Claude Code plugin (hooks.json)
├── shared-providers/       # LLM provider abstractions
├── feature-*/              # Feature packages (reminders, statusline, etc.)
└── testing-fixtures/       # Shared test mocks and factories
```

### Development Workflow

1. **Enable dev-mode** to use local builds:
   ```bash
   pnpm sidekick dev-mode enable
   ```

2. **Make changes** to packages under `packages/`

3. **Rebuild** after changes:
   ```bash
   pnpm build
   ```

4. **Restart Claude Code** to pick up hook changes

### Testing

```bash
# Run all tests (mocked LLM, zero API costs)
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

**Note**: IPC tests fail in Claude Code sandbox (Unix socket EPERM). Run full tests outside sandbox:
```bash
INTEGRATION_TESTS=1 pnpm test
```

### Adding New Packages

1. Create directory under `packages/`
2. Add `package.json` with `@sidekick/` scope
3. Add to `vitest.workspace.ts` if it has tests
4. Follow existing patterns for exports and types

## Coding Style

### TypeScript

- Use **strict mode** (enforced by tsconfig)
- **Explicit return types** for public functions
- **No `any`** except in test files
- **Prefer `const`** over `let`
- Follow ESLint rules (auto-fixed with `pnpm lint:fix`)

### Configuration

- Use **YAML** for configuration files
- Follow the cascade pattern in `assets/sidekick/defaults/`
- Override locally in `.sidekick/` (gitignored)

## Documentation Standards

- **Update AGENTS.md** for architectural changes
- **Update README.md** for user-facing changes
- **Inline comments** for non-obvious code

## Questions?

Open an issue with the `question` label.

## Attribution

By contributing, you agree that your contributions will be licensed under the MIT License.
