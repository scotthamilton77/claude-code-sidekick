/**
 * Custom errors for StateService operations.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */

/**
 * Thrown when a required state file is not found and no default was provided.
 */
export class StateNotFoundError extends Error {
  readonly name = 'StateNotFoundError'

  constructor(public readonly path: string) {
    super(`State file not found: ${path}`)
  }
}

/**
 * Thrown when a state file is corrupt (invalid JSON or schema validation fails)
 * and no default was provided.
 */
export class StateCorruptError extends Error {
  readonly name = 'StateCorruptError'

  constructor(
    public readonly path: string,
    public readonly reason: 'parse_error' | 'schema_validation',
    public readonly cause: unknown
  ) {
    super(`State file corrupt: ${path} (${reason})`)
  }
}
