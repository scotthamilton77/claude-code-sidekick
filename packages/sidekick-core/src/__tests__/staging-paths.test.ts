/**
 * Tests for staging-paths utility functions
 *
 * Tests the shared path construction, validation, and filtering utilities
 * used by both StagingServiceCore and CLIStagingReader.
 *
 * @see packages/sidekick-core/src/staging-paths.ts
 */

import { describe, it, expect } from 'vitest'
import {
  getStagingRoot,
  getHookDir,
  getReminderPath,
  isValidPathSegment,
  validatePathSegment,
  filterActiveReminderFiles,
  createConsumedFilePattern,
  extractConsumedTimestamp,
  CONSUMED_FILE_PATTERN,
} from '../staging-paths'

// ============================================================================
// Path Construction
// ============================================================================

describe('Path Construction', () => {
  describe('getStagingRoot', () => {
    it('returns correct staging root path', () => {
      expect(getStagingRoot('/state', 'session-123')).toBe('/state/sessions/session-123/stage')
    })
  })

  describe('getHookDir', () => {
    it('returns correct hook directory path', () => {
      expect(getHookDir('/state', 'session-123', 'PostToolUse')).toBe('/state/sessions/session-123/stage/PostToolUse')
    })
  })

  describe('getReminderPath', () => {
    it('returns correct reminder file path', () => {
      expect(getReminderPath('/state', 'session-123', 'PostToolUse', 'MyReminder')).toBe(
        '/state/sessions/session-123/stage/PostToolUse/MyReminder.json'
      )
    })
  })
})

// ============================================================================
// Path Validation
// ============================================================================

describe('Path Validation', () => {
  describe('isValidPathSegment', () => {
    it('returns true for valid segment', () => {
      expect(isValidPathSegment('valid-name')).toBe(true)
    })

    it('returns true for segment with underscores', () => {
      expect(isValidPathSegment('valid_name')).toBe(true)
    })

    it('returns false for empty string', () => {
      expect(isValidPathSegment('')).toBe(false)
    })

    it('returns false for literal ".." but allows ".." as substring', () => {
      expect(isValidPathSegment('..')).toBe(false)
      expect(isValidPathSegment('foo..')).toBe(true)
      expect(isValidPathSegment('..bar')).toBe(true)
    })

    it('returns false for segment with forward slash', () => {
      expect(isValidPathSegment('foo/bar')).toBe(false)
    })

    it('returns false for segment with backslash', () => {
      expect(isValidPathSegment('foo\\bar')).toBe(false)
    })

    it('accepts dot-prefixed segments (allowed by character class)', () => {
      expect(isValidPathSegment('.hidden')).toBe(true)
      expect(isValidPathSegment('.gitignore')).toBe(true)
    })

    it('rejects segments with characters outside allowed set', () => {
      expect(isValidPathSegment('foo bar')).toBe(false)
      expect(isValidPathSegment('foo@bar')).toBe(false)
    })
  })

  describe('validatePathSegment', () => {
    it('does not throw for valid segment', () => {
      expect(() => validatePathSegment('valid-name', 'hookName')).not.toThrow()
    })

    it('throws for empty segment with descriptive message', () => {
      expect(() => validatePathSegment('', 'hookName')).toThrow('hookName cannot be empty')
    })

    it('throws for path traversal with descriptive message', () => {
      expect(() => validatePathSegment('..', 'hookName')).toThrow(
        'Invalid hookName: path traversal characters not allowed'
      )
    })

    it('throws for forward slash with descriptive message', () => {
      expect(() => validatePathSegment('foo/bar', 'reminderName')).toThrow(
        'Invalid reminderName: path traversal characters not allowed'
      )
    })

    it('throws for backslash with descriptive message', () => {
      expect(() => validatePathSegment('foo\\bar', 'reminderName')).toThrow(
        'Invalid reminderName: path traversal characters not allowed'
      )
    })

    it('throws for dot-prefixed segment with descriptive message', () => {
      expect(() => validatePathSegment('.hidden', 'hookName')).toThrow("Invalid hookName: cannot start with '.'")
    })
  })
})

// ============================================================================
// File Filtering
// ============================================================================

describe('File Filtering', () => {
  describe('CONSUMED_FILE_PATTERN', () => {
    it('matches consumed file format', () => {
      expect(CONSUMED_FILE_PATTERN.test('reminder.1234567890123.json')).toBe(true)
    })

    it('does not match active reminder file', () => {
      expect(CONSUMED_FILE_PATTERN.test('reminder.json')).toBe(false)
    })
  })

  describe('filterActiveReminderFiles', () => {
    it('filters out consumed files', () => {
      const files = ['reminder.json', 'reminder.1234567890123.json', 'other.json']
      expect(filterActiveReminderFiles(files)).toEqual(['reminder.json', 'other.json'])
    })

    it('filters out non-json files', () => {
      const files = ['reminder.json', 'readme.txt', 'notes.md']
      expect(filterActiveReminderFiles(files)).toEqual(['reminder.json'])
    })

    it('returns empty array for empty input', () => {
      expect(filterActiveReminderFiles([])).toEqual([])
    })
  })

  describe('createConsumedFilePattern', () => {
    it('creates pattern that matches consumed file for given reminder', () => {
      const pattern = createConsumedFilePattern('MyReminder')
      expect(pattern.test('MyReminder.1234567890123.json')).toBe(true)
    })

    it('pattern does not match different reminder name', () => {
      const pattern = createConsumedFilePattern('MyReminder')
      expect(pattern.test('OtherReminder.1234567890123.json')).toBe(false)
    })

    it('pattern captures timestamp', () => {
      const pattern = createConsumedFilePattern('MyReminder')
      const match = pattern.exec('MyReminder.1706000000000.json')
      expect(match?.[1]).toBe('1706000000000')
    })
  })

  describe('extractConsumedTimestamp', () => {
    it('extracts timestamp from consumed file', () => {
      expect(extractConsumedTimestamp('MyReminder.1706000000000.json', 'MyReminder')).toBe(1706000000000)
    })

    it('returns null for non-consumed file', () => {
      expect(extractConsumedTimestamp('MyReminder.json', 'MyReminder')).toBeNull()
    })

    it('returns null for different reminder name', () => {
      expect(extractConsumedTimestamp('OtherReminder.1706000000000.json', 'MyReminder')).toBeNull()
    })
  })
})
