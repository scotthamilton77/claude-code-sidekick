// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSessions } from '../useSessions'

const mockFetch = vi.fn() as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockFetch.mockClear()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  }
}

describe('useSessions', () => {
  it('starts in loading state', () => {
    // fetch never resolves
    mockFetch.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useSessions())
    expect(result.current.loading).toBe(true)
    expect(result.current.projects).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('fetches projects and sessions, maps to Project[] type', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/projects') {
        return Promise.resolve(
          jsonResponse({
            projects: [
              {
                id: 'proj-1',
                name: 'my-project',
                projectDir: '/Users/scott/src/my-project',
                branch: 'main',
                active: true,
              },
            ],
          }),
        )
      }
      if (url.includes('/api/projects/proj-1/sessions')) {
        return Promise.resolve(
          jsonResponse({
            sessions: [
              {
                id: 'sess-1',
                title: 'Fix bug',
                date: '2026-03-10T14:30:00.000Z',
                status: 'active' as const,
                persona: 'jarvis',
                intent: 'Bug fix',
                intentConfidence: 0.85,
              },
            ],
          }),
        )
      }
      return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
    })

    const { result } = renderHook(() => useSessions())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBeNull()
    expect(result.current.projects).toHaveLength(1)

    const project = result.current.projects[0]
    expect(project.id).toBe('proj-1')
    expect(project.name).toBe('my-project')
    expect(project.sessions).toHaveLength(1)

    const session = project.sessions[0]
    expect(session.id).toBe('sess-1')
    expect(session.title).toBe('Fix bug')
    expect(session.branch).toBe('main') // mapped from project
    expect(session.projectId).toBe('proj-1')
    expect(session.persona).toBe('jarvis')
    expect(session.status).toBe('active')
    expect(session.transcriptLines).toEqual([])
    expect(session.sidekickEvents).toEqual([])
    expect(session.stateSnapshots).toEqual([])
    // ledStates is a Map
    expect(session.ledStates).toBeInstanceOf(Map)
    expect(session.ledStates.size).toBe(0)
  })

  it('sets error when projects fetch fails', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Server error' }, 500))

    const { result } = renderHook(() => useSessions())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Failed to fetch projects: 500')
    expect(result.current.projects).toEqual([])
  })

  it('returns project with empty sessions when sessions fetch fails', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/projects') {
        return Promise.resolve(
          jsonResponse({
            projects: [
              {
                id: 'proj-1',
                name: 'my-project',
                projectDir: '/test',
                branch: 'main',
                active: false,
              },
            ],
          }),
        )
      }
      // Sessions endpoint fails
      return Promise.reject(new Error('Network error'))
    })

    const { result } = renderHook(() => useSessions())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBeNull()
    expect(result.current.projects).toHaveLength(1)
    expect(result.current.projects[0].sessions).toEqual([])
  })
})
