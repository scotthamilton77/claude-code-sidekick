// packages/sidekick-cli/src/commands/setup/prompts.ts
import * as readline from 'node:readline'

// Re-export promptConfirm and PromptContext from shared utils
export { promptConfirm, type PromptContext } from '../../utils/prompt.js'
import type { PromptContext } from '../../utils/prompt.js'

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
} as const

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
 * @param defaultIndex - 0-based index of the default option (selected on empty input). Defaults to 0.
 */
export async function promptSelect<T extends string>(
  ctx: PromptContext,
  question: string,
  options: Array<{ value: T; label: string; description?: string }>,
  defaultIndex = 0
): Promise<T> {
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

  const defaultNum = defaultIndex + 1
  const prompt = `Enter choice (1-${options.length}) [${defaultNum}]: `

  return new Promise((resolve) => {
    const ask = (): void => {
      ctx.stdout.write(prompt)
      rl.once('line', (answer) => {
        const trimmed = answer.trim()
        if (trimmed === '') {
          rl.close()
          resolve(options[defaultIndex].value)
        } else {
          const num = parseInt(trimmed, 10)
          if (num >= 1 && num <= options.length) {
            rl.close()
            resolve(options[num - 1].value)
          } else {
            ctx.stdout.write(
              `${colors.yellow}Invalid choice. Enter a number between 1 and ${options.length}.${colors.reset}\n`
            )
            ask()
          }
        }
      })
    }
    ask()
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
