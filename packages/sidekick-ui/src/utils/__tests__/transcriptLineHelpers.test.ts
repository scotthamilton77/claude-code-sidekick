import { describe, it, expect } from 'vitest'
import {
  truncate,
  formatToolInput,
  isSafeUrl,
  formatDuration,
  extractCommandName,
  extractSkillName,
  getSystemInjectionLabel,
} from '../transcriptLineHelpers'

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates long strings with ellipsis', () => {
    const result = truncate('a'.repeat(20), 10)
    expect(result).toHaveLength(11) // 10 chars + ellipsis
    expect(result.endsWith('\u2026')).toBe(true)
  })

  it('returns exact-length strings unchanged', () => {
    expect(truncate('12345', 5)).toBe('12345')
  })
})

describe('formatToolInput', () => {
  it('returns empty string when input is undefined', () => {
    expect(formatToolInput('Bash', undefined)).toBe('')
  })

  it('extracts command from Bash tool', () => {
    expect(formatToolInput('Bash', { command: 'ls -la' })).toBe('ls -la')
  })

  it('extracts file_path from Read tool', () => {
    expect(formatToolInput('Read', { file_path: '/path/to/file.ts' })).toBe('/path/to/file.ts')
  })

  it('extracts file_path from Edit tool', () => {
    expect(formatToolInput('Edit', { file_path: '/path/to/file.ts' })).toBe('/path/to/file.ts')
  })

  it('extracts file_path from Write tool', () => {
    expect(formatToolInput('Write', { file_path: '/path/to/file.ts' })).toBe('/path/to/file.ts')
  })

  it('extracts pattern from Grep tool with slashes', () => {
    expect(formatToolInput('Grep', { pattern: 'hello.*world' })).toBe('/hello.*world/')
  })

  it('extracts pattern from Glob tool', () => {
    expect(formatToolInput('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts')
  })

  it('extracts description from Agent tool', () => {
    expect(formatToolInput('Agent', { description: 'do something' })).toBe('do something')
  })

  it('extracts skill from Skill tool', () => {
    expect(formatToolInput('Skill', { skill: 'brainstorm' })).toBe('brainstorm')
  })

  it('falls back to first string value for unknown tools', () => {
    expect(formatToolInput('Custom', { foo: 42, bar: 'hello' })).toBe('hello')
  })

  it('returns empty string when no string values exist', () => {
    expect(formatToolInput('Custom', { foo: 42, bar: true })).toBe('')
  })

  it('truncates long Bash commands', () => {
    const longCmd = 'x'.repeat(300)
    const result = formatToolInput('Bash', { command: longCmd })
    expect(result.length).toBeLessThanOrEqual(201) // 200 + ellipsis
  })
})

describe('isSafeUrl', () => {
  it('allows http URLs', () => {
    expect(isSafeUrl('http://example.com')).toBe(true)
  })

  it('allows https URLs', () => {
    expect(isSafeUrl('https://github.com/user/repo/pull/123')).toBe(true)
  })

  it('rejects javascript: URLs', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects data: URLs', () => {
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('rejects ftp: URLs', () => {
    expect(isSafeUrl('ftp://example.com')).toBe(false)
  })

  it('rejects invalid URLs', () => {
    expect(isSafeUrl('not a url')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isSafeUrl('')).toBe(false)
  })
})

describe('formatDuration', () => {
  it('returns "?" for undefined', () => {
    expect(formatDuration(undefined)).toBe('?')
  })

  it('returns "?" for null', () => {
    expect(formatDuration(null as unknown as undefined)).toBe('?')
  })

  it('formats sub-second durations in ms', () => {
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('formats durations >= 1s in seconds', () => {
    expect(formatDuration(1000)).toBe('1.0s')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(10000)).toBe('10.0s')
  })
})

describe('extractCommandName', () => {
  it('extracts command name from tag', () => {
    expect(extractCommandName('Some text <command-name>/commit</command-name> more text')).toBe('commit')
  })

  it('handles command names without leading slash', () => {
    expect(extractCommandName('<command-name>review-pr</command-name>')).toBe('review-pr')
  })

  it('returns null when no tag is present', () => {
    expect(extractCommandName('plain text')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractCommandName('')).toBeNull()
  })
})

describe('extractSkillName', () => {
  it('extracts skill name from path', () => {
    const content = 'Base directory for this skill: /Users/scott/.claude/skills/brainstorm'
    expect(extractSkillName(content)).toBe('brainstorm')
  })

  it('extracts hyphenated skill names', () => {
    const content = 'Base directory for this skill: /home/user/.claude/skills/test-driven-development'
    expect(extractSkillName(content)).toBe('test-driven-development')
  })

  it('returns null when no skill path is present', () => {
    expect(extractSkillName('some random content')).toBeNull()
  })
})

describe('getSystemInjectionLabel', () => {
  it('returns "Session start hook" for SessionStart content', () => {
    expect(getSystemInjectionLabel('Hook type: SessionStart ...')).toBe('Session start hook')
  })

  it('returns "Prompt hook" for UserPromptSubmit content', () => {
    expect(getSystemInjectionLabel('Hook type: UserPromptSubmit ...')).toBe('Prompt hook')
  })

  it('returns "System reminder" for system-reminder tags', () => {
    expect(getSystemInjectionLabel('<system-reminder>some data</system-reminder>')).toBe('System reminder')
  })

  it('returns "System injection" as fallback', () => {
    expect(getSystemInjectionLabel('some unknown injection content')).toBe('System injection')
  })

  it('returns "System injection" for empty string', () => {
    expect(getSystemInjectionLabel('')).toBe('System injection')
  })
})
