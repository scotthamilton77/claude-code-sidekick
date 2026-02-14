/**
 * Sandbox Detection Utility
 *
 * Detects when running inside Claude Code's sandbox environment.
 * The sandbox blocks Unix socket operations (EPERM), making daemon
 * IPC impossible. Callers use this to skip daemon startup and avoid
 * burning 5-20s on timeouts that can never succeed.
 *
 * @see sidekick-a08 — Sandbox-aware daemon short-circuit
 */

/**
 * Detect if running in Claude Code sandbox mode.
 * Uses SANDBOX_RUNTIME=1 as the canonical signal (set by Claude Code).
 *
 * @returns true when running inside the sandbox
 */
export function isInSandbox(): boolean {
  return process.env.SANDBOX_RUNTIME === '1'
}
