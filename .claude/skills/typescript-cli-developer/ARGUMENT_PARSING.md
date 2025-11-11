# Argument Parsing Reference

Complete guide to parsing command-line arguments in TypeScript CLIs.

## Table of Contents

- [Overview](#overview)
- [yargs (Recommended for Complex CLIs)](#yargs-recommended-for-complex-clis)
- [commander (Simpler Alternative)](#commander-simpler-alternative)
- [Choosing Between yargs and commander](#choosing-between-yargs-and-commander)

---

## Overview

Argument parsing libraries handle:
- Positional arguments (`mycli build input.ts`)
- Options/flags (`--output dist`, `-v`)
- Subcommands (`mycli init`, `mycli build`)
- Validation and type coercion
- Help text generation
- Error handling

---

## yargs (Recommended for Complex CLIs)

**Install:** `npm install yargs @types/yargs`

### Basic Usage

```typescript
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = await yargs(hideBin(process.argv))
  .command('build <input>', 'Build the project', (yargs) => {
    return yargs.positional('input', {
      describe: 'Input file',
      type: 'string',
      demandOption: true,
    });
  })
  .option('output', {
    alias: 'o',
    type: 'string',
    description: 'Output directory',
    default: './dist',
  })
  .option('watch', {
    alias: 'w',
    type: 'boolean',
    description: 'Watch mode',
    default: false,
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    description: 'Verbose output',
    default: false,
  })
  .strict()
  .help()
  .parse();

console.log(argv.input);  // Typed!
console.log(argv.output); // Typed!
```

### Subcommands

```typescript
yargs(hideBin(process.argv))
  .command('init', 'Initialize project', {}, async (argv) => {
    await initProject();
  })
  .command('build', 'Build project', {}, async (argv) => {
    await buildProject();
  })
  .command('test', 'Run tests', {}, async (argv) => {
    await runTests();
  })
  .demandCommand(1, 'You must specify a command')
  .strict()
  .help()
  .parse();
```

### Type-Safe with Middleware

```typescript
interface GlobalArgs {
  verbose: boolean;
  config?: string;
}

interface BuildArgs extends GlobalArgs {
  input: string;
  output: string;
  watch: boolean;
}

const parser = yargs(hideBin(process.argv))
  .option('verbose', {
    type: 'boolean',
    default: false,
    description: 'Verbose logging',
  })
  .option('config', {
    type: 'string',
    description: 'Config file path',
  })
  .middleware((argv) => {
    // Setup logging based on verbose flag
    if (argv.verbose) {
      setupVerboseLogging();
    }

    // Load config if specified
    if (argv.config) {
      loadConfigFile(argv.config);
    }
  });

const buildCommand = parser.command<BuildArgs>(
  'build <input>',
  'Build the project',
  (yargs) => {
    return yargs
      .positional('input', {
        type: 'string',
        demandOption: true,
        describe: 'Input file or directory',
      })
      .option('output', {
        type: 'string',
        default: './dist',
        alias: 'o',
        describe: 'Output directory',
      })
      .option('watch', {
        type: 'boolean',
        default: false,
        alias: 'w',
        describe: 'Watch for changes',
      });
  },
  async (argv) => {
    await build(argv.input, argv.output, { watch: argv.watch });
  }
);

await parser.parse();
```

### Advanced Validation

```typescript
yargs(hideBin(process.argv))
  .option('port', {
    type: 'number',
    default: 3000,
    coerce: (val) => {
      if (val < 1 || val > 65535) {
        throw new Error('Port must be between 1 and 65535');
      }
      return val;
    },
  })
  .option('env', {
    type: 'string',
    choices: ['development', 'staging', 'production'],
    default: 'development',
  })
  .option('log-level', {
    type: 'string',
    choices: ['debug', 'info', 'warn', 'error'],
    default: 'info',
  })
  .check((argv) => {
    // Cross-field validation
    if (argv.env === 'production' && argv.logLevel === 'debug') {
      throw new Error('Cannot use debug logging in production');
    }
    return true;
  })
  .parse();
```

### Positional Arguments

```typescript
yargs(hideBin(process.argv))
  .command(
    'copy <source> <destination>',
    'Copy files',
    (yargs) => {
      return yargs
        .positional('source', {
          describe: 'Source file or directory',
          type: 'string',
          normalize: true, // Resolve paths
        })
        .positional('destination', {
          describe: 'Destination path',
          type: 'string',
          normalize: true,
        });
    },
    async (argv) => {
      await copyFiles(argv.source, argv.destination);
    }
  )
  .parse();
```

### Variadic Arguments

```typescript
yargs(hideBin(process.argv))
  .command(
    'process <files..>',
    'Process multiple files',
    (yargs) => {
      return yargs.positional('files', {
        describe: 'Files to process',
        type: 'string',
        array: true,
      });
    },
    async (argv) => {
      // argv.files is string[]
      for (const file of argv.files) {
        await processFile(file);
      }
    }
  )
  .parse();

// Usage: mycli process file1.txt file2.txt file3.txt
```

### Custom Help Text

```typescript
yargs(hideBin(process.argv))
  .usage('Usage: $0 <command> [options]')
  .epilogue('For more information, visit https://example.com/docs')
  .example('$0 build src/', 'Build from src directory')
  .example('$0 build src/ -o dist/', 'Build with custom output')
  .wrap(Math.min(120, yargs.terminalWidth()))
  .parse();
```

### Configuration Files

```typescript
yargs(hideBin(process.argv))
  .config('config', 'Path to config file', (configPath) => {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  })
  .option('config', {
    alias: 'c',
    type: 'string',
    description: 'Config file path',
  })
  .parse();

// Usage: mycli --config ./myconfig.json
// Config file values are merged with CLI args
```

---

## commander (Simpler Alternative)

**Install:** `npm install commander`

### Basic Usage

```typescript
import { Command } from 'commander';

const program = new Command();

program
  .name('my-cli')
  .description('CLI tool description')
  .version('1.0.0');

program
  .command('build')
  .description('Build the project')
  .argument('<input>', 'Input file')
  .option('-o, --output <dir>', 'Output directory', './dist')
  .option('-w, --watch', 'Watch mode', false)
  .action(async (input, options) => {
    await build(input, options);
  });

await program.parseAsync(process.argv);
```

### Subcommands

```typescript
const program = new Command();

program
  .name('mycli')
  .description('My CLI tool')
  .version('1.0.0');

// Init command
program
  .command('init')
  .description('Initialize a new project')
  .option('-t, --template <name>', 'Template to use', 'basic')
  .action(async (options) => {
    await initProject(options.template);
  });

// Build command
program
  .command('build')
  .description('Build the project')
  .argument('<input>', 'Input file')
  .option('-o, --output <dir>', 'Output directory', './dist')
  .action(async (input, options) => {
    await build(input, options.output);
  });

await program.parseAsync();
```

### Options

```typescript
program
  .option('-d, --debug', 'Enable debug mode')
  .option('-p, --port <number>', 'Port number', '3000')
  .option('-h, --host <address>', 'Host address', 'localhost')
  .option('--no-color', 'Disable colored output')
  .action((options) => {
    console.log(options.debug);   // boolean
    console.log(options.port);    // string
    console.log(options.color);   // boolean (negated)
  });
```

### Custom Validation

```typescript
program
  .command('start')
  .option('-p, --port <number>', 'Port number')
  .action((options) => {
    if (options.port) {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        program.error('Error: Port must be between 1 and 65535');
      }
    }
  });
```

### Variadic Arguments

```typescript
program
  .command('process')
  .description('Process multiple files')
  .argument('<files...>', 'Files to process')
  .action(async (files) => {
    // files is string[]
    for (const file of files) {
      await processFile(file);
    }
  });

// Usage: mycli process file1.txt file2.txt file3.txt
```

### Global Options

```typescript
const program = new Command();

// Global options available to all commands
program
  .option('-v, --verbose', 'Verbose output')
  .option('-c, --config <path>', 'Config file');

program
  .command('build')
  .action((options, command) => {
    // Access global options from parent
    const globalOpts = command.parent.opts();
    if (globalOpts.verbose) {
      console.log('Verbose mode enabled');
    }
  });
```

---

## Choosing Between yargs and commander

### Use **yargs** when:

✅ Building complex CLIs with many subcommands
✅ Need advanced validation and coercion
✅ Want middleware support
✅ Need configuration file integration
✅ Type safety is critical
✅ Have many cross-field validations

**Examples:** Build tools (Webpack, Vite), CLIs with plugins

### Use **commander** when:

✅ Building simpler CLIs
✅ Want cleaner, more readable API
✅ Don't need complex validation
✅ Prefer fluent/builder pattern
✅ Want lighter dependencies

**Examples:** Simple utilities, deployment tools, generators

### Comparison

| Feature | yargs | commander |
|---------|-------|-----------|
| **Bundle size** | ~120KB | ~8KB |
| **Type safety** | Excellent | Good |
| **Middleware** | ✅ Yes | ❌ No |
| **Config files** | ✅ Built-in | ⚠️ Manual |
| **Validation** | ✅ Advanced | ⚠️ Basic |
| **API style** | Fluent | Fluent |
| **Learning curve** | Steeper | Gentle |
| **Documentation** | Excellent | Excellent |

---

## Common Patterns

### Environment Variable Fallbacks

```typescript
// yargs
yargs()
  .option('api-key', {
    type: 'string',
    description: 'API key',
    default: process.env.API_KEY,
  })
  .parse();

// commander
program
  .option('-k, --api-key <key>', 'API key', process.env.API_KEY)
  .parse();
```

### Required Options

```typescript
// yargs
yargs()
  .option('api-key', {
    type: 'string',
    demandOption: true,
    description: 'API key (required)',
  })
  .parse();

// commander
program
  .requiredOption('-k, --api-key <key>', 'API key')
  .parse();
```

### Conflicts and Dependencies

```typescript
// yargs
yargs()
  .option('production', { type: 'boolean' })
  .option('development', { type: 'boolean' })
  .conflicts('production', 'development')
  .parse();

yargs()
  .option('watch', { type: 'boolean' })
  .option('output', { type: 'string' })
  .implies('watch', 'output') // watch requires output
  .parse();
```

---

**Related Files:**
- [SKILL.md](SKILL.md) - Main skill overview
- [TERMINAL_UI.md](TERMINAL_UI.md) - Terminal UI components
- [TESTING.md](TESTING.md) - Testing CLI applications
- [PACKAGING.md](PACKAGING.md) - Packaging and distribution
