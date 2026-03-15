import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Mock sessions-api and timeline-api
const mockListProjects = vi.fn()
const mockGetProjectById = vi.fn()
const mockListSessions = vi.fn()

vi.mock('../sessions-api.js', () => ({
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
  listSessions: (...args: unknown[]) => mockListSessions(...args),
}))

const mockParseTimelineEvents = vi.fn()

vi.mock('../timeline-api.js', () => ({
  parseTimelineEvents: (...args: unknown[]) => mockParseTimelineEvents(...args),
}))

const mockParseTranscriptLines = vi.fn()

vi.mock('../transcript-api.js', () => ({
  parseTranscriptLines: (...args: unknown[]) => mockParseTranscriptLines(...args),
}))

// Mock node:fs/promises (access used in timeline route)
const mockAccess = vi.fn()

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}))

import { sessionsApiPlugin, isValidPathSegment } from '../api-plugin.js'

// Helper: capture the middleware from the plugin
type MiddlewareFn = (req: IncomingMessage, res: ServerResponse, next: () => void) => void | Promise<void>

function getMiddleware(): MiddlewareFn {
  let captured: MiddlewareFn | undefined
  const fakeServer = {
    middlewares: {
      use(fn: MiddlewareFn) {
        captured = fn
      },
    },
  }
  const plugin = sessionsApiPlugin()
  // configureServer is defined on the plugin
  ;(plugin as unknown as { configureServer: (s: typeof fakeServer) => void }).configureServer(fakeServer)
  if (!captured) throw new Error('middleware not captured')
  return captured
}

// Helper: mock response with typed statusCode access
interface MockRes {
  statusCode: number
  setHeader: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

// Helper: create mock req/res/next
function createMocks(method: string, url: string) {
  const req = { method, url } as IncomingMessage
  const resBody: string[] = []
  const mockRes: MockRes = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((chunk?: string) => {
      if (chunk) resBody.push(chunk)
    }),
  }
  const res = mockRes as unknown as ServerResponse
  const next = vi.fn()
  return { req, res, mockRes, next, resBody }
}

beforeEach(() => {
  mockListProjects.mockClear()
  mockGetProjectById.mockClear()
  mockListSessions.mockClear()
  mockParseTimelineEvents.mockClear()
  mockParseTranscriptLines.mockClear()
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

describe('sessionsApiPlugin middleware', () => {
  describe('path traversal rejection', () => {
    it('falls through when projectId ".." is URL-normalized away in sessions route', async () => {
      // new URL normalizes /api/projects/%2E%2E/sessions → /api/sessions
      // which doesn't match any route, so next() is called
      const mw = getMiddleware()
      const { req, res, next } = createMocks('GET', '/api/projects/%2E%2E/sessions')
      await mw(req, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('falls through when projectId "." is URL-normalized away in sessions route', async () => {
      // new URL normalizes /api/projects/./sessions → /api/projects/sessions
      const mw = getMiddleware()
      const { req, res, next } = createMocks('GET', '/api/projects/./sessions')
      await mw(req, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('rejects projectId "../etc" in sessions route via isValidPathSegment', async () => {
      // %2F is not normalized by URL parser, so regex matches with segment "..%2Fetc"
      // decodeURIComponent produces "../etc" which fails isValidPathSegment (contains /)
      const mw = getMiddleware()
      const { req, res, mockRes, next } = createMocks('GET', '/api/projects/..%2Fetc/sessions')
      await mw(req, res, next)
      expect(mockRes.statusCode).toBe(400)
      expect(next).not.toHaveBeenCalled()
    })

    it('falls through when projectId ".." is URL-normalized away in timeline route', async () => {
      const mw = getMiddleware()
      const { req, res, next } = createMocks(
        'GET',
        '/api/projects/%2E%2E/sessions/abc-123/timeline'
      )
      await mw(req, res, next)
      // URL normalizes away the ".." so the route pattern doesn't match
      expect(next).toHaveBeenCalled()
    })

    it('accepts valid projectId like "-Users-scott-myproject"', async () => {
      const mw = getMiddleware()
      mockGetProjectById.mockResolvedValue({
        id: '-Users-scott-myproject',
        name: 'myproject',
        projectDir: '/Users/scott/myproject',
        branch: 'main',
        active: false,
      })
      mockListSessions.mockResolvedValue([])
      const { req, res, mockRes, next } = createMocks(
        'GET',
        '/api/projects/-Users-scott-myproject/sessions'
      )
      await mw(req, res, next)
      expect(mockRes.statusCode).toBe(200)
      expect(mockGetProjectById).toHaveBeenCalled()
    })

    it('returns 400 for malformed percent-encoding in projectId', async () => {
      const mw = getMiddleware()
      const { req, res, mockRes, next } = createMocks('GET', '/api/projects/%E0%A4%A/sessions')
      await mw(req, res, next)
      expect(mockRes.statusCode).toBe(400)
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('query string handling', () => {
    it('GET /api/projects?_t=123 matches projects route', async () => {
      const mw = getMiddleware()
      mockListProjects.mockResolvedValue([])
      const { req, res, next } = createMocks('GET', '/api/projects?_t=123')
      await mw(req, res, next)
      expect(mockListProjects).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    })

    it('GET /api/projects/-Users-foo/sessions?_t=123 matches sessions route', async () => {
      const mw = getMiddleware()
      mockGetProjectById.mockResolvedValue({
        id: '-Users-foo',
        name: 'foo',
        projectDir: '/Users/foo',
        branch: 'main',
        active: false,
      })
      mockListSessions.mockResolvedValue([])
      const { req, res, next } = createMocks(
        'GET',
        '/api/projects/-Users-foo/sessions?_t=123'
      )
      await mw(req, res, next)
      expect(mockGetProjectById).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    })

    it('GET /api/projects/-Users-foo/sessions/uuid-1/timeline?_t=123 matches timeline route', async () => {
      const mw = getMiddleware()
      mockGetProjectById.mockResolvedValue({
        id: '-Users-foo',
        name: 'foo',
        projectDir: '/Users/foo',
        branch: 'main',
        active: false,
      })
      mockAccess.mockResolvedValue(undefined)
      mockParseTimelineEvents.mockResolvedValue([])
      const { req, res, next } = createMocks(
        'GET',
        '/api/projects/-Users-foo/sessions/uuid-1/timeline?_t=123'
      )
      await mw(req, res, next)
      expect(mockGetProjectById).toHaveBeenCalled()
      expect(mockParseTimelineEvents).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('transcript route', () => {
    it('GET /api/projects/-Users-foo/sessions/uuid-1/transcript returns transcript lines', async () => {
      const mw = getMiddleware()
      const mockLines = [{ id: '1', type: 'user-message', timestamp: 1000, content: 'hello' }]
      mockParseTranscriptLines.mockResolvedValue(mockLines)
      mockGetProjectById.mockResolvedValue({ id: '-Users-foo', projectDir: '/Users/foo', active: true })
      const { req, res, mockRes, next, resBody } = createMocks(
        'GET',
        '/api/projects/-Users-foo/sessions/uuid-1/transcript'
      )
      await mw(req, res, next)
      expect(mockParseTranscriptLines).toHaveBeenCalledWith('-Users-foo', 'uuid-1', '/Users/foo')
      expect(mockRes.statusCode).toBe(200)
      expect(JSON.parse(resBody[0])).toEqual({ lines: mockLines })
      expect(next).not.toHaveBeenCalled()
    })

    it('GET /api/projects/-Users-foo/sessions/uuid-1/transcript?_t=123 handles query strings', async () => {
      const mw = getMiddleware()
      mockParseTranscriptLines.mockResolvedValue([])
      mockGetProjectById.mockResolvedValue({ id: '-Users-foo', projectDir: '/Users/foo', active: true })
      const { req, res, next } = createMocks(
        'GET',
        '/api/projects/-Users-foo/sessions/uuid-1/transcript?_t=123'
      )
      await mw(req, res, next)
      expect(mockParseTranscriptLines).toHaveBeenCalledWith('-Users-foo', 'uuid-1', '/Users/foo')
      expect(next).not.toHaveBeenCalled()
    })

    it('rejects invalid projectId in transcript route', async () => {
      const mw = getMiddleware()
      const { req, res, mockRes, next } = createMocks(
        'GET',
        '/api/projects/..%2Fetc/sessions/uuid-1/transcript'
      )
      await mw(req, res, next)
      expect(mockRes.statusCode).toBe(400)
      expect(next).not.toHaveBeenCalled()
    })

    it('rejects invalid sessionId in transcript route', async () => {
      const mw = getMiddleware()
      const { req, res, mockRes, next } = createMocks(
        'GET',
        '/api/projects/-Users-foo/sessions/..%2Fetc/transcript'
      )
      await mw(req, res, next)
      expect(mockRes.statusCode).toBe(400)
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('passthrough', () => {
    it('calls next() for non-api URLs', async () => {
      const mw = getMiddleware()
      const { req, res, next } = createMocks('GET', '/index.html')
      await mw(req, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('calls next() for unknown /api/ routes', async () => {
      const mw = getMiddleware()
      const { req, res, next } = createMocks('GET', '/api/unknown')
      await mw(req, res, next)
      expect(next).toHaveBeenCalled()
    })
  })
})
