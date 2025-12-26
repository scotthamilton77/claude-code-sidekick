import { describe, it, expect } from 'vitest'
import { encodeProjectPath, reconstructTranscriptPath } from '../claude-paths'
import { homedir } from 'os'
import path from 'path'

describe('claude-paths', () => {
  describe('encodeProjectPath', () => {
    it('should replace forward slashes with dashes', () => {
      expect(encodeProjectPath('/Users/scott/project')).toBe('-Users-scott-project')
    })

    it('should handle paths with multiple segments', () => {
      expect(encodeProjectPath('/home/user/src/my-app')).toBe('-home-user-src-my-app')
    })

    it('should handle root path', () => {
      expect(encodeProjectPath('/')).toBe('-')
    })
  })

  describe('reconstructTranscriptPath', () => {
    it('should build correct transcript path', () => {
      const projectDir = '/Users/scott/project'
      const sessionId = 'abc-123-def'
      const result = reconstructTranscriptPath(projectDir, sessionId)

      expect(result).toBe(path.join(homedir(), '.claude', 'projects', '-Users-scott-project', 'abc-123-def.jsonl'))
    })

    it('should handle complex project paths', () => {
      const projectDir = '/home/user/src/projects/my-app'
      const sessionId = 'session-uuid'
      const result = reconstructTranscriptPath(projectDir, sessionId)

      expect(result).toBe(
        path.join(homedir(), '.claude', 'projects', '-home-user-src-projects-my-app', 'session-uuid.jsonl')
      )
    })
  })
})
