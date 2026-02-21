/**
 * IPC Server Implementation
 *
 * Provides a JSON-RPC 2.0 compatible server over Unix Domain Sockets (or Named Pipes on Windows).
 * Used by the Daemon to accept commands from the CLI.
 */
import fs from 'fs/promises'
import net from 'net'
import { Logger } from '../logger.js'
import { ErrorCodes, IpcHandler, JSONRPC_VERSION, JsonRpcRequestSchema, JsonRpcResponse } from './protocol.js'
import { validateSocketPath } from './transport.js'

export class IpcServer {
  private server: net.Server
  private logger: Logger
  private handler: IpcHandler
  private socketPath: string

  constructor(socketPath: string, logger: Logger, handler: IpcHandler) {
    this.socketPath = socketPath
    this.logger = logger
    this.handler = handler

    this.server = net.createServer((socket) => {
      let buffer = ''

      socket.on('data', (data) => {
        void (async (): Promise<void> => {
          buffer += data.toString()

          // Simple newline-delimited JSON framing for JSON-RPC
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            await this.handleMessage(socket, line)
          }
        })()
      })

      socket.on('error', (err) => {
        this.logger.error('IPC socket error', { error: err })
      })
    })
  }

  private async handleMessage(socket: net.Socket, message: string): Promise<void> {
    let id: string | number | null
    let method: string | undefined
    try {
      const json: unknown = JSON.parse(message)
      const parseResult = JsonRpcRequestSchema.safeParse(json)

      if (!parseResult.success) {
        this.sendError(socket, null, ErrorCodes.InvalidRequest, 'Invalid Request')
        return
      }

      const request = parseResult.data
      id = request.id ?? null
      method = request.method
      this.logger.debug('IPC request received', { method, requestSize: message.length })

      try {
        const result: unknown = await this.handler(request.method, request.params)
        if (id !== null) {
          this.sendResponse(socket, id, result, method)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal Error'
        this.logger.error('Error handling IPC method', { method: request.method, error: err })
        if (id !== null) {
          this.sendError(socket, id, ErrorCodes.InternalError, message)
        }
      }
    } catch {
      this.sendError(socket, null, ErrorCodes.ParseError, 'Parse Error')
    }
  }

  private sendResponse(socket: net.Socket, id: string | number, result: unknown, method?: string): void {
    const response: JsonRpcResponse = {
      jsonrpc: JSONRPC_VERSION,
      result,
      id,
    }
    const serialized = JSON.stringify(response)
    this.logger.debug('IPC response sent', { method, responseSize: serialized.length })
    socket.write(serialized + '\n')
  }

  private sendError(socket: net.Socket, id: string | number | null, code: number, message: string): void {
    const response: JsonRpcResponse = {
      jsonrpc: JSONRPC_VERSION,
      error: { code, message },
      id,
    }
    socket.write(JSON.stringify(response) + '\n')
  }

  async start(): Promise<void> {
    // Validate socket path length before attempting to listen
    validateSocketPath(this.socketPath)

    // Cleanup existing socket file if it exists (Unix only)
    if (process.platform !== 'win32') {
      try {
        await fs.unlink(this.socketPath)
      } catch {
        // Ignore if file doesn't exist
      }
    }

    return new Promise((resolve, reject) => {
      this.server.listen(this.socketPath, () => {
        this.logger.info('IPC Server started', { path: this.socketPath })
        resolve()
      })

      this.server.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
}
