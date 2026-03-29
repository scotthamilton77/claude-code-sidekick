import { describe, it, expect } from 'vitest'
import {
  truncate,
  formatToolInput,
  extractCommandName,
  extractSkillName,
  getSystemInjectionLabel,
  isSafeUrl,
  formatDuration,
} from '../TranscriptLineUtils'

describe('truncate', () => {
  it('returns string unchanged when shorter than max', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('returns string unchanged when exactly max length', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('truncates and appends ellipsis when longer than max', () => {
    expect(truncate('hello world', 5)).toBe('hello\u2026')
  })

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('')
  })
})

describe('formatToolInput', () => {
  it('returns empty string for undefined input', () => {
    expect(formatToolInput('Bash')).toBe('')
  })

  it('returns command for Bash tool', () => {
    expect(formatToolInput('Bash', { command: 'ls -la' })).toBe('ls -la')
  })

  it('returns file_path for Read tool', () => {
    expect(formatToolInput('Read', { file_path: '/foo/bar.ts' })).toBe('/foo/bar.ts')
  })

  it('returns file_path for Edit tool', () => {
    expect(formatToolInput('Edit', { file_path: '/src/index.ts' })).toBe('/src/index.ts')
  })

  it('returns file_path for Write tool', () => {
    expect(formatToolInput('Write', { file_path: '/tmp/out.txt' })).toBe('/tmp/out.txt')
  })

  it('wraps Grep pattern in slashes', () => {
    expect(formatToolInput('Grep', { pattern: 'foo.*bar' })).toBe('/foo.*bar/')
  })

  it('returns pattern for Glob tool', () => {
    expect(formatToolInput('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts')
  })

  it('returns description for Agent tool', () => {
    expect(formatToolInput('Agent', { description: 'Research task' })).toBe('Research task')
  })

  it('returns skill name for Skill tool', () => {
    expect(formatToolInput('Skill', { skill: 'brainstorm' })).toBe('brainstorm')
  })

  it('falls back to first string value for unknown tool', () => {
    expect(formatToolInput('Unknown', { foo: 42, bar: 'hello' })).toBe('hello')
  })

  it('returns empty string when no string values found', () => {
    expect(formatToolInput('Unknown', { a: 42, b: true })).toBe('')
  })

  it('truncates long Bash commands', () => {
    const longCmd = 'x'.repeat(300)
    const result = formatToolInput('Bash', { command: longCmd })
    expect(result.length).toBeLessThanOrEqual(201) // 200 + ellipsis
  })
})

describe('extractCommandName', () => {
  it('extracts command name from tag', () => {
    expect(extractCommandName('run <command-name>commit</command-name> now')).toBe('commit')
  })

  it('extracts command name with leading slash', () => {
    expect(extractCommandName('<command-name>/review</command-name>')).toBe('review')
  })

  it('handles hyphens in command names', () => {
    expect(extractCommandName('<command-name>code-review</command-name>')).toBe('code-review')
  })

  it('returns null when no tag found', () => {
    expect(extractCommandName('no command here')).toBeNull()
  })
})

describe('extractSkillName', () => {
  it('extracts skill name from path', () => {
    expect(extractSkillName('Base directory for this skill: /foo/skills/brainstorm')).toBe('brainstorm')
  })

  it('handles hyphens in skill names', () => {
    expect(extractSkillName('Base directory for this skill: /bar/skills/code-review')).toBe('code-review')
  })

  it('returns null when pattern not found', () => {
    expect(extractSkillName('no skill path here')).toBeNull()
  })
})

describe('getSystemInjectionLabel', () => {
  it('returns session start hook label', () => {
    expect(getSystemInjectionLabel('SessionStart event payload')).toBe('Session start hook')
  })

  it('returns prompt hook label', () => {
    expect(getSystemInjectionLabel('UserPromptSubmit triggered')).toBe('Prompt hook')
  })

  it('returns system reminder label', () => {
    expect(getSystemInjectionLabel('<system-reminder>some content</system-reminder>')).toBe('System reminder')
  })

  it('returns generic label for unknown content', () => {
    expect(getSystemInjectionLabel('something else entirely')).toBe('System injection')
  })

  it('checks in priority order (SessionStart before system-reminder)', () => {
    expect(getSystemInjectionLabel('SessionStart <system-reminder>')).toBe('Session start hook')
  })
})

describe('isSafeUrl', () => {
  it('allows http URLs', () => {
    expect(isSafeUrl('http://example.com')).toBe(true)
  })

  it('allows https URLs', () => {
    expect(isSafeUrl('https://github.com/pr/123')).toBe(true)
  })

  it('blocks javascript: URLs', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
  })

  it('blocks data: URLs', () => {
    expect(isSafeUrl('data:text/html,<h1>hi</h1>')).toBe(false)
  })

  it('blocks file: URLs', () => {
    expect(isSafeUrl('file:///etc/passwd')).toBe(false)
  })

  it('returns false for invalid URLs', () => {
    expect(isSafeUrl('not a url')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isSafeUrl('')).toBe(false)
  })
})

describe('formatDuration', () => {
  it('returns ? for undefined', () => {
    expect(formatDuration(undefined)).toBe('?')
  })

  it('returns ? for null', () => {
    expect(formatDuration(null as unknown as undefined)).toBe('?')
  })

  it('returns milliseconds for values under 1000', () => {
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('returns seconds with one decimal for values >= 1000', () => {
    expect(formatDuration(1000)).toBe('1.0s')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(12345)).toBe('12.3s')
  })
})
