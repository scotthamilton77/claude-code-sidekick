/**
 * Semantic similarity scoring using LLM-as-Judge
 *
 * Uses a judge model to rate semantic similarity between two texts
 * on a scale from 0.0 (completely different) to 1.0 (identical meaning).
 */

import type { LLMResponse } from '../../lib/providers/types'
import type { ZodSchema } from 'zod'
import { SimilarityScoreSchema } from './schemas'

/**
 * Minimal LLM provider interface for semantic similarity
 */
export interface SimilarityJudgeProvider {
  invoke(prompt: string): Promise<LLMResponse>
  extractJSON<T>(response: LLMResponse, schema: ZodSchema<T>): T
}

/**
 * Semantic similarity configuration
 */
export interface SemanticSimilarityConfig {
  /** Primary judge model provider */
  judgeProvider: SimilarityJudgeProvider

  /** Optional fallback judge model provider */
  fallbackProvider?: SimilarityJudgeProvider
}

/**
 * Similarity scoring guidelines for judge model
 */
const SIMILARITY_PROMPT_TEMPLATE = `Rate the semantic similarity between these two texts on a scale from 0.0 to 1.0.

Scoring guidelines:
- 1.0: Identical or nearly identical in meaning
- 0.9-0.99: Same core meaning with minor wording differences
- 0.7-0.89: Similar meaning but different phrasing or details
- 0.5-0.69: Related but with notable differences in focus or specifics
- 0.3-0.49: Loosely related or tangentially connected
- 0.0-0.29: Completely different topics or meanings

Return your response as JSON matching the provided schema.

Text A: {TEXT1}

Text B: {TEXT2}`

/**
 * Calculate semantic similarity between two texts using LLM-as-Judge
 *
 * @param text1 - First text to compare
 * @param text2 - Second text to compare
 * @param config - Configuration with judge provider(s)
 * @returns Similarity score (0.0-1.0)
 * @throws Error if both primary and fallback judges fail
 */
export async function calculateSemanticSimilarity(
  text1: string,
  text2: string,
  config: SemanticSimilarityConfig
): Promise<number> {
  // Validate inputs
  if (!text1 || !text2) {
    throw new Error('Both text1 and text2 must be non-empty')
  }

  // Optimization: identical texts
  if (text1 === text2) {
    return 1.0
  }

  // Build prompt
  const prompt = SIMILARITY_PROMPT_TEMPLATE.replace('{TEXT1}', text1).replace('{TEXT2}', text2)

  // Try primary judge
  try {
    const response = await config.judgeProvider.invoke(prompt)
    const parsed = config.judgeProvider.extractJSON(response, SimilarityScoreSchema)
    return parsed.score
  } catch (primaryError) {
    // Try fallback if available
    if (config.fallbackProvider) {
      try {
        const response = await config.fallbackProvider.invoke(prompt)
        const parsed = config.fallbackProvider.extractJSON(response, SimilarityScoreSchema)
        return parsed.score
      } catch (fallbackError) {
        throw new Error(
          `Both primary and fallback judge models failed for semantic similarity: ${String(primaryError)}; ${String(fallbackError)}`
        )
      }
    }

    throw new Error(
      `Judge model failed for semantic similarity (no fallback configured): ${String(primaryError)}`
    )
  }
}
