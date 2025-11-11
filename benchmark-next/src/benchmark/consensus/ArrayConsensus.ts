/**
 * Array consensus using union with majority voting
 *
 * For array fields (like task_ids), include any item that appears in at least
 * 2 of the 3 model outputs. Returns deduplicated array or null.
 *
 * Behavioral parity with: scripts/benchmark/lib/consensus.sh::consensus_array_field()
 */

/**
 * Compute array consensus using union with majority requirement
 *
 * Algorithm:
 * 1. Normalize inputs: null/undefined → empty array
 * 2. If all arrays are empty, return null
 * 3. Combine all arrays and count occurrences of each item
 * 4. Include items that appear in 2+ arrays (majority)
 * 5. Return deduplicated array, or null if empty
 *
 * For three arrays, this implements a consensus algorithm where an item
 * must be present in at least 2 of 3 arrays to be included in the result.
 *
 * @param arr1 - First array (null/undefined treated as empty)
 * @param arr2 - Second array (null/undefined treated as empty)
 * @param arr3 - Third array (null/undefined treated as empty)
 * @returns Array of items appearing in 2+ arrays, or null if empty
 *
 * @example
 * ```typescript
 * // Basic usage - item in 2+ arrays
 * const consensus = computeArrayConsensus(
 *   ['T123', 'T456'],
 *   ['T123', 'T789'],
 *   ['T123', 'T999']
 * );
 * console.log(consensus); // ['T123'] (appears in all 3)
 *
 * // With duplicates within arrays
 * const consensus2 = computeArrayConsensus(
 *   ['T123', 'T123', 'T456'],
 *   ['T123', 'T789'],
 *   ['T456', 'T999']
 * );
 * console.log(consensus2); // ['T123', 'T456'] (both in 2+ arrays)
 *
 * // No consensus - all items unique to one array
 * const consensus3 = computeArrayConsensus(
 *   ['T123'],
 *   ['T456'],
 *   ['T789']
 * );
 * console.log(consensus3); // null (no item appears in 2+ arrays)
 *
 * // With null handling
 * const consensus4 = computeArrayConsensus(
 *   null,
 *   ['T123', 'T456'],
 *   ['T123', 'T789']
 * );
 * console.log(consensus4); // ['T123'] (appears in 2 arrays)
 * ```
 */
export function computeArrayConsensus(
  arr1: string[] | null | undefined,
  arr2: string[] | null | undefined,
  arr3: string[] | null | undefined
): string[] | null {
  // Normalize inputs: null/undefined → empty array
  // Bash: [ "$arr1" = "null" ] || [ -z "$arr1" ] && arr1=""
  const normalized1 = arr1 ?? []
  const normalized2 = arr2 ?? []
  const normalized3 = arr3 ?? []

  // If all empty, return null
  // Bash: if [ -z "$arr1" ] && [ -z "$arr2" ] && [ -z "$arr3" ]; then echo "null"; return 0; fi
  if (normalized1.length === 0 && normalized2.length === 0 && normalized3.length === 0) {
    return null
  }

  // Count occurrences of each item across arrays
  // We need to track which arrays contain each item (not how many times within an array)
  const itemArrays = new Map<string, Set<number>>()

  // Process each array, tracking which array index contains each item
  const arrays = [normalized1, normalized2, normalized3]
  arrays.forEach((arr, arrayIndex) => {
    // Use Set to deduplicate items within the same array
    const uniqueItems = new Set(arr)
    uniqueItems.forEach((item) => {
      if (item.length > 0) {
        // Filter empty strings
        if (!itemArrays.has(item)) {
          itemArrays.set(item, new Set())
        }
        itemArrays.get(item)!.add(arrayIndex)
      }
    })
  })

  // Include items that appear in 2+ arrays
  // Bash: map(select(length >= 2) | .[0])
  const consensus: string[] = []
  itemArrays.forEach((arrayIndices, item) => {
    if (arrayIndices.size >= 2) {
      consensus.push(item)
    }
  })

  // Return null if empty, else the array
  // Bash: if [ -z "$combined" ]; then echo "null"; else echo "$combined"; fi
  return consensus.length > 0 ? consensus : null
}
