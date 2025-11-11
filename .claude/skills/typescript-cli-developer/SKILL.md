---
name: typescript-cli-developer
description: Comprehensive guide for building production-ready CLI applications with TypeScript. Covers argument parsing (yargs, commander), terminal UI (chalk, ora, inquirer), file operations, error handling, testing CLI apps, packaging, distribution, stdin/stdout handling, exit codes, configuration, and CLI UX best practices.
---

# TypeScript CLI Developer

## Purpose

Build robust, user-friendly command-line tools with TypeScript using industry-standard libraries and patterns. This skill provides architectural guidance, library recommendations, and best practices for creating professional CLI applications.

## When to Use

- Building new CLI tools or command-line applications
- Adding CLI interfaces to existing applications
- Working with argv parsing, terminal UI, or interactive prompts
- Implementing progress bars, spinners, or colored output
- Testing command-line applications
- Packaging CLIs for npm distribution

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

Separate CLI concerns from business logic for testability:

```typescript
#!/usr/bin/env node
// bin/cli.ts
import { run } from '../src/index.js';

run(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
```

```typescript
// src/index.ts
export async function run(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  await executeCommand(parsed);
}
```

**Why:** Enables testing without `process.exit()`, separates concerns

### Error Handling

Use custom error classes with exit codes:

```typescript
export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

// Usage
if (!fileExists(path)) {
  throw new CliError(`File not found: ${path}`, 2);
}
```

**Exit code conventions:**
- `0` - Success
- `1` - General errors
- `2` - Misuse (invalid args, missing files)
- `128+n` - Fatal error signal "n"

**Error output pattern:**

```typescript
import chalk from 'chalk';

function handleError(error: unknown): never {
  if (error instanceof CliError) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(error.exitCode);
  }
  console.error(chalk.red('Unexpected error:'), error);
  process.exit(1);
}
```

### Configuration Cascade

**Pattern:** CLI args > env vars > config file > defaults

```typescript
import { cosmiconfigSync } from 'cosmiconfig';

function loadConfig(cliArgs: ParsedArgs): Config {
  const explorer = cosmiconfigSync('myapp');
  const fileConfig = explorer.search()?.config ?? {};

  return {
    apiKey: cliArgs.apiKey ?? process.env.API_KEY ?? fileConfig.apiKey,
    timeout: cliArgs.timeout ?? fileConfig.timeout ?? 5000,
    verbose: cliArgs.verbose ?? fileConfig.verbose ?? false,
  };
}
```

---

## Core Capabilities

### Argument Parsing

**Quick comparison:**

| Feature | yargs | commander |
|---------|-------|-----------|
| Complexity | Complex CLIs | Simple CLIs |
| Bundle size | ~120KB | ~8KB |
| Type safety | Excellent | Good |
| Validation | Advanced | Basic |
| Middleware | ✅ Yes | ❌ No |

**See [ARGUMENT_PARSING.md](ARGUMENT_PARSING.md) for:**
- Full yargs and commander examples
- Subcommands and validation
- Type-safe patterns
- Configuration file integration

### Terminal UI

**Available components:**

- **Colors**: chalk for terminal styling
- **Spinners**: ora for loading indicators
- **Progress bars**: cli-progress for long operations
- **Interactive prompts**: inquirer or prompts for user input
- **Tables**: cli-table3 for formatted output
- **Feature detection**: Color and unicode support

**See [TERMINAL_UI.md](TERMINAL_UI.md) for:**
- Complete examples for each component
- Color patterns and styling
- Interactive prompt patterns
- Progress tracking
- Feature detection

### Input/Output Handling

**Reading stdin:**

```typescript
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// Detect piped input
if (process.stdin.isTTY) {
  // Interactive mode
  const answer = await promptUser();
} else {
  // Piped input
  const input = await readStdin();
}
```

**Writing to stdout/stderr:**

```typescript
// Standard output (actual program output)
process.stdout.write('data\n');
console.log('data');

// Standard error (diagnostics and logging)
process.stderr.write('error\n');
console.error('diagnostic info');
```

**Important:** Use stderr for logging, stdout for data. This allows:
```bash
mycli | jq  # stdout to jq, logging to terminal
```

---

## Testing

**Strategy:**
- **Unit tests**: Test functions (parsing, validation, formatters)
- **Integration tests**: Test CLI as subprocess (real usage)
- **Mocks**: Test interactive prompts

**Quick example:**

```typescript
// Integration test with execa
import { execa } from 'execa';

it('shows help message', async () => {
  const { stdout, exitCode } = await execa('node', [cliPath, '--help']);

  expect(exitCode).toBe(0);
  expect(stdout).toContain('Usage:');
});

it('handles errors correctly', async () => {
  await expect(
    execa('node', [cliPath, 'invalid'])
  ).rejects.toMatchObject({
    exitCode: 1,
    stderr: expect.stringContaining('Unknown command'),
  });
});
```

**See [TESTING.md](TESTING.md) for:**
- Unit testing patterns
- Integration testing with execa
- Testing interactive prompts
- Mocking strategies
- Snapshot testing
- stdin/stdout testing

---

## Packaging & Distribution

**Essential package.json:**

```json
{
  "name": "my-cli-tool",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "mycli": "./dist/cli.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "prepublishOnly": "npm run build && npm test"
  }
}
```

**Publishing workflow:**

```bash
# Link for local testing
npm link

# Test locally
mycli --help

# Publish to npm
npm version patch
npm publish
```

**See [PACKAGING.md](PACKAGING.md) for:**
- Complete package.json setup
- TypeScript configuration
- Build optimization
- Local development
- Publishing to npm
- Version management
- Binary wrappers

---

## Best Practices

### ✅ DO

1. **Use exit codes correctly**
   ```typescript
   process.exit(0);  // Success
   process.exit(1);  // Error
   process.exit(2);  // Invalid usage
   ```

2. **Respect stdout/stderr**
   ```typescript
   console.log(data);           // Actual output (stdout)
   console.error('Warning:');   // Diagnostics (stderr)
   ```

3. **Support --help and --version**
   ```typescript
   yargs.help().version()
   ```

4. **Handle SIGINT gracefully**
   ```typescript
   process.on('SIGINT', async () => {
     await cleanup();
     process.exit(130); // 128 + SIGINT(2)
   });
   ```

5. **Validate user input**
   ```typescript
   .option('port', {
     type: 'number',
     coerce: (val) => {
       if (val < 1 || val > 65535) {
         throw new Error('Port must be 1-65535');
       }
       return val;
     },
   })
   ```

6. **Use spinners for long operations**
   ```typescript
   const spinner = ora('Installing...').start();
   await install();
   spinner.succeed('Installed!');
   ```

7. **Provide verbose mode**
   ```typescript
   if (argv.verbose) {
     console.error(`Processing ${file}...`);
   }
   ```

8. **Test as users would run it**
   ```typescript
   await execa('node', [cliPath, 'build', 'input.ts']);
   ```

### ❌ DON'T

1. **Don't use process.exit() in library code** - Throw errors instead
2. **Don't log to stdout unless it's actual output** - Use stderr for diagnostics
3. **Don't ignore errors silently** - Always handle or propagate
4. **Don't assume terminal capabilities** - Check with feature detection
5. **Don't block on synchronous I/O** - Use async file operations
6. **Don't hard-code paths** - Use path.join() and respect OS differences
7. **Don't publish without testing** - Use `npm pack` and test locally

---

## Quick Start

Basic TypeScript CLI setup:

**1. Install dependencies:**
```bash
npm install yargs chalk ora
npm install -D typescript tsx @types/yargs @types/node
```

**2. Create src/cli.ts:**
```typescript
#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

yargs(hideBin(process.argv))
  .command('hello [name]', 'Say hello', {}, (argv) => {
    console.log(`Hello, ${argv.name || 'World'}!`);
  })
  .strict()
  .help()
  .parse();
```

**3. Configure package.json:**
```json
{
  "type": "module",
  "bin": "./dist/cli.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts"
  }
}
```

**See reference files for complete examples and patterns.**

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

**Skill Status**: COMPLETE ✅
**Line Count**: < 500 (following 500-line rule) ✅
**Progressive Disclosure**: Reference files for detailed information ✅
