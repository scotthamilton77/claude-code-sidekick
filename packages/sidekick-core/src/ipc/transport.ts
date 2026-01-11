/**
 * IPC Transport Utilities
 *
 * Provides platform-aware path resolution for daemon IPC resources.
 *
 * @see docs/design/DAEMON.md §2 Process Architecture
 * @see docs/design/CLI.md §7 Daemon Lifecycle Management
 */
import crypto from 'crypto'
import os from 'os'
import path from 'path'

/**
 * Generate a deterministic hash for a project directory.
 * Used for unique socket names and user-level PID tracking.
 */
export function getProjectHash(projectDir: string): string {
  return crypto.createHash('sha256').update(projectDir).digest('hex').substring(0, 16)
}

/**
 * Unix domain sockets have a path length limit of 108 bytes (including null terminator).
 * This is defined by struct sockaddr_un.sun_path[] in POSIX.
 */
export const UNIX_PATH_MAX = 107

/**
 * Get the base directory for Unix domain sockets.
 * Uses XDG_RUNTIME_DIR on Linux (per-user, auto-cleaned), /tmp elsewhere.
 */
function getSocketBaseDir(): string {
  const xdgRuntime = process.env.XDG_RUNTIME_DIR
  if (xdgRuntime && os.platform() === 'linux') {
    return xdgRuntime
  }
  return os.tmpdir()
}

export function getSocketPath(projectDir: string): string {
  const hash = getProjectHash(projectDir)

  if (os.platform() === 'win32') {
    // On Windows, use named pipes.
    return `\\\\.\\pipe\\sidekick-${hash}-sock`
  } else {
    // On Unix, use domain sockets in a short base directory with hash.
    // This avoids the 108-byte path limit for Unix domain sockets.
    const baseDir = getSocketBaseDir()
    return path.join(baseDir, `sidekick-${hash}.sock`)
  }
}

/**
 * Validate that a socket path doesn't exceed Unix limits.
 * Throws an error with a helpful message if the path is too long.
 */
export function validateSocketPath(socketPath: string): void {
  if (os.platform() !== 'win32' && socketPath.length > UNIX_PATH_MAX) {
    throw new Error(
      `Socket path exceeds Unix limit of ${UNIX_PATH_MAX} characters (got ${socketPath.length}): ${socketPath}`
    )
  }
}

export function getTokenPath(projectDir: string): string {
  return path.join(projectDir, '.sidekick', 'sidekickd.token')
}

export function getPidPath(projectDir: string): string {
  return path.join(projectDir, '.sidekick', 'sidekickd.pid')
}

/**
 * Get the lockfile path for daemon startup serialization.
 * Used to prevent race conditions when multiple hooks try to start the daemon.
 */
export function getLockPath(projectDir: string): string {
  return path.join(projectDir, '.sidekick', 'sidekickd.lock')
}

/**
 * Get the user-level daemons directory.
 * Per design/CLI.md §7: Store PID files at ~/.sidekick/daemons/ for --kill-all.
 */
export function getUserDaemonsDir(): string {
  return path.join(os.homedir(), '.sidekick', 'daemons')
}

/**
 * Get the user-level PID file path for a project.
 * Format: ~/.sidekick/daemons/{project-hash}.pid
 *
 * Contains JSON with project path and PID for discovery during --kill-all.
 */
export function getUserPidPath(projectDir: string): string {
  const hash = getProjectHash(projectDir)
  return path.join(getUserDaemonsDir(), `${hash}.pid`)
}
