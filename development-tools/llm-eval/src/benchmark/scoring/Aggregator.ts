/**
 * Weighted score aggregator for benchmark scoring system
 *
 * Combines three scoring dimensions into an overall score using weighted average:
 * - Schema compliance: 30%
 * - Technical accuracy: 50%
 * - Content quality: 20%
 *
 * Maps to: `lib/scoring.sh::calculate_overall_score()`
 */

/**
 * Weights for each scoring dimension
 * These weights match the Track 1 bash implementation:
 * overall_score=$(echo "scale=2; ($schema_score * 0.30) + ($technical_score * 0.50) + ($content_score * 0.20)" | bc)
 */
const WEIGHTS = {
  SCHEMA: 0.3, // 30%
  TECHNICAL: 0.5, // 50%
  CONTENT: 0.2, // 20%
} as const

/**
 * Calculate overall weighted score from three scoring dimensions
 *
 * @param schemaScore - Schema compliance score (0-100)
 * @param technicalScore - Technical accuracy score (0-100)
 * @param contentScore - Content quality score (0-100)
 * @returns Overall weighted score (0-100), rounded to 2 decimal places
 *
 * @example
 * ```typescript
 * // Perfect scores across all dimensions
 * calculateOverallScore(100, 100, 100) // => 100
 *
 * // Mixed scores
 * calculateOverallScore(80, 60, 40) // => 62
 *
 * // Realistic scenario: perfect schema, good technical, decent content
 * calculateOverallScore(100, 85, 60) // => 84.5
 * ```
 */
export function calculateOverallScore(
  schemaScore: number,
  technicalScore: number,
  contentScore: number
): number {
  // Calculate weighted average
  // Formula: (schema * 0.30) + (technical * 0.50) + (content * 0.20)
  const weightedSum =
    schemaScore * WEIGHTS.SCHEMA +
    technicalScore * WEIGHTS.TECHNICAL +
    contentScore * WEIGHTS.CONTENT

  // Round to 2 decimal places to match Track 1's bc scale=2 behavior
  return Math.round(weightedSum * 100) / 100
}
