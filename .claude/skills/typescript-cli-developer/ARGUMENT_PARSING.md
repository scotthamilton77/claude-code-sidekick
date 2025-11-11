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

**Why yargs:** Advanced validation, middleware support, configuration file integration, and excellent TypeScript inference. Choose when you need complex CLIs with plugins, cross-field validation, or config file support.

### Basic Usage
Use `.command()` for subcommands with `.positional()` for required args. Use `.option()` for flags with `type`, `alias`, `default`. Chain `.strict().help().parse()` for validation and help text.

### Subcommands
Use `.demandCommand(1, 'message')` to require a command. Each `.command()` gets its own handler and options.

### Type-Safe Patterns
Define interfaces for arg types, use generics in `.command<YourInterface>()`. Use `.middleware()` for cross-cutting concerns (logging setup, config loading).

### Advanced Validation
- **coerce**: Transform/validate option values (throw Error for invalid)
- **choices**: Restrict to enum values
- **check**: Cross-field validation (access all argv)

### Positional Arguments
Use `<required>` and `[optional]` in command string. Set `normalize: true` for path resolution.

### Variadic Arguments
Use `<files..>` syntax with `array: true` in positional config. Results in `string[]`.

### Custom Help Text
Use `.usage()`, `.epilogue()`, `.example()` for customization. Use `.wrap()` for terminal width control.

### Configuration Files
Use `.config()` with custom loader function. Config values merge with CLI args (CLI args win).

---

## commander (Simpler Alternative)

**Install:** `npm install commander`

**Why commander:** Tiny bundle size (~8KB vs yargs ~120KB), clean fluent API, and simpler learning curve. Choose for straightforward CLIs without complex validation needs or when bundle size is critical.

### Basic Usage
Create `new Command()`, set `.name()`, `.description()`, `.version()`. Use `.command()` for subcommands with `.argument()` and `.option()`. Call `.action()` with handler, then `.parseAsync()`.

### Key Patterns
- **Options**: `-s, --long <value>` syntax, third param is default
- **Negation**: `--no-flag` creates boolean flag (defaults true)
- **Variadic**: `<files...>` for arrays
- **Validation**: Use `program.error()` for validation errors
- **Global options**: Access via `command.parent.opts()` in subcommand handlers

---

## Choosing Between yargs and commander

### Use **yargs** when:

✅ Building complex CLIs with many subcommands
✅ Need advanced validation and coercion (port ranges, custom types)
✅ Want middleware support (logging, auth, config loading)
✅ Need configuration file integration (cosmiconfig support)
✅ Type safety is critical (excellent TypeScript inference)
✅ Have many cross-field validations (production + debug conflicts)

**Examples:** Build tools (Webpack, Vite), CLIs with plugins, enterprise tooling

**Trade-off:** Larger bundle (~120KB) but saves development time on complex CLIs

### Use **commander** when:

✅ Building simpler CLIs (< 10 commands)
✅ Want cleaner, more readable API (less boilerplate)
✅ Don't need complex validation (basic type checking is enough)
✅ Prefer fluent/builder pattern (method chaining)
✅ Want lighter dependencies (bundle size matters)

**Examples:** Simple utilities, deployment tools, generators, one-off scripts

**Trade-off:** Smaller bundle (~8KB) but manual validation for complex scenarios

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

**Environment Variable Fallbacks**: Use `default: process.env.VAR_NAME`

**Required Options**: yargs `demandOption: true`, commander `.requiredOption()`

**Conflicts & Dependencies** (yargs only): `.conflicts(a, b)` and `.implies(a, b)`

---

**Related Files:**
- [SKILL.md](SKILL.md) - Main skill overview
- [TERMINAL_UI.md](TERMINAL_UI.md) - Terminal UI components
- [TESTING.md](TESTING.md) - Testing CLI applications
- [PACKAGING.md](PACKAGING.md) - Packaging and distribution
