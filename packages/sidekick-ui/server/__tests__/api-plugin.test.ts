import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Mock sessions-api
const mockListProjects = vi.fn()
const mockGetProjectById = vi.fn()
const mockListSessions = vi.fn()

vi.mock('../sessions-api.js', () => ({
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
  listSessions: (...args: unknown[]) => mockListSessions(...args),
}))

// Mock timeline-api
const mockParseTimelineEvents = vi.fn()

vi.mock('../timeline-api.js', () => ({
  parseTimelineEvents: (...args: unknown[]) => mockParseTimelineEvents(...args),
}))

// Mock transcript-api
const mockParseTranscriptLines = vi.fn()
const mockParseSubagentTranscript = vi.fn()

vi.mock('../transcript-api.js', () => ({
  parseTranscriptLines: (...args: unknown[]) => mockParseTranscriptLines(...args),
  parseSubagentTranscript: (...args: unknown[]) => mockParseSubagentTranscript(...args),
}))

// Mock node:fs/promises (access used via requireSession in timeline handler)
const mockAccess = vi.fn()

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}))

import { sidekickApiPlugin } from '../api-plugin.js'

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
  const plugin = sidekickApiPlugin()
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
// toRequest uses req.headers.host to build the URL
function createMocks(method: string, url: string) {
  const req = { method, url, headers: { host: 'localhost:5173' } } as unknown as IncomingMessage
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
  mockParseSubagentTranscript.mockClear()
  mockAccess.mockClear()
})

describe('sidekickApiPlugin adapter integration', () => {
  describe('passthrough', () => {
    it('calls next() for non-API URLs', async () => {
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

  describe('route wiring', () => {
    it('GET /api/projects returns project list', async () => {
      const mw = getMiddleware()
      const projects = [{ id: 'p1', name: 'Project 1' }]
      mockListProjects.mockResolvedValue(projects)
      const { req, res, next, resBody } = createMocks('GET', '/api/projects')
      await mw(req, res, next)
      expect(mockListProjects).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
      expect(JSON.parse(resBody[0])).toEqual({ projects })
    })

    it('GET /api/projects/:id/sessions returns sessions list', async () => {
      const mw = getMiddleware()
      mockGetProjectById.mockResolvedValue({
        id: '-Users-scott-proj',
        name: 'proj',
        projectDir: '/Users/scott/proj',
        branch: 'main',
        active: false,
      })
      mockListSessions.mockResolvedValue([{ id: 'sess-1' }])
      const { req, res, next, resBody } = createMocks(
        'GET',
        '/api/projects/-Users-scott-proj/sessions'
      )
      await mw(req, res, next)
      expect(mockGetProjectById).toHaveBeenCalled()
      expect(mockListSessions).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
      expect(JSON.parse(resBody[0])).toEqual({ sessions: [{ id: 'sess-1' }] })
    })

    it('GET /api/projects/:pid/sessions/:sid/transcript returns transcript', async () => {
      const mw = getMiddleware()
      const mockLines = [{ id: '1', type: 'user-message', timestamp: 1000, content: 'hello' }]
      mockParseTranscriptLines.mockResolvedValue(mockLines)
      mockGetProjectById.mockResolvedValue({ id: '-Users-foo', projectDir: '/Users/foo', active: true })
      const { req, res, next, resBody } = createMocks(
        'GET',
        '/api/projects/-Users-foo/sessions/uuid-1/transcript'
      )
      await mw(req, res, next)
      expect(mockParseTranscriptLines).toHaveBeenCalledWith('-Users-foo', 'uuid-1', '/Users/foo')
      expect(next).not.toHaveBeenCalled()
      expect(JSON.parse(resBody[0])).toEqual({ lines: mockLines })
    })
  })

  describe('error handling', () => {
    it('returns 400 for malformed percent-encoding', async () => {
      const mw = getMiddleware()
      const { req, res, mockRes, next, resBody } = createMocks(
        'GET',
        '/api/projects/%E0%A4%A/sessions'
      )
      await mw(req, res, next)
      expect(mockRes.statusCode).toBe(400)
      expect(next).not.toHaveBeenCalled()
      const body = JSON.parse(resBody[0])
      expect(body.error).toContain('Malformed URL encoding')
    })

    it('returns 400 for path traversal (..%2Fetc)', async () => {
      const mw = getMiddleware()
      const { req, res, mockRes, next, resBody } = createMocks(
        'GET',
        '/api/projects/..%2Fetc/sessions'
      )
      await mw(req, res, next)
      expect(mockRes.statusCode).toBe(400)
      expect(next).not.toHaveBeenCalled()
      const body = JSON.parse(resBody[0])
      expect(body.error).toContain('Invalid project ID')
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

  describe('URL normalization', () => {
    it('%2E%2E normalized away in sessions route -> next()', async () => {
      const mw = getMiddleware()
      const { req, res, next } = createMocks('GET', '/api/projects/%2E%2E/sessions')
      await mw(req, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('"." normalized away in sessions route -> next()', async () => {
      const mw = getMiddleware()
      const { req, res, next } = createMocks('GET', '/api/projects/./sessions')
      await mw(req, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('%2E%2E normalized away in timeline route -> next()', async () => {
      const mw = getMiddleware()
      const { req, res, next } = createMocks(
        'GET',
        '/api/projects/%2E%2E/sessions/abc-123/timeline'
      )
      await mw(req, res, next)
      expect(next).toHaveBeenCalled()
    })
  })
})
