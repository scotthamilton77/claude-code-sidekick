/**
 * JSON diff computation using microdiff for generic snapshot comparison.
 *
 * This module computes structural differences between any two JSON objects,
 * supporting the generic Snapshot Diff View requirement (Phase 7.B.3).
 *
 * It wraps microdiff to provide:
 * - Type-safe diff operations
 * - Path formatting for nested changes
 * - Change categorization (add/remove/modify)
 */

import diff from 'microdiff'
import type { Difference } from 'microdiff'

/**
 * Categorized change types for visual distinction
 */
export type ChangeType = 'add' | 'remove' | 'modify'

/**
 * Enriched diff entry with categorized change type and formatted path
 */
export interface DiffEntry {
  /** Type of change for visual distinction */
  type: ChangeType
  /** Path to the changed value (e.g., "tokens.input" or "items[2].name") */
  path: string
  /** Old value (undefined for additions) */
  oldValue?: unknown
  /** New value (undefined for deletions) */
  newValue?: unknown
  /** Raw microdiff operation type */
  rawType: Difference['type']
}

/**
 * Compute diff between two JSON objects
 *
 * @param previous - The previous snapshot (baseline)
 * @param current - The current snapshot (comparison target)
 * @returns Array of enriched diff entries for rendering
 *
 * @example
 * ```ts
 * const prev = { count: 5, user: { name: "Alice" } }
 * const curr = { count: 10, user: { name: "Alice", role: "admin" } }
 * const changes = computeDiff(prev, curr)
 * // [
 * //   { type: 'modify', path: 'count', oldValue: 5, newValue: 10 },
 * //   { type: 'add', path: 'user.role', newValue: 'admin' }
 * // ]
 * ```
 */
export function computeDiff(previous: unknown, current: unknown): DiffEntry[] {
  const rawDiff = diff(previous as Record<string, unknown>, current as Record<string, unknown>)

  return rawDiff.map((d) => {
    const path = formatPath(d.path)
    const changeType = categorizeChange(d.type)

    const entry: DiffEntry = {
      type: changeType,
      path,
      rawType: d.type,
    }

    // Populate values based on operation type
    if (d.type === 'CREATE') {
      entry.newValue = d.value
    } else if (d.type === 'REMOVE') {
      entry.oldValue = d.oldValue
    } else if (d.type === 'CHANGE') {
      entry.oldValue = d.oldValue
      entry.newValue = d.value
    }

    return entry
  })
}

/**
 * Format microdiff path array into human-readable string
 *
 * @param path - Array of property keys and array indices
 * @returns Formatted path string (e.g., "user.address[0].city")
 *
 * @example
 * ```ts
 * formatPath(['user', 'address', 0, 'city']) // "user.address[0].city"
 * formatPath(['tokens', 'input']) // "tokens.input"
 * ```
 */
function formatPath(path: (string | number)[]): string {
  return path.reduce<string>((acc, segment, idx) => {
    if (typeof segment === 'number') {
      // Array index
      return `${acc}[${segment}]`
    } else {
      // Object property
      return idx === 0 ? segment : `${acc}.${segment}`
    }
  }, '')
}

/**
 * Categorize microdiff operation types into visual change types
 *
 * @param rawType - Microdiff operation type
 * @returns Categorized change type for UI rendering
 */
function categorizeChange(rawType: Difference['type']): ChangeType {
  switch (rawType) {
    case 'CREATE':
      return 'add'
    case 'REMOVE':
      return 'remove'
    case 'CHANGE':
      return 'modify'
    default:
      // Fallback for any future microdiff types
      return 'modify'
  }
}

/**
 * Check if two values are deeply equal (no differences)
 *
 * @param a - First value
 * @param b - Second value
 * @returns True if values are structurally identical
 */
export function isEqual(a: unknown, b: unknown): boolean {
  return diff(a as Record<string, unknown>, b as Record<string, unknown>).length === 0
}
