import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatusError } from 'itty-router'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Mock sessions-api
const mockGetProjectById = vi.fn()
vi.mock('../sessions-api.js', () => ({
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
}))

// Mock node:fs/promises
const mockAccess = vi.fn()
vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}))

import {
  isValidPathSegment,
  validatePathParam,
  requireProject,
  requireSession,
  toRequest,
  writeResponse,
  toJsonResponse,
  handleError,
} from '../utils.js'

beforeEach(() => {
  mockGetProjectById.mockClear()
  mockAccess.mockClear()
})

describe('isValidPathSegment', () => {
  it('rejects empty string', () => {
    expect(isValidPathSegment('')).toBe(false)
  })

  it('rejects "."', () => {
    expect(isValidPathSegment('.')).toBe(false)
  })

  it('rejects ".."', () => {
    expect(isValidPathSegment('..')).toBe(false)
  })

  it('rejects strings with "/"', () => {
    expect(isValidPathSegment('../etc')).toBe(false)
    expect(isValidPathSegment('foo/bar')).toBe(false)
  })

  it('rejects strings with "\\"', () => {
    expect(isValidPathSegment('foo\\bar')).toBe(false)
  })

  it('accepts alphanumeric with dots, hyphens, underscores', () => {
    expect(isValidPathSegment('-Users-scott-myproject')).toBe(true)
    expect(isValidPathSegment('my.project_v2')).toBe(true)
    expect(isValidPathSegment('abc-123')).toBe(true)
  })
})

describe('validatePathParam', () => {
  it('returns decoded value for valid segments', () => {
    expect(validatePathParam('-Users-scott-myproject', 'projectId')).toBe('-Users-scott-myproject')
  })

  it('decodes percent-encoded characters', () => {
    expect(validatePathParam('abc%2D123', 'id')).toBe('abc-123')
  })

  it('throws StatusError(400) for invalid segments', () => {
    try {
      validatePathParam('..', 'projectId')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(400)
    }
  })

  it('throws StatusError(400) for path traversal attempts', () => {
    try {
      validatePathParam('..%2Fetc', 'projectId')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(400)
    }
  })

  it('lets URIError propagate for malformed percent-encoding', () => {
    expect(() => validatePathParam('%E0%A4%A', 'id')).toThrow(URIError)
  })
})

describe('requireProject', () => {
  it('returns project when found', async () => {
    const project = { id: 'proj-1', name: 'Test', projectDir: '/tmp/proj', branch: 'main', active: false }
    mockGetProjectById.mockResolvedValue(project)
    const result = await requireProject('/registry', 'proj-1')
    expect(result).toBe(project)
    expect(mockGetProjectById).toHaveBeenCalledWith('/registry', 'proj-1')
  })

  it('throws StatusError(404) when project not found', async () => {
    mockGetProjectById.mockResolvedValue(null)
    try {
      await requireProject('/registry', 'missing-proj')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(404)
    }
  })
})

describe('requireSession', () => {
  it('succeeds when session directory exists', async () => {
    mockAccess.mockResolvedValue(undefined)
    await expect(requireSession('/Users/scott/proj', 'session-1')).resolves.toBeUndefined()
    expect(mockAccess).toHaveBeenCalledWith(
      expect.stringContaining('.sidekick/sessions/session-1')
    )
  })

  it('throws StatusError(404) when session directory missing', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'))
    try {
      await requireSession('/Users/scott/proj', 'missing-session')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(404)
    }
  })
})

describe('toRequest', () => {
  it('converts Node IncomingMessage to ApiRequest', () => {
    const req = {
      method: 'GET',
      url: '/api/projects?_t=123',
      headers: { host: 'localhost:5173' },
    } as unknown as IncomingMessage

    const ctx = { registryRoot: '/registry' }
    const result = toRequest(req, ctx)

    expect(result).toBeInstanceOf(Request)
    expect(result.method).toBe('GET')
    expect(result.url).toBe('http://localhost:5173/api/projects?_t=123')
    expect(result.ctx).toBe(ctx)
    expect(result.query._t).toBe('123')
  })

  it('defaults host to localhost when header missing', () => {
    const req = {
      method: 'GET',
      url: '/api/projects',
      headers: {},
    } as unknown as IncomingMessage

    const ctx = { registryRoot: '/registry' }
    const result = toRequest(req, ctx)

    expect(result.url).toBe('http://localhost/api/projects')
  })
})

describe('writeResponse', () => {
  it('writes Web Response to Node ServerResponse', async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    const chunks: string[] = []
    const setHeader = vi.fn()
    const end = vi.fn((chunk?: string) => {
      if (chunk) chunks.push(chunk)
    })
    const mockRes = { statusCode: 0, setHeader, end } as unknown as ServerResponse

    await writeResponse(response, mockRes)

    expect(mockRes.statusCode).toBe(200)
    expect(setHeader).toHaveBeenCalledWith('content-type', 'application/json')
    expect(end).toHaveBeenCalled()
  })
})

describe('toJsonResponse', () => {
  it('converts plain objects to JSON Response', () => {
    const result = toJsonResponse({ projects: [] })
    expect(result).toBeInstanceOf(Response)
  })

  it('passes through Response objects unchanged', () => {
    const resp = new Response('ok')
    expect(toJsonResponse(resp)).toBe(resp)
  })

  it('returns undefined for undefined input', () => {
    expect(toJsonResponse(undefined)).toBeUndefined()
  })
})

describe('handleError', () => {
  it('returns correct status for StatusError', () => {
    const err = new StatusError(404, 'Not found')
    const result = handleError(err)
    expect(result).toBeInstanceOf(Response)
    expect(result.status).toBe(404)
  })

  it('returns 400 for URIError', () => {
    const err = new URIError('malformed')
    const result = handleError(err)
    expect(result).toBeInstanceOf(Response)
    expect(result.status).toBe(400)
  })

  it('returns 500 for unknown errors', () => {
    const err = new Error('something went wrong')
    const result = handleError(err)
    expect(result).toBeInstanceOf(Response)
    expect(result.status).toBe(500)
  })
})
