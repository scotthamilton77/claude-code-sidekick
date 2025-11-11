# Testing CLI Applications

Complete guide to testing TypeScript CLI tools with unit and integration tests.

## Table of Contents

- [Overview](#overview)
- [Unit Testing with Vitest](#unit-testing-with-vitest)
- [Integration Testing with execa](#integration-testing-with-execa)
- [Testing Interactive Prompts](#testing-interactive-prompts)
- [Testing Terminal Output](#testing-terminal-output)
- [Testing stdin/stdout](#testing-stdinstdout)
- [Best Practices](#best-practices)

---

## Overview

CLI testing requires different strategies than typical application testing:

- **Unit tests**: Test individual functions (argument parsing, validation, formatters)
- **Integration tests**: Test the entire CLI as a subprocess (like users would run it)
- **Snapshot tests**: Verify terminal output format
- **Mock tests**: Test interactive prompts without user input

**Key libraries:**
- `vitest` - Fast unit test framework with native ESM support
- `execa` - Execute CLI as subprocess (tests real user experience)
- `strip-ansi` - Remove ANSI color codes for testing (enables stable assertions across terminals)

---

## Unit Testing with Vitest

### What to Test
- **Argument parsing**: Commands, options, defaults, validation errors
- **Business logic**: File processing, transformations, error handling
- **Formatters**: Output templates, color integration (use `strip-ansi`)
- **Utilities**: Path validation, option normalization, helper functions

### Key Patterns
Use `describe/it/expect` from vitest. Use `stripAnsi()` for color-independent assertions. Test both success and error paths.

---

## Integration Testing with execa

**Install:** `npm install -D execa`

**Why execa:** Executes your CLI as a real subprocess (like users would), captures stdout/stderr separately, handles exit codes properly, and supports stdin injection. Essential for end-to-end CLI testing.

### Basic Setup
Import from `'execa'`. Build CLI in `beforeAll()`. Call `execa('node', [cliPath, ...args])` which returns `{ stdout, stderr, exitCode }`.

### What to Test
- **Help/version**: Verify output format and exit 0
- **Commands**: Test success paths with assertions on stdout
- **Errors**: Use `await expect(execa(...)).rejects.toMatchObject({ exitCode, stderr })`
- **Environment**: Pass `{ env: { VAR: 'value' } }` options
- **stdin**: Pass `{ input: 'data' }` for piped input testing
- **Streams**: Verify stdout for data, stderr for diagnostics

### Assertions
Success: `expect(exitCode).toBe(0)`, check stdout content. Errors: Catch rejection, check `exitCode` and `stderr`. NO_COLOR: Verify `stdout === stripAnsi(stdout)`.

---

## Testing Interactive Prompts

### Mocking
Use `vi.mock('inquirer')` or `vi.mock('prompts')`. Mock `prompt()` to return predefined answers: `vi.mocked(inquirer.prompt).mockResolvedValue(answers)`.

### Real Input (Advanced)
Use `spawn()` from `child_process`, pipe input to `stdin` based on stdout patterns. More brittle, prefer mocks for most cases.

---

## Best Practices

### ✅ DO
1. Test both success and error cases
2. Use integration tests for critical user paths (execa)
3. Strip ANSI codes with `stripAnsi()` for terminal-independent assertions
4. Test exit codes (0, 1, 2, 130)
5. Mock external dependencies (APIs, prompts)
6. Test environment variable handling
7. Verify stdout (data) vs stderr (diagnostics) separation

### ❌ DON'T
1. Test with real external services (mock instead)
2. Forget to strip ANSI (tests will be flaky)
3. Use `console.log` in tests (pollutes output)
4. Test implementation details (test behavior)
5. Skip error cases (failures are critical)

---

## Test Organization

**Structure:**
- `src/*.test.ts` - Unit tests colocated with source
- `test/integration.test.ts` - Integration tests separate
- `test/fixtures/` - Test data
- `vitest.config.ts` - Coverage config (v8 provider, exclude test files)

**Config essentials:** `globals: true`, `environment: 'node'`, coverage with v8

---

**Related Files:**
- [SKILL.md](SKILL.md) - Main skill overview
- [ARGUMENT_PARSING.md](ARGUMENT_PARSING.md) - Argument parsing
- [TERMINAL_UI.md](TERMINAL_UI.md) - Terminal UI components
- [PACKAGING.md](PACKAGING.md) - Packaging and distribution
