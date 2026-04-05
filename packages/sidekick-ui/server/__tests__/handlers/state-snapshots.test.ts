import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatusError } from 'itty-router'
import type { ApiRequest } from '../../types.js'

const mockGetProjectById = vi.fn()
vi.mock('../../sessions-api.js', () => ({
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
}))

const mockParseStateSnapshots = vi.fn()
vi.mock('../../state-snapshots-api.js', () => ({
  parseStateSnapshots: (...args: unknown[]) => mockParseStateSnapshots(...args),
}))

const mockAccess = vi.fn()
vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}))

import { handleGetStateSnapshots } from '../../handlers/state-snapshots.js'

beforeEach(() => {
  mockGetProjectById.mockClear()
  mockParseStateSnapshots.mockClear()
  mockAccess.mockClear()
})

function fakeRequest(params: Record<string, string> = {}): ApiRequest {
  const req = new Request('http://localhost/api/projects/p/sessions/s/state-snapshots') as ApiRequest
  req.ctx = { registryRoot: '/registry' }
  Object.assign(req, params)
  return req
}

describe('handleGetStateSnapshots', () => {
  it('validates params, requires project, requires session, returns { snapshots }', async () => {
    const project = {
      id: '-Users-scott-proj',
      name: 'proj',
      projectDir: '/Users/scott/proj',
      branch: 'main',
      active: false,
    }
    mockGetProjectById.mockResolvedValue(project)
    mockAccess.mockResolvedValue(undefined)
    const snapshots = [{ timestamp: 1000, sessionSummary: { title: 'T' } }]
    mockParseStateSnapshots.mockResolvedValue(snapshots)

    const req = fakeRequest({ projectId: '-Users-scott-proj', sessionId: 'abc-123' })
    const result = await handleGetStateSnapshots(req)

    expect(result).toEqual({ snapshots })
    expect(mockParseStateSnapshots).toHaveBeenCalledWith('/Users/scott/proj', 'abc-123')
  })

  it('throws 404 when project not found', async () => {
    mockGetProjectById.mockResolvedValue(null)

    const req = fakeRequest({ projectId: 'nonexistent', sessionId: 'abc' })

    await expect(handleGetStateSnapshots(req)).rejects.toThrow(StatusError)
  })

  it('throws 400 for path traversal in projectId', async () => {
    const req = fakeRequest({ projectId: '../etc', sessionId: 'abc' })

    await expect(handleGetStateSnapshots(req)).rejects.toThrow(StatusError)
  })
})
