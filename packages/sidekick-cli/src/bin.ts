#!/usr/bin/env node
import process from 'node:process'

import { runCli } from './cli'

async function main(): Promise<void> {
  const result = await runCli({
    argv: process.argv.slice(2),
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
