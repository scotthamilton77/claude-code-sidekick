/**
 * Supervisor Client Interface
 *
 * CLI-side interface for IPC communication with the Supervisor process.
 *
 * @see docs/design/CLI.md §4 Supervisor Interaction
 * @see docs/design/SUPERVISOR.md
 */

/**
 * Supervisor client for IPC communication.
 * Used by CLI to communicate with the background Supervisor process.
 *
 * @see docs/design/CLI.md §4 Supervisor Interaction
 */
export interface SupervisorClient {
  /** Start the supervisor process if not running */
  start(): Promise<void>
  /** Stop the supervisor process */
  stop(): Promise<void>
  /** Get supervisor status */
  getStatus(): Promise<{ status: string; ping?: unknown; error?: unknown }>
  /** Kill supervisor forcefully */
  kill(): Promise<{ killed: boolean; pid?: number }>
}
