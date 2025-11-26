import { z } from 'zod'

export const JSONRPC_VERSION = '2.0'

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  method: z.string(),
  params: z.unknown().optional(),
  // Per JSON-RPC 2.0 spec: id can be string, number, or null. We use auto-increment numbers.
  id: z.union([z.string(), z.number()]).optional(),
})

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
  // Response id matches request id (or null for notifications/errors without id)
  id: z.union([z.string(), z.number(), z.null()]),
})

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>

export interface IpcHandler {
  (method: string, params: unknown): Promise<unknown>
}

export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerError: -32000,
}
