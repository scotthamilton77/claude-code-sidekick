import { getPidPath, getTokenPath, getUserPidPath, getUserDaemonsDir, type Logger } from '@sidekick/core'
import { randomBytes } from 'crypto'
import fs from 'fs/promises'
import path from 'path'

/** Write PID files to project-level (.sidekick/) and user-level (~/.sidekick/daemons/) locations. */
export async function writePid(projectDir: string): Promise<void> {
  const pidPath = getPidPath(projectDir)
  await fs.mkdir(path.dirname(pidPath), { recursive: true })
  await fs.writeFile(pidPath, process.pid.toString(), 'utf-8')

  const userPidPath = getUserPidPath(projectDir)
  await fs.mkdir(getUserDaemonsDir(), { recursive: true })
  const userPidData = JSON.stringify({
    pid: process.pid,
    projectDir,
    startedAt: new Date().toISOString(),
  })
  await fs.writeFile(userPidPath, userPidData, 'utf-8')
}

/** Generate and persist the IPC auth token (mode 0600, 64-char hex). */
export async function writeToken(projectDir: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const tokenPath = getTokenPath(projectDir)
  await fs.mkdir(path.dirname(tokenPath), { recursive: true })
  await fs.writeFile(tokenPath, token, { mode: 0o600, encoding: 'utf-8' })
  return token
}

/** Remove project-level PID, token, and user-level PID files on shutdown. */
export async function cleanup(projectDir: string): Promise<void> {
  const filesToRemove = [getPidPath(projectDir), getTokenPath(projectDir), getUserPidPath(projectDir)]

  for (const file of filesToRemove) {
    try {
      await fs.unlink(file)
    } catch {
      // Ignore — file may not exist
    }
  }
}

/** Set up process-level error handlers (uncaughtException, unhandledRejection). */
export function setupErrorHandlers(logger: Logger, projectDir: string, cleanupFn: () => Promise<void>): void {
  let isHandlingFatalError = false

  function handleFatalError(type: string, error: unknown): void {
    if (isHandlingFatalError) {
      console.error(`Recursive fatal error during ${type} handling:`, error)
      process.exit(1)
    }
    isHandlingFatalError = true

    logger.fatal(`Fatal ${type}`, {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      pid: process.pid,
      projectDir,
    })

    void cleanupFn().finally(() => {
      process.exit(1)
    })
  }

  process.on('uncaughtException', (err: Error) => {
    handleFatalError('uncaughtException', err)
  })

  process.on('unhandledRejection', (reason: unknown) => {
    handleFatalError('unhandledRejection', reason)
  })

  logger.debug('Process error handlers installed')
}
