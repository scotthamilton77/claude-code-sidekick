import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatusError } from 'itty-router'
import type { ApiRequest } from '../../types.js'

// Mock sessions-api
const mockGetProjectById = vi.fn()
vi.mock('../../sessions-api.js', () => ({
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
}))

// Mock transcript-api
const mockParseTranscriptLines = vi.fn()
const mockParseSubagentTranscript = vi.fn()
vi.mock('../../transcript-api.js', () => ({
  parseTranscriptLines: (...args: unknown[]) => mockParseTranscriptLines(...args),
  parseSubagentTranscript: (...args: unknown[]) => mockParseSubagentTranscript(...args),
}))

import { handleGetTranscript, handleGetSubagentTranscript } from '../../handlers/transcript.js'

beforeEach(() => {
  mockGetProjectById.mockClear()
  mockParseTranscriptLines.mockClear()
  mockParseSubagentTranscript.mockClear()
})

function fakeRequest(params: Record<string, string> = {}): ApiRequest {
  const req = new Request('http://localhost/api/test') as ApiRequest
  req.ctx = { registryRoot: '/registry' }
  Object.assign(req, params)
  return req
}

describe('handleGetTranscript', () => {
  it('validates params, optionally looks up project, returns { lines }', async () => {
    const project = {
      id: '-Users-foo',
      name: 'foo',
      projectDir: '/Users/foo',
      branch: 'main',
      active: true,
    }
    mockGetProjectById.mockResolvedValue(project)
    const lines = [{ id: '1', type: 'user-message', content: 'hello' }]
    mockParseTranscriptLines.mockResolvedValue(lines)

    const req = fakeRequest({ projectId: '-Users-foo', sessionId: 'uuid-1' })
    const result = await handleGetTranscript(req)

    expect(result).toEqual({ lines })
    expect(mockGetProjectById).toHaveBeenCalledWith('/registry', '-Users-foo')
    expect(mockParseTranscriptLines).toHaveBeenCalledWith('-Users-foo', 'uuid-1', '/Users/foo')
  })

  it('does NOT throw 404 when project is missing (graceful degradation)', async () => {
    mockGetProjectById.mockResolvedValue(null)
    mockParseTranscriptLines.mockResolvedValue([])

    const req = fakeRequest({ projectId: 'missing-proj', sessionId: 'uuid-1' })
    const result = await handleGetTranscript(req)

    expect(result).toEqual({ lines: [] })
    // projectDir is undefined → no Sidekick event interleaving
    expect(mockParseTranscriptLines).toHaveBeenCalledWith('missing-proj', 'uuid-1', undefined)
  })

  it('throws StatusError(400) for invalid projectId', async () => {
    const req = fakeRequest({ projectId: '..', sessionId: 'uuid-1' })
    try {
      await handleGetTranscript(req)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(400)
    }
  })

  it('throws StatusError(400) for invalid sessionId', async () => {
    const req = fakeRequest({ projectId: '-Users-foo', sessionId: '..' })
    try {
      await handleGetTranscript(req)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(400)
    }
  })
})

describe('handleGetSubagentTranscript', () => {
  it('validates params, returns raw result (lines + meta) directly', async () => {
    const result = {
      lines: [{ id: '1', type: 'assistant-message' }],
      meta: { agentType: 'code' },
    }
    mockParseSubagentTranscript.mockResolvedValue(result)

    const req = fakeRequest({
      projectId: '-Users-foo',
      sessionId: 'uuid-1',
      agentId: 'agent-abc',
    })
    const response = await handleGetSubagentTranscript(req)

    // Returns the raw result object, NOT wrapped in { lines: ... }
    expect(response).toBe(result)
    expect(mockParseSubagentTranscript).toHaveBeenCalledWith(
      '-Users-foo',
      'uuid-1',
      'agent-abc'
    )
  })

  it('throws StatusError(404) when result is null', async () => {
    mockParseSubagentTranscript.mockResolvedValue(null)

    const req = fakeRequest({
      projectId: '-Users-foo',
      sessionId: 'uuid-1',
      agentId: 'missing-agent',
    })
    try {
      await handleGetSubagentTranscript(req)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(404)
    }
  })

  it('throws StatusError(400) for invalid agentId', async () => {
    const req = fakeRequest({
      projectId: '-Users-foo',
      sessionId: 'uuid-1',
      agentId: '..',
    })
    try {
      await handleGetSubagentTranscript(req)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(StatusError)
      expect((err as StatusError).status).toBe(400)
    }
  })
})
