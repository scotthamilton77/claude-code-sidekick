#!/usr/bin/env node
/**
 * CLI Binary Entrypoint
 *
 * Reads hook input JSON from stdin (per CLI.md §3.1) and invokes the CLI.
 *
 * @see docs/design/CLI.md §3.1.1 Hook Input Structure
 */
import process from 'node:process'
import { createInterface } from 'node:readline'

import { runCli } from './cli'

/**
 * Read all data from stdin (non-blocking).
 * Returns empty string if stdin is a TTY (interactive mode).
 */
async function readStdin(): Promise<string> {
  // Skip stdin reading if running interactively
  if (process.stdin.isTTY) {
    return ''
  }

  const chunks: string[] = []
  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    chunks.push(line)
  }

  return chunks.join('\n')
}

async function main(): Promise<void> {
  // Read hook input from stdin (per CLI.md §3.1)
  const stdinData = await readStdin()

  const result = await runCli({
    argv: process.argv.slice(2),
    stdinData,
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
  })
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error('[FATAL] sidekick-cli failed during bootstrap', error)
  process.exit(1)
})
