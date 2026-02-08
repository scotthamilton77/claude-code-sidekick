/**
 * State Descriptor - Type-safe state file definitions.
 *
 * Bundles filename, schema, and default value into a single descriptor.
 * Used by feature packages to define their state files without exposing
 * implementation details to consumers.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
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
  /**
   * Track history of changes in dev mode.
   * When true, creates timestamped backups before each write.
   * Use for LLM-generated content and reminder consumption state.
   * @default false
   */
  readonly trackHistory?: boolean
}

/** Options for state descriptor creation */
export interface StateDescriptorOptions<D> {
  /** Default value or factory function */
  defaultValue?: D | (() => D)
  /**
   * Track history of changes in dev mode.
   * When true, creates timestamped backups before each write.
   * Use for LLM-generated content and reminder consumption state.
   */
  trackHistory?: boolean
}

/**
 * Determine if the options parameter is a StateDescriptorOptions object.
 * Returns true for objects with 'defaultValue' or 'trackHistory' keys.
 * Returns false for primitive values, null, and factory functions.
 */
function isOptionsObject<D>(options: unknown): options is StateDescriptorOptions<D> {
  if (options === null || typeof options !== 'object') {
    return false
  }
  return 'defaultValue' in options || 'trackHistory' in options
}

/**
 * Resolve the third parameter to a StateDescriptorOptions object.
 * Supports both legacy signature (bare default value) and new signature (options object).
 */
function resolveOptions<D>(options: StateDescriptorOptions<D> | D | (() => D) | undefined): StateDescriptorOptions<D> {
  if (options === undefined) {
    return {}
  }
  if (isOptionsObject<D>(options)) {
    return options
  }
  return { defaultValue: options }
}

/**
 * Create a session-scoped state descriptor.
 * Session state is stored in `.sidekick/sessions/{sessionId}/state/{filename}`.
 *
 * @example
 * const PRBaselineDescriptor = sessionState('pr-baseline.json', PRBaselineStateSchema)
 * const CountdownDescriptor = sessionState('countdown.json', CountdownSchema, { defaultValue: { count: 0 } })
 * const OptionalDescriptor = sessionState('optional.json', Schema, { defaultValue: null }) // returns null if missing
 * const TrackedDescriptor = sessionState('summary.json', Schema, { trackHistory: true }) // backs up on write
 */
export function sessionState<T, D extends T | null | undefined = undefined>(
  filename: string,
  schema: ZodType<T>,
  options?: StateDescriptorOptions<D> | D | (() => D)
): StateDescriptor<T, D> {
  const resolved = resolveOptions(options)
  return {
    filename,
    schema,
    defaultValue: resolved.defaultValue,
    scope: 'session',
    trackHistory: resolved.trackHistory,
  } as StateDescriptor<T, D>
}

/**
 * Create a global-scoped state descriptor.
 * Global state is stored in `.sidekick/state/{filename}`.
 *
 * @example
 * const GlobalMetricsDescriptor = globalState('global-metrics.json', GlobalMetricsSchema)
 * const OptionalGlobalDescriptor = globalState('optional.json', Schema, { defaultValue: null }) // returns null if missing
 */
export function globalState<T, D extends T | null | undefined = undefined>(
  filename: string,
  schema: ZodType<T>,
  options?: StateDescriptorOptions<D> | D | (() => D)
): StateDescriptor<T, D> {
  const resolved = resolveOptions(options)
  return {
    filename,
    schema,
    defaultValue: resolved.defaultValue,
    scope: 'global',
    trackHistory: resolved.trackHistory,
  } as StateDescriptor<T, D>
}
