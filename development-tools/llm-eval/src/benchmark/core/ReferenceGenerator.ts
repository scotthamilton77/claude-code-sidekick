/**
 * Reference Generator
 * Maps to Track 1: scripts/benchmark/generate-reference.sh
 *
 * Generates high-quality reference outputs from premium models for benchmarking.
 * This script:
 * 1. Loads golden test set transcripts
 * 2. Invokes 3 reference models on each transcript
 * 3. Computes consensus output using semantic similarity
 * 4. Stores individual outputs and consensus with provenance
 */

/* eslint-disable no-console */

import * as fs from 'fs/promises'
import * as crypto from 'crypto'
import * as path from 'path'
import type { LLMProvider } from '../../lib/providers/LLMProvider'
import { extractExcerptFromFile } from '../../lib/transcript/excerpt'
import { computeStringConsensus } from '../consensus/StringConsensus'
import { computeNumericConsensus } from '../consensus/NumericConsensus'
import { computeBooleanConsensus } from '../consensus/BooleanConsensus'
import { computeArrayConsensus } from '../consensus/ArrayConsensus'
import { loadGoldenSet, loadMetadata } from '../data/loaders'
import type {
  GenerateOptions,
  GenerationResult,
  TestReferenceResult,
  ModelOutput,
  ConsensusOutput,
  ReferenceMetadata,
  ConfigSnapshot,
} from './types'

/**
 * Configuration for the ReferenceGenerator
 */
export interface ReferenceGeneratorConfig {
  /** Reference version (e.g., "v1.0") */
  referenceVersion: string
  /** Description for the reference run */
  description?: string
  /** Number of lines to extract from transcripts */
  excerptLines: number
  /** Whether to filter tool messages from excerpts */
  filterToolMessages: boolean
  /** Timeout in seconds for LLM invocations */
  timeoutSeconds: number
  /** Path to project root directory */
  projectRoot: string
  /** Path to test data directory */
  testDataDir?: string
  /** Path to sidekick source directory (for prompts) */
  sidekickSrcDir?: string
}

/**
 * ReferenceGenerator orchestrates the generation of reference outputs
 * from multiple premium models, computing consensus for benchmarking.
 */
export class ReferenceGenerator {
  private readonly referenceProviders: Array<{ spec: string; provider: LLMProvider }>
  private readonly judgeProvider: LLMProvider
  private readonly config: ReferenceGeneratorConfig
  private readonly testDataDir: string
  private readonly sidekickSrcDir: string
  private readonly referencesDir: string
  private readonly transcriptsDir: string

  constructor(
    referenceProviders: Array<{ spec: string; provider: LLMProvider }>,
    judgeProvider: LLMProvider,
    config: ReferenceGeneratorConfig
  ) {
    if (referenceProviders.length !== 3) {
      throw new Error('Exactly 3 reference providers required')
    }

    this.referenceProviders = referenceProviders
    this.judgeProvider = judgeProvider
    this.config = config

    // Set up paths
    this.testDataDir = config.testDataDir ?? path.join(config.projectRoot, 'test-data')
    this.sidekickSrcDir = config.sidekickSrcDir ?? path.join(config.projectRoot, 'src', 'sidekick')
    this.referencesDir = path.join(this.testDataDir, 'references')
    this.transcriptsDir = path.join(this.testDataDir, 'transcripts')
  }

  /**
   * Generate references for golden set tests
   *
   * @param options - Generation options
   * @returns Generation result with statistics
   */
  async generateReferences(options: GenerateOptions = {}): Promise<GenerationResult> {
    const startTime = Date.now()

    // Load golden set
    const goldenSet = await loadGoldenSet(this.testDataDir)
    const goldenIds = options.testId ? [options.testId] : goldenSet.golden_ids

    console.log('====================================================================')
    console.log('REFERENCE GENERATION')
    console.log('====================================================================')
    console.log(`Reference version: ${this.config.referenceVersion}`)
    console.log(`Golden set: ${goldenSet.golden_ids.length} transcripts`)
    console.log(`Reference models: ${this.referenceProviders.length}`)
    for (const { spec } of this.referenceProviders) {
      console.log(`  - ${spec}`)
    }
    console.log(`Judge model: ${this.judgeProvider.getIdentifier()}`)
    console.log('')

    if (options.testId) {
      console.log(`Mode: Single test (${options.testId})`)
    } else {
      console.log(`Mode: All tests (${goldenIds.length} transcripts)`)
    }

    // Create versioned output directory
    const versionedDir = await this.createVersionedDirectory()
    console.log(`Output dir: ${versionedDir}`)
    console.log('')

    if (options.dryRun) {
      console.log('[DRY-RUN] Would create versioned directory with prompt snapshots')
      console.log(`[DRY-RUN] Would generate ${goldenIds.length} reference outputs`)
      return {
        versionedDir,
        totalCount: goldenIds.length,
        successCount: 0,
        skipCount: 0,
        failCount: 0,
        duration: 0,
      }
    }

    // Create provenance (snapshots and metadata)
    await this.createProvenance(versionedDir, goldenIds.length)

    console.log('====================================================================')
    console.log('')

    // Track statistics
    let successCount = 0
    let skipCount = 0
    let failCount = 0

    // Generate references for each test
    for (const testId of goldenIds) {
      try {
        const result = await this.generateReferenceForTest(
          testId,
          versionedDir,
          options.force ?? false
        )

        if (result.consensus) {
          successCount++
        } else {
          skipCount++
        }
      } catch (error) {
        console.error(`ERROR: Failed to generate reference for ${testId}:`, error)
        failCount++
      }
    }

    const duration = Math.floor((Date.now() - startTime) / 1000)

    // Print summary
    console.log('')
    console.log('====================================================================')
    console.log('SUMMARY')
    console.log('====================================================================')
    console.log(`Reference version: ${this.config.referenceVersion}`)
    console.log(`Output directory:  ${versionedDir}`)
    console.log(`Total tests:       ${goldenIds.length}`)
    console.log(`Success:           ${successCount}`)
    console.log(`Skipped:           ${skipCount}`)
    console.log(`Failed:            ${failCount}`)
    console.log(`Duration:          ${duration}s`)
    console.log('')

    if (failCount > 0) {
      console.log('⚠️  Some references failed to generate')
      console.log('')
      console.log(`References stored in: ${versionedDir}`)
    } else if (successCount === 0 && skipCount > 0) {
      console.log('ℹ️  All references already exist')
    } else {
      console.log('✓ Reference generation complete!')
      console.log('')
      console.log(`References stored in: ${versionedDir}`)
    }

    return {
      versionedDir,
      totalCount: goldenIds.length,
      successCount,
      skipCount,
      failCount,
      duration,
    }
  }

  /**
   * Generate reference for a single test
   *
   * @param testId - Test ID (e.g., "short-001")
   * @param versionedDir - Versioned output directory
   * @param force - Force regeneration even if exists
   * @returns Test reference result
   */
  async generateReferenceForTest(
    testId: string,
    versionedDir: string,
    force: boolean
  ): Promise<TestReferenceResult> {
    console.log('')
    console.log('========================================')
    console.log(`Generating reference for: ${testId}`)
    console.log('========================================')

    const transcriptFile = path.join(this.transcriptsDir, `${testId}.jsonl`)

    // Check if transcript exists
    try {
      await fs.access(transcriptFile)
    } catch {
      throw new Error(`Transcript not found: ${transcriptFile}`)
    }

    // Create output directory for this test
    const outputDir = path.join(versionedDir, testId)
    await fs.mkdir(outputDir, { recursive: true })

    // Check if already exists
    const consensusFile = path.join(outputDir, 'consensus.json')
    const alreadyExists = await fs
      .access(consensusFile)
      .then(() => true)
      .catch(() => false)

    if (alreadyExists && !force) {
      console.log(`SKIP: Reference already exists for ${testId} (use --force to regenerate)`)
      return { testId, outputs: [], consensus: null }
    }

    // Extract transcript excerpt
    console.log('[EXTRACT] Extracting transcript excerpt...')
    const transcriptExcerpt = extractExcerptFromFile(transcriptFile, {
      lineCount: this.config.excerptLines,
      filterToolMessages: this.config.filterToolMessages,
      stripMetadata: true,
    })

    // Build prompt
    console.log('[PROMPT] Building prompt...')
    const prompt = await this.buildPrompt(JSON.stringify(transcriptExcerpt, null, 2))

    // Invoke reference models
    const outputs: ModelOutput[] = []
    let _failedCount = 0

    for (const { spec, provider } of this.referenceProviders) {
      console.log('')
      console.log(`Invoking reference model: ${spec}`)

      try {
        const output = await this.invokeReferenceModel(provider, spec, prompt, testId)
        outputs.push(output)

        // Save individual output
        const specParts = spec.split(':')
        const modelName =
          specParts.length > 1 && specParts[1]
            ? specParts[1].replace(/\//g, '-')
            : spec.replace(/\//g, '-')
        const outputFile = path.join(outputDir, `${modelName}.json`)
        await fs.writeFile(outputFile, JSON.stringify(output, null, 2))
        console.log(`Saved: ${outputFile}`)
      } catch (error) {
        console.error(`ERROR: Failed to get output from ${spec}:`, error)
        _failedCount++
      }
    }

    // Check if we have enough outputs for consensus
    const successCount = outputs.length
    if (successCount < 2) {
      throw new Error(
        `Need at least 2 successful model outputs for consensus (got ${successCount})`
      )
    }

    // Generate consensus
    console.log('')
    console.log(`[CONSENSUS] Computing consensus from ${successCount} model outputs...`)

    let consensus: ConsensusOutput

    if (successCount === 3) {
      // All 3 models succeeded - TypeScript knows outputs has at least 3 elements
      consensus = await this.computeConsensus(outputs[0]!, outputs[1]!, outputs[2]!)
    } else {
      // Only 2 models succeeded - duplicate the second for consensus voting
      consensus = await this.computeConsensus(outputs[0]!, outputs[1]!, outputs[1]!)
    }

    // Save consensus
    await fs.writeFile(consensusFile, JSON.stringify(consensus, null, 2))
    console.log(`Saved consensus: ${consensusFile}`)

    console.log(`✓ Reference generation complete for ${testId}`)

    return { testId, outputs, consensus }
  }

  /**
   * Create versioned directory with timestamp
   * Format: {version}_{timestamp}/ (e.g., v1.0_2025-11-11_120000)
   */
  private async createVersionedDirectory(): Promise<string> {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .substring(0, 19)
      .replace(/-/g, (_match, offset) => (offset < 10 ? '-' : ''))

    const timestampParts = timestamp.split('_')
    const formattedTimestamp =
      timestampParts[0] + '_' + (timestampParts[1] ? timestampParts[1].replace(/-/g, '') : '')
    const versionedDir = path.join(
      this.referencesDir,
      `${this.config.referenceVersion}_${formattedTimestamp}`
    )

    await fs.mkdir(versionedDir, { recursive: true })

    return versionedDir
  }

  /**
   * Create provenance tracking for the reference run
   * - Snapshots of prompt files
   * - Configuration snapshot
   * - Metadata with checksums
   */
  private async createProvenance(versionedDir: string, testCount: number): Promise<void> {
    console.log('[SNAPSHOT] Creating versioned reference directory with provenance...')

    // Create snapshot directory
    const snapshotDir = path.join(versionedDir, '_prompt-snapshot')
    await fs.mkdir(snapshotDir, { recursive: true })

    // Snapshot prompt files
    const promptFile = path.join(this.sidekickSrcDir, 'features', 'prompts', 'topic-only.txt')
    const schemaFile = path.join(this.sidekickSrcDir, 'features', 'prompts', 'topic-schema.json')

    let promptSha256 = ''
    let schemaSha256 = ''

    try {
      const promptContent = await fs.readFile(promptFile, 'utf8')
      await fs.writeFile(path.join(snapshotDir, 'topic-only.txt'), promptContent)
      promptSha256 = crypto.createHash('sha256').update(promptContent).digest('hex')
      console.log('  Snapshotted: topic-only.txt')
    } catch (error) {
      console.warn(`  WARN: Prompt file not found: ${promptFile}`)
    }

    try {
      const schemaContent = await fs.readFile(schemaFile, 'utf8')
      await fs.writeFile(path.join(snapshotDir, 'topic-schema.json'), schemaContent)
      schemaSha256 = crypto.createHash('sha256').update(schemaContent).digest('hex')
      console.log('  Snapshotted: topic-schema.json')
    } catch (error) {
      console.warn(`  WARN: Schema file not found: ${schemaFile}`)
    }

    // Create config snapshot (bash format for compatibility)
    const configSnapshot: ConfigSnapshot = {
      REFERENCE_VERSION: this.config.referenceVersion,
      LLM_TIMEOUT_SECONDS: this.config.timeoutSeconds,
      TOPIC_EXCERPT_LINES: this.config.excerptLines,
      TOPIC_FILTER_TOOL_MESSAGES: this.config.filterToolMessages,
      REFERENCE_MODELS: this.referenceProviders.map((p) => p.spec),
      JUDGE_MODEL: this.judgeProvider.getIdentifier(),
    }

    const configSnapshotContent = `# Configuration snapshot for reference generation
# Generated: ${new Date().toISOString()}

REFERENCE_VERSION="${configSnapshot.REFERENCE_VERSION}"
LLM_TIMEOUT_SECONDS=${configSnapshot.LLM_TIMEOUT_SECONDS}
TOPIC_EXCERPT_LINES=${configSnapshot.TOPIC_EXCERPT_LINES}
TOPIC_FILTER_TOOL_MESSAGES=${configSnapshot.TOPIC_FILTER_TOOL_MESSAGES}

# Reference models
REFERENCE_MODELS=(
${configSnapshot.REFERENCE_MODELS.map((m) => `    "${m}"`).join('\n')}
)

# Judge model
JUDGE_MODEL="${configSnapshot.JUDGE_MODEL}"
`

    await fs.writeFile(path.join(snapshotDir, 'config-snapshot.sh'), configSnapshotContent)
    console.log('  Snapshotted: config-snapshot.sh')

    // Compute golden set SHA256
    const goldenSetFile = path.join(this.testDataDir, 'transcripts', 'golden-set.json')
    const goldenSetContent = await fs.readFile(goldenSetFile, 'utf8')
    const goldenSetSha256 = crypto.createHash('sha256').update(goldenSetContent).digest('hex')

    // Load dataset version from metadata
    const metadata = await loadMetadata(this.testDataDir)
    const datasetVersion = metadata.dataset_version

    // Create metadata
    const referenceMetadata: ReferenceMetadata = {
      reference_version: this.config.referenceVersion,
      description: this.config.description ?? 'Reference generation for golden test set',
      generated_at: new Date().toISOString(),
      dataset: {
        version: datasetVersion,
        golden_set_sha256: goldenSetSha256,
        test_count: testCount,
      },
      models: {
        references: this.referenceProviders.map((p) => p.spec),
        judge: this.judgeProvider.getIdentifier(),
      },
      prompts: {
        topic_template: 'topic-only.txt',
        topic_template_sha256: promptSha256,
        schema: 'topic-schema.json',
        schema_sha256: schemaSha256,
      },
      config: {
        excerpt_lines: this.config.excerptLines,
        filter_tool_messages: this.config.filterToolMessages,
        timeout_seconds: this.config.timeoutSeconds,
      },
    }

    await fs.writeFile(
      path.join(versionedDir, '_metadata.json'),
      JSON.stringify(referenceMetadata, null, 2)
    )
    console.log('  Created: _metadata.json')
    console.log('[SNAPSHOT] Versioned reference directory ready')
  }

  /**
   * Build prompt from transcript excerpt
   * Replaces {TRANSCRIPT} placeholder in template
   */
  private async buildPrompt(transcriptJson: string): Promise<string> {
    const promptFile = path.join(this.sidekickSrcDir, 'features', 'prompts', 'topic-only.txt')
    let template = await fs.readFile(promptFile, 'utf8')

    // Replace placeholders
    template = template.replace('{PREVIOUS_TOPIC}', '') // No previous topic for reference generation
    template = template.replace('{TRANSCRIPT}', transcriptJson)

    return template
  }

  /**
   * Invoke a reference model and extract structured output
   */
  private async invokeReferenceModel(
    provider: LLMProvider,
    modelSpec: string,
    prompt: string,
    testId: string
  ): Promise<ModelOutput> {
    const startTime = Date.now()

    // Load JSON schema
    const schemaFile = path.join(this.sidekickSrcDir, 'features', 'prompts', 'topic-schema.json')
    const schemaContent = await fs.readFile(schemaFile, 'utf8')
    const jsonSchema = JSON.parse(schemaContent) as Record<string, unknown>

    // Invoke LLM
    const response = await provider.invoke(prompt, {
      timeout: this.config.timeoutSeconds * 1000,
      jsonSchema,
    })

    const latency = Math.floor((Date.now() - startTime) / 1000)

    // Extract JSON from response
    const output = provider.extractJSON<Omit<ModelOutput, '_metadata'>>(response)

    // Add metadata
    const modelOutput: ModelOutput = {
      ...output,
      _metadata: {
        model: modelSpec,
        test_id: testId,
        latency_seconds: latency,
        generated_at: new Date().toISOString(),
      },
    }

    return modelOutput
  }

  /**
   * Compute consensus from 3 model outputs
   * Uses consensus algorithms for each field type
   */
  private async computeConsensus(
    output1: ModelOutput,
    output2: ModelOutput,
    output3: ModelOutput
  ): Promise<ConsensusOutput> {
    console.log('[CONSENSUS] Computing consensus for task_ids...')
    // Parse task_ids from comma-delimited string to array
    const parseTaskIds = (taskIds: string | null): string[] | null => {
      if (!taskIds) return null
      return taskIds
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    }

    const taskIdsArray = computeArrayConsensus(
      parseTaskIds(output1.task_ids),
      parseTaskIds(output2.task_ids),
      parseTaskIds(output3.task_ids)
    )

    // Convert back to comma-delimited string
    const taskIds = taskIdsArray ? taskIdsArray.join(',') : null

    console.log('[CONSENSUS] Computing consensus for initial_goal...')
    const initialGoalResult = await computeStringConsensus(
      output1.initial_goal,
      output2.initial_goal,
      output3.initial_goal,
      { judgeProvider: this.judgeProvider }
    )

    console.log('[CONSENSUS] Computing consensus for current_objective...')
    const currentObjectiveResult = await computeStringConsensus(
      output1.current_objective,
      output2.current_objective,
      output3.current_objective,
      { judgeProvider: this.judgeProvider }
    )

    console.log('[CONSENSUS] Computing consensus for clarity_score...')
    const clarityScore = computeNumericConsensus(
      output1.clarity_score,
      output2.clarity_score,
      output3.clarity_score
    )

    console.log('[CONSENSUS] Computing consensus for confidence...')
    const confidence = computeNumericConsensus(
      output1.confidence,
      output2.confidence,
      output3.confidence
    )

    console.log('[CONSENSUS] Computing consensus for significant_change...')
    const significantChange = computeBooleanConsensus(
      output1.significant_change,
      output2.significant_change,
      output3.significant_change
    )

    return {
      task_ids: taskIds,
      initial_goal: initialGoalResult.consensus ?? '',
      current_objective: currentObjectiveResult.consensus ?? '',
      clarity_score: clarityScore,
      confidence,
      significant_change: significantChange,
      generated_at: new Date().toISOString(),
      consensus_method: 'semantic_similarity_median_majority',
    }
  }
}
