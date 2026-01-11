/**
 * Tests for CLI parsing functions.
 *
 * Verifies behavior of input parsing at the CLI boundary:
 * - parseHookInput: JSON parsing from stdin
 * - parseStatuslineInput: Claude Code status input parsing
 *
 * These are pure functions that validate/transform external input.
 * Tests focus on behavior (return values), not implementation details.
 */
import { describe, expect, test } from 'vitest'

import { parseHookInput } from '../cli'
import { parseStatuslineInput } from '../commands/statusline'

describe('parseHookInput', () => {
  test('returns undefined for undefined input', () => {
    expect(parseHookInput(undefined)).toBeUndefined()
  })

  test('returns undefined for empty string', () => {
    expect(parseHookInput('')).toBeUndefined()
  })

  test('returns undefined for whitespace-only string', () => {
    expect(parseHookInput('   \n\t  ')).toBeUndefined()
  })

  test('returns undefined for invalid JSON', () => {
    expect(parseHookInput('not json')).toBeUndefined()
    expect(parseHookInput('{invalid')).toBeUndefined()
    expect(parseHookInput('{"unclosed": ')).toBeUndefined()
  })

  test('returns undefined when session_id is missing', () => {
    expect(parseHookInput(JSON.stringify({ other: 'data' }))).toBeUndefined()
    expect(parseHookInput(JSON.stringify({}))).toBeUndefined()
  })

  test('returns undefined when session_id is not a string', () => {
    expect(parseHookInput(JSON.stringify({ session_id: 123 }))).toBeUndefined()
    expect(parseHookInput(JSON.stringify({ session_id: null }))).toBeUndefined()
    expect(parseHookInput(JSON.stringify({ session_id: ['arr'] }))).toBeUndefined()
  })

  test('extracts session_id from valid input', () => {
    const result = parseHookInput(JSON.stringify({ session_id: 'abc123' }))
    expect(result?.sessionId).toBe('abc123')
  })

  test('extracts all optional fields when present', () => {
    const input = {
      session_id: 'abc',
      transcript_path: '/path/to/transcript.jsonl',
      cwd: '/project/dir',
      hook_event_name: 'SessionStart',
      permission_mode: 'strict',
    }
    const result = parseHookInput(JSON.stringify(input))

    expect(result).toEqual({
      sessionId: 'abc',
      transcriptPath: '/path/to/transcript.jsonl',
      cwd: '/project/dir',
      hookEventName: 'SessionStart',
      permissionMode: 'strict',
      raw: input,
    })
  })

  test('provides defaults for missing optional fields', () => {
    const input = { session_id: 'minimal' }
    const result = parseHookInput(JSON.stringify(input))

    expect(result?.sessionId).toBe('minimal')
    expect(result?.transcriptPath).toBe('')
    expect(result?.cwd).toBeUndefined()
    expect(result?.hookEventName).toBe('unknown')
    expect(result?.permissionMode).toBeUndefined()
  })

  test('preserves raw input object for handler access', () => {
    const input = {
      session_id: 'test',
      custom_field: 'custom_value',
      nested: { data: 123 },
    }
    const result = parseHookInput(JSON.stringify(input))

    expect(result?.raw).toEqual(input)
  })

  test('ignores non-string types for optional string fields', () => {
    const input = {
      session_id: 'test',
      transcript_path: 123, // number, should be ignored
      cwd: ['array'], // array, should be ignored
      hook_event_name: { obj: true }, // object, should be ignored
    }
    const result = parseHookInput(JSON.stringify(input))

    expect(result?.sessionId).toBe('test')
    expect(result?.transcriptPath).toBe('')
    expect(result?.cwd).toBeUndefined()
    expect(result?.hookEventName).toBe('unknown')
  })
})

describe('parseStatuslineInput', () => {
  test('returns undefined when session_id is missing', () => {
    expect(parseStatuslineInput({ cwd: '/project' })).toBeUndefined()
  })

  test('returns undefined when session_id is not a string', () => {
    expect(parseStatuslineInput({ session_id: 123, cwd: '/project' })).toBeUndefined()
  })

  test('returns undefined when cwd is missing', () => {
    expect(parseStatuslineInput({ session_id: 'abc' })).toBeUndefined()
  })

  test('returns undefined when cwd is not a string', () => {
    expect(parseStatuslineInput({ session_id: 'abc', cwd: 123 })).toBeUndefined()
  })

  test('parses minimal valid input with defaults', () => {
    const result = parseStatuslineInput({ session_id: 'abc123', cwd: '/project' })

    expect(result).toBeDefined()
    expect(result?.session_id).toBe('abc123')
    expect(result?.cwd).toBe('/project')
    expect(result?.hook_event_name).toBe('Status')
    expect(result?.version).toBe('unknown')
    expect(result?.model.id).toBe('unknown')
    expect(result?.model.display_name).toBe('unknown')
    expect(result?.cost.total_cost_usd).toBe(0)
  })

  test('extracts nested model fields', () => {
    const input = {
      session_id: 'test',
      cwd: '/project',
      model: {
        id: 'claude-3-opus',
        display_name: 'Claude 3 Opus',
      },
    }
    const result = parseStatuslineInput(input)

    expect(result?.model.id).toBe('claude-3-opus')
    expect(result?.model.display_name).toBe('Claude 3 Opus')
  })

  test('extracts nested workspace fields', () => {
    const input = {
      session_id: 'test',
      cwd: '/project/subdir',
      workspace: {
        current_dir: '/project/subdir',
        project_dir: '/project',
      },
    }
    const result = parseStatuslineInput(input)

    expect(result?.workspace.current_dir).toBe('/project/subdir')
    expect(result?.workspace.project_dir).toBe('/project')
  })

  test('extracts cost metrics', () => {
    const input = {
      session_id: 'test',
      cwd: '/project',
      cost: {
        total_cost_usd: 0.42,
        total_duration_ms: 30000,
        total_api_duration_ms: 25000,
        total_lines_added: 100,
        total_lines_removed: 50,
      },
    }
    const result = parseStatuslineInput(input)

    expect(result?.cost.total_cost_usd).toBe(0.42)
    expect(result?.cost.total_duration_ms).toBe(30000)
    expect(result?.cost.total_api_duration_ms).toBe(25000)
    expect(result?.cost.total_lines_added).toBe(100)
    expect(result?.cost.total_lines_removed).toBe(50)
  })

  test('extracts context window metrics', () => {
    const input = {
      session_id: 'test',
      cwd: '/project',
      context_window: {
        total_input_tokens: 50000,
        total_output_tokens: 10000,
        context_window_size: 200000,
        current_usage: {
          input_tokens: 25000,
          output_tokens: 5000,
          cache_creation_input_tokens: 10000,
          cache_read_input_tokens: 15000,
        },
      },
    }
    const result = parseStatuslineInput(input)

    expect(result?.context_window.total_input_tokens).toBe(50000)
    expect(result?.context_window.total_output_tokens).toBe(10000)
    expect(result?.context_window.context_window_size).toBe(200000)
    expect(result?.context_window.current_usage?.input_tokens).toBe(25000)
    expect(result?.context_window.current_usage?.output_tokens).toBe(5000)
    expect(result?.context_window.current_usage?.cache_creation_input_tokens).toBe(10000)
    expect(result?.context_window.current_usage?.cache_read_input_tokens).toBe(15000)
  })

  test('preserves null current_usage (session start case)', () => {
    const input = {
      session_id: 'test',
      cwd: '/project',
      context_window: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        context_window_size: 200000,
        current_usage: null,
      },
    }
    const result = parseStatuslineInput(input)

    expect(result?.context_window.current_usage).toBeNull()
  })

  test('falls back workspace fields to cwd', () => {
    const input = {
      session_id: 'test',
      cwd: '/project',
      workspace: {}, // Empty workspace
    }
    const result = parseStatuslineInput(input)

    expect(result?.workspace.current_dir).toBe('/project')
    expect(result?.workspace.project_dir).toBe('/project')
  })

  test('defaults context_window_size to 200000', () => {
    const input = {
      session_id: 'test',
      cwd: '/project',
      context_window: {
        // No context_window_size provided
      },
    }
    const result = parseStatuslineInput(input)

    expect(result?.context_window.context_window_size).toBe(200000)
  })

  test('handles non-number cost values with defaults', () => {
    const input = {
      session_id: 'test',
      cwd: '/project',
      cost: {
        total_cost_usd: 'not a number',
        total_duration_ms: null,
      },
    }
    const result = parseStatuslineInput(input)

    expect(result?.cost.total_cost_usd).toBe(0)
    expect(result?.cost.total_duration_ms).toBe(0)
  })
})
