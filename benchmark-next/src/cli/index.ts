#!/usr/bin/env node
/**
 * CLI Entry Point for Benchmark System
 *
 * Provides command-line interface for:
 * - Running benchmarks against test transcripts
 * - Generating reference outputs from premium models
 *
 * Usage:
 *   npm run benchmark -- [options]
 *   npm run generate-reference -- [options]
 *
 * Or directly:
 *   tsx src/cli/benchmark.ts [options]
 *   tsx src/cli/generate-reference.ts [options]
 */

import { Command } from 'commander'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import type { BenchmarkOptions } from './commands/benchmark.js'
import type { GenerateReferenceOptions } from './commands/generate-reference.js'

// Get package.json for version
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as {
  version: string
}

const program = new Command()

program
  .name('benchmark')
  .description('Claude Code benchmarking system - TypeScript edition')
  .version(packageJson.version)

// benchmark command
program
  .command('run')
  .description('Execute benchmark against test transcripts')
  .option('--mode <mode>', 'Benchmark mode: smoke|quick|full|statistical', 'quick')
  .option('--models <models>', 'Models to test: all|cheap|expensive|model1,model2,...', 'all')
  .option('--reference-version <version>', 'Reference version to use', 'latest')
  .option('--output-dir <dir>', 'Output directory for results')
  .option('--json', 'Output results in JSON format')
  .action(async (options: BenchmarkOptions) => {
    const { runBenchmark } = await import('./commands/benchmark.js')
    await runBenchmark(options)
  })

// generate-reference command
program
  .command('generate-reference')
  .alias('gen-ref')
  .description('Generate reference outputs from premium models')
  .option('--test-id <id>', 'Generate reference for single test (e.g., "short-001")')
  .option('--force', 'Overwrite existing references', false)
  .option('--dry-run', 'Show what would be generated without calling LLMs', false)
  .option('--json', 'Output results in JSON format')
  .action(async (options: GenerateReferenceOptions) => {
    const { generateReference } = await import('./commands/generate-reference.js')
    await generateReference(options)
  })

// Parse and execute
program.parse(process.argv)

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp()
}
