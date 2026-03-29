/**
 * State Domain Types — Barrel Re-export
 *
 * Re-exports all state types from domain-specific modules.
 * Consumers continue importing from './state.js' with zero breaking changes.
 *
 * Domain modules:
 * - session-state.ts: Session summary, persona, snarky/resume message schemas
 * - metrics-state.ts: Transcript, log, context, and LLM metrics schemas
 * - reminder-state.ts: PR baseline, VC unverified, verification tools, throttle, staged reminders
 * - minimal-state-service.ts: StateReadResult, MinimalStateService, SessionStateSnapshot
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */

export * from './session-state.js'
export * from './metrics-state.js'
export * from './reminder-state.js'
export * from './minimal-state-service.js'
