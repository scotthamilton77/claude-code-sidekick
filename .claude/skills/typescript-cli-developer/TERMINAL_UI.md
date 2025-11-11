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

```typescript
import chalk from 'chalk';

// Basic colors
console.log(chalk.blue('Info:'), 'Processing files...');
console.log(chalk.green('Success:'), 'Build completed!');
console.log(chalk.yellow('Warning:'), 'Deprecated API used');
console.log(chalk.red('Error:'), 'Build failed!');

// Background colors
console.log(chalk.bgRed.white(' ERROR '), 'Critical failure');
console.log(chalk.bgGreen.black(' PASS '), 'All tests passed');

// Combine styles
console.log(chalk.bold.green('✓'), 'All tests passed');
console.log(chalk.dim('(123 files processed)'));
console.log(chalk.underline('Important'));
console.log(chalk.italic('Note:'), 'This is a note');

// Hex and RGB colors
console.log(chalk.hex('#FF6B6B')('Custom color'));
console.log(chalk.rgb(255, 136, 0)('Orange text'));

// Conditional coloring
const status = hasErrors ? chalk.red('FAILED') : chalk.green('PASSED');
console.log(`Tests: ${status}`);

// Template literals
console.log(chalk`
  {green Success:} Built {bold ${fileCount}} files
  {dim Output:} ${outputDir}
`);
```

### Color Detection

```typescript
import chalk from 'chalk';

// chalk auto-detects color support via supports-color
// It respects NO_COLOR and FORCE_COLOR environment variables

// Manual control:
const forceColor = new chalk.Instance({ level: 3 }); // Force 24-bit color
const noColor = new chalk.Instance({ level: 0 });    // Disable colors

// Check support level
import supportsColor from 'supports-color';

if (supportsColor.stdout) {
  console.log('Color level:', supportsColor.stdout.level);
  // level 1: Basic 16 colors
  // level 2: ANSI 256 colors
  // level 3: 16 million colors (true color)
}
```

### Common Color Patterns

```typescript
// Status messages
function logInfo(message: string) {
  console.log(chalk.blue('ℹ'), message);
}

function logSuccess(message: string) {
  console.log(chalk.green('✓'), message);
}

function logWarning(message: string) {
  console.log(chalk.yellow('⚠'), message);
}

function logError(message: string) {
  console.error(chalk.red('✗'), message);
}

// Highlight important parts
console.log(`Found ${chalk.bold(count)} matches in ${chalk.cyan(filename)}`);

// Diff-like output
console.log(chalk.red('- Removed line'));
console.log(chalk.green('+ Added line'));
console.log(chalk.dim('  Unchanged line'));
```

---

## Spinners

### ora - Elegant Terminal Spinners

**Install:** `npm install ora`

```typescript
import ora from 'ora';

// Basic usage
const spinner = ora('Loading...').start();

try {
  await longRunningOperation();
  spinner.succeed('Operation completed!');
} catch (error) {
  spinner.fail('Operation failed');
  throw error;
}

// Update spinner text
spinner.text = 'Still working...';

// Change spinner type
spinner.spinner = 'dots';
spinner.spinner = 'line';
spinner.spinner = 'arrow3';

// Change color
spinner.color = 'yellow';
spinner.color = 'cyan';
```

### Advanced Spinner Patterns

```typescript
import ora from 'ora';

// Sequential operations
const spinner = ora();

spinner.start('Downloading dependencies...');
await downloadDeps();

spinner.text = 'Installing packages...';
await installPackages();

spinner.text = 'Building project...';
await build();

spinner.succeed('Project ready!');

// Conditional success/failure
const spinner = ora('Running tests...').start();
const results = await runTests();

if (results.passed === results.total) {
  spinner.succeed(`All ${results.total} tests passed`);
} else {
  spinner.fail(`${results.failed} of ${results.total} tests failed`);
}

// Warnings
const spinner = ora('Checking dependencies...').start();
const warnings = await checkDeps();

if (warnings.length > 0) {
  spinner.warn(`Found ${warnings.length} warnings`);
} else {
  spinner.succeed('All dependencies up to date');
}

// Info
spinner.info('No changes detected');

// Stop without symbol
spinner.stop();
spinner.clear();
```

### Multiple Spinners

```typescript
import ora from 'ora';

const spinners = {
  download: ora('Downloading...'),
  install: ora('Installing...'),
  build: ora('Building...'),
};

// Start all
spinners.download.start();
spinners.install.start();
spinners.build.start();

// Update as tasks complete
await download();
spinners.download.succeed();

await install();
spinners.install.succeed();

await build();
spinners.build.succeed();
```

---

## Progress Bars

### cli-progress - Flexible Progress Bars

**Install:** `npm install cli-progress`

```typescript
import cliProgress from 'cli-progress';

// Basic progress bar
const bar = new cliProgress.SingleBar({
  format: 'Progress |{bar}| {percentage}% | {value}/{total} Files',
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
});

bar.start(totalFiles, 0);

for (let i = 0; i < totalFiles; i++) {
  await processFile(files[i]);
  bar.update(i + 1);
}

bar.stop();
```

### Custom Formatting

```typescript
const bar = new cliProgress.SingleBar({
  format: '{task} |{bar}| {percentage}% | ETA: {eta}s | {value}/{total}',
  barCompleteChar: '#',
  barIncompleteChar: '-',
  hideCursor: true,
});

bar.start(total, 0, { task: 'Processing' });

for (let i = 0; i < total; i++) {
  await process(items[i]);
  bar.update(i + 1, { task: `Processing ${items[i].name}` });
}

bar.stop();
```

### Multiple Progress Bars

```typescript
import cliProgress from 'cli-progress';

const multibar = new cliProgress.MultiBar({
  format: '{task} |{bar}| {percentage}% | {value}/{total}',
  clearOnComplete: false,
  hideCursor: true,
});

const downloadBar = multibar.create(100, 0, { task: 'Download' });
const installBar = multibar.create(50, 0, { task: 'Install ' });
const buildBar = multibar.create(30, 0, { task: 'Build   ' });

// Update bars independently
downloadBar.update(50);
installBar.update(25);
buildBar.update(10);

// ...

multibar.stop();
```

### Progress Bar with Color

```typescript
import chalk from 'chalk';
import cliProgress from 'cli-progress';

const bar = new cliProgress.SingleBar({
  format: `${chalk.cyan('{task}')} |{bar}| ${chalk.yellow('{percentage}%')} | {value}/{total}`,
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
});
```

---

## Interactive Prompts

### inquirer - Full-Featured Prompts

**Install:** `npm install inquirer`

```typescript
import inquirer from 'inquirer';

const answers = await inquirer.prompt([
  {
    type: 'input',
    name: 'projectName',
    message: 'Project name:',
    default: 'my-project',
    validate: (input) => {
      if (input.length === 0) {
        return 'Name is required';
      }
      if (!/^[a-z0-9-]+$/.test(input)) {
        return 'Name must be lowercase alphanumeric with hyphens';
      }
      return true;
    },
  },
  {
    type: 'list',
    name: 'template',
    message: 'Choose a template:',
    choices: ['basic', 'advanced', 'minimal'],
    default: 'basic',
  },
  {
    type: 'confirm',
    name: 'useTypescript',
    message: 'Use TypeScript?',
    default: true,
  },
  {
    type: 'checkbox',
    name: 'features',
    message: 'Select features:',
    choices: [
      { name: 'Linting (ESLint)', value: 'linting', checked: true },
      { name: 'Testing (Vitest)', value: 'testing', checked: true },
      { name: 'CI/CD (GitHub Actions)', value: 'ci-cd' },
      { name: 'Docker support', value: 'docker' },
    ],
  },
  {
    type: 'password',
    name: 'apiKey',
    message: 'API key:',
    mask: '*',
  },
  {
    type: 'editor',
    name: 'description',
    message: 'Project description (opens editor):',
  },
]);

console.log(answers.projectName);    // string
console.log(answers.template);       // 'basic' | 'advanced' | 'minimal'
console.log(answers.useTypescript);  // boolean
console.log(answers.features);       // string[]
```

### Conditional Questions

```typescript
const answers = await inquirer.prompt([
  {
    type: 'confirm',
    name: 'useDatabase',
    message: 'Use a database?',
  },
  {
    type: 'list',
    name: 'database',
    message: 'Which database?',
    choices: ['PostgreSQL', 'MySQL', 'SQLite'],
    when: (answers) => answers.useDatabase, // Only ask if useDatabase is true
  },
]);
```

### prompts - Lightweight Alternative

**Install:** `npm install prompts`

```typescript
import prompts from 'prompts';

const response = await prompts([
  {
    type: 'text',
    name: 'name',
    message: 'Project name?',
    initial: 'my-project',
    validate: (value) => value.length > 0 || 'Name is required',
  },
  {
    type: 'select',
    name: 'template',
    message: 'Choose template',
    choices: [
      { title: 'Basic', value: 'basic' },
      { title: 'Advanced', value: 'advanced' },
      { title: 'Minimal', value: 'minimal' },
    ],
    initial: 0,
  },
  {
    type: 'toggle',
    name: 'typescript',
    message: 'Use TypeScript?',
    initial: true,
    active: 'yes',
    inactive: 'no',
  },
  {
    type: 'multiselect',
    name: 'features',
    message: 'Select features',
    choices: [
      { title: 'Linting', value: 'lint', selected: true },
      { title: 'Testing', value: 'test', selected: true },
      { title: 'CI/CD', value: 'ci' },
    ],
  },
]);

// Handle Ctrl+C gracefully
if (!response.name) {
  console.log('Cancelled');
  process.exit(0);
}
```

---

## Tables

### cli-table3 - Formatted Tables

**Install:** `npm install cli-table3`

```typescript
import Table from 'cli-table3';
import chalk from 'chalk';

// Basic table
const table = new Table({
  head: [chalk.cyan('Name'), chalk.cyan('Status'), chalk.cyan('Time')],
  colWidths: [30, 15, 10],
});

table.push(
  ['Authentication', chalk.green('✓ PASS'), '123ms'],
  ['Database', chalk.red('✗ FAIL'), '456ms'],
  ['API', chalk.yellow('⚠ WARN'), '789ms']
);

console.log(table.toString());
```

### Table Styles

```typescript
// Compact style
const compactTable = new Table({
  head: ['Name', 'Value'],
  style: {
    head: ['cyan'],
    compact: true,
  },
});

// Borderless
const borderlessTable = new Table({
  chars: {
    'top': '', 'top-mid': '', 'top-left': '', 'top-right': '',
    'bottom': '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
    'left': '', 'left-mid': '', 'mid': '', 'mid-mid': '',
    'right': '', 'right-mid': '', 'middle': ' ',
  },
  style: { 'padding-left': 0, 'padding-right': 0 },
});

// Markdown-style
const mdTable = new Table({
  chars: {
    'top': '', 'top-mid': '', 'top-left': '', 'top-right': '',
    'bottom': '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
    'left': '|', 'left-mid': '', 'mid': '', 'mid-mid': '',
    'right': '|', 'right-mid': '', 'middle': '|',
  },
});
```

### Horizontal Tables

```typescript
const table = new Table();

table.push(
  { 'Name': 'John Doe' },
  { 'Email': 'john@example.com' },
  { 'Role': 'Admin' }
);

console.log(table.toString());
// Output:
// ┌───────┬──────────────────┐
// │ Name  │ John Doe         │
// ├───────┼──────────────────┤
// │ Email │ john@example.com │
// ├───────┼──────────────────┤
// │ Role  │ Admin            │
// └───────┴──────────────────┘
```

### Complex Tables

```typescript
const table = new Table({
  head: ['Module', 'Tests', 'Coverage', 'Status'],
  colAligns: ['left', 'right', 'right', 'center'],
  colWidths: [25, 10, 12, 10],
});

table.push(
  ['Authentication', '42', '95.2%', chalk.green('PASS')],
  ['Database', '38', '87.5%', chalk.green('PASS')],
  ['API', '56', '72.1%', chalk.yellow('WARN')],
  ['Utilities', '28', '98.8%', chalk.green('PASS')]
);

console.log(table.toString());
```

---

## Feature Detection

### Unicode Support

**Install:** `npm install is-unicode-supported`

```typescript
import isUnicodeSupported from 'is-unicode-supported';

const useUnicode = isUnicodeSupported();

// Use appropriate characters
const checkmark = useUnicode ? '✓' : '√';
const crossmark = useUnicode ? '✗' : 'x';
const info = useUnicode ? 'ℹ' : 'i';
const warning = useUnicode ? '⚠' : '!';
const spinner = useUnicode ? '◐◓◑◒' : '|/-\\';

console.log(`${checkmark} Test passed`);
console.log(`${crossmark} Test failed`);
```

### Terminal Width

```typescript
import { stdout } from 'process';

const width = stdout.columns || 80;

// Wrap text to terminal width
function wrapText(text: string, maxWidth: number = width): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + word).length > maxWidth) {
      lines.push(currentLine.trim());
      currentLine = '';
    }
    currentLine += word + ' ';
  }

  if (currentLine) {
    lines.push(currentLine.trim());
  }

  return lines.join('\n');
}
```

### TTY Detection

```typescript
import { stdin, stdout, stderr } from 'process';

// Check if running in interactive terminal
if (stdin.isTTY) {
  // Interactive mode - can use prompts, spinners
  const answer = await promptUser();
} else {
  // Piped input - read from stdin
  const input = await readStdin();
}

if (stdout.isTTY) {
  // Can use colors, spinners, progress bars
  const spinner = ora('Loading...').start();
} else {
  // Piped output - use plain text
  console.log('Loading...');
}
```

---

## Common Patterns

### Loading State with Spinner and Progress

```typescript
import ora from 'ora';
import cliProgress from 'cli-progress';

async function processFiles(files: string[]) {
  const spinner = ora(`Scanning ${files.length} files...`).start();

  // Scan phase
  const tasks = await scanFiles(files);
  spinner.succeed(`Found ${tasks.length} tasks`);

  // Processing phase with progress
  const bar = new cliProgress.SingleBar({
    format: 'Processing |{bar}| {percentage}% | {value}/{total}',
  });

  bar.start(tasks.length, 0);

  for (let i = 0; i < tasks.length; i++) {
    await processTask(tasks[i]);
    bar.update(i + 1);
  }

  bar.stop();
  console.log(chalk.green('✓'), 'All tasks completed');
}
```

### Interactive Setup Wizard

```typescript
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';

async function setupProject() {
  console.log(chalk.bold.cyan('\n🚀 Project Setup Wizard\n'));

  const config = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Project name:',
      validate: (input) => input.length > 0 || 'Required',
    },
    {
      type: 'list',
      name: 'template',
      message: 'Template:',
      choices: ['basic', 'advanced'],
    },
    {
      type: 'checkbox',
      name: 'features',
      message: 'Features:',
      choices: ['linting', 'testing', 'ci/cd'],
    },
  ]);

  console.log(chalk.dim('\nConfiguration:'));
  console.log(chalk.dim(JSON.stringify(config, null, 2)));

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Create project?',
      default: true,
    },
  ]);

  if (!confirm) {
    console.log(chalk.yellow('Cancelled'));
    return;
  }

  const spinner = ora('Creating project...').start();
  await createProject(config);
  spinner.succeed('Project created!');
}
```

---

**Related Files:**
- [SKILL.md](SKILL.md) - Main skill overview
- [ARGUMENT_PARSING.md](ARGUMENT_PARSING.md) - Argument parsing
- [TESTING.md](TESTING.md) - Testing CLI applications
- [PACKAGING.md](PACKAGING.md) - Packaging and distribution
