/**
 * Content Quality Scorer
 *
 * Evaluates the quality of snarky comments in topic analysis outputs.
 * Matches Track 1 bash implementation: scripts/benchmark/lib/scoring.sh::score_content_quality()
 *
 * Scoring dimensions (0-100 total):
 * - Presence (20 pts): Comment exists and is not null/empty
 * - Length (20 pts): Comment length is 20-120 characters
 * - Relevance (60 pts): Semantic similarity to first 500 chars of transcript * 60
 *
 * Field selection:
 * - clarity_score >= 7: use high_clarity_snarky_comment
 * - clarity_score < 7: use low_clarity_snarky_comment
 */

import { calculateSemanticSimilarity } from './SemanticSimilarity'
import type { TopicAnalysis, ContentQualityResult } from './types'
import type { SemanticSimilarityConfig } from './SemanticSimilarity'

/**
 * Score content quality of a snarky comment
 *
 * @param output - The topic analysis output to score
 * @param transcript - Full transcript text (first 500 chars used for relevance)
 * @param config - Semantic similarity configuration
 * @returns Content quality score with detailed breakdown
 */
export async function scoreContentQuality(
  output: TopicAnalysis,
  transcript: string,
  config: SemanticSimilarityConfig
): Promise<ContentQualityResult> {
  let score = 0

  // Determine which field to use based on clarity_score
  const clarity = output.clarity_score
  const fieldUsed = clarity >= 7 ? 'high_clarity_snarky_comment' : 'low_clarity_snarky_comment'

  // Get the comment from the appropriate field
  const comment = output[fieldUsed] ?? ''

  // 1. Presence scoring (20 pts)
  const presentScore = comment.length > 0 ? 20 : 0
  score += presentScore

  // 2. Length scoring (20 pts) - must be 20-120 chars
  const commentLength = comment.length
  const lengthScore = commentLength >= 20 && commentLength <= 120 ? 20 : 0
  score += lengthScore

  // 3. Relevance scoring (60 pts) - semantic similarity to transcript excerpt
  let relevanceSimilarity = 0.0
  let relevanceScore = 0

  if (comment.length > 0) {
    // Use first 500 characters of transcript for comparison
    const transcriptExcerpt = transcript.slice(0, 500)

    try {
      relevanceSimilarity = await calculateSemanticSimilarity(comment, transcriptExcerpt, config)
      // Scale similarity (0.0-1.0) to score (0-60)
      relevanceScore = Math.round(relevanceSimilarity * 60)
      score += relevanceScore
    } catch (error) {
      // On error, relevance is 0.0 (no points awarded)
      relevanceSimilarity = 0.0
      relevanceScore = 0
    }
  }

  return {
    score,
    details: {
      field_used: fieldUsed,
      comment_length: commentLength,
      present_score: presentScore,
      length_score: lengthScore,
      relevance_similarity: relevanceSimilarity,
      relevance_score: relevanceScore,
    },
  }
}
