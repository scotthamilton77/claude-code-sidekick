/**
 * Technical Accuracy Scorer
 *
 * Evaluates how accurately the model extracted information from the transcript
 * by comparing output fields to a reference (consensus from high-quality models).
 *
 * Scoring breakdown (0-100 points total):
 * - task_ids exact match: 15 pts
 * - initial_goal semantic similarity: 20 pts (similarity * 20)
 * - current_objective semantic similarity: 20 pts (similarity * 20)
 * - clarity_score within ±1: 20 pts (all or nothing)
 * - significant_change match: 15 pts (boolean exact match)
 * - confidence within ±0.15: 10 pts (all or nothing)
 */

import type { TopicAnalysis, TechnicalAccuracyResult } from './types'
import type { SemanticSimilarityConfig } from './SemanticSimilarity'
import { calculateSemanticSimilarity } from './SemanticSimilarity'

/**
 * Score technical accuracy by comparing output to reference
 *
 * @param output - Model output to evaluate
 * @param reference - Reference output (consensus from high-quality models)
 * @param config - Semantic similarity configuration (judge provider)
 * @returns Technical accuracy score and detailed breakdown
 */
export async function scoreTechnicalAccuracy(
  output: TopicAnalysis,
  reference: TopicAnalysis,
  config: SemanticSimilarityConfig
): Promise<TechnicalAccuracyResult> {
  let score = 0

  // 1. task_ids exact match (15 pts)
  const taskIdsMatch = output.task_ids === reference.task_ids
  const taskIdsScore = taskIdsMatch ? 15 : 0
  score += taskIdsScore

  // 2. initial_goal semantic similarity (20 pts)
  let initialGoalSimilarity = 0.0
  let initialGoalScore = 0

  if (output.initial_goal && reference.initial_goal) {
    try {
      initialGoalSimilarity = await calculateSemanticSimilarity(
        output.initial_goal,
        reference.initial_goal,
        config
      )
      // Round to nearest integer (matching bash: awk '{printf "%.0f", $1}')
      initialGoalScore = Math.round(initialGoalSimilarity * 20)
      score += initialGoalScore
    } catch (error) {
      // If semantic similarity fails, treat as 0.0
      initialGoalSimilarity = 0.0
      initialGoalScore = 0
    }
  }

  // 3. current_objective semantic similarity (20 pts)
  let currentObjectiveSimilarity = 0.0
  let currentObjectiveScore = 0

  if (output.current_objective && reference.current_objective) {
    try {
      currentObjectiveSimilarity = await calculateSemanticSimilarity(
        output.current_objective,
        reference.current_objective,
        config
      )
      // Round to nearest integer
      currentObjectiveScore = Math.round(currentObjectiveSimilarity * 20)
      score += currentObjectiveScore
    } catch (error) {
      // If semantic similarity fails, treat as 0.0
      currentObjectiveSimilarity = 0.0
      currentObjectiveScore = 0
    }
  }

  // 4. clarity_score within ±1 (20 pts)
  const clarityDiff = Math.abs(output.clarity_score - reference.clarity_score)
  const clarityMatch = clarityDiff <= 1
  const clarityScore = clarityMatch ? 20 : 0
  score += clarityScore

  // 5. significant_change match (15 pts)
  const significantChangeMatch = output.significant_change === reference.significant_change
  const significantChangeScore = significantChangeMatch ? 15 : 0
  score += significantChangeScore

  // 6. confidence within ±0.15 (10 pts)
  // Use small epsilon to handle floating-point precision
  const CONFIDENCE_EPSILON = 1e-10
  const confidenceDiff = Math.abs(output.confidence - reference.confidence)
  const confidenceMatch = confidenceDiff <= 0.15 + CONFIDENCE_EPSILON
  const confidenceScore = confidenceMatch ? 10 : 0
  score += confidenceScore

  return {
    score,
    details: {
      task_ids_match: taskIdsMatch,
      task_ids_score: taskIdsScore,
      initial_goal_similarity: initialGoalSimilarity,
      initial_goal_score: initialGoalScore,
      current_objective_similarity: currentObjectiveSimilarity,
      current_objective_score: currentObjectiveScore,
      clarity_match: clarityMatch,
      clarity_score: clarityScore,
      significant_change_match: significantChangeMatch,
      significant_change_score: significantChangeScore,
      confidence_match: confidenceMatch,
      confidence_score: confidenceScore,
    },
  }
}
