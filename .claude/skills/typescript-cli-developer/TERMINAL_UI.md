# Terminal UI Reference

Complete guide to creating beautiful, interactive command-line interfaces.

## Table of Contents

- [Colors and Styling](#colors-and-styling)
- [Spinners](#spinners)
- [Progress Bars](#progress-bars)
- [Interactive Prompts](#interactive-prompts)
- [Tables](#tables)
- [Feature Detection](#feature-detection)

---

## Colors and Styling

### chalk - Terminal String Styling

**Install:** `npm install chalk`

**Why chalk:** Auto-detects color support, respects NO_COLOR/FORCE_COLOR env vars, and safely degrades to plain text when piped. More reliable than manual ANSI codes.

### Basic API
- **Colors**: `.red()`, `.green()`, `.blue()`, `.yellow()`
- **Backgrounds**: `.bgRed()`, `.bgGreen()`, chain with text color
- **Styles**: `.bold()`, `.dim()`, `.italic()`, `.underline()`
- **Custom**: `.hex('#FF6B6B')`, `.rgb(255, 136, 0)`
- **Templates**: `` chalk`{green text} {bold value}` ``

### Color Detection
Auto-detects via `supports-color`. Manual control: `new chalk.Instance({ level: 0-3 })` for no color to true color.

### Common Patterns
Status helpers: `chalk.blue('ℹ')`, `chalk.green('✓')`, `chalk.yellow('⚠')`, `chalk.red('✗')`. Diff-style with red/green/dim for removed/added/unchanged.

---

## Spinners

### ora - Elegant Terminal Spinners

**Install:** `npm install ora`

**Why ora:** Automatically hides spinners in non-TTY environments (CI/CD, pipes), prevents visual glitches, and provides clean success/fail/warn states without manual cleanup.

### Basic API
Create with `ora('message').start()`. Update with `.text = 'new message'`. Finish with `.succeed()`, `.fail()`, `.warn()`, `.info()`, or `.stop()`.

### Properties
- `.spinner`: Change animation (`'dots'`, `'line'`, `'arrow3'`)
- `.color`: Change color (`'yellow'`, `'cyan'`)
- `.text`: Update message during operation

### Patterns
Sequential: Update `.text` between steps, finish with final state. Conditional: Choose `.succeed()` or `.fail()` based on results. Multiple: Track multiple spinners in object, update independently.

---

## Progress Bars

### cli-progress - Flexible Progress Bars

**Install:** `npm install cli-progress`

**Why cli-progress:** Provides multi-bar support (concurrent operations), auto-calculates ETA, and handles terminal resize gracefully. Essential for batch processing visibility.

### Basic API
Create `SingleBar` with format config. Call `.start(total, initial, payload)`, `.update(value, payload)`, and `.stop()`.

### Format Tokens
`{bar}`, `{percentage}`, `{value}`, `{total}`, `{eta}`, custom `{payload}` variables

### Multiple Bars
Use `MultiBar` to track concurrent operations. Create bars with `.create(total, initial, payload)`, update independently.

### Integration
Combine with chalk for colored formatting: `` format: `${chalk.cyan('{task}')} |{bar}|` ``

---

## Interactive Prompts

### inquirer - Full-Featured Prompts

**Install:** `npm install inquirer`

**Why inquirer:** Industry standard with 8+ prompt types, validation, conditional questions, and robust TTY handling. Best for complex interactive workflows (setup wizards, config builders).

### Prompt Types
- **input**: Text input with validation
- **list**: Single selection from choices
- **checkbox**: Multiple selections
- **confirm**: Yes/no question
- **password**: Masked input
- **editor**: Opens $EDITOR for long text

### Key Properties
- `validate`: Return `true` or error string
- `when`: Conditional rendering based on previous answers
- `default`: Default value
- `choices`: Array or objects with `name`, `value`, `checked`

Call `inquirer.prompt([questions])`, returns promise with answers object.

### prompts - Lightweight Alternative

**Install:** `npm install prompts`

**Why prompts:** Minimal bundle size (~4KB vs inquirer's ~100KB), simpler API, and better TypeScript support. Choose for simple CLIs where size matters or when you need fewer prompt types.

### Key Differences from inquirer
- **Types**: `text`, `select`, `toggle`, `multiselect` (similar names, different API)
- **Cancellation**: Returns partial response on Ctrl+C (check for missing values)
- **Choices**: Use `title` and `value` properties, `selected` for defaults

Simpler API but requires manual Ctrl+C handling.

---

## Tables

### cli-table3 - Formatted Tables

**Install:** `npm install cli-table3`

**Why cli-table3:** Supports complex layouts (horizontal, vertical, cross tables), Unicode box drawing, and color integration. Perfect for structured data display (test results, file listings, comparisons).

### Basic API
Create `new Table({ head, colWidths })`. Push arrays for rows: `table.push([...row])`. Call `table.toString()` to render.

### Config Options
- `head`: Column headers (array)
- `colWidths`: Fixed column widths
- `colAligns`: Alignment per column (`'left'`, `'center'`, `'right'`)
- `style`: Color theme (`{ head: ['cyan'] }`)
- `chars`: Custom border characters (for borderless/markdown tables)

### Layouts
- **Vertical**: Default, rows are arrays
- **Horizontal**: Push objects (`{ 'Key': 'Value' }`)
- **Cross**: Mixed layouts

Integrate with chalk for colored cells.

---

## Feature Detection

### Unicode Support
Use `is-unicode-supported` package. Fallback fancy chars (✓, ✗, ℹ, ⚠) to ASCII (√, x, i, !) for compatibility.

### Terminal Width
Access via `process.stdout.columns` (fallback to 80). Use for text wrapping and responsive layouts.

### TTY Detection
Check `process.stdin.isTTY` for interactive vs piped input. Check `process.stdout.isTTY` to enable/disable colors, spinners, progress bars.

---

## Common Patterns

**Spinner → Progress**: Use ora for indefinite scanning, switch to progress bar for batch processing with known total.

**Setup Wizards**: Prompt for config with inquirer, show summary, confirm before execution, ora spinner during creation.

**Status Logging**: Combine chalk colors with symbol prefixes (ℹ blue, ✓ green, ⚠ yellow, ✗ red) to stderr for visibility in pipes.

---

**Related Files:**
- [SKILL.md](SKILL.md) - Main skill overview
- [ARGUMENT_PARSING.md](ARGUMENT_PARSING.md) - Argument parsing
- [TESTING.md](TESTING.md) - Testing CLI applications
- [PACKAGING.md](PACKAGING.md) - Packaging and distribution
