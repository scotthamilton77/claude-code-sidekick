/**
 * Security validation tests for API path parameters.
 *
 * Tests path traversal prevention, null byte injection, and other attack vectors.
 */

import { describe, it, expect } from 'vitest'
import { isValidSessionId, isValidHookName, isValidTimestamp, isValidFilename } from '../utils'

describe('isValidSessionId', () => {
  describe('valid session IDs', () => {
    it('accepts alphanumeric session IDs', () => {
      expect(isValidSessionId('sess-abc123')).toBe(true)
      expect(isValidSessionId('session_12345')).toBe(true)
      expect(isValidSessionId('ABC-123-XYZ')).toBe(true)
      expect(isValidSessionId('test_session')).toBe(true)
    })

    it('accepts UUID-style session IDs', () => {
      expect(isValidSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    })

    it('accepts short session IDs', () => {
      expect(isValidSessionId('s1')).toBe(true)
      expect(isValidSessionId('abc')).toBe(true)
    })
  })

  describe('invalid session IDs - path traversal attempts', () => {
    it('rejects path traversal with ../', () => {
      expect(isValidSessionId('../etc/passwd')).toBe(false)
      expect(isValidSessionId('../../secrets')).toBe(false)
      expect(isValidSessionId('sess/../admin')).toBe(false)
    })

    it('rejects path traversal with ..\\ (Windows)', () => {
      expect(isValidSessionId('..\\windows\\system32')).toBe(false)
      expect(isValidSessionId('sess\\..\\admin')).toBe(false)
    })

    it('rejects absolute paths', () => {
      expect(isValidSessionId('/etc/passwd')).toBe(false)
      expect(isValidSessionId('/root/secrets')).toBe(false)
      expect(isValidSessionId('C:\\Windows')).toBe(false)
    })

    it('rejects embedded path separators', () => {
      expect(isValidSessionId('sess/admin')).toBe(false)
      expect(isValidSessionId('sess\\admin')).toBe(false)
    })
  })

  describe('invalid session IDs - null byte injection', () => {
    it('rejects null byte literals', () => {
      expect(isValidSessionId('sess\0.txt')).toBe(false)
      expect(isValidSessionId('sess\0/../etc/passwd')).toBe(false)
    })

    it('rejects URL-encoded null bytes', () => {
      expect(isValidSessionId('sess%00.txt')).toBe(false)
      expect(isValidSessionId('sess%00/../etc/passwd')).toBe(false)
    })
  })

  describe('invalid session IDs - format violations', () => {
    it('rejects empty or undefined', () => {
      expect(isValidSessionId('')).toBe(false)
      expect(isValidSessionId(undefined)).toBe(false)
    })

    it('rejects non-string types', () => {
      expect(isValidSessionId(123 as unknown as string)).toBe(false)

      expect(isValidSessionId({} as unknown as string)).toBe(false)

      expect(isValidSessionId(null as unknown as string)).toBe(false)
    })

    it('rejects too-long session IDs', () => {
      const tooLong = 'a'.repeat(65)
      expect(isValidSessionId(tooLong)).toBe(false)
    })

    it('rejects special characters', () => {
      expect(isValidSessionId('sess@admin')).toBe(false)
      expect(isValidSessionId('sess#123')).toBe(false)
      expect(isValidSessionId('sess$var')).toBe(false)
      expect(isValidSessionId('sess&cmd')).toBe(false)
      expect(isValidSessionId('sess;rm-rf')).toBe(false)
      expect(isValidSessionId('sess|cmd')).toBe(false)
      expect(isValidSessionId('sess`cmd`')).toBe(false)
    })
  })
})

describe('isValidHookName', () => {
  describe('valid hook names', () => {
    it('accepts PascalCase hook names', () => {
      expect(isValidHookName('SessionStart')).toBe(true)
      expect(isValidHookName('UserPromptSubmit')).toBe(true)
      expect(isValidHookName('PreToolUse')).toBe(true)
      expect(isValidHookName('PostToolUse')).toBe(true)
      expect(isValidHookName('Stop')).toBe(true)
    })
  })

  describe('invalid hook names - path traversal attempts', () => {
    it('rejects path traversal patterns', () => {
      expect(isValidHookName('../secrets')).toBe(false)
      expect(isValidHookName('../../etc/passwd')).toBe(false)
      expect(isValidHookName('Hook/../admin')).toBe(false)
    })

    it('rejects absolute paths', () => {
      expect(isValidHookName('/etc/passwd')).toBe(false)
      expect(isValidHookName('C:\\Windows')).toBe(false)
    })

    it('rejects path separators', () => {
      expect(isValidHookName('Session/Start')).toBe(false)
      expect(isValidHookName('Session\\Start')).toBe(false)
    })
  })

  describe('invalid hook names - null byte injection', () => {
    it('rejects null bytes', () => {
      expect(isValidHookName('Hook\0')).toBe(false)
      expect(isValidHookName('Hook%00')).toBe(false)
    })
  })

  describe('invalid hook names - format violations', () => {
    it('rejects empty or undefined', () => {
      expect(isValidHookName('')).toBe(false)
      expect(isValidHookName(undefined)).toBe(false)
    })

    it('rejects non-string types', () => {
      expect(isValidHookName(123 as unknown as string)).toBe(false)
    })

    it('rejects too-long hook names', () => {
      const tooLong = 'A' + 'a'.repeat(64)
      expect(isValidHookName(tooLong)).toBe(false)
    })

    it('rejects lowercase start', () => {
      expect(isValidHookName('sessionStart')).toBe(false)
      expect(isValidHookName('hook')).toBe(false)
    })

    it('rejects numbers and special characters', () => {
      expect(isValidHookName('Session123')).toBe(false)
      expect(isValidHookName('Session-Start')).toBe(false)
      expect(isValidHookName('Session_Start')).toBe(false)
      expect(isValidHookName('Session@Start')).toBe(false)
    })
  })
})

describe('isValidTimestamp', () => {
  describe('valid timestamps', () => {
    it('accepts valid Unix timestamps in milliseconds', () => {
      expect(isValidTimestamp('1678888888888')).toBe(true) // Mar 2023
      expect(isValidTimestamp('1609459200000')).toBe(true) // Jan 2021
      expect(isValidTimestamp('0')).toBe(true) // Unix epoch
    })

    it('accepts future timestamps (up to year 2100)', () => {
      expect(isValidTimestamp('4000000000000')).toBe(true) // ~2096
    })
  })

  describe('invalid timestamps - format violations', () => {
    it('rejects empty or undefined', () => {
      expect(isValidTimestamp('')).toBe(false)
      expect(isValidTimestamp(undefined)).toBe(false)
    })

    it('rejects non-string types', () => {
      expect(isValidTimestamp(123 as unknown as string)).toBe(false)
    })

    it('rejects non-numeric strings', () => {
      expect(isValidTimestamp('abc')).toBe(false)
      expect(isValidTimestamp('12abc34')).toBe(false)
      expect(isValidTimestamp('1.23e10')).toBe(false) // Scientific notation
    })

    it('rejects negative timestamps', () => {
      expect(isValidTimestamp('-1')).toBe(false)
      expect(isValidTimestamp('-1678888888888')).toBe(false)
    })

    it('rejects timestamps beyond year 2100', () => {
      expect(isValidTimestamp('5000000000000')).toBe(false)
      expect(isValidTimestamp('9999999999999')).toBe(false)
    })
  })

  describe('invalid timestamps - injection attempts', () => {
    it('rejects path traversal patterns', () => {
      expect(isValidTimestamp('../1234')).toBe(false)
      expect(isValidTimestamp('1234/../5678')).toBe(false)
    })

    it('rejects special characters', () => {
      expect(isValidTimestamp('1234;rm-rf')).toBe(false)
      expect(isValidTimestamp('1234|cmd')).toBe(false)
      expect(isValidTimestamp('1234`cmd`')).toBe(false)
    })
  })
})

describe('isValidFilename', () => {
  describe('valid filenames', () => {
    it('accepts .json files with safe names', () => {
      expect(isValidFilename('reminder.json')).toBe(true)
      expect(isValidFilename('session-summary.json')).toBe(true)
      expect(isValidFilename('state_123.json')).toBe(true)
      expect(isValidFilename('file.with.dots.json')).toBe(true)
    })
  })

  describe('invalid filenames - path traversal attempts', () => {
    it('rejects path traversal patterns', () => {
      expect(isValidFilename('../secrets.json')).toBe(false)
      expect(isValidFilename('../../etc/passwd.json')).toBe(false)
      expect(isValidFilename('file/../admin.json')).toBe(false)
    })

    it('rejects absolute paths', () => {
      expect(isValidFilename('/etc/passwd.json')).toBe(false)
      expect(isValidFilename('C:\\Windows\\system.json')).toBe(false)
    })

    it('rejects path separators', () => {
      expect(isValidFilename('dir/file.json')).toBe(false)
      expect(isValidFilename('dir\\file.json')).toBe(false)
    })
  })

  describe('invalid filenames - null byte injection', () => {
    it('rejects null bytes', () => {
      expect(isValidFilename('file\0.json')).toBe(false)
      expect(isValidFilename('file%00.json')).toBe(false)
    })
  })

  describe('invalid filenames - format violations', () => {
    it('rejects empty or undefined', () => {
      expect(isValidFilename('')).toBe(false)
      expect(isValidFilename(undefined)).toBe(false)
    })

    it('rejects non-string types', () => {
      expect(isValidFilename(123 as unknown as string)).toBe(false)
    })

    it('rejects files without .json extension', () => {
      expect(isValidFilename('file.txt')).toBe(false)
      expect(isValidFilename('file')).toBe(false)
      expect(isValidFilename('file.json.bak')).toBe(false)
    })

    it('rejects too-long filenames', () => {
      // 251 chars + '.json' (5 chars) = 256 chars, exceeds 255 limit
      const tooLong = 'a'.repeat(251) + '.json'
      expect(isValidFilename(tooLong)).toBe(false)
    })

    it('rejects special characters', () => {
      expect(isValidFilename('file@admin.json')).toBe(false)
      expect(isValidFilename('file#123.json')).toBe(false)
      expect(isValidFilename('file$var.json')).toBe(false)
      expect(isValidFilename('file;cmd.json')).toBe(false)
    })
  })
})
