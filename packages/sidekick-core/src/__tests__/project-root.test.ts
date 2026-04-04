import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveProjectRoot } from '../project-root.js'

describe('resolveProjectRoot', () => {
  it('returns { projectRoot: undefined } when projectDir is undefined', () => {
    expect(resolveProjectRoot({})).toEqual({ projectRoot: undefined })
  })

  it('returns { projectRoot: undefined } when projectDir is empty string', () => {
    // Empty string is falsy — treated the same as omitted
    expect(resolveProjectRoot({ projectDir: '' })).toEqual({ projectRoot: undefined })
  })

  it('returns the resolved absolute path when projectDir is an absolute path', () => {
    expect(resolveProjectRoot({ projectDir: '/some/absolute/dir' })).toEqual({
      projectRoot: '/some/absolute/dir',
    })
  })

  it('returns an absolute resolved path when projectDir is a relative path', () => {
    const relPath = './foo/bar'
    const result = resolveProjectRoot({ projectDir: relPath })
    expect(result.projectRoot).toBe(path.resolve(relPath))
  })
})
