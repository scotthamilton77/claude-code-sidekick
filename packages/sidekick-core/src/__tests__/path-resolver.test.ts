import { describe, it, expect } from 'vitest'
import { PathResolver } from '../state/path-resolver.js'

describe('PathResolver', () => {
  const resolver = new PathResolver('/projects/myapp')

  it('sessionLogsDir returns correct path for a session', () => {
    expect(resolver.sessionLogsDir('abc-123')).toBe('/projects/myapp/.sidekick/sessions/abc-123/logs')
  })
})
