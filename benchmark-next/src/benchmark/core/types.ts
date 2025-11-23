/**
 * Type definitions for reference generation
 * Maps to Track 1: scripts/benchmark/generate-reference.sh
 */

/**
 * Options for generating references
 */
export interface GenerateOptions {
  /** Optional test ID - if provided, only generate for this test, otherwise all golden set tests */
  testId?: string
  /** Force regeneration even if references already exist */
  force?: boolean
  /** Dry run mode - create directories and metadata but skip LLM invocations */
  dryRun?: boolean
}

/**
 * Result of reference generation run
 */
export interface GenerationResult {
  /** Path to the versioned output directory */
  versionedDir: string
  /** Total number of tests attempted */
  totalCount: number
  /** Number of successfully generated references */
  successCount: number
  /** Number of skipped tests (already existed) */
  skipCount: number
  /** Number of failed tests */
  failCount: number
  /** Duration in seconds */
  duration: number
}

/**
 * Result of generating reference for a single test
 */
export interface TestReferenceResult {
  /** Test ID */
  testId: string
  /** Individual model outputs (up to 3) */
  outputs: ModelOutput[]
  /** Consensus output computed from model outputs */
  consensus: ConsensusOutput | null
}

/**
 * Topic analysis output from a single model
 * Includes both the core analysis fields and metadata
 */
export interface ModelOutput {
  // Core topic analysis fields
  task_ids: string | null
  initial_goal: string
  current_objective: string
  clarity_score: number
  confidence: number
  high_clarity_snarky_comment: string | null
  low_clarity_snarky_comment: string | null
  significant_change: boolean

  // Metadata added by reference generator
  _metadata: ModelOutputMetadata
}

/**
 * Metadata attached to each model output
 */
export interface ModelOutputMetadata {
  /** Model spec (provider:model format) */
  model: string
  /** Test ID this output was generated for */
  test_id: string
  /** Latency in seconds */
  latency_seconds: number
  /** ISO 8601 timestamp */
  generated_at: string
}

/**
 * Consensus output computed from multiple model outputs
 * Omits snarky comments - only includes core analysis fields
 */
export interface ConsensusOutput {
  task_ids: string | null
  initial_goal: string
  current_objective: string
  clarity_score: number
  confidence: number
  significant_change: boolean
  generated_at: string
  consensus_method: string
}

/**
 * Reference metadata stored in _metadata.json
 * Captures complete provenance for the reference generation run
 */
export interface ReferenceMetadata {
  reference_version: string
  description: string
  generated_at: string
  dataset: {
    version: string
    golden_set_sha256: string
    test_count: number
  }
  models: {
    references: string[]
    judge: string
  }
  prompts: {
    topic_template: string
    topic_template_sha256: string
    schema: string
    schema_sha256: string
  }
  config: {
    excerpt_lines: number
    filter_tool_messages: boolean
    timeout_seconds: number
  }
}

/**
 * Snapshot of configuration for a reference generation run
 * Written to _prompt-snapshot/config-snapshot.sh (bash format for compatibility)
 */
export interface ConfigSnapshot {
  REFERENCE_VERSION: string
  LLM_TIMEOUT_SECONDS: number
  TOPIC_EXCERPT_LINES: number
  TOPIC_FILTER_TOOL_MESSAGES: boolean
  REFERENCE_MODELS: string[]
  JUDGE_MODEL: string
}
