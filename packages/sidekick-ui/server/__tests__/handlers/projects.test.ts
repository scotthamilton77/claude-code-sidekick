import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatusError } from 'itty-router'
import type { ApiRequest } from '../../types.js'

// Mock sessions-api
const mockListProjects = vi.fn()
const mockGetProjectById = vi.fn()
const mockListSessions = vi.fn()
vi.mock('../../sessions-api.js', () => ({
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
  listSessions: (...args: unknown[]) => mockListSessions(...args),
}))

import { handleListProjects, handleListSessions } from '../../handlers/projects.js'

beforeEach(() => {
  mockListProjects.mockClear()
  mockGetProjectById.mockClear()
  mockListSessions.mockClear()
})

function fakeRequest(params: Record<string, string> = {}): ApiRequest {
  const req = new Request('http://localhost/api/projects') as ApiRequest
  req.ctx = { registryRoot: '/registry' }
  Object.assign(req, params)
  return req
}

describe('handleListProjects', () => {
  it('returns { projects } from listProjects', async () => {
    const projects = [{ id: 'p1', name: 'Project 1' }]
    mockListProjects.mockResolvedValue(projects)

    const result = await handleListProjects(fakeRequest())

    expect(result).toEqual({ projects })
    expect(mockListProjects).toHaveBeenCalledWith('/registry')
  })
})

describe('handleListSessions', () => {
  it('validates projectId, requires project, returns { sessions }', async () => {
    const project = {
      id: '-Users-scott-proj',
      name: 'proj',
      projectDir: '/Users/scott/proj',
      branch: 'main',
      active: true,
    }
    mockGetProjectById.mockResolvedValue(project)
    const sessions = [{ id: 'sess-1', title: 'Session 1' }]
    mockListSessions.mockResolvedValue(sessions)

    const req = fakeRequest({ projectId: '-Users-scott-proj' })
    const result = await handleListSessions(req)

    expect(result).toEqual({ sessions })
    expect(mockGetProjectById).toHaveBeenCalledWith('/registry', '-Users-scott-proj')
    expect(mockListSessions).toHaveBeenCalledWith('/Users/scott/proj', true)
  })

  it('throws StatusError(404) when project not found', async () => {
    mockGetProjectById.mockResolvedValue(null)

    const req = fakeRequest({ projectId: 'missing' })
    try {
      await handleListSessions(req)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(404)
    }
  })

  it('throws StatusError(400) for invalid projectId', async () => {
    const req = fakeRequest({ projectId: '..' })
    try {
      await handleListSessions(req)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(400)
    }
  })
})
