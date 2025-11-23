/**
 * Type definitions for test data structures
 *
 * Maps to test-data/ directory structure:
 * - transcripts/golden-set.json
 * - transcripts/metadata.json
 * - transcripts/*.jsonl
 * - references/{version}/{transcript-id}/*.json
 */

/**
 * Length category for transcript classification
 */
export type LengthCategory = 'short' | 'medium' | 'long'

/**
 * Golden set transcript entry (minimal metadata)
 */
export interface GoldenSetTranscript {
  id: string
  line_count: number
  description: string
}

/**
 * Golden set collection (test-data/transcripts/golden-set.json)
 */
export interface GoldenSet {
  description: string
  selection_method: string
  selected_at: string
  total_count: number
  distribution: {
    short: number
    medium: number
    long: number
  }
  golden_ids: string[]
  transcripts: GoldenSetTranscript[]
}

/**
 * Full transcript metadata entry
 */
export interface TranscriptMetadata {
  id: string
  file: string
  source_session: string
  length_category: LengthCategory
  line_count: number
  description: string
  collected_at: string
}

/**
 * Metadata collection (test-data/transcripts/metadata.json)
 */
export interface MetadataCollection {
  dataset_version: string
  generated_at: string
  test_count: number
  distribution: {
    short: number
    medium: number
    long: number
  }
  transcripts: TranscriptMetadata[]
}

/**
 * Claude Code message (single line in transcript JSONL)
 */
export interface TranscriptMessage {
  parentUuid: string | null
  isSidechain: boolean
  userType: string
  cwd: string
  sessionId: string
  version: string
  gitBranch: string
  type: string
  message?: {
    role?: string
    content: string | object[]
    model?: string
    id?: string
    stop_reason?: string | null
    stop_sequence?: string | null
    usage?: {
      input_tokens: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
      cache_creation?: {
        ephemeral_5m_input_tokens?: number
        ephemeral_1h_input_tokens?: number
      }
      output_tokens: number
      service_tier?: string
    }
  }
  requestId?: string
  uuid: string
  timestamp: string
  thinkingMetadata?: {
    level: string
    disabled: boolean
    triggers: string[]
  }
  messageId?: string
  snapshot?: object
  isSnapshotUpdate?: boolean
}

/**
 * Full transcript (array of messages from JSONL file)
 */
export type Transcript = TranscriptMessage[]

/**
 * Reference output from a single model
 */
export interface ReferenceOutput {
  task_ids: string[] | null
  initial_goal: string
  current_objective: string
  clarity_score: number
  confidence: number
  high_clarity_snarky_comment: string | null
  low_clarity_snarky_comment: string | null
  significant_change: boolean
  _metadata?: {
    model: string
    test_id: string
    latency_seconds: number
    generated_at: string
  }
}

/**
 * Consensus output (aggregated from multiple models)
 */
export interface ConsensusOutput {
  task_ids: string[] | null
  initial_goal: string
  current_objective: string
  clarity_score: number
  confidence: number
  high_clarity_snarky_comment?: string | null
  low_clarity_snarky_comment?: string | null
  significant_change: boolean
  generated_at: string
  consensus_method: string
}

/**
 * Reference version metadata (test-data/references/{version}/_metadata.json)
 */
export interface ReferenceVersionMetadata {
  version: string
  generated_at: string
  model_configurations: {
    provider: string
    model: string
  }[]
  prompt_hash?: string
  schema_version?: string
}

/**
 * Reference directory listing
 */
export interface ReferenceDirectory {
  version: string
  path: string
  transcriptIds: string[]
  metadata?: ReferenceVersionMetadata | undefined
}
