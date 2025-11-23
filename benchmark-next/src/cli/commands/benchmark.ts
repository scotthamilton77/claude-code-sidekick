#!/usr/bin/env node
/**
 * Benchmark Command
 *
 * Executes LLM models against test transcripts and measures performance.
 * Matches Track 1 bash script `run-benchmark.sh` behavior.
 */

import { join } from 'path'
import { readFileSync } from 'fs'
import { BenchmarkRunner } from '../../benchmark/core/BenchmarkRunner.js'
import { createLogger } from '../../lib/logging/createLogger.js'
import { ClaudeProvider } from '../../lib/providers/ClaudeProvider.js'
import { OpenAIProvider } from '../../lib/providers/OpenAIProvider.js'
import { OpenRouterProvider } from '../../lib/providers/OpenRouterProvider.js'
import type { LLMProvider } from '../../lib/providers/LLMProvider.js'
import { formatBenchmarkResults, logger, ProgressIndicator } from '../formatters.js'
import type { BenchmarkMode } from '../../benchmark/core/BenchmarkTypes.js'

/**
 * Benchmark command options
 */
export interface BenchmarkOptions {
  mode?: string
  models?: string
  referenceVersion?: string
  outputDir?: string
  json?: boolean
}

/**
 * Create LLM provider instances based on configuration and environment
 */
function createProviders(): Map<string, LLMProvider> {
  const providers = new Map<string, LLMProvider>()

  // For now, use environment variables directly
  // In future, these could come from Config
  const timeout = 30000 // 30 seconds default

  // Claude provider (from ANTHROPIC_API_KEY env var)
  const claudeApiKey = process.env['ANTHROPIC_API_KEY']
  if (claudeApiKey) {
    const provider = new ClaudeProvider({
      type: 'claude-cli',
      model: 'claude-sonnet-4-5-20250929',
      timeout,
      options: {
        apiKey: claudeApiKey,
      },
    })
    providers.set('claude', provider)
  }

  // OpenAI provider (from OPENAI_API_KEY env var)
  const openaiApiKey = process.env['OPENAI_API_KEY']
  if (openaiApiKey) {
    const provider = new OpenAIProvider({
      type: 'openai-api',
      apiKey: openaiApiKey,
      model: 'gpt-4o',
      timeout,
    })
    providers.set('openai', provider)
  }

  // OpenRouter provider (from OPENROUTER_API_KEY env var)
  const openrouterApiKey = process.env['OPENROUTER_API_KEY']
  if (openrouterApiKey) {
    const provider = new OpenRouterProvider({
      type: 'openrouter',
      apiKey: openrouterApiKey,
      model: 'google/gemini-2.0-flash-exp',
      timeout,
    })
    providers.set('openrouter', provider)
  }

  return providers
}

/**
 * Run benchmark command
 */
export async function runBenchmark(options: BenchmarkOptions): Promise<void> {
  const startTime = Date.now()

  try {
    const projectRoot = process.cwd()

    // Create logger
    const logFile = join(projectRoot, '.benchmark-next', 'logs', 'benchmark.log')
    const log = await createLogger({ filePath: logFile, level: 'info' })

    log.info(
      {
        mode: options.mode || 'quick',
        models: options.models || 'all',
        referenceVersion: options.referenceVersion || 'latest',
      },
      'Starting benchmark'
    )

    // Create providers
    const providers = createProviders()
    if (providers.size === 0) {
      logger.error(
        'No LLM providers configured. Please set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY.'
      )
      process.exit(1)
    }

    logger.info(`Loaded ${providers.size} provider(s): ${Array.from(providers.keys()).join(', ')}`)

    // Use first provider as judge (for similarity scoring)
    const judgeProvider = Array.from(providers.values())[0]
    if (!judgeProvider) {
      logger.error('No judge provider available')
      process.exit(1)
    }

    // Load prompt template
    const promptPath = join(projectRoot, 'src', 'sidekick', 'features', 'prompts', 'topic-only.txt')
    const promptTemplate = readFileSync(promptPath, 'utf-8')

    // Create benchmark runner
    const runner = new BenchmarkRunner({
      providers,
      judgeProvider,
      promptTemplate,
      testDataRoot: join(projectRoot, 'test-data'),
    })

    // Run benchmark
    logger.info('Running benchmark...')
    const progress = new ProgressIndicator(100, 'Benchmark', !options.json)

    const result = await runner.run({
      mode: (options.mode as BenchmarkMode) || 'quick',
      modelsFilter: options.models || 'all',
      referenceVersion: options.referenceVersion || 'latest',
      ...(options.outputDir && { outputDir: options.outputDir }),
    })

    progress.complete(`Processed ${result.models.length} model(s)`)

    // Format and display results
    const output = formatBenchmarkResults(result, { json: options.json || false })
    // eslint-disable-next-line no-console
    console.log('\n' + output)

    // Exit with appropriate code - check if any model was terminated
    const anyTerminated = result.models.some((m) => m.terminated)
    if (anyTerminated) {
      logger.warn('Benchmark terminated early for some models')
      process.exit(1)
    }

    const duration = Date.now() - startTime
    log.info({ duration, outputDir: result.metadata.outputDir }, 'Benchmark complete')
    logger.success(`Benchmark complete in ${Math.floor(duration / 1000)}s`)
    process.exit(0)
  } catch (error) {
    const duration = Date.now() - startTime
    logger.error(
      `Benchmark failed after ${Math.floor(duration / 1000)}s: ${error instanceof Error ? error.message : String(error)}`
    )

    if (error instanceof Error && error.stack) {
      console.error('\n' + error.stack)
    }

    process.exit(1)
  }
}

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const options: BenchmarkOptions = {}

  // Simple argument parsing for direct execution
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--mode': {
        const value = args[i + 1]
        if (value !== undefined) {
          options.mode = value
          i++
        }
        break
      }
      case '--models': {
        const value = args[i + 1]
        if (value !== undefined) {
          options.models = value
          i++
        }
        break
      }
      case '--reference-version': {
        const value = args[i + 1]
        if (value !== undefined) {
          options.referenceVersion = value
          i++
        }
        break
      }
      case '--output-dir': {
        const value = args[i + 1]
        if (value !== undefined) {
          options.outputDir = value
          i++
        }
        break
      }
      case '--json':
        options.json = true
        break
      case '--help':
      case '-h':
        // eslint-disable-next-line no-console
        console.log(`
Usage: npm run benchmark -- [options]

Options:
  --mode <mode>                Benchmark mode: smoke|quick|full|statistical (default: quick)
  --models <models>            Models to test: all|cheap|expensive|model1,model2,... (default: all)
  --reference-version <ver>    Reference version to use (default: latest)
  --output-dir <dir>           Output directory for results
  --json                       Output results in JSON format
  --help, -h                   Show this help message

Examples:
  npm run benchmark -- --mode smoke
  npm run benchmark -- --mode quick --models cheap
  npm run benchmark -- --mode full --models "gemma-3-12b-it,gpt-5-nano"
        `)
        process.exit(0)
    }
  }

  runBenchmark(options).catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
