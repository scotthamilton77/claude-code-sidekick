/**
 * Type definitions for benchmark runner
 * Maps to Track 1: scripts/benchmark/run-benchmark.sh
 */

/**
 * Benchmark execution mode
 * Maps to Track 1: BENCHMARK_MODE_SAMPLES and BENCHMARK_MODE_RUNS
 */
export type BenchmarkMode = 'smoke' | 'quick' | 'full' | 'statistical'

/**
 * Model filter type
 * Maps to Track 1: --models parameter
 */
export type ModelFilter =
  | 'all'
  | 'cheap'
  | 'expensive'
  | 'default'
  | (string & Record<never, never>)

/**
 * Model specification
 * Maps to Track 1: BENCHMARK_MODELS array format
 * Format: "provider:model_name|input_price|output_price|tags"
 */
export interface ModelSpec {
  /** Provider name (e.g., "openrouter", "claude-cli", "openai-api") */
  provider: string
  /** Model name (e.g., "google/gemma-3-4b-it") */
  model: string
  /** Input price per million tokens */
  inputPrice: number
  /** Output price per million tokens */
  outputPrice: number
  /** Tags for filtering (e.g., ["cheap", "fast"]) */
  tags: string[]
}

/**
 * Benchmark run options
 * Maps to Track 1: run-benchmark.sh options
 */
export interface BenchmarkOptions {
  /** Benchmark mode (default: quick) */
  mode?: BenchmarkMode
  /** Models filter (default: all) */
  modelsFilter?: ModelFilter
  /** Reference version to use (default: latest) */
  referenceVersion?: string
  /** Output directory for results (default: test-data/results/{timestamp}) */
  outputDir?: string
  /** Available models to choose from */
  availableModels?: ModelSpec[]
}

/**
 * Benchmark execution result
 * Maps to Track 1: summary.json structure
 */
export interface BenchmarkResult {
  /** Benchmark run metadata */
  metadata: BenchmarkMetadata
  /** Per-model results */
  models: ModelResult[]
}

/**
 * Benchmark run metadata
 * Maps to Track 1: summary.json::benchmark_metadata
 */
export interface BenchmarkMetadata {
  mode: BenchmarkMode
  modelsFilter: string
  referenceVersion: string
  transcriptCount: number
  runCount: number
  timestamp: string
  outputDir: string
}

/**
 * Result for a single model
 * Maps to Track 1: summary.json::models array element
 */
export interface ModelResult {
  provider: string
  model: string
  pricing: {
    inputPerMillion: number
    outputPerMillion: number
  }
  tags: string
  latency: LatencyStats
  scores: ScoreStats
  /** True if model was terminated early */
  terminated?: boolean
  /** Reason for early termination */
  terminationReason?: string
}

/**
 * Latency statistics
 * Maps to Track 1: summary.json::latency
 */
export interface LatencyStats {
  min: number
  max: number
  avg: number
  count: number
}

/**
 * Score statistics
 * Maps to Track 1: summary.json::scores
 */
export interface ScoreStats {
  totalRuns: number
  apiFailures: number
  timeouts: number
  otherApiErrors: number
  successfulRuns: number
  errorRate: number
  timeoutRate: number
  otherErrorRate: number
  schemaAvg: number
  technicalAvg: number
  contentAvg: number
  overallAvg: number
}

/**
 * Result of running a single test
 * Maps to Track 1: run_N.json and run_N_scores.json files
 */
export interface TestRunResult {
  /** Run number (1-based) */
  runNumber: number
  /** Test ID */
  transcriptId: string
  /** Model spec */
  modelSpec: ModelSpec
  /** True if API call failed */
  apiFailure: boolean
  /** Failure type if apiFailure is true */
  failureType?: 'timeout' | 'api_error' | 'json_parse'
  /** Extracted JSON output (null on failure) */
  output: ModelOutput | null
  /** Latency in milliseconds */
  latencyMs: number
  /** Scores (all 0 on failure) */
  scores: TestScores
  /** Raw API response */
  rawResponse?: string
  /** Error message if failed */
  errorMessage?: string
  /** ISO 8601 timestamp */
  timestamp: string
}

/**
 * Model output structure (topic analysis)
 * Maps to Track 1: output JSON structure
 */
export interface ModelOutput {
  task_ids: string | null
  initial_goal: string
  current_objective: string
  clarity_score: number
  confidence: number
  high_clarity_snarky_comment: string | null
  low_clarity_snarky_comment: string | null
  significant_change: boolean
}

/**
 * Test scores
 * Maps to Track 1: run_N_scores.json structure
 */
export interface TestScores {
  apiFailure?: boolean
  failureType?: string
  schemaCompliance: {
    score: number
    errors?: string[]
  }
  technicalAccuracy: {
    score: number
  }
  contentQuality: {
    score: number
  }
  overallScore: number
  timestamp: string
}

/**
 * Mode configuration
 * Maps to Track 1: BENCHMARK_MODE_SAMPLES and BENCHMARK_MODE_RUNS
 */
export interface ModeConfig {
  /** Number of transcripts to test ("all" or number) */
  sampleCount: number | 'all'
  /** Number of runs per transcript */
  runCount: number
}

/**
 * Failure tracking for early termination
 * Maps to Track 1: consecutive_failures and consecutive_timeouts tracking
 */
export interface FailureTracker {
  consecutiveFailures: number
  consecutiveTimeouts: number
  terminated: boolean
  terminationReason?: string
}

/**
 * Reference data for scoring
 * Maps to Track 1: consensus.json file
 */
export interface ReferenceData {
  transcriptId: string
  consensus: {
    task_ids: string[] | null
    initial_goal: string
    current_objective: string
    clarity_score: number
    confidence: number
    significant_change: boolean
    generated_at: string
    consensus_method: string
  }
}
