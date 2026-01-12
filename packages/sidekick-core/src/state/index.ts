/**
 * State management exports.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */

export { StateService, type StateReadResult, type StateServiceOptions } from './state-service.js'
export { StateNotFoundError, StateCorruptError } from './errors.js'

// PathResolver is intentionally NOT exported - it's internal to StateService
