/**
 * Numeric consensus using median calculation
 *
 * Computes the median (middle value) of three numeric inputs.
 * Null or undefined values are treated as 0 (matches Track 1 behavior).
 */

/**
 * Compute numeric consensus using median
 *
 * Algorithm:
 * 1. Convert null/undefined values to 0 (default fallback)
 * 2. Sort the three values
 * 3. Return the middle value (index 1 when sorted)
 *
 * For three values, the median is simply the middle value when sorted.
 * This provides a robust central tendency measure that's resistant to outliers.
 *
 * @param num1 - First number (null/undefined treated as 0)
 * @param num2 - Second number (null/undefined treated as 0)
 * @param num3 - Third number (null/undefined treated as 0)
 * @returns The median value
 *
 * @example
 * ```typescript
 * // Basic usage
 * const median = computeNumericConsensus(7, 9, 8);
 * console.log(median); // 8
 *
 * // With null handling
 * const median2 = computeNumericConsensus(null, 5, 10);
 * console.log(median2); // 5 (null → 0, so [0, 5, 10] → median is 5)
 *
 * // Floating point
 * const median3 = computeNumericConsensus(0.5, 0.8, 0.6);
 * console.log(median3); // 0.6
 * ```
 */
export function computeNumericConsensus(
  num1: number | null | undefined,
  num2: number | null | undefined,
  num3: number | null | undefined
): number {
  // Handle nulls - use 0 as default (matches Track 1 bash implementation)
  // Bash: [ "$num1" = "null" ] || [ -z "$num1" ] && num1=0
  const normalized1 = num1 ?? 0
  const normalized2 = num2 ?? 0
  const normalized3 = num3 ?? 0

  // Sort the three values and return the middle one (median)
  // Matches Track 1: echo "$num1" "$num2" "$num3" | jq -s 'sort | .[1]'
  const sorted = [normalized1, normalized2, normalized3].sort((a, b) => a - b)

  // Return the middle value (index 1)
  return sorted[1]!
}
