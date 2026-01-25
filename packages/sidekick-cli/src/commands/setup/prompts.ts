// packages/sidekick-cli/src/commands/setup/prompts.ts
import * as readline from 'node:readline'

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
} as const

export interface PromptContext {
  stdin: NodeJS.ReadableStream
  stdout: NodeJS.WritableStream
}

/**
 * Display a header/title section.
 */
export function printHeader(ctx: PromptContext, title: string, description?: string): void {
  ctx.stdout.write('\n')
  ctx.stdout.write(`${colors.bold}${title}${colors.reset}\n`)
  ctx.stdout.write('─'.repeat(Math.min(title.length + 10, 60)) + '\n')
  if (description) {
    ctx.stdout.write(`${colors.dim}${description}${colors.reset}\n`)
  }
  ctx.stdout.write('\n')
}

/**
 * Display a status message with icon.
 */
export function printStatus(ctx: PromptContext, type: 'success' | 'warning' | 'info' | 'error', message: string): void {
  const icons = { success: '✓', warning: '⚠', info: '•', error: '✗' }
  const colorMap = { success: colors.green, warning: colors.yellow, info: colors.blue, error: '\x1b[31m' }
  ctx.stdout.write(`${colorMap[type]}${icons[type]}${colors.reset} ${message}\n`)
}

/**
 * Prompt for single-choice selection.
 */
export async function promptSelect(
  ctx: PromptContext,
  question: string,
  options: Array<{ value: string; label: string; description?: string }>
): Promise<string> {
  ctx.stdout.write(`${question}\n\n`)

  options.forEach((opt, i) => {
    ctx.stdout.write(`  ${colors.cyan}${i + 1})${colors.reset} ${opt.label}\n`)
    if (opt.description) {
      ctx.stdout.write(`     ${colors.dim}${opt.description}${colors.reset}\n`)
    }
  })

  ctx.stdout.write('\n')

  const rl = readline.createInterface({
    input: ctx.stdin,
    output: ctx.stdout,
    terminal: false,
  })

  return new Promise((resolve) => {
    ctx.stdout.write(`Enter choice (1-${options.length}): `)
    rl.once('line', (answer) => {
      rl.close()
      const num = parseInt(answer.trim(), 10)
      if (num >= 1 && num <= options.length) {
        resolve(options[num - 1].value)
      } else {
        // Default to first option
        resolve(options[0].value)
      }
    })
  })
}

/**
 * Prompt for yes/no confirmation.
 */
export async function promptConfirm(ctx: PromptContext, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]'

  const rl = readline.createInterface({
    input: ctx.stdin,
    output: ctx.stdout,
    terminal: false,
  })

  return new Promise((resolve) => {
    ctx.stdout.write(`${question} ${hint} `)
    rl.once('line', (answer) => {
      rl.close()
      const normalized = answer.trim().toLowerCase()
      if (normalized === '') {
        resolve(defaultYes)
      } else {
        resolve(normalized === 'y' || normalized === 'yes')
      }
    })
  })
}

/**
 * Prompt for text input (e.g., API key).
 */
export async function promptInput(ctx: PromptContext, question: string): Promise<string> {
  const rl = readline.createInterface({
    input: ctx.stdin,
    output: ctx.stdout,
    terminal: false,
  })

  return new Promise((resolve) => {
    ctx.stdout.write(`${question}: `)
    rl.once('line', (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}
