/**
 * Runtime validation tests for hook input Zod schemas.
 *
 * Exercises safeParse with valid and invalid payloads for every hook input type.
 *
 * @see packages/types/src/hook-input.ts
 */

import { describe, expect, it } from 'vitest'
import {
  HookInputBaseSchema,
  UserPromptSubmitInputSchema,
  PreToolUseInputSchema,
  PostToolUseInputSchema,
  StopInputSchema,
  SessionStartInputSchema,
  SessionEndInputSchema,
  PreCompactInputSchema,
  NotificationInputSchema,
  StatuslineInputSchema,
  StatuslineModelSchema,
  StatuslineContextWindowSchema,
  StatuslineCostSchema,
  StatuslineWorkspaceSchema,
  HookInputSchema,
} from '../hook-input.js'

// ============================================================================
// Shared Fixtures
// ============================================================================

const basePayload = {
  session_id: 'sess-abc-123',
  transcript_path: '/tmp/transcript.jsonl',
  hook_event_name: 'SessionStart',
}

// ============================================================================
// HookInputBaseSchema
// ============================================================================

describe('HookInputBaseSchema', () => {
  it('accepts valid base payload', () => {
    const result = HookInputBaseSchema.safeParse(basePayload)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.session_id).toBe('sess-abc-123')
    }
  })

  it('accepts optional cwd and permission_mode', () => {
    const result = HookInputBaseSchema.safeParse({
      ...basePayload,
      cwd: '/home/user/project',
      permission_mode: 'default',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cwd).toBe('/home/user/project')
      expect(result.data.permission_mode).toBe('default')
    }
  })

  it('rejects missing session_id', () => {
    const result = HookInputBaseSchema.safeParse({
      transcript_path: '/tmp/transcript.jsonl',
      hook_event_name: 'SessionStart',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing transcript_path', () => {
    const result = HookInputBaseSchema.safeParse({
      session_id: 'sess-123',
      hook_event_name: 'SessionStart',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing hook_event_name', () => {
    const result = HookInputBaseSchema.safeParse({
      session_id: 'sess-123',
      transcript_path: '/tmp/transcript.jsonl',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// UserPromptSubmitInputSchema
// ============================================================================

describe('UserPromptSubmitInputSchema', () => {
  it('accepts valid prompt input', () => {
    const result = UserPromptSubmitInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Write unit tests for the Zod schemas',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.prompt).toBe('Write unit tests for the Zod schemas')
    }
  })

  it('rejects missing prompt field', () => {
    const result = UserPromptSubmitInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'UserPromptSubmit',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-string prompt', () => {
    const result = UserPromptSubmitInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'UserPromptSubmit',
      prompt: 42,
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// PreToolUseInputSchema
// ============================================================================

describe('PreToolUseInputSchema', () => {
  it('accepts valid pre-tool-use input', () => {
    const result = PreToolUseInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      tool_use_id: 'tool-use-xyz',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tool_name).toBe('Bash')
      expect(result.data.tool_input).toEqual({ command: 'ls -la' })
    }
  })

  it('rejects missing tool_name', () => {
    const result = PreToolUseInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'PreToolUse',
      tool_input: { command: 'ls' },
      tool_use_id: 'tool-use-xyz',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing tool_use_id', () => {
    const result = PreToolUseInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: {},
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// PostToolUseInputSchema
// ============================================================================

describe('PostToolUseInputSchema', () => {
  it('accepts valid post-tool-use input', () => {
    const result = PostToolUseInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/src/index.ts' },
      tool_response: { content: 'file contents' },
      tool_use_id: 'tool-use-abc',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tool_response).toEqual({ content: 'file contents' })
    }
  })

  it('rejects missing tool_response', () => {
    const result = PostToolUseInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: {},
      tool_use_id: 'tool-use-abc',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// StopInputSchema
// ============================================================================

describe('StopInputSchema', () => {
  it('accepts valid stop input without optional fields', () => {
    const result = StopInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'Stop',
    })
    expect(result.success).toBe(true)
  })

  it('accepts stop_hook_active field', () => {
    const result = StopInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'Stop',
      stop_hook_active: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.stop_hook_active).toBe(true)
    }
  })
})

// ============================================================================
// SessionStartInputSchema
// ============================================================================

describe('SessionStartInputSchema', () => {
  it('accepts valid session start', () => {
    const result = SessionStartInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'SessionStart',
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional source field', () => {
    const result = SessionStartInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'SessionStart',
      source: 'startup',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.source).toBe('startup')
    }
  })
})

// ============================================================================
// SessionEndInputSchema
// ============================================================================

describe('SessionEndInputSchema', () => {
  it('accepts valid session end', () => {
    const result = SessionEndInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'SessionEnd',
      reason: 'exit',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reason).toBe('exit')
    }
  })

  it('accepts without optional reason', () => {
    const result = SessionEndInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'SessionEnd',
    })
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// PreCompactInputSchema
// ============================================================================

describe('PreCompactInputSchema', () => {
  it('accepts valid pre-compact input', () => {
    const result = PreCompactInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'PreCompact',
      trigger: 'auto',
      custom_instructions: '',
    })
    expect(result.success).toBe(true)
  })

  it('accepts without optional fields', () => {
    const result = PreCompactInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'PreCompact',
    })
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// NotificationInputSchema
// ============================================================================

describe('NotificationInputSchema', () => {
  it('accepts valid notification input', () => {
    const result = NotificationInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'Notification',
      message: 'Permission requested for file write',
      notification_type: 'permission_prompt',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.notification_type).toBe('permission_prompt')
    }
  })

  it('rejects missing message', () => {
    const result = NotificationInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing notification_type', () => {
    const result = NotificationInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'Notification',
      message: 'Something happened',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// Statusline Schemas
// ============================================================================

describe('StatuslineModelSchema', () => {
  it('accepts valid model info', () => {
    const result = StatuslineModelSchema.safeParse({
      id: 'claude-opus-4-1',
      display_name: 'Opus',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing display_name', () => {
    const result = StatuslineModelSchema.safeParse({ id: 'claude-opus-4-1' })
    expect(result.success).toBe(false)
  })
})

describe('StatuslineContextWindowSchema', () => {
  it('accepts valid context window', () => {
    const result = StatuslineContextWindowSchema.safeParse({
      total_input_tokens: 50000,
      total_output_tokens: 10000,
      context_window_size: 200000,
    })
    expect(result.success).toBe(true)
  })

  it('accepts minimal (only required total_input_tokens)', () => {
    const result = StatuslineContextWindowSchema.safeParse({
      total_input_tokens: 50000,
    })
    expect(result.success).toBe(true)
  })
})

describe('StatuslineCostSchema', () => {
  it('accepts valid cost data', () => {
    const result = StatuslineCostSchema.safeParse({
      total_cost_usd: 0.15,
      total_duration_ms: 30000,
      total_api_duration_ms: 25000,
      total_lines_added: 100,
      total_lines_removed: 50,
    })
    expect(result.success).toBe(true)
  })

  it('accepts minimal cost data', () => {
    const result = StatuslineCostSchema.safeParse({
      total_cost_usd: 0.01,
    })
    expect(result.success).toBe(true)
  })
})

describe('StatuslineWorkspaceSchema', () => {
  it('accepts valid workspace', () => {
    const result = StatuslineWorkspaceSchema.safeParse({
      current_dir: '/home/user/project',
      project_dir: '/home/user/project',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing project_dir', () => {
    const result = StatuslineWorkspaceSchema.safeParse({
      current_dir: '/home/user/project',
    })
    expect(result.success).toBe(false)
  })
})

describe('StatuslineInputSchema', () => {
  it('accepts valid statusline input', () => {
    const result = StatuslineInputSchema.safeParse({
      session_id: 'sess-123',
      model: { id: 'claude-opus-4-1', display_name: 'Opus' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts full statusline input with all optional fields', () => {
    const result = StatuslineInputSchema.safeParse({
      hook_event_name: 'Status',
      session_id: 'sess-123',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/home/user/project',
      version: '1.0.0',
      model: { id: 'claude-opus-4-1', display_name: 'Opus' },
      workspace: { current_dir: '/home/user/project', project_dir: '/home/user/project' },
      cost: { total_cost_usd: 0.15 },
      context_window: { total_input_tokens: 50000 },
      output_style: { name: 'concise' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing model', () => {
    const result = StatuslineInputSchema.safeParse({
      session_id: 'sess-123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects wrong hook_event_name literal', () => {
    const result = StatuslineInputSchema.safeParse({
      hook_event_name: 'NotStatus',
      session_id: 'sess-123',
      model: { id: 'claude-opus-4-1', display_name: 'Opus' },
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// HookInputSchema (union)
// ============================================================================

describe('HookInputSchema', () => {
  it('accepts a UserPromptSubmit payload', () => {
    const result = HookInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Hello',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a PreToolUse payload', () => {
    const result = HookInputSchema.safeParse({
      ...basePayload,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo hi' },
      tool_use_id: 'tu-1',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a base payload (fallback)', () => {
    const result = HookInputSchema.safeParse(basePayload)
    expect(result.success).toBe(true)
  })

  it('rejects completely invalid data', () => {
    const result = HookInputSchema.safeParse({ random: 'stuff' })
    expect(result.success).toBe(false)
  })
})
