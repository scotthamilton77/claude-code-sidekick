/**
 * State Descriptor - Type-safe state file definitions.
 *
 * Bundles filename, schema, and default value into a single descriptor.
 * Used by feature packages to define their state files without exposing
 * implementation details to consumers.
 *
 * @see docs/ROADMAP.md Phase 9.3.7
 */

import type { ZodType } from 'zod'

/**
 * Describes a state file with its filename, schema, and optional default value.
 * Features define descriptors and pass them to accessors.
 *
 * The default value can be:
 * - A value of type T (returned when file is missing)
 * - A factory function () => T (called when file is missing)
 * - null (indicates file may not exist, accessor returns null in that case)
 * - undefined (no default - accessor throws if file is missing)
 */
export interface StateDescriptor<T, D = T | null | undefined> {
  /** Filename within the state directory (e.g., 'session-summary.json') */
  readonly filename: string
  /** Zod schema for validation */
  readonly schema: ZodType<T>
  /** Default value or factory function (optional) */
  readonly defaultValue?: D | (() => D)
  /** Scope: session-scoped or global */
  readonly scope: 'session' | 'global'
}

/**
 * Create a session-scoped state descriptor.
 * Session state is stored in `.sidekick/sessions/{sessionId}/state/{filename}`.
 *
 * @example
 * const PRBaselineDescriptor = sessionState('pr-baseline.json', PRBaselineStateSchema)
 * const CountdownDescriptor = sessionState('countdown.json', CountdownSchema, { count: 0 })
 * const OptionalDescriptor = sessionState('optional.json', Schema, null) // returns null if missing
 */
export function sessionState<T, D extends T | null | undefined = undefined>(
  filename: string,
  schema: ZodType<T>,
  defaultValue?: D | (() => D)
): StateDescriptor<T, D> {
  return {
    filename,
    schema,
    defaultValue,
    scope: 'session',
  } as StateDescriptor<T, D>
}

/**
 * Create a global-scoped state descriptor.
 * Global state is stored in `.sidekick/state/{filename}`.
 *
 * @example
 * const GlobalMetricsDescriptor = globalState('global-metrics.json', GlobalMetricsSchema)
 * const OptionalGlobalDescriptor = globalState('optional.json', Schema, null) // returns null if missing
 */
export function globalState<T, D extends T | null | undefined = undefined>(
  filename: string,
  schema: ZodType<T>,
  defaultValue?: D | (() => D)
): StateDescriptor<T, D> {
  return {
    filename,
    schema,
    defaultValue,
    scope: 'global',
  } as StateDescriptor<T, D>
}
