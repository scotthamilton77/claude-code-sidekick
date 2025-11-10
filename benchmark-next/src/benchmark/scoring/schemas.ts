/**
 * Zod schemas for topic extraction and scoring
 */

import { z } from 'zod'

/**
 * Topic analysis schema matching topic-schema.json
 *
 * Validates:
 * - Required fields presence
 * - Field types (string, number, boolean, null unions)
 * - Numeric ranges (clarity_score: 1-10, confidence: 0.0-1.0)
 * - String length constraints (maxLength: 60 and 120)
 */
export const TopicAnalysisSchema = z.object({
  task_ids: z.string().nullable(),
  initial_goal: z.string().max(60),
  current_objective: z.string().max(60),
  clarity_score: z.number().int().min(1).max(10),
  confidence: z.number().min(0.0).max(1.0),
  high_clarity_snarky_comment: z.string().max(120).nullable(),
  low_clarity_snarky_comment: z.string().max(120).nullable(),
  significant_change: z.boolean(),
})

/**
 * Semantic similarity score schema
 */
export const SimilarityScoreSchema = z.object({
  score: z.number().min(0.0).max(1.0),
})

/**
 * Schema validation result
 */
export const SchemaValidationResultSchema = z.object({
  score: z.number().min(0).max(100),
  errors: z.array(z.string()),
})
