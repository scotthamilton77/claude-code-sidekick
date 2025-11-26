import crypto from 'crypto'
import os from 'os'
import path from 'path'

export function getSocketPath(projectDir: string): string {
  const isWindows = os.platform() === 'win32'

  if (isWindows) {
    // On Windows, use named pipes.
    // We hash the project path to create a unique but deterministic pipe name.
    const hash = crypto.createHash('sha256').update(projectDir).digest('hex').substring(0, 16)
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
