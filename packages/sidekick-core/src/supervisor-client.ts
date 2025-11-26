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
  bin?: string | Record<string, string>
  main?: string
}

export class SupervisorClient {
  private projectDir: string
  private logger: Logger
  private ipcClient: IpcClient

  constructor(projectDir: string, logger: Logger) {
    this.projectDir = projectDir
    this.logger = logger
    this.ipcClient = new IpcClient(getSocketPath(projectDir), logger)
  }

  async start(): Promise<void> {
    if (await this.isRunning()) {
      this.logger.debug('Supervisor already running')
      return
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
      // Read token
      const token = await this.readToken()

      // Handshake
      await this.ipcClient.call('handshake', { token })

      // Shutdown
      await this.ipcClient.call('shutdown')
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
      const token = await this.readToken()
      await this.ipcClient.call('handshake', { token })
      const pong = await this.ipcClient.call('ping')
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
