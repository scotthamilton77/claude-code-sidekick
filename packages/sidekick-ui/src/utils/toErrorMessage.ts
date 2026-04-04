/**
 * Extract a human-readable message from an unknown error value.
 *
 * Re-exported locally because @sidekick/core is CJS and Vite's Rollup
 * bundler cannot resolve named CJS exports in the client bundle.
 *
 * @see packages/sidekick-core/src/error-utils.ts — canonical implementation
 */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
