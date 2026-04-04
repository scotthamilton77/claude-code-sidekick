/**
 * Error Utilities
 *
 * Shared helpers for safely extracting information from unknown error values.
 * Replaces the ubiquitous `err instanceof Error ? err.message : String(err)` pattern.
 */

/**
 * Extract a human-readable message from an unknown error value.
 *
 * - `Error` instances return `.message`
 * - All other values return `String(value)`
 *
 * @param error - The caught value (may not be an Error)
 * @returns A string suitable for logging or display
 */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
