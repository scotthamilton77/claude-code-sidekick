/**
 * String consensus using semantic centrality
 *
 * Selects the most "central" string from 3 inputs by computing pairwise
 * semantic similarity and choosing the one with highest average similarity
 * to the other two.
 */

import { calculateSemanticSimilarity } from '../scoring/SemanticSimilarity'
import type { SemanticSimilarityConfig } from '../scoring/SemanticSimilarity'

/**
 * Result from string consensus calculation
 */
export interface StringConsensusResult {
  /** The consensus string, or null if all inputs were null/empty */
  consensus: string | null

  /** Debug information about the selection process */
  debug?: {
    /** Average similarity scores for each input */
    averages: [number, number, number]
    /** Pairwise similarity scores: [sim(1,2), sim(1,3), sim(2,3)] */
    pairwiseScores: [number, number, number]
    /** Which input was selected (0, 1, or 2) */
    selectedIndex: number
  }
}

/**
 * Compute string consensus using semantic centrality
 *
 * Algorithm:
 * 1. If all inputs are null/empty → return null
 * 2. If only one input is non-null → return that one
 * 3. If any two inputs are identical → return that one
 * 4. Otherwise, compute pairwise semantic similarity and select the string
 *    with the highest average similarity to the other two (most "central")
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @param str3 - Third string
 * @param config - Semantic similarity configuration (judge provider)
 * @param includeDebug - Include debug information in result (default: false)
 * @returns Consensus result with selected string
 *
 * @example
 * ```typescript
 * const result = await computeStringConsensus(
 *   "Fix authentication bug",
 *   "Resolve login issue",
 *   "Debug auth system",
 *   { judgeProvider }
 * );
 * console.log(result.consensus); // "Fix authentication bug" (if most central)
 * ```
 */
export async function computeStringConsensus(
  str1: string | null,
  str2: string | null,
  str3: string | null,
  config: SemanticSimilarityConfig,
  includeDebug = false
): Promise<StringConsensusResult> {
  // Normalize null/empty values
  const norm1 = str1 === null || str1 === '' ? null : str1
  const norm2 = str2 === null || str2 === '' ? null : str2
  const norm3 = str3 === null || str3 === '' ? null : str3

  // Count non-null values
  const nonNullValues: string[] = []
  if (norm1 !== null) nonNullValues.push(norm1)
  if (norm2 !== null) nonNullValues.push(norm2)
  if (norm3 !== null) nonNullValues.push(norm3)
  const nonNullCount = nonNullValues.length

  // Case 1: All null/empty
  if (nonNullCount === 0) {
    return { consensus: null }
  }

  // Case 2: Only one non-null
  if (nonNullCount === 1) {
    return { consensus: nonNullValues[0]! }
  }

  // Case 3: Two or more identical (optimization - no need for semantic similarity)
  // Check if any two are identical
  if (norm1 !== null && norm2 !== null && norm1 === norm2) {
    return { consensus: norm1 }
  }
  if (norm1 !== null && norm3 !== null && norm1 === norm3) {
    return { consensus: norm1 }
  }
  if (norm2 !== null && norm3 !== null && norm2 === norm3) {
    return { consensus: norm2 }
  }

  // Case 4: All three different - compute semantic similarity
  // We only reach this point if we have 2 or 3 non-null values that are all different

  // Build list of non-null strings with their original indices
  const stringsWithIndices: Array<{ value: string; index: number }> = []
  if (norm1 !== null) stringsWithIndices.push({ value: norm1, index: 0 })
  if (norm2 !== null) stringsWithIndices.push({ value: norm2, index: 1 })
  if (norm3 !== null) stringsWithIndices.push({ value: norm3, index: 2 })

  // If we only have 2 non-null values, compute similarity and return the one with higher similarity
  if (stringsWithIndices.length === 2) {
    const a = stringsWithIndices[0]!
    const b = stringsWithIndices[1]!

    try {
      const similarity = await calculateSemanticSimilarity(a.value, b.value, config)

      // Return first one by default (or could use similarity as tiebreaker logic if needed)
      // Track 1 returns the first one in this case
      return {
        consensus: a.value,
        ...(includeDebug && {
          debug: {
            averages: [similarity, similarity, 0], // Only two values compared
            pairwiseScores: [similarity, 0, 0],
            selectedIndex: a.index,
          },
        }),
      }
    } catch {
      // On error, return first non-null (matches Track 1 behavior)
      return { consensus: a.value }
    }
  }

  // We have 3 non-null values - compute pairwise similarities
  const s0 = stringsWithIndices[0]!
  const s1 = stringsWithIndices[1]!
  const s2 = stringsWithIndices[2]!

  let sim01 = 0.0
  let sim02 = 0.0
  let sim12 = 0.0

  try {
    // Calculate pairwise similarities
    // If any calculation fails, we use 0.0 (matches Track 1 behavior)
    try {
      sim01 = await calculateSemanticSimilarity(s0.value, s1.value, config)
    } catch {
      sim01 = 0.0
    }

    try {
      sim02 = await calculateSemanticSimilarity(s0.value, s2.value, config)
    } catch {
      sim02 = 0.0
    }

    try {
      sim12 = await calculateSemanticSimilarity(s1.value, s2.value, config)
    } catch {
      sim12 = 0.0
    }

    // Calculate average similarity for each string
    const avg0 = (sim01 + sim02) / 2
    const avg1 = (sim01 + sim12) / 2
    const avg2 = (sim02 + sim12) / 2

    // Find the string with highest average (most central)
    let maxAvg = avg0
    let selectedIdx = 0

    if (avg1 > maxAvg) {
      maxAvg = avg1
      selectedIdx = 1
    }

    if (avg2 > maxAvg) {
      maxAvg = avg2
      selectedIdx = 2
    }

    return {
      consensus: stringsWithIndices[selectedIdx]!.value,
      ...(includeDebug && {
        debug: {
          averages: [avg0, avg1, avg2],
          pairwiseScores: [sim01, sim02, sim12],
          selectedIndex: stringsWithIndices[selectedIdx]!.index,
        },
      }),
    }
  } catch {
    // If all similarity calculations fail, return first non-null string
    return { consensus: stringsWithIndices[0]!.value }
  }
}
