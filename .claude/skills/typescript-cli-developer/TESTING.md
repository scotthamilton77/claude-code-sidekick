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
- `vitest` - Fast unit test framework
- `execa` - Execute CLI as subprocess
- `strip-ansi` - Remove ANSI color codes for testing

---

## Unit Testing with Vitest

### Testing Argument Parsing

```typescript
// src/cli.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from './cli';

describe('parseArgs', () => {
  it('parses basic arguments', () => {
    const result = parseArgs(['build', 'input.ts', '--output', 'dist']);

    expect(result.command).toBe('build');
    expect(result.input).toBe('input.ts');
    expect(result.output).toBe('dist');
  });

  it('applies default values', () => {
    const result = parseArgs(['build', 'input.ts']);

    expect(result.output).toBe('./dist');
    expect(result.watch).toBe(false);
    expect(result.verbose).toBe(false);
  });

  it('handles flags', () => {
    const result = parseArgs(['build', 'input.ts', '--watch', '-v']);

    expect(result.watch).toBe(true);
    expect(result.verbose).toBe(true);
  });

  it('throws on invalid command', () => {
    expect(() => parseArgs(['invalid'])).toThrow('Unknown command: invalid');
  });

  it('throws on missing required argument', () => {
    expect(() => parseArgs(['build'])).toThrow('Missing required argument');
  });
});
```

### Testing Business Logic

```typescript
// src/processor.test.ts
import { describe, it, expect } from 'vitest';
import { processFile } from './processor';

describe('processFile', () => {
  it('processes valid file', async () => {
    const result = await processFile('test.ts');

    expect(result.success).toBe(true);
    expect(result.linesProcessed).toBeGreaterThan(0);
  });

  it('handles missing file', async () => {
    await expect(processFile('nonexistent.ts')).rejects.toThrow(
      'File not found: nonexistent.ts'
    );
  });

  it('handles invalid syntax', async () => {
    const result = await processFile('invalid.ts');

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});
```

### Testing Formatters

```typescript
// src/formatter.test.ts
import { describe, it, expect } from 'vitest';
import { formatOutput, formatError } from './formatter';
import stripAnsi from 'strip-ansi';

describe('formatOutput', () => {
  it('formats success message', () => {
    const output = formatOutput({ status: 'success', count: 42 });

    // Strip colors for assertion
    expect(stripAnsi(output)).toContain('Success: 42 files processed');
  });

  it('includes colors in interactive mode', () => {
    const output = formatOutput({ status: 'success', count: 42 });

    // Should contain ANSI codes
    expect(output).not.toBe(stripAnsi(output));
  });
});

describe('formatError', () => {
  it('formats error message', () => {
    const error = new Error('Something went wrong');
    const output = formatError(error);

    expect(stripAnsi(output)).toContain('Error: Something went wrong');
  });
});
```

### Testing Utilities

```typescript
// src/utils.test.ts
import { describe, it, expect } from 'vitest';
import { validatePath, normalizeOptions } from './utils';

describe('validatePath', () => {
  it('accepts valid paths', () => {
    expect(validatePath('./src/file.ts')).toBe(true);
    expect(validatePath('/abs/path/file.ts')).toBe(true);
  });

  it('rejects invalid paths', () => {
    expect(validatePath('../../../etc/passwd')).toBe(false);
    expect(validatePath('/root/.ssh/id_rsa')).toBe(false);
  });
});

describe('normalizeOptions', () => {
  it('normalizes relative paths', () => {
    const options = normalizeOptions({ input: './src' });

    expect(options.input).toMatch(/^\/.*\/src$/);
  });

  it('applies defaults', () => {
    const options = normalizeOptions({});

    expect(options.verbose).toBe(false);
    expect(options.output).toBe('./dist');
  });
});
```

---

## Integration Testing with execa

**Install:** `npm install -D execa`

### Basic Integration Tests

```typescript
// test/integration.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execa } from 'execa';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '../dist/cli.js');

// Build CLI before tests
beforeAll(async () => {
  await execa('npm', ['run', 'build']);
});

describe('CLI integration', () => {
  it('shows help message', async () => {
    const { stdout, exitCode } = await execa('node', [cliPath, '--help']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('Commands:');
    expect(stdout).toContain('Options:');
  });

  it('shows version', async () => {
    const { stdout, exitCode } = await execa('node', [cliPath, '--version']);

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('handles invalid command', async () => {
    await expect(
      execa('node', [cliPath, 'invalid'])
    ).rejects.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('Unknown command'),
    });
  });
});
```

### Testing Command Execution

```typescript
describe('build command', () => {
  it('builds project successfully', async () => {
    const { stdout, exitCode } = await execa('node', [
      cliPath,
      'build',
      'test.ts',
      '--output',
      '/tmp/test-dist',
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Build completed');
  });

  it('handles missing input file', async () => {
    await expect(
      execa('node', [cliPath, 'build', 'nonexistent.ts'])
    ).rejects.toMatchObject({
      exitCode: 2,
      stderr: expect.stringContaining('File not found'),
    });
  });

  it('respects verbose flag', async () => {
    const { stdout } = await execa('node', [
      cliPath,
      'build',
      'test.ts',
      '--verbose',
    ]);

    expect(stdout).toContain('Processing file:');
    expect(stdout).toContain('Output written to:');
  });
});
```

### Testing with Environment Variables

```typescript
it('reads API key from environment', async () => {
  const { stdout } = await execa('node', [cliPath, 'deploy'], {
    env: {
      API_KEY: 'test-key-12345',
    },
  });

  expect(stdout).toContain('Deploying...');
});

it('respects NO_COLOR environment variable', async () => {
  const { stdout } = await execa('node', [cliPath, 'build', 'test.ts'], {
    env: {
      NO_COLOR: '1',
    },
  });

  // Output should not contain ANSI codes
  expect(stdout).toBe(stripAnsi(stdout));
});
```

### Testing stdin

```typescript
import { describe, it, expect } from 'vitest';
import { execa } from 'execa';

it('reads input from stdin', async () => {
  const { stdout } = await execa('node', [cliPath, 'process'], {
    input: 'line 1\nline 2\nline 3',
  });

  expect(stdout).toContain('Processed 3 lines');
});

it('handles piped input', async () => {
  const { stdout } = await execa('node', [cliPath, 'format'], {
    input: JSON.stringify({ foo: 'bar' }),
  });

  expect(stdout).toContain('"foo": "bar"');
});
```

### Testing Output Streams

```typescript
it('writes errors to stderr', async () => {
  try {
    await execa('node', [cliPath, 'build', 'invalid.ts']);
  } catch (error) {
    expect(error.stderr).toContain('Error:');
    expect(error.stdout).toBe(''); // stdout should be empty
  }
});

it('writes data to stdout', async () => {
  const { stdout, stderr } = await execa('node', [cliPath, 'list']);

  expect(stdout).toContain('file1.ts');
  expect(stderr).toBe(''); // No errors
});
```

---

## Testing Interactive Prompts

### Mocking inquirer

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import inquirer from 'inquirer';

// Mock inquirer
vi.mock('inquirer');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('interactive setup', () => {
  it('handles user input', async () => {
    // Mock prompt responses
    vi.mocked(inquirer.prompt).mockResolvedValue({
      projectName: 'test-project',
      template: 'basic',
      useTypescript: true,
      features: ['linting', 'testing'],
    });

    const result = await runSetup();

    expect(result.name).toBe('test-project');
    expect(result.template).toBe('basic');
    expect(result.features).toContain('linting');
  });

  it('validates input', async () => {
    vi.mocked(inquirer.prompt).mockResolvedValue({
      projectName: '',
      template: 'basic',
    });

    await expect(runSetup()).rejects.toThrow('Project name is required');
  });
});
```

### Testing with Real User Input

```typescript
import { spawn } from 'child_process';

it('handles interactive prompts', (done) => {
  const child = spawn('node', [cliPath, 'init']);

  // Send responses to prompts
  child.stdout.on('data', (data) => {
    const output = data.toString();

    if (output.includes('Project name')) {
      child.stdin.write('my-project\n');
    } else if (output.includes('Choose template')) {
      child.stdin.write('\n'); // Select first option
    } else if (output.includes('Use TypeScript')) {
      child.stdin.write('y\n');
    }
  });

  child.on('close', (code) => {
    expect(code).toBe(0);
    done();
  });
});
```

---

## Testing Terminal Output

### Snapshot Testing

```typescript
import { describe, it, expect } from 'vitest';
import { formatTable } from './formatter';

describe('formatTable', () => {
  it('formats table correctly', () => {
    const table = formatTable([
      { name: 'test1.ts', status: 'pass', time: '123ms' },
      { name: 'test2.ts', status: 'fail', time: '456ms' },
    ]);

    // Strip ANSI codes for consistent snapshots
    expect(stripAnsi(table)).toMatchInlineSnapshot(`
      "┌───────────┬────────┬────────┐
       │ Name      │ Status │ Time   │
       ├───────────┼────────┼────────┤
       │ test1.ts  │ pass   │ 123ms  │
       ├───────────┼────────┼────────┤
       │ test2.ts  │ fail   │ 456ms  │
       └───────────┴────────┴────────┘"
    `);
  });
});
```

### Testing ANSI Codes

```typescript
import { describe, it, expect } from 'vitest';
import chalk from 'chalk';

describe('colored output', () => {
  it('includes color codes in TTY mode', () => {
    const output = formatSuccess('Done!');

    expect(output).toContain('\x1b[32m'); // Green color code
    expect(stripAnsi(output)).toBe('✓ Done!');
  });

  it('strips colors in non-TTY mode', () => {
    // Disable colors
    const noColor = new chalk.Instance({ level: 0 });
    const output = formatSuccess('Done!', { chalk: noColor });

    expect(output).not.toContain('\x1b[');
    expect(output).toBe('✓ Done!');
  });
});
```

---

## Testing stdin/stdout

### Mocking process streams

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('CLI I/O', () => {
  it('reads from stdin', async () => {
    const mockStdin = {
      isTTY: false,
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('test input');
      },
    };

    const result = await readInput(mockStdin as any);

    expect(result).toBe('test input');
  });

  it('writes to stdout', () => {
    const mockStdout = {
      write: vi.fn(),
    };

    writeOutput('test output', mockStdout as any);

    expect(mockStdout.write).toHaveBeenCalledWith('test output\n');
  });
});
```

---

## Best Practices

### ✅ DO

1. **Test both success and error cases**
   ```typescript
   it('handles success', async () => { /* ... */ });
   it('handles file not found', async () => { /* ... */ });
   it('handles invalid input', async () => { /* ... */ });
   ```

2. **Use integration tests for critical paths**
   ```typescript
   // Test the CLI as users would run it
   await execa('node', [cliPath, 'build', 'input.ts']);
   ```

3. **Strip ANSI codes in assertions**
   ```typescript
   expect(stripAnsi(output)).toContain('Success');
   ```

4. **Test exit codes**
   ```typescript
   expect(exitCode).toBe(0);  // Success
   expect(exitCode).toBe(1);  // Error
   expect(exitCode).toBe(2);  // Invalid usage
   ```

5. **Mock external dependencies**
   ```typescript
   vi.mock('inquirer');
   vi.mock('./api-client');
   ```

6. **Test environment variable handling**
   ```typescript
   await execa('node', [cliPath], {
     env: { API_KEY: 'test' }
   });
   ```

7. **Verify stderr vs stdout usage**
   ```typescript
   expect(stdout).toContain('data');
   expect(stderr).toContain('error');
   ```

### ❌ DON'T

1. **Don't test with real external services** - Mock APIs, databases, etc.
2. **Don't forget to strip ANSI codes** - Tests will fail on different terminals
3. **Don't use `console.log` in tests** - Pollutes test output
4. **Don't test implementation details** - Test behavior, not internals
5. **Don't skip error cases** - Test failures are as important as successes

---

## Test Organization

```
project/
├── src/
│   ├── cli.ts
│   ├── cli.test.ts          # Unit tests for CLI logic
│   ├── processor.ts
│   └── processor.test.ts    # Unit tests for processor
├── test/
│   ├── integration.test.ts  # Integration tests
│   ├── fixtures/            # Test data
│   │   ├── input.ts
│   │   └── expected.ts
│   └── helpers.ts           # Test utilities
└── vitest.config.ts
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/*.test.ts', '**/dist/**'],
    },
  },
});
```

---

## Example Test Suite

```typescript
// test/integration.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execa } from 'execa';
import { join } from 'path';
import stripAnsi from 'strip-ansi';

const cliPath = join(__dirname, '../dist/cli.js');

beforeAll(async () => {
  await execa('npm', ['run', 'build']);
});

describe('mycli', () => {
  describe('--help', () => {
    it('shows help text', async () => {
      const { stdout, exitCode } = await execa('node', [cliPath, '--help']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage:');
    });
  });

  describe('build command', () => {
    it('builds successfully', async () => {
      const { stdout, exitCode } = await execa('node', [
        cliPath,
        'build',
        'test.ts',
      ]);

      expect(exitCode).toBe(0);
      expect(stripAnsi(stdout)).toContain('Build completed');
    });

    it('fails on missing file', async () => {
      await expect(
        execa('node', [cliPath, 'build', 'nonexistent.ts'])
      ).rejects.toMatchObject({
        exitCode: 2,
      });
    });

    it('respects --output flag', async () => {
      const { exitCode } = await execa('node', [
        cliPath,
        'build',
        'test.ts',
        '--output',
        '/tmp/custom',
      ]);

      expect(exitCode).toBe(0);
      // Verify output directory exists
    });
  });
});
```

---

**Related Files:**
- [SKILL.md](SKILL.md) - Main skill overview
- [ARGUMENT_PARSING.md](ARGUMENT_PARSING.md) - Argument parsing
- [TERMINAL_UI.md](TERMINAL_UI.md) - Terminal UI components
- [PACKAGING.md](PACKAGING.md) - Packaging and distribution
