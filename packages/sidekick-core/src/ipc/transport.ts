/**
 * IPC Transport Utilities
 *
 * Provides platform-aware path resolution for supervisor IPC resources.
 *
 * @see docs/design/SUPERVISOR.md §2 Process Architecture
 * @see docs/design/CLI.md §7 Supervisor Lifecycle Management
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

export function getSocketPath(projectDir: string): string {
  const isWindows = os.platform() === 'win32'

  if (isWindows) {
    // On Windows, use named pipes.
    // We hash the project path to create a unique but deterministic pipe name.
    const hash = getProjectHash(projectDir)
    return `\\\\.\\pipe\\sidekick-${hash}-sock`
  } else {
    // On Unix, use domain sockets in the .sidekick directory.
    return path.join(projectDir, '.sidekick', 'supervisor.sock')
  }
}

export function getTokenPath(projectDir: string): string {
  return path.join(projectDir, '.sidekick', 'supervisor.token')
}

export function getPidPath(projectDir: string): string {
  return path.join(projectDir, '.sidekick', 'supervisor.pid')
}

/**
 * Get the user-level supervisors directory.
 * Per design/CLI.md §7: Store PID files at ~/.sidekick/supervisors/ for --kill-all.
 */
export function getUserSupervisorsDir(): string {
  return path.join(os.homedir(), '.sidekick', 'supervisors')
}

/**
 * Get the user-level PID file path for a project.
 * Format: ~/.sidekick/supervisors/{project-hash}.pid
 *
 * Contains JSON with project path and PID for discovery during --kill-all.
 */
export function getUserPidPath(projectDir: string): string {
  const hash = getProjectHash(projectDir)
  return path.join(getUserSupervisorsDir(), `${hash}.pid`)
}
