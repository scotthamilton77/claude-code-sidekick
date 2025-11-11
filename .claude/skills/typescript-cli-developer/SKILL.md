---
name: typescript-cli-developer
description: Build production-ready command-line tools with TypeScript. Use when creating CLI apps, working with argv, terminal UI, interactive prompts, spinners, progress bars, testing CLIs, or packaging for npm. Covers yargs, commander, chalk, ora, inquirer, execa, and CLI best practices.
---

# TypeScript CLI Developer

## Purpose

Build robust, user-friendly command-line tools with TypeScript using industry-standard libraries. This skill provides architectural patterns, library guidance, and testing strategies for professional CLI development.

## When to Use

Trigger this skill when working on:
- CLI tools, command-line apps, terminal utilities
- Argument parsing with yargs or commander
- Terminal UI: colors, spinners, progress bars, prompts, tables
- Interactive CLI workflows
- Testing CLIs with execa or subprocess testing
- npm packaging and distribution

---

## Quick Reference

| Need | Library | Documentation |
|------|---------|---------------|
| **Argument parsing** | `yargs` or `commander` | [ARGUMENT_PARSING.md](ARGUMENT_PARSING.md) |
| **Colored output** | `chalk` | [TERMINAL_UI.md](TERMINAL_UI.md#colors-and-styling) |
| **Interactive prompts** | `inquirer` or `prompts` | [TERMINAL_UI.md](TERMINAL_UI.md#interactive-prompts) |
| **Spinners** | `ora` | [TERMINAL_UI.md](TERMINAL_UI.md#spinners) |
| **Progress bars** | `cli-progress` | [TERMINAL_UI.md](TERMINAL_UI.md#progress-bars) |
| **Tables** | `cli-table3` | [TERMINAL_UI.md](TERMINAL_UI.md#tables) |
| **Testing** | `vitest` + `execa` | [TESTING.md](TESTING.md) |
| **Packaging** | npm + TypeScript | [PACKAGING.md](PACKAGING.md) |

---

## Architecture Patterns

### Entry Point Structure
Separate CLI entry (`bin/cli.ts` with shebang) from business logic (`src/index.ts`). Export testable `run(args)` function instead of using `process.exit()` directly.

### Error Handling
Custom error classes with exit codes. Use `CliError` base class with `exitCode` property.

**Exit code conventions:**
- `0` - Success
- `1` - General errors
- `2` - Misuse (invalid args, missing files)
- `128+n` - Fatal error signal "n"

### Configuration Cascade
**Pattern:** CLI args > env vars > config file > defaults

Use `cosmiconfig` for file discovery. Apply nullish coalescing (`??`) chain for precedence.

---

## Core Capabilities

### Argument Parsing
**yargs** (120KB): Complex CLIs, advanced validation, middleware, config files
**commander** (8KB): Simple CLIs, fluent API, basic validation

See [ARGUMENT_PARSING.md](ARGUMENT_PARSING.md) for library-specific patterns.

### Terminal UI
**chalk** - Colors with auto-detection
**ora** - Spinners with TTY handling
**cli-progress** - Progress bars with ETA
**inquirer**/**prompts** - Interactive prompts
**cli-table3** - Formatted tables

See [TERMINAL_UI.md](TERMINAL_UI.md) for usage patterns.

### Input/Output
- **stdin**: Check `process.stdin.isTTY` to detect pipes vs interactive mode
- **stdout**: Program data output (pipeable)
- **stderr**: Logging and diagnostics (visible in pipes)

---

## Testing
- **Unit tests**: vitest for functions (parsing, validation, formatters)
- **Integration tests**: execa to run CLI as subprocess
- **Mocks**: Test interactive prompts without user input
- **Strip ANSI**: Use `strip-ansi` for stable assertions

See [TESTING.md](TESTING.md) for test patterns and execa usage.

---

## Packaging & Distribution
**package.json essentials:**
- `"type": "module"` for ESM
- `"bin": { "mycli": "./dist/cli.js" }` for executable
- `"files": ["dist"]` to whitelist published content
- `prepublishOnly` hook for build + test

**Development:** Use `npm link` for local testing, `npm pack` to verify tarball contents.

See [PACKAGING.md](PACKAGING.md) for tsconfig, build optimization, and publishing workflow.

---

## Best Practices

### ✅ DO
1. Use exit codes correctly (0=success, 1=error, 2=misuse, 130=SIGINT)
2. Respect stdout/stderr separation (data vs diagnostics)
3. Support --help and --version flags
4. Handle SIGINT gracefully with cleanup (exit 130)
5. Validate user input with clear error messages
6. Use spinners for long operations (ora auto-hides in CI)
7. Provide verbose mode for debugging
8. Test as users would run it (execa subprocess tests)

### ❌ DON'T
1. Don't use `process.exit()` in library code (throw errors instead)
2. Don't log to stdout unless it's actual output (use stderr for diagnostics)
3. Don't ignore errors silently (always handle or propagate)
4. Don't assume terminal capabilities (check TTY/color support)
5. Don't block on synchronous I/O (use async operations)
6. Don't hard-code paths (use `path.join()`, respect OS)
7. Don't publish without testing (`npm pack` + local install)

---

## Quick Start

**Dependencies:** `yargs` + `chalk` + `ora` + `typescript` + `tsx` + types

**Setup:**
1. Create `src/cli.ts` with shebang `#!/usr/bin/env node`
2. Set `"type": "module"` and `"bin": "./dist/cli.js"` in package.json
3. Add build script: `"build": "tsc"`
4. Add dev script: `"dev": "tsx src/cli.ts"`

**Pattern:** Use `yargs(hideBin(process.argv))` for arg parsing, `.strict().help()` for validation.

See reference files for detailed patterns.

---

## Reference Files

- **[ARGUMENT_PARSING.md](ARGUMENT_PARSING.md)** - yargs & commander complete guide
- **[TERMINAL_UI.md](TERMINAL_UI.md)** - Colors, spinners, prompts, progress bars, tables
- **[TESTING.md](TESTING.md)** - Unit & integration testing, mocking, execa
- **[PACKAGING.md](PACKAGING.md)** - npm packaging, building, publishing

---

## Resources

- **yargs**: https://yargs.js.org/
- **commander**: https://github.com/tj/commander.js
- **chalk**: https://github.com/chalk/chalk
- **ora**: https://github.com/sindresorhus/ora
- **inquirer**: https://github.com/SBoudrias/Inquirer.js
- **execa**: https://github.com/sindresorhus/execa
- **CLI Guidelines**: https://clig.dev/

---

## Quality Checklist

When building a CLI with this skill, verify:

- [ ] Description includes trigger terms and specific use cases
- [ ] SKILL.md under 500 lines with progressive disclosure
- [ ] No time-sensitive information (version numbers generic)
- [ ] Consistent terminology throughout
- [ ] Examples explain "why" not just "what"
- [ ] Error handling with clear messages
- [ ] Exit codes follow conventions (0=success, 1=error, 2=misuse)
- [ ] Respects stdout/stderr separation
- [ ] Supports --help and --version
- [ ] Handles SIGINT gracefully
- [ ] Tests cover success and error paths
- [ ] Integration tests use execa or subprocess
- [ ] Works with NO_COLOR environment variable
