/**
 * Boolean consensus using majority vote
 *
 * Implements simple majority voting: if 2 or more values are true, return true.
 * Otherwise return false. Null and undefined values are treated as false.
 */

/**
 * Compute boolean consensus using majority vote
 *
 * Algorithm:
 * 1. Normalize each value: true → true, everything else → false
 * 2. Count how many values are true
 * 3. Return true if count >= 2, otherwise false
 *
 * For three boolean values, this implements a simple majority voting system
 * where at least 2 of 3 models must agree for consensus to be true.
 *
 * @param bool1 - First boolean (null/undefined treated as false)
 * @param bool2 - Second boolean (null/undefined treated as false)
 * @param bool3 - Third boolean (null/undefined treated as false)
 * @returns true if 2+ values are true, false otherwise
 *
 * @example
 * ```typescript
 * // Basic usage
 * const consensus = computeBooleanConsensus(true, false, true);
 * console.log(consensus); // true (2 out of 3 are true)
 *
 * // With null handling
 * const consensus2 = computeBooleanConsensus(null, true, true);
 * console.log(consensus2); // true (null → false, so 2 out of 3 are true)
 *
 * // Minority vote
 * const consensus3 = computeBooleanConsensus(true, false, false);
 * console.log(consensus3); // false (only 1 out of 3 is true)
 * ```
 */
export function computeBooleanConsensus(
  bool1: boolean | null | undefined,
  bool2: boolean | null | undefined,
  bool3: boolean | null | undefined
): boolean {
  // Normalize to true/false (matches Track 1 bash implementation)
  // Bash: [ "$bool1" = "true" ] && bool1=1 || bool1=0
  // Only explicit true is treated as true, everything else (false, null, undefined) becomes false
  const normalized1 = bool1 === true ? 1 : 0
  const normalized2 = bool2 === true ? 1 : 0
  const normalized3 = bool3 === true ? 1 : 0

  // Count trues
  // Bash: local true_count=$((bool1 + bool2 + bool3))
  const trueCount = normalized1 + normalized2 + normalized3

  // Majority vote: return true if 2 or more are true
  // Bash: if [ $true_count -ge 2 ]; then echo "true"; else echo "false"; fi
  return trueCount >= 2
}
