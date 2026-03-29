/**
 * Tests for resolveEffectiveTokens — the 4-branch token decision tree
 *
 * Branches:
 * 1. hookInput with current_usage: sum all usage fields
 * 2. hookInput with null current_usage + transcript data: use transcript
 * 3. hookInput with null current_usage + no transcript: use 0 (baseline floor)
 * 4. No hookInput: use currentContextTokens or total tokens
 */

import { describe, expect, it } from 'vitest'
import { resolveEffectiveTokens } from '../token-resolution.js'
import type { TranscriptMetricsState } from '../types.js'
import type { ContextOverhead } from '../context-overhead-reader.js'
import type { ClaudeCodeStatusInput } from '../hook-types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<TranscriptMetricsState> = {}): TranscriptMetricsState {
  return {
    sessionId: 'test-session',
    lastUpdatedAt: Date.now(),
    tokens: { input: 1000, output: 500, total: 1500, cacheCreation: 0, cacheRead: 0 },
    currentContextTokens: null,
    isPostCompactIndeterminate: false,
    ...overrides,
  }
}

function makeBaseline(overrides: Partial<ContextOverhead> = {}): ContextOverhead {
  return {
    systemPromptTokens: 3200,
    systemToolsTokens: 17900,
    mcpToolsTokens: 500,
    customAgentsTokens: 200,
    memoryFilesTokens: 100,
    autocompactBufferTokens: 45000,
    totalOverhead: 66900, // sum of all above
    usingDefaults: false,
    ...overrides,
  }
}

function makeHookInput(overrides: Partial<ClaudeCodeStatusInput> = {}): ClaudeCodeStatusInput {
  return {
    hook_event_name: 'Status',
    session_id: 'test-session',
    transcript_path: '/tmp/transcript.json',
    cwd: '/test/project',
    model: { id: 'claude-opus-4-1', display_name: 'Opus' },
    workspace: { current_dir: '/test/project', project_dir: '/test/project' },
    version: '1.0.0',
    output_style: { name: 'default' },
    cost: {
      total_cost_usd: 0.5,
      total_duration_ms: 60000,
      total_api_duration_ms: 30000,
      total_lines_added: 100,
      total_lines_removed: 50,
    },
    context_window: {
      total_input_tokens: 50000,
      total_output_tokens: 10000,
      context_window_size: 200000,
      current_usage: {
        input_tokens: 30000,
        output_tokens: 5000,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 8000,
      },
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveEffectiveTokens', () => {
  describe('Branch 1: hookInput with current_usage', () => {
    it('sums all current_usage fields', () => {
      const state = makeState()
      const baseline = makeBaseline()
      const hookInput = makeHookInput()

      const result = resolveEffectiveTokens(state, baseline, hookInput)

      // 30000 + 5000 + 2000 + 8000 = 45000
      expect(result.effectiveTokens).toBe(45000)
      expect(result.usingBaseline).toBe(false)
      expect(result.usingTranscript).toBe(false)
    })

    it('applies baseline floor when current_usage sum is below minimum', () => {
      const state = makeState()
      const baseline = makeBaseline()
      // Set current_usage to very small values (below baseline minimum)
      const hookInput = makeHookInput({
        context_window: {
          total_input_tokens: 100,
          total_output_tokens: 50,
          context_window_size: 200000,
          current_usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      })

      const result = resolveEffectiveTokens(state, baseline, hookInput)

      // baselineMinimum = totalOverhead - autocompactBufferTokens = 66900 - 45000 = 21900
      expect(result.effectiveTokens).toBe(21900)
      expect(result.usingBaseline).toBe(true)
      expect(result.usingTranscript).toBe(false)
    })

    it('does not apply baseline floor when usage exceeds minimum', () => {
      const state = makeState()
      const baseline = makeBaseline()
      // Set current_usage to values above baseline minimum (21900)
      const hookInput = makeHookInput({
        context_window: {
          total_input_tokens: 50000,
          total_output_tokens: 10000,
          context_window_size: 200000,
          current_usage: {
            input_tokens: 20000,
            output_tokens: 5000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      })

      const result = resolveEffectiveTokens(state, baseline, hookInput)

      // 20000 + 5000 = 25000 > 21900 baseline minimum
      expect(result.effectiveTokens).toBe(25000)
      expect(result.usingBaseline).toBe(false)
    })
  })

  describe('Branch 2: hookInput with null current_usage + transcript data', () => {
    it('falls back to transcript currentContextTokens', () => {
      const state = makeState({ currentContextTokens: 35000 })
      const baseline = makeBaseline()
      const hookInput = makeHookInput({
        context_window: {
          total_input_tokens: 50000,
          total_output_tokens: 10000,
          context_window_size: 200000,
          current_usage: null,
        },
      })

      const result = resolveEffectiveTokens(state, baseline, hookInput)

      expect(result.effectiveTokens).toBe(35000)
      expect(result.usingTranscript).toBe(true)
      expect(result.usingBaseline).toBe(false)
    })

    it('applies baseline floor when transcript tokens are below minimum', () => {
      const state = makeState({ currentContextTokens: 100 })
      const baseline = makeBaseline()
      const hookInput = makeHookInput({
        context_window: {
          total_input_tokens: 50000,
          total_output_tokens: 10000,
          context_window_size: 200000,
          current_usage: null,
        },
      })

      const result = resolveEffectiveTokens(state, baseline, hookInput)

      // baselineMinimum = 66900 - 45000 = 21900
      expect(result.effectiveTokens).toBe(21900)
      expect(result.usingTranscript).toBe(true)
      expect(result.usingBaseline).toBe(true)
    })
  })

  describe('Branch 3: hookInput with null current_usage + no transcript', () => {
    it('uses 0 and applies baseline floor', () => {
      const state = makeState({ currentContextTokens: null })
      const baseline = makeBaseline()
      const hookInput = makeHookInput({
        context_window: {
          total_input_tokens: 50000,
          total_output_tokens: 10000,
          context_window_size: 200000,
          current_usage: null,
        },
      })

      const result = resolveEffectiveTokens(state, baseline, hookInput)

      // 0 < 21900, so baseline floor applies
      expect(result.effectiveTokens).toBe(21900)
      expect(result.usingBaseline).toBe(true)
      expect(result.usingTranscript).toBe(false)
    })

    it('uses 0 when transcript is 0', () => {
      const state = makeState({ currentContextTokens: 0 })
      const baseline = makeBaseline()
      const hookInput = makeHookInput({
        context_window: {
          total_input_tokens: 0,
          total_output_tokens: 0,
          context_window_size: 200000,
          current_usage: null,
        },
      })

      const result = resolveEffectiveTokens(state, baseline, hookInput)

      // 0 < 21900, so baseline floor applies
      expect(result.effectiveTokens).toBe(21900)
      expect(result.usingBaseline).toBe(true)
      expect(result.usingTranscript).toBe(false)
    })
  })

  describe('Branch 4: no hookInput (fallback)', () => {
    it('uses currentContextTokens when available', () => {
      const state = makeState({ currentContextTokens: 42000 })
      const baseline = makeBaseline()

      const result = resolveEffectiveTokens(state, baseline)

      expect(result.effectiveTokens).toBe(42000)
      expect(result.usingBaseline).toBe(false)
      expect(result.usingTranscript).toBe(false)
    })

    it('falls back to tokens.total when currentContextTokens is null', () => {
      const state = makeState({
        currentContextTokens: null,
        tokens: { input: 5000, output: 3000, total: 8000, cacheCreation: 0, cacheRead: 0 },
      })
      const baseline = makeBaseline()

      const result = resolveEffectiveTokens(state, baseline)

      expect(result.effectiveTokens).toBe(8000)
      expect(result.usingBaseline).toBe(false)
      expect(result.usingTranscript).toBe(false)
    })

    it('does not apply baseline floor (no hookInput means no floor logic)', () => {
      const state = makeState({
        currentContextTokens: 100,
        tokens: { input: 50, output: 50, total: 100, cacheCreation: 0, cacheRead: 0 },
      })
      const baseline = makeBaseline()

      const result = resolveEffectiveTokens(state, baseline)

      // Even though 100 < 21900 (baseline minimum), floor is only applied with hookInput
      expect(result.effectiveTokens).toBe(100)
      expect(result.usingBaseline).toBe(false)
    })
  })
})
