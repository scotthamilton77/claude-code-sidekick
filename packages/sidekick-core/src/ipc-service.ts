/**
 * IPC Service
 *
 * High-level IPC abstraction for feature code. Provides:
 * - Simple `send(method, payload)` API
 * - Connection pooling (connection reused within CLI session)
 * - Automatic reconnection on transient failures
 * - Graceful degradation when daemon unavailable
 * - Configurable timeout/retry settings from core.yaml
 *
 * @see docs/design/CLI.md §4 Daemon Interaction
 * @see docs/design/CONFIG-SYSTEM.md (ipc config settings)
 */
import fs from 'fs/promises'
import { CoreConfig } from './config.js'
import { IpcClient, IpcClientOptions } from './ipc/client.js'
import { getSocketPath, getTokenPath } from './ipc/transport.js'
import { Logger } from './logger.js'

export interface IpcServiceOptions extends IpcClientOptions {
  /** Return null instead of throwing when daemon is unavailable (default: true) */
  gracefulDegradation?: boolean
}

const DEFAULT_OPTIONS: IpcServiceOptions = {
  gracefulDegradation: true,
}

/**
 * High-level IPC service for communicating with the daemon.
 *
 * Designed for feature code to easily send commands to the daemon
 * without managing connection lifecycle.
 *
 * @example
 * ```typescript
 * // Create from config
 * const ipc = IpcService.fromConfig(projectDir, logger, config.core);
 *
 * // Or create with manual options
 * const ipc = new IpcService(projectDir, logger);
 *
 * // Simple send with graceful degradation
 * const result = await ipc.send('state.update', { file: 'summary.json', data: {...} });
 *
 * // Explicit error handling
 * const result = await ipc.send('ping', {}, { gracefulDegradation: false });
 * ```
 */
export class IpcService {
  private projectDir: string
  private logger: Logger
  private client: IpcClient
  private options: IpcServiceOptions
  private authenticated = false
  private token: string | null = null

  constructor(projectDir: string, logger: Logger, options?: IpcServiceOptions) {
    this.projectDir = projectDir
    this.logger = logger
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.client = new IpcClient(getSocketPath(projectDir), logger, options)
  }

  /**
   * Create IpcService from CoreConfig, using IPC settings from core.yaml.
   *
   * @param projectDir - Project directory path
   * @param logger - Logger instance
   * @param config - Core config containing IPC settings
   * @returns Configured IpcService instance
   */
  static fromConfig(projectDir: string, logger: Logger, config: CoreConfig): IpcService {
    return new IpcService(projectDir, logger, {
      ...config.ipc,
      gracefulDegradation: true,
    })
  }

  /**
   * Send an IPC request to the daemon.
   *
   * Handles authentication, connection pooling, and optionally graceful degradation.
   *
   * @param method - RPC method name
   * @param params - Method parameters (will have token added automatically)
   * @param options - Override options for this call
   * @returns Result from daemon, or null if graceful degradation is enabled and daemon unavailable
   */
  async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: { gracefulDegradation?: boolean }
  ): Promise<T | null> {
    const graceful = options?.gracefulDegradation ?? this.options.gracefulDegradation

    try {
      // Ensure we have a connection and are authenticated
      await this.ensureAuthenticated()

      // Add token to params for authenticated methods
      const authenticatedParams = {
        ...params,
        token: this.token,
      }

      const result = await this.client.callWithRetry(method, authenticatedParams)
      return result as T
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))

      if (graceful) {
        this.logger.warn('IPC call failed, daemon unavailable', {
          method,
          error: error.message,
        })
        return null
      }

      throw error
    }
  }

  /**
   * Check if daemon is available and responding.
   *
   * Useful for features to check before attempting expensive operations.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureAuthenticated()
      await this.client.call('ping', { token: this.token })
      return true
    } catch {
      return false
    }
  }

  /**
   * Close the IPC connection.
   *
   * Call this during cleanup to release resources.
   */
  close(): void {
    this.client.close()
    this.authenticated = false
    this.token = null
  }

  /**
   * Ensure we have a connection and have completed handshake.
   * Reuses existing connection if already authenticated.
   */
  private async ensureAuthenticated(): Promise<void> {
    if (this.authenticated && this.client.isConnected()) {
      return
    }

    // Read token from file
    try {
      this.token = await fs.readFile(getTokenPath(this.projectDir), 'utf-8')
    } catch {
      throw new Error('Daemon token not found - daemon may not be running')
    }

    // Connect if needed
    if (!this.client.isConnected()) {
      await this.client.connect()
    }

    // Perform handshake
    await this.client.call('handshake', { token: this.token })
    this.authenticated = true
  }
}
