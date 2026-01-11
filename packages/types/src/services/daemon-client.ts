/**
 * Daemon Client Interface
 *
 * CLI-side interface for IPC communication with the Daemon process.
 *
 * @see docs/design/CLI.md §4 Daemon Interaction
 * @see docs/design/DAEMON.md
 */

/**
 * Daemon client for IPC communication.
 * Used by CLI to communicate with the background Daemon process.
 *
 * @see docs/design/CLI.md §4 Daemon Interaction
 */
export interface DaemonClient {
  /** Start the daemon process if not running */
  start(): Promise<void>
  /** Stop the daemon process */
  stop(): Promise<void>
  /** Get daemon status */
  getStatus(): Promise<{ status: string; ping?: unknown; error?: unknown }>
  /** Kill daemon forcefully */
  kill(): Promise<{ killed: boolean; pid?: number }>
}
