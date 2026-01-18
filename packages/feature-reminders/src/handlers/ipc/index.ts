/**
 * IPC Handlers for Reminders Feature (Daemon-side)
 *
 * These handlers are invoked by the daemon's IPC router when the CLI
 * sends reminder-related IPC requests. They manage P&R baseline and
 * VC unverified state.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */

// Re-export types
export type {
  IPCLogger,
  IPCHandlerContext,
  ReminderConsumedParams,
  VCUnverifiedSetParams,
  VCUnverifiedClearParams,
} from './types.js'

// Re-export handlers
export { handleReminderConsumed } from './reminder-consumed.js'
export { handleVCUnverifiedSet, handleVCUnverifiedClear } from './vc-unverified.js'
