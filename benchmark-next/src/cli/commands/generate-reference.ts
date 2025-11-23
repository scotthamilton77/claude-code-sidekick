#!/usr/bin/env node
/**
 * Generate Reference Command
 *
 * Generate high-quality reference outputs from premium models for benchmarking.
 * Matches Track 1 bash script `generate-reference.sh` behavior.
 */

import { join } from 'path'
import {
  ReferenceGenerator,
  type ReferenceGeneratorConfig,
} from '../../benchmark/core/ReferenceGenerator.js'
import { createLogger } from '../../lib/logging/createLogger.js'
import { ClaudeProvider } from '../../lib/providers/ClaudeProvider.js'
import { OpenAIProvider } from '../../lib/providers/OpenAIProvider.js'
import { OpenRouterProvider } from '../../lib/providers/OpenRouterProvider.js'
import type { LLMProvider } from '../../lib/providers/LLMProvider.js'
import { logger } from '../formatters.js'

/**
 * Generate reference command options
 */
export interface GenerateReferenceOptions {
  testId?: string
  force?: boolean
  dryRun?: boolean
  json?: boolean
}

/**
 * Create LLM provider instances for reference generation
 */
function createReferenceProviders(): Array<{ spec: string; provider: LLMProvider }> {
  const providers: Array<{ spec: string; provider: LLMProvider }> = []
  const timeout = 30000 // 30 seconds default

  // Provider 1: Claude Sonnet 4 (direct)
  const claudeApiKey = process.env['ANTHROPIC_API_KEY']
  if (claudeApiKey) {
    providers.push({
      spec: 'claude:claude-sonnet-4-5-20250929',
      provider: new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-5-20250929',
        timeout,
        options: {
          apiKey: claudeApiKey,
        },
      }),
    })
  }

  // Provider 2: GPT-4o (direct)
  const openaiApiKey = process.env['OPENAI_API_KEY']
  if (openaiApiKey) {
    providers.push({
      spec: 'openai:gpt-4o',
      provider: new OpenAIProvider({
        type: 'openai-api',
        apiKey: openaiApiKey,
        model: 'gpt-4o',
        timeout,
      }),
    })
  }

  // Provider 3: Gemini via OpenRouter
  const openrouterApiKey = process.env['OPENROUTER_API_KEY']
  if (openrouterApiKey) {
    providers.push({
      spec: 'openrouter:google/gemini-2.0-flash-exp',
      provider: new OpenRouterProvider({
        type: 'openrouter',
        apiKey: openrouterApiKey,
        model: 'google/gemini-2.0-flash-exp',
        timeout,
      }),
    })
  }

  return providers
}

/**
 * Run generate-reference command
 */
export async function generateReference(options: GenerateReferenceOptions): Promise<void> {
  const startTime = Date.now()

  try {
    const projectRoot = process.cwd()

    // Create logger
    const logFile = join(projectRoot, '.benchmark-next', 'logs', 'generate-reference.log')
    const log = await createLogger({ filePath: logFile, level: 'info' })

    log.info(
      {
        testId: options.testId || 'all',
        force: options.force || false,
        dryRun: options.dryRun || false,
      },
      'Starting reference generation'
    )

    // Create providers
    const providers = createReferenceProviders()
    if (providers.length < 3 && !options.dryRun) {
      logger.warn(
        `Only ${providers.length} provider(s) configured. Reference generation requires 3 providers.`
      )
      if (providers.length === 0) {
        logger.error(
          'No LLM providers configured. Please set ANTHROPIC_API_KEY, OPENAI_API_KEY, and OPENROUTER_API_KEY.'
        )
        process.exit(1)
      }
    }

    logger.info(`Using ${providers.length} provider(s): ${providers.map((p) => p.spec).join(', ')}`)

    // Use first provider as judge
    const judgeProvider = providers[0]?.provider
    if (!judgeProvider) {
      logger.error('No judge provider available')
      process.exit(1)
    }

    // Create config
    const config: ReferenceGeneratorConfig = {
      referenceVersion: 'v1.0',
      description: 'Reference generation from TypeScript CLI',
      excerptLines: 80,
      filterToolMessages: true,
      timeoutSeconds: 30,
      projectRoot,
    }

    // Create reference generator
    const generator = new ReferenceGenerator(providers, judgeProvider, config)

    // Process tests
    logger.info('Generating references...')

    const result = await generator.generateReferences({
      ...(options.testId && { testId: options.testId }),
      force: options.force || false,
      dryRun: options.dryRun || false,
    })

    // Display results
    if (options.json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2))
    } else {
      // eslint-disable-next-line no-console
      console.log('')
      logger.success(`Generated ${result.successCount} reference(s)`)
      if (result.skipCount > 0) {
        logger.info(`Skipped ${result.skipCount} (already exist)`)
      }
      if (result.failCount > 0) {
        logger.warn(`Failed ${result.failCount}`)
      }
      logger.info(`Output directory: ${result.versionedDir}`)
    }

    const duration = Date.now() - startTime
    log.info(
      {
        duration,
        versionedDir: result.versionedDir,
        totalCount: result.totalCount,
        successCount: result.successCount,
        skipCount: result.skipCount,
        failCount: result.failCount,
      },
      'Reference generation complete'
    )
    logger.success(`Reference generation complete in ${Math.floor(duration / 1000)}s`)
    process.exit(0)
  } catch (error) {
    const duration = Date.now() - startTime
    logger.error(
      `Reference generation failed after ${Math.floor(duration / 1000)}s: ${error instanceof Error ? error.message : String(error)}`
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
  const options: GenerateReferenceOptions = {}

  // Simple argument parsing for direct execution
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--test-id': {
        const value = args[i + 1]
        if (value !== undefined) {
          options.testId = value
          i++
        }
        break
      }
      case '--force':
        options.force = true
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--json':
        options.json = true
        break
      case '--help':
      case '-h':
        // eslint-disable-next-line no-console
        console.log(`
Usage: npm run generate-reference -- [options]

Options:
  --test-id <id>     Generate reference for single test (e.g., "short-001")
  --force            Overwrite existing references
  --dry-run          Show what would be generated without calling LLMs
  --json             Output results in JSON format
  --help, -h         Show this help message

Examples:
  npm run generate-reference -- --test-id short-001
  npm run generate-reference -- --force
  npm run generate-reference -- --dry-run
        `)
        process.exit(0)
    }
  }

  generateReference(options).catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
