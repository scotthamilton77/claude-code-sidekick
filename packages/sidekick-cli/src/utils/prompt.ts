/**
 * Shared interactive prompt utilities for the CLI package.
 */
import * as readline from 'node:readline'

const colors = {
  yellow: '\x1b[1;33m',
  reset: '\x1b[0m',
} as const

/**
 * Context for interactive prompts: requires an input stream and output stream.
 */
export interface PromptContext {
  stdin: NodeJS.ReadableStream
  stdout: NodeJS.WritableStream
}

/**
 * Prompt for yes/no confirmation.
 *
 * Retries on invalid input. EOF-safe: uses a safeResolve guard to prevent
 * double-resolution when readline 'close' fires after 'line'.
 *
 * @param ctx - Input/output streams
 * @param question - The yes/no question to display
 * @param defaultYes - Whether empty input means "yes" (default: false)
 * @returns true if the user confirmed, false otherwise
 */
export async function promptConfirm(ctx: PromptContext, question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]'

  const rl = readline.createInterface({
    input: ctx.stdin,
    output: ctx.stdout,
    terminal: false,
  })

  const prompt = `${question} ${hint} `

  return new Promise((resolve) => {
    let resolved = false
    const safeResolve = (value: boolean): void => {
      if (!resolved) {
        resolved = true
        resolve(value)
      }
    }

    // Handle stdin close/EOF -- resolve with default if no answer was read
    rl.once('close', () => {
      safeResolve(defaultYes)
    })

    const ask = (): void => {
      ctx.stdout.write(prompt)
      rl.once('line', (answer) => {
        const normalized = answer.trim().toLowerCase()
        if (normalized === '') {
          safeResolve(defaultYes)
          rl.close()
        } else if (normalized === 'y' || normalized === 'yes') {
          safeResolve(true)
          rl.close()
        } else if (normalized === 'n' || normalized === 'no') {
          safeResolve(false)
          rl.close()
        } else {
          ctx.stdout.write(`${colors.yellow}Please enter y or n.${colors.reset}\n`)
          ask()
        }
      })
    }
    ask()
  })
}
