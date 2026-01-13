/**
 * Scoring types for benchmark system
 */

/**
 * Topic extraction output schema
 */
export interface TopicAnalysis {
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
 * Schema validation result
 */
export interface SchemaValidationResult {
  score: number
  errors: string[]
}

/**
 * Technical accuracy scoring result
 */
export interface TechnicalAccuracyResult {
  score: number
  details: {
    task_ids_match: boolean
    task_ids_score: number
    initial_goal_similarity: number
    initial_goal_score: number
    current_objective_similarity: number
    current_objective_score: number
    clarity_match: boolean
    clarity_score: number
    significant_change_match: boolean
    significant_change_score: number
    confidence_match: boolean
    confidence_score: number
  }
}

/**
 * Content quality scoring result
 */
export interface ContentQualityResult {
  score: number
  details: {
    field_used: string
    comment_length: number
    present_score: number
    length_score: number
    relevance_similarity: number
    relevance_score: number
  }
}

/**
 * Overall scoring result
 */
export interface ScoringResult {
  schema_compliance: SchemaValidationResult
  technical_accuracy: TechnicalAccuracyResult
  content_quality: ContentQualityResult
  overall_score: number
  timestamp: string
}
