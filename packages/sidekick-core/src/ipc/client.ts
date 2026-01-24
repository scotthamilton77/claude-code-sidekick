import net from 'net'
import { Logger } from '../logger.js'
import { JSONRPC_VERSION, JsonRpcResponseSchema } from './protocol.js'

/**
 * IPC Client Configuration Options
 */
export interface IpcClientOptions {
  /** Connection timeout in ms (default: 5000) */
  connectTimeoutMs?: number
  /** Request timeout in ms (default: 30000) */
  requestTimeoutMs?: number
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number
  /** Base delay between retries in ms, doubles each attempt (default: 100) */
  retryDelayMs?: number
}

const DEFAULT_OPTIONS: Required<IpcClientOptions> = {
  connectTimeoutMs: 5000,
  requestTimeoutMs: 30000,
  maxRetries: 3,
  retryDelayMs: 100,
}

/**
 * IPC Client with timeout and retry support.
 *
 * Provides JSON-RPC 2.0 communication over Unix Domain Sockets (or Named Pipes on Windows).
 *
 * @see docs/design/DAEMON.md §3 Communication Layer
 */
export class IpcClient {
  private socketPath: string
  private logger: Logger
  private socket: net.Socket | null = null
  private pendingRequests = new Map<
    string | number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >()
  private nextId = 1
  private options: Required<IpcClientOptions>

  constructor(socketPath: string, logger: Logger, options?: IpcClientOptions) {
    this.socketPath = socketPath
    this.logger = logger
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Connect to the IPC server with timeout.
   * Rejects if connection not established within connectTimeoutMs.
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.socket) {
          this.socket.destroy()
          this.socket = null
        }
        reject(new Error(`Connection timeout after ${this.options.connectTimeoutMs}ms`))
      }, this.options.connectTimeoutMs)

      this.socket = net.createConnection(this.socketPath, () => {
        clearTimeout(timeoutId)
        this.logger.debug('IPC Client connected', { path: this.socketPath })
        this.setupListeners()
        resolve()
      })

      this.socket.on('error', (err) => {
        clearTimeout(timeoutId)
        this.socket = null
        reject(err)
      })
    })
  }

  private setupListeners(): void {
    if (!this.socket) return

    let buffer = ''
    this.socket.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        this.handleResponse(line)
      }
    })

    this.socket.on('close', () => {
      this.logger.debug('IPC Client disconnected')
      this.socket = null
      // Reject all pending requests and clear their timers
      for (const { reject, timer } of this.pendingRequests.values()) {
        clearTimeout(timer)
        reject(new Error('Connection closed'))
      }
      this.pendingRequests.clear()
    })
  }

  private handleResponse(message: string): void {
    try {
      this.logger.info('IPC response received', { responseSize: message.length })
      const json: unknown = JSON.parse(message)
      const parseResult = JsonRpcResponseSchema.safeParse(json)

      if (!parseResult.success) {
        this.logger.error('Invalid IPC response', { error: parseResult.error })
        return
      }

      const response = parseResult.data
      if (response.id === null || response.id === undefined) return

      const pending = this.pendingRequests.get(response.id)
      if (pending) {
        clearTimeout(pending.timer)
        if (response.error) {
          pending.reject(new Error(`[${response.error.code}] ${response.error.message}`))
        } else {
          pending.resolve(response.result)
        }
        this.pendingRequests.delete(response.id)
      }
    } catch (err) {
      this.logger.error('Error parsing IPC response', { error: err })
    }
  }

  /**
   * Make a JSON-RPC call with request timeout.
   * Rejects if response not received within requestTimeoutMs.
   */
  async call(method: string, params?: unknown): Promise<unknown> {
    if (!this.socket) {
      throw new Error('Not connected')
    }

    const id = this.nextId++
    const request = {
      jsonrpc: JSONRPC_VERSION,
      method,
      params,
      id,
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout after ${this.options.requestTimeoutMs}ms for method: ${method}`))
      }, this.options.requestTimeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timer })
      const serialized = JSON.stringify(request)
      this.logger.info('IPC request sent', { method, requestSize: serialized.length })
      this.socket!.write(serialized + '\n')
    })
  }

  /**
   * Make a JSON-RPC call with automatic retry on transient failures.
   * Retries with exponential backoff on connection errors.
   *
   * @param method - RPC method name
   * @param params - Method parameters
   * @param retries - Override max retries (default: options.maxRetries)
   */
  async callWithRetry(method: string, params?: unknown, retries?: number): Promise<unknown> {
    const maxAttempts = retries ?? this.options.maxRetries
    let lastError: Error | null = null
    let delay = this.options.retryDelayMs

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Reconnect if disconnected
        if (!this.socket) {
          await this.connect()
        }
        return await this.call(method, params)
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        const isTransient = this.isTransientError(lastError)

        if (!isTransient || attempt === maxAttempts) {
          throw lastError
        }

        this.logger.debug('IPC call failed, retrying', {
          method,
          attempt,
          maxAttempts,
          delay,
          error: lastError.message,
        })

        await this.sleep(delay)
        delay *= 2 // Exponential backoff
      }
    }

    throw lastError ?? new Error('Unknown error during retry')
  }

  /**
   * Check if client is currently connected.
   */
  isConnected(): boolean {
    return this.socket !== null
  }

  close(): void {
    // Clear all pending request timers
    for (const { timer } of this.pendingRequests.values()) {
      clearTimeout(timer)
    }
    this.pendingRequests.clear()

    if (this.socket) {
      this.socket.end()
      this.socket = null
    }
  }

  private isTransientError(error: Error): boolean {
    // Transient errors that warrant retry:
    // - Connection closed: connection dropped mid-request
    // - Connection timeout: couldn't connect in time
    // - ECONNRESET: connection reset by peer
    // - ECONNREFUSED: socket exists but not accepting (daemon may be restarting)
    // - ENOENT: socket file doesn't exist (daemon may be starting up)
    // - EPIPE: broken pipe
    const transientPatterns = [
      'Connection closed',
      'Connection timeout',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOENT',
      'EPIPE',
    ]
    return transientPatterns.some((pattern) => error.message.includes(pattern))
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
