import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatusError } from 'itty-router'
import type { ApiRequest } from '../../types.js'

// Mock sessions-api
const mockGetProjectById = vi.fn()
vi.mock('../../sessions-api.js', () => ({
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
}))

// Mock timeline-api
const mockParseTimelineEvents = vi.fn()
vi.mock('../../timeline-api.js', () => ({
  parseTimelineEvents: (...args: unknown[]) => mockParseTimelineEvents(...args),
}))

// Mock node:fs/promises
const mockAccess = vi.fn()
vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}))

import { handleGetTimeline } from '../../handlers/timeline.js'

beforeEach(() => {
  mockGetProjectById.mockClear()
  mockParseTimelineEvents.mockClear()
  mockAccess.mockClear()
})

function fakeRequest(params: Record<string, string> = {}): ApiRequest {
  const req = new Request('http://localhost/api/projects/p/sessions/s/timeline') as ApiRequest
  req.ctx = { registryRoot: '/registry' }
  req.params = params
  return req
}

describe('handleGetTimeline', () => {
  it('validates params, requires project, requires session, returns { events }', async () => {
    const project = {
      id: '-Users-scott-proj',
      name: 'proj',
      projectDir: '/Users/scott/proj',
      branch: 'main',
      active: false,
    }
    mockGetProjectById.mockResolvedValue(project)
    mockAccess.mockResolvedValue(undefined)
    const events = [{ id: 'e1', type: 'hook:received' }]
    mockParseTimelineEvents.mockResolvedValue(events)

    const req = fakeRequest({ projectId: '-Users-scott-proj', sessionId: 'sess-abc' })
    const result = await handleGetTimeline(req)

    expect(result).toEqual({ events })
    expect(mockGetProjectById).toHaveBeenCalledWith('/registry', '-Users-scott-proj')
    expect(mockAccess).toHaveBeenCalledWith(
      expect.stringContaining('.sidekick/sessions/sess-abc')
    )
    expect(mockParseTimelineEvents).toHaveBeenCalledWith('/Users/scott/proj', 'sess-abc')
  })

  it('throws StatusError(404) when project not found', async () => {
    mockGetProjectById.mockResolvedValue(null)

    const req = fakeRequest({ projectId: 'missing', sessionId: 'sess-1' })
    try {
      await handleGetTimeline(req)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(404)
    }
  })

  it('throws StatusError(404) when session directory missing', async () => {
    const project = {
      id: 'proj-1',
      name: 'proj',
      projectDir: '/Users/scott/proj',
      branch: 'main',
      active: false,
    }
    mockGetProjectById.mockResolvedValue(project)
    mockAccess.mockRejectedValue(new Error('ENOENT'))

    const req = fakeRequest({ projectId: 'proj-1', sessionId: 'missing-sess' })
    try {
      await handleGetTimeline(req)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(404)
    }
  })

  it('throws StatusError(400) for invalid projectId', async () => {
    const req = fakeRequest({ projectId: '..', sessionId: 'sess-1' })
    try {
      await handleGetTimeline(req)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(400)
    }
  })

  it('throws StatusError(400) for invalid sessionId', async () => {
    mockGetProjectById.mockResolvedValue({
      id: 'proj-1',
      projectDir: '/tmp/proj',
      active: false,
    })
    const req = fakeRequest({ projectId: 'proj-1', sessionId: '..' })
    try {
      await handleGetTimeline(req)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(400)
    }
  })
})
