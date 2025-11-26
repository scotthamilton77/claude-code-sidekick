/**
 * Supervisor Client Facade
 *
 * High-level client for managing the Supervisor lifecycle (start/stop/status)
 * and communicating via IPC.
 *
 * @see LLD-CLI.md §7 Supervisor Lifecycle Management
 */
import { spawn } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { IpcClient } from './ipc/client.js'
import { getPidPath, getSocketPath, getTokenPath } from './ipc/transport.js'
import { Logger } from './logger.js'

interface PackageJson {
  version?: string
  bin?: string | Record<string, string>
  main?: string
}

interface HandshakeResponse {
  version: string
  status: string
}

// Read version from package.json at module load
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const CLIENT_VERSION: string = require('../package.json').version

export class SupervisorClient {
  private projectDir: string
  private logger: Logger
  private ipcClient: IpcClient
  private token: string | null = null

  constructor(projectDir: string, logger: Logger) {
    this.projectDir = projectDir
    this.logger = logger
    this.ipcClient = new IpcClient(getSocketPath(projectDir), logger)
  }

  async start(): Promise<void> {
    // Clean up stale files if process died without cleanup
    await this.cleanupStaleFiles()

    if (await this.isRunning()) {
      // Check version compatibility
      const versionMatch = await this.checkVersion()
      if (versionMatch) {
        this.logger.debug('Supervisor already running with matching version')
        return
      }

      // Version mismatch - stop old supervisor before spawning new
      this.logger.info('Version mismatch, restarting supervisor', {
        clientVersion: CLIENT_VERSION,
      })
      await this.stop()
      await this.waitForShutdown()
    }

    this.logger.info('Starting supervisor...')

    // Resolve supervisor entry point
    let supervisorPath: string
    try {
      const pkgPath = require.resolve('@sidekick/supervisor/package.json')
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
      const pkg: PackageJson = require(pkgPath)
      const binPath = pkg.bin ? (typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['sidekick-supervisor']) : pkg.main
      supervisorPath = path.resolve(path.dirname(pkgPath), binPath ?? 'dist/index.js')
    } catch {
      // Fallback for dev environment
      supervisorPath = path.resolve(__dirname, '../../../sidekick-supervisor/dist/index.js')
    }

    const child = spawn('node', [supervisorPath, this.projectDir], {
      detached: true,
      stdio: 'ignore',
      cwd: this.projectDir,
    })

    child.unref()

    // Wait for startup
    await this.waitForStartup()
  }

  async stop(): Promise<void> {
    if (!(await this.isRunning())) {
      return
    }

    try {
      await this.ipcClient.connect()
      this.token = await this.readToken()

      // Handshake
      await this.ipcClient.call('handshake', { token: this.token })

      // Shutdown (requires token)
      await this.ipcClient.call('shutdown', { token: this.token })
    } catch (err) {
      this.logger.warn('Failed to stop supervisor gracefully, killing...', { error: err })
      await this.killForcefully()
    }
  }

  async getStatus(): Promise<{ status: string; ping?: unknown; error?: unknown }> {
    const running = await this.isRunning()
    if (!running) {
      return { status: 'stopped' }
    }

    try {
      await this.ipcClient.connect()
      this.token = await this.readToken()
      await this.ipcClient.call('handshake', { token: this.token })
      const pong = await this.ipcClient.call('ping', { token: this.token })
      this.ipcClient.close()
      return { status: 'running', ping: pong }
    } catch (err) {
      return { status: 'unresponsive', error: err }
    }
  }

  private async isRunning(): Promise<boolean> {
    try {
      const pidPath = getPidPath(this.projectDir)
      const pid = parseInt(await fs.readFile(pidPath, 'utf-8'), 10)
      process.kill(pid, 0) // Check if process exists
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if running supervisor version matches client version.
   * Per LLD-SUPERVISOR §2.2: Version mismatch triggers restart.
   */
  private async checkVersion(): Promise<boolean> {
    try {
      await this.ipcClient.connect()
      this.token = await this.readToken()
      const response = (await this.ipcClient.call('handshake', {
        token: this.token,
      })) as HandshakeResponse
      this.ipcClient.close()

      const match = response.version === CLIENT_VERSION
      if (!match) {
        this.logger.debug('Supervisor version mismatch', {
          supervisorVersion: response.version,
          clientVersion: CLIENT_VERSION,
        })
      }
      return match
    } catch (err) {
      this.logger.warn('Failed to check supervisor version', { error: err })
      // On error, assume mismatch to trigger restart
      return false
    }
  }

  /**
   * Wait for supervisor to fully shut down (files removed).
   */
  private async waitForShutdown(timeoutMs = 5000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (!(await this.isRunning())) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    this.logger.warn('Supervisor did not shut down within timeout, forcing kill')
    await this.killForcefully()
    await this.cleanupStaleFiles()
  }

  /**
   * Remove stale supervisor files when process is dead but files remain.
   * Per LLD-SUPERVISOR §2.2: "If process dead: Remove stale .pid, .sock, .token files"
   */
  private async cleanupStaleFiles(): Promise<void> {
    const pidPath = getPidPath(this.projectDir)

    try {
      const pidContent = await fs.readFile(pidPath, 'utf-8')
      const pid = parseInt(pidContent, 10)

      try {
        process.kill(pid, 0)
        // Process is alive, don't cleanup
        return
      } catch {
        // Process is dead, cleanup stale files
        this.logger.info('Cleaning up stale supervisor files', { pid })
      }
    } catch {
      // No PID file, nothing to cleanup
      return
    }

    // Remove stale files
    const filesToRemove = [getPidPath(this.projectDir), getSocketPath(this.projectDir), getTokenPath(this.projectDir)]

    for (const file of filesToRemove) {
      try {
        await fs.unlink(file)
        this.logger.debug('Removed stale file', { file })
      } catch {
        // File may not exist
      }
    }
  }

  private async killForcefully(): Promise<void> {
    try {
      const pidPath = getPidPath(this.projectDir)
      const pid = parseInt(await fs.readFile(pidPath, 'utf-8'), 10)
      process.kill(pid, 'SIGKILL')
    } catch {
      // Process may not exist
    }
  }

  private async waitForStartup(timeoutMs = 5000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.isRunning()) {
        // Also check if socket exists
        try {
          await fs.access(getSocketPath(this.projectDir))
          return
        } catch {
          // Socket not ready yet
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Supervisor failed to start within timeout')
  }

  private async readToken(): Promise<string> {
    return fs.readFile(getTokenPath(this.projectDir), 'utf-8')
  }
}
