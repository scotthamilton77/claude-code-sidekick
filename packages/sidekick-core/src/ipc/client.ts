import net from 'net'
import { Logger } from '../logger.js'
import { JSONRPC_VERSION, JsonRpcResponseSchema } from './protocol.js'

export class IpcClient {
  private socketPath: string
  private logger: Logger
  private socket: net.Socket | null = null
  private pendingRequests = new Map<
    string | number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >()
  private nextId = 1

  constructor(socketPath: string, logger: Logger) {
    this.socketPath = socketPath
    this.logger = logger
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath, () => {
        this.logger.debug('IPC Client connected', { path: this.socketPath })
        this.setupListeners()
        resolve()
      })

      this.socket.on('error', (err) => {
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
      // Reject all pending requests
      for (const { reject } of this.pendingRequests.values()) {
        reject(new Error('Connection closed'))
      }
      this.pendingRequests.clear()
    })
  }

  private handleResponse(message: string): void {
    try {
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
      this.pendingRequests.set(id, { resolve, reject })
      this.socket!.write(JSON.stringify(request) + '\n')
    })
  }

  close(): void {
    if (this.socket) {
      this.socket.end()
      this.socket = null
    }
  }
}
