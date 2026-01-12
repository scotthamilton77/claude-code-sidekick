import { describe, expect, it } from 'vitest'
import {
  ErrorCodes,
  JSONRPC_VERSION,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../protocol.js'

describe('protocol', () => {
  describe('JSONRPC_VERSION', () => {
    it('is 2.0 per JSON-RPC spec', () => {
      expect(JSONRPC_VERSION).toBe('2.0')
    })
  })

  describe('ErrorCodes', () => {
    it('defines standard JSON-RPC error codes', () => {
      expect(ErrorCodes.ParseError).toBe(-32700)
      expect(ErrorCodes.InvalidRequest).toBe(-32600)
      expect(ErrorCodes.MethodNotFound).toBe(-32601)
      expect(ErrorCodes.InvalidParams).toBe(-32602)
      expect(ErrorCodes.InternalError).toBe(-32603)
      expect(ErrorCodes.ServerError).toBe(-32000)
    })
  })

  describe('JsonRpcRequestSchema', () => {
    it('validates a minimal valid request', () => {
      const request = {
        jsonrpc: '2.0',
        method: 'ping',
      }
      const result = JsonRpcRequestSchema.safeParse(request)
      expect(result.success).toBe(true)
    })

    it('validates a request with params and id', () => {
      const request = {
        jsonrpc: '2.0',
        method: 'setState',
        params: { key: 'value' },
        id: 1,
      }
      const result = JsonRpcRequestSchema.safeParse(request)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.params).toEqual({ key: 'value' })
        expect(result.data.id).toBe(1)
      }
    })

    it('validates a request with string id', () => {
      const request = {
        jsonrpc: '2.0',
        method: 'test',
        id: 'uuid-123',
      }
      const result = JsonRpcRequestSchema.safeParse(request)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('uuid-123')
      }
    })

    it('rejects invalid jsonrpc version', () => {
      const request = {
        jsonrpc: '1.0',
        method: 'ping',
      }
      const result = JsonRpcRequestSchema.safeParse(request)
      expect(result.success).toBe(false)
    })

    it('rejects missing jsonrpc field', () => {
      const request = {
        method: 'ping',
      }
      const result = JsonRpcRequestSchema.safeParse(request)
      expect(result.success).toBe(false)
    })

    it('rejects missing method field', () => {
      const request = {
        jsonrpc: '2.0',
      }
      const result = JsonRpcRequestSchema.safeParse(request)
      expect(result.success).toBe(false)
    })

    it('rejects non-string method', () => {
      const request = {
        jsonrpc: '2.0',
        method: 123,
      }
      const result = JsonRpcRequestSchema.safeParse(request)
      expect(result.success).toBe(false)
    })

    it('allows any params type', () => {
      const testCases = [
        { params: null },
        { params: 'string' },
        { params: 123 },
        { params: [1, 2, 3] },
        { params: { nested: { deep: true } } },
      ]

      for (const testCase of testCases) {
        const request = {
          jsonrpc: '2.0',
          method: 'test',
          ...testCase,
        }
        const result = JsonRpcRequestSchema.safeParse(request)
        expect(result.success).toBe(true)
      }
    })

    it('allows notification (request without id)', () => {
      const notification = {
        jsonrpc: '2.0',
        method: 'notify',
        params: { event: 'something' },
      }
      const result = JsonRpcRequestSchema.safeParse(notification)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBeUndefined()
      }
    })
  })

  describe('JsonRpcResponseSchema', () => {
    it('validates a success response', () => {
      const response = {
        jsonrpc: '2.0',
        result: { status: 'ok' },
        id: 1,
      }
      const result = JsonRpcResponseSchema.safeParse(response)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.result).toEqual({ status: 'ok' })
        expect(result.data.error).toBeUndefined()
      }
    })

    it('validates an error response', () => {
      const response = {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.InternalError,
          message: 'Something went wrong',
        },
        id: 1,
      }
      const result = JsonRpcResponseSchema.safeParse(response)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.error?.code).toBe(-32603)
        expect(result.data.error?.message).toBe('Something went wrong')
      }
    })

    it('validates error response with data field', () => {
      const response = {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.InvalidParams,
          message: 'Invalid parameter',
          data: { field: 'name', reason: 'required' },
        },
        id: 1,
      }
      const result = JsonRpcResponseSchema.safeParse(response)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.error?.data).toEqual({ field: 'name', reason: 'required' })
      }
    })

    it('validates response with null id (for notifications/errors)', () => {
      const response = {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.ParseError,
          message: 'Parse error',
        },
        id: null,
      }
      const result = JsonRpcResponseSchema.safeParse(response)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBeNull()
      }
    })

    it('validates response with string id', () => {
      const response = {
        jsonrpc: '2.0',
        result: 'pong',
        id: 'request-uuid',
      }
      const result = JsonRpcResponseSchema.safeParse(response)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('request-uuid')
      }
    })

    it('rejects invalid jsonrpc version', () => {
      const response = {
        jsonrpc: '1.0',
        result: 'ok',
        id: 1,
      }
      const result = JsonRpcResponseSchema.safeParse(response)
      expect(result.success).toBe(false)
    })

    it('rejects missing id field', () => {
      const response = {
        jsonrpc: '2.0',
        result: 'ok',
      }
      const result = JsonRpcResponseSchema.safeParse(response)
      expect(result.success).toBe(false)
    })

    it('allows response with both result and error undefined', () => {
      const response = {
        jsonrpc: '2.0',
        id: 1,
      }
      const result = JsonRpcResponseSchema.safeParse(response)
      expect(result.success).toBe(true)
    })

    it('allows any result type', () => {
      const testCases = [
        { result: null },
        { result: 'string' },
        { result: 123 },
        { result: true },
        { result: [1, 2, 3] },
        { result: { nested: { data: [1, 2] } } },
      ]

      for (const testCase of testCases) {
        const response = {
          jsonrpc: '2.0',
          id: 1,
          ...testCase,
        }
        const result = JsonRpcResponseSchema.safeParse(response)
        expect(result.success).toBe(true)
      }
    })

    it('rejects error with missing code', () => {
      const response = {
        jsonrpc: '2.0',
        error: {
          message: 'Error without code',
        },
        id: 1,
      }
      const result = JsonRpcResponseSchema.safeParse(response)
      expect(result.success).toBe(false)
    })

    it('rejects error with missing message', () => {
      const response = {
        jsonrpc: '2.0',
        error: {
          code: -32600,
        },
        id: 1,
      }
      const result = JsonRpcResponseSchema.safeParse(response)
      expect(result.success).toBe(false)
    })

    it('rejects error with non-numeric code', () => {
      const response = {
        jsonrpc: '2.0',
        error: {
          code: 'invalid',
          message: 'Error',
        },
        id: 1,
      }
      const result = JsonRpcResponseSchema.safeParse(response)
      expect(result.success).toBe(false)
    })
  })

  describe('Type exports', () => {
    it('JsonRpcRequest type matches schema', () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'test',
        params: { foo: 'bar' },
        id: 1,
      }
      const result = JsonRpcRequestSchema.safeParse(request)
      expect(result.success).toBe(true)
    })

    it('JsonRpcResponse type matches schema', () => {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        result: 'success',
        id: 1,
      }
      const result = JsonRpcResponseSchema.safeParse(response)
      expect(result.success).toBe(true)
    })
  })
})
