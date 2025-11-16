/**
 * Benchmark Runner - Parallel execution of benchmark tests
 * Maps to Track 1: scripts/benchmark/run-benchmark.sh
 *
 * Responsibilities:
 * - Model selection (tags, explicit list)
 * - Transcript loading from golden set
 * - Parallel execution (N runs per transcript)
 * - Latency measurement (millisecond precision)
 * - Output organization (results/{timestamp}/raw/{provider}_{model}/)
 * - Failure tracking and early termination
 * - Statistics aggregation
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LLMProvider } from '../../lib/providers/LLMProvider.js'
import { loadGoldenSet, loadTranscript, loadConsensusOutput } from '../data/loaders.js'
import type { ConsensusOutput } from '../data/types.js'
import { extractExcerpt } from '../../lib/transcript/excerpt.js'
import { validateSchema } from '../scoring/SchemaValidator.js'
import { scoreTechnicalAccuracy } from '../scoring/TechnicalAccuracy.js'
import { scoreContentQuality } from '../scoring/ContentQuality.js'
import { calculateOverallScore } from '../scoring/Aggregator.js'
import type {
  BenchmarkOptions,
  BenchmarkResult,
  BenchmarkMetadata,
  ModelSpec,
  ModelResult,
  TestRunResult,
  ModeConfig,
  FailureTracker,
  BenchmarkMode,
  ModelFilter,
  ModelOutput,
  TestScores,
  ReferenceData,
} from './BenchmarkTypes.js'

// Mode configurations (maps to Track 1 BENCHMARK_MODE_*)
const MODE_CONFIGS: Record<BenchmarkMode, ModeConfig> = {
  smoke: { sampleCount: 3, runCount: 1 },
  quick: { sampleCount: 10, runCount: 3 },
  full: { sampleCount: 'all', runCount: 5 },
  statistical: { sampleCount: 'all', runCount: 10 },
}

// Early termination thresholds (maps to Track 1 EARLY_TERM_*)
const EARLY_TERM_JSON_FAILURES = 3
const EARLY_TERM_TIMEOUT_COUNT = 3

/**
 * Benchmark runner for parallel execution
 */
export class BenchmarkRunner {
  private readonly providers: Map<string, LLMProvider>
  private readonly judgeProvider: LLMProvider
  private readonly promptTemplate: string
  private readonly testDataRoot: string

  constructor(options: {
    providers: Map<string, LLMProvider>
    judgeProvider: LLMProvider
    promptTemplate: string
    testDataRoot?: string
  }) {
    this.providers = options.providers
    this.judgeProvider = options.judgeProvider
    this.promptTemplate = options.promptTemplate
    this.testDataRoot = options.testDataRoot || join(process.cwd(), 'test-data')
  }

  /**
   * Run benchmark with specified options
   * Maps to Track 1: run-benchmark.sh main flow
   */
  async run(options: BenchmarkOptions = {}): Promise<BenchmarkResult> {
    const mode = options.mode || 'quick'
    const modelsFilter = options.modelsFilter || 'all'
    const referenceVersion = options.referenceVersion || 'latest'
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    const outputDir = options.outputDir || join(this.testDataRoot, 'results', timestamp)

    // Create output directory
    await mkdir(outputDir, { recursive: true })
    const rawOutputDir = join(outputDir, 'raw')
    await mkdir(rawOutputDir, { recursive: true })

    // Get mode configuration
    const modeConfig = MODE_CONFIGS[mode]

    // Load transcripts
    const goldenSet = await loadGoldenSet(join(this.testDataRoot, 'transcripts'))
    const transcriptIds =
      modeConfig.sampleCount === 'all'
        ? goldenSet.golden_ids
        : goldenSet.golden_ids.slice(0, modeConfig.sampleCount)

    // Filter models
    const availableModels = options.availableModels || []
    const modelsToTest = this.filterModels(availableModels, modelsFilter)

    if (modelsToTest.length === 0) {
      throw new Error(`No models matched filter: ${modelsFilter}`)
    }

    // Find reference directory
    const referencesDir = join(this.testDataRoot, 'references')
    const referenceDir = await this.findReferenceDirectory(referencesDir, referenceVersion)

    // Load references for all transcripts
    const referenceDirName = referenceDir.split('/').pop() || ''
    const references = new Map<string, ReferenceData>()
    for (const transcriptId of transcriptIds) {
      try {
        const consensus = await loadConsensusOutput(referenceDirName, transcriptId, referencesDir)
        references.set(transcriptId, { transcriptId, consensus })
      } catch (error) {
        console.warn(`Warning: Reference not found for ${transcriptId}:`, error)
      }
    }

    // Prepare metadata
    const metadata: BenchmarkMetadata = {
      mode,
      modelsFilter: String(modelsFilter),
      referenceVersion: referenceDir.split('/').pop() || referenceVersion,
      transcriptCount: transcriptIds.length,
      runCount: modeConfig.runCount,
      timestamp: new Date().toISOString(),
      outputDir,
    }

    // Run benchmark for each model
    const modelResults: ModelResult[] = []

    for (const modelSpec of modelsToTest) {
      // eslint-disable-next-line no-console
      console.log(`Testing model: ${modelSpec.provider}:${modelSpec.model}`)

      const modelResult = await this.runModelBenchmark({
        modelSpec,
        transcriptIds,
        references,
        runCount: modeConfig.runCount,
        rawOutputDir,
      })

      modelResults.push(modelResult)

      // Log completion
      if (modelResult.terminated) {
        // eslint-disable-next-line no-console
        console.log(
          `Model ${modelSpec.provider}:${modelSpec.model} terminated: ${modelResult.terminationReason}`
        )
      } else {
        // eslint-disable-next-line no-console
        console.log(`Completed testing ${modelSpec.provider}:${modelSpec.model}`)
      }
    }

    // Build result
    const result: BenchmarkResult = {
      metadata,
      models: modelResults,
    }

    // Save summary
    const summaryPath = join(outputDir, 'summary.json')
    await writeFile(summaryPath, JSON.stringify(result, null, 2))

    // eslint-disable-next-line no-console
    console.log(`Summary saved to: ${summaryPath}`)

    return result
  }

  /**
   * Run benchmark for a single model across all transcripts
   */
  private async runModelBenchmark(params: {
    modelSpec: ModelSpec
    transcriptIds: string[]
    references: Map<string, ReferenceData>
    runCount: number
    rawOutputDir: string
  }): Promise<ModelResult> {
    const { modelSpec, transcriptIds, references, runCount, rawOutputDir } = params

    // Get provider
    const provider = this.providers.get(modelSpec.provider)
    if (!provider) {
      throw new Error(`Provider not found: ${modelSpec.provider}`)
    }

    // Create model output directory
    const modelOutputDir = join(
      rawOutputDir,
      `${modelSpec.provider}_${modelSpec.model.replace(/\//g, '_')}`
    )
    await mkdir(modelOutputDir, { recursive: true })

    // Track failures for early termination
    const failureTracker: FailureTracker = {
      consecutiveFailures: 0,
      consecutiveTimeouts: 0,
      terminated: false,
    }

    // Collect all test results
    const testResults: TestRunResult[] = []

    // Test each transcript
    for (const transcriptId of transcriptIds) {
      // Check for early termination
      if (failureTracker.terminated) {
        // eslint-disable-next-line no-console
        console.log(
          `Skipping remaining transcripts for ${modelSpec.provider}:${modelSpec.model} (early termination)`
        )
        break
      }

      // eslint-disable-next-line no-console
      console.log(`  Testing ${transcriptId} (run 1/${runCount})`)

      // Load transcript
      const transcript = await loadTranscript(transcriptId, join(this.testDataRoot, 'transcripts'))

      // Load reference
      const reference = references.get(transcriptId)
      if (!reference) {
        // eslint-disable-next-line no-console
        console.warn(`  Reference not found for ${transcriptId}, skipping`)
        continue
      }

      // Preprocess transcript
      const excerptResult = extractExcerpt(transcript, {
        lineCount: 80,
        filterToolMessages: true,
        stripMetadata: true,
      })

      // Convert messages to string (JSON format)
      const transcriptText = JSON.stringify(excerptResult.messages)

      // Prepare prompt
      const prompt = this.promptTemplate.replace('{TRANSCRIPT}', transcriptText)

      // Create test output directory
      const testOutputDir = join(modelOutputDir, transcriptId)
      await mkdir(testOutputDir, { recursive: true })

      // Run multiple iterations
      for (let runNumber = 1; runNumber <= runCount; runNumber++) {
        // eslint-disable-next-line no-console
        console.log(`    Run ${runNumber}/${runCount}...`)

        const runResult = await this.runSingleTest({
          runNumber,
          transcriptId,
          modelSpec,
          provider,
          prompt,
          reference,
          transcript: transcriptText,
          testOutputDir,
        })

        testResults.push(runResult)

        // Update failure tracking
        if (runResult.apiFailure) {
          failureTracker.consecutiveFailures++
          if (runResult.failureType === 'timeout') {
            failureTracker.consecutiveTimeouts++
          }
        } else {
          // Success! Reset failure counters
          failureTracker.consecutiveFailures = 0
          failureTracker.consecutiveTimeouts = 0
        }

        // eslint-disable-next-line no-console
        console.log(
          `    Run ${runNumber} complete: latency=${runResult.latencyMs}ms, score=${runResult.scores.overallScore}`
        )
      }

      // Check for early termination after each transcript
      // Check timeouts first (more specific) before general failures
      if (failureTracker.consecutiveTimeouts >= EARLY_TERM_TIMEOUT_COUNT) {
        failureTracker.terminated = true
        failureTracker.terminationReason = `${failureTracker.consecutiveTimeouts} consecutive timeouts`
      } else if (failureTracker.consecutiveFailures >= EARLY_TERM_JSON_FAILURES) {
        failureTracker.terminated = true
        failureTracker.terminationReason = `${failureTracker.consecutiveFailures} consecutive JSON failures`
      }
    }

    // Calculate statistics
    const modelResult = this.calculateModelStatistics(modelSpec, testResults, failureTracker)

    return modelResult
  }

  /**
   * Run a single test (one LLM invocation)
   */
  private async runSingleTest(params: {
    runNumber: number
    transcriptId: string
    modelSpec: ModelSpec
    provider: LLMProvider
    prompt: string
    reference: ReferenceData
    transcript: string
    testOutputDir: string
  }): Promise<TestRunResult> {
    const {
      runNumber,
      transcriptId,
      modelSpec,
      provider,
      prompt,
      reference,
      transcript,
      testOutputDir,
    } = params

    const timestamp = new Date().toISOString()

    // Output files
    const rawOutputFile = join(testOutputDir, `run_${runNumber}_raw.txt`)
    const outputFile = join(testOutputDir, `run_${runNumber}.json`)
    const timingFile = join(testOutputDir, `run_${runNumber}_timing.txt`)
    const errorFile = join(testOutputDir, `run_${runNumber}_error.txt`)
    const scoreFile = join(testOutputDir, `run_${runNumber}_scores.json`)

    // Measure latency and invoke model
    const startTime = Date.now()

    try {
      const response = await provider.invoke(prompt)

      const endTime = Date.now()
      const latencyMs = endTime - startTime

      // Save timing
      await writeFile(timingFile, String(latencyMs))

      // Save raw response (prettified)
      await writeFile(rawOutputFile, JSON.stringify(response, null, 2))

      // Extract JSON from response
      let output: ModelOutput | null = null
      try {
        output = provider.extractJSON<ModelOutput>(response)
        await writeFile(outputFile, JSON.stringify(output, null, 2))
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        await writeFile(errorFile, `JSON extraction failed: ${errorMessage}`)

        const failureScores: TestScores = {
          apiFailure: true,
          failureType: 'json_parse',
          schemaCompliance: { score: 0, errors: [`JSON extraction failed: ${errorMessage}`] },
          technicalAccuracy: { score: 0 },
          contentQuality: { score: 0 },
          overallScore: 0,
          timestamp,
        }

        await writeFile(scoreFile, JSON.stringify(failureScores, null, 2))

        return {
          runNumber,
          transcriptId,
          modelSpec,
          apiFailure: true,
          failureType: 'json_parse',
          output: null,
          latencyMs,
          scores: failureScores,
          rawResponse: JSON.stringify(response, null, 2),
          errorMessage,
          timestamp,
        }
      }

      // Score the output
      const scores = await this.scoreOutput(output, reference.consensus, transcript)
      scores.timestamp = timestamp
      await writeFile(scoreFile, JSON.stringify(scores, null, 2))

      return {
        runNumber,
        transcriptId,
        modelSpec,
        apiFailure: false,
        output,
        latencyMs,
        scores,
        rawResponse: JSON.stringify(response, null, 2),
        timestamp,
      }
    } catch (error) {
      const endTime = Date.now()
      const latencyMs = endTime - startTime

      const errorMessage = error instanceof Error ? error.message : String(error)
      const failureType = errorMessage.toLowerCase().includes('timeout') ? 'timeout' : 'api_error'

      await writeFile(timingFile, String(latencyMs))
      await writeFile(errorFile, errorMessage)
      await writeFile(rawOutputFile, errorMessage)

      const failureScores: TestScores = {
        apiFailure: true,
        failureType,
        schemaCompliance: { score: 0, errors: ['LLM invocation failed'] },
        technicalAccuracy: { score: 0 },
        contentQuality: { score: 0 },
        overallScore: 0,
        timestamp,
      }

      await writeFile(scoreFile, JSON.stringify(failureScores, null, 2))

      return {
        runNumber,
        transcriptId,
        modelSpec,
        apiFailure: true,
        failureType,
        output: null,
        latencyMs,
        scores: failureScores,
        errorMessage,
        timestamp,
      }
    }
  }

  /**
   * Score a model output against reference
   */
  private async scoreOutput(
    output: ModelOutput,
    reference: ConsensusOutput,
    transcript: string
  ): Promise<TestScores> {
    // Schema compliance
    const schemaScore = validateSchema(output)

    // Convert reference to TopicAnalysis format (task_ids from array to string)
    const referenceForScoring = {
      ...reference,
      task_ids: Array.isArray(reference.task_ids)
        ? reference.task_ids.join(',')
        : reference.task_ids,
      high_clarity_snarky_comment: null,
      low_clarity_snarky_comment: null,
    }

    // Technical accuracy (requires semantic similarity config)
    const technicalScore = await scoreTechnicalAccuracy(output, referenceForScoring, {
      judgeProvider: this.judgeProvider,
    })

    // Content quality
    const contentScore = await scoreContentQuality(output, transcript, {
      judgeProvider: this.judgeProvider,
    })

    // Overall score
    const overallScore = calculateOverallScore(
      schemaScore.score,
      technicalScore.score,
      contentScore.score
    )

    return {
      schemaCompliance: {
        score: schemaScore.score,
        errors: schemaScore.errors,
      },
      technicalAccuracy: {
        score: technicalScore.score,
      },
      contentQuality: {
        score: contentScore.score,
      },
      overallScore,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Calculate statistics for a model
   */
  private calculateModelStatistics(
    modelSpec: ModelSpec,
    testResults: TestRunResult[],
    failureTracker: FailureTracker
  ): ModelResult {
    // Latency stats
    const latencies = testResults.map((r) => r.latencyMs)
    const latencyStats = {
      min: Math.min(...latencies),
      max: Math.max(...latencies),
      avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      count: latencies.length,
    }

    // Score stats
    const totalRuns = testResults.length
    const apiFailures = testResults.filter((r) => r.apiFailure).length
    const timeouts = testResults.filter((r) => r.failureType === 'timeout').length
    const otherApiErrors = testResults.filter(
      (r) => r.apiFailure && r.failureType !== 'timeout'
    ).length
    const successfulRuns = totalRuns - apiFailures

    const successfulResults = testResults.filter((r) => !r.apiFailure)
    const schemaScores = successfulResults.map((r) => r.scores.schemaCompliance.score)
    const technicalScores = successfulResults.map((r) => r.scores.technicalAccuracy.score)
    const contentScores = successfulResults.map((r) => r.scores.contentQuality.score)
    const overallScores = successfulResults.map((r) => r.scores.overallScore)

    const scoreStats = {
      totalRuns,
      apiFailures,
      timeouts,
      otherApiErrors,
      successfulRuns,
      errorRate: apiFailures / totalRuns,
      timeoutRate: timeouts / totalRuns,
      otherErrorRate: otherApiErrors / totalRuns,
      schemaAvg:
        schemaScores.length > 0 ? schemaScores.reduce((a, b) => a + b, 0) / schemaScores.length : 0,
      technicalAvg:
        technicalScores.length > 0
          ? technicalScores.reduce((a, b) => a + b, 0) / technicalScores.length
          : 0,
      contentAvg:
        contentScores.length > 0
          ? contentScores.reduce((a, b) => a + b, 0) / contentScores.length
          : 0,
      overallAvg:
        overallScores.length > 0
          ? overallScores.reduce((a, b) => a + b, 0) / overallScores.length
          : 0,
    }

    return {
      provider: modelSpec.provider,
      model: modelSpec.model,
      pricing: {
        inputPerMillion: modelSpec.inputPrice,
        outputPerMillion: modelSpec.outputPrice,
      },
      tags: modelSpec.tags.join(','),
      latency: latencyStats,
      scores: scoreStats,
      terminated: failureTracker.terminated,
      ...(failureTracker.terminated && {
        terminationReason: failureTracker.terminationReason,
      }),
    }
  }

  /**
   * Filter models based on filter criteria
   */
  private filterModels(availableModels: ModelSpec[], filter: ModelFilter): ModelSpec[] {
    if (filter === 'all') {
      return availableModels
    }

    // Check for tag filters
    if (filter === 'cheap' || filter === 'expensive' || filter === 'default') {
      return availableModels.filter((spec) => spec.tags.includes(filter))
    }

    // Explicit model list (comma-separated)
    const modelNames = filter.split(',').map((m) => m.trim())
    return availableModels.filter((spec) => {
      const fullName = spec.model
      const shortName = spec.model.split('/').pop() || spec.model
      return modelNames.some((name) => name === fullName || name === shortName)
    })
  }

  /**
   * Find reference directory based on version filter
   */
  private async findReferenceDirectory(
    referencesDir: string,
    versionFilter: string
  ): Promise<string> {
    const { readdir } = await import('node:fs/promises')
    const dirs = await readdir(referencesDir)

    // Filter for version directories (format: v{VERSION}_{TIMESTAMP})
    const versionDirs = dirs
      .filter((dir) => dir.startsWith('v'))
      .sort()
      .reverse() // Most recent first

    if (versionFilter === 'latest') {
      if (versionDirs.length === 0) {
        throw new Error(`No reference directory found in ${referencesDir}`)
      }
      return join(referencesDir, versionDirs[0] || '')
    }

    // Find matching version
    const matchingDir = versionDirs.find((dir) => dir.startsWith(`${versionFilter}_`))
    if (!matchingDir) {
      throw new Error(`No reference directory found for version: ${versionFilter}`)
    }

    return join(referencesDir, matchingDir)
  }
}
