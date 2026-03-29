/**
 * Token Resolution — Pure function for determining effective token count
 *
 * Extracted from StatuslineService.buildViewModel to enable independent testing
 * of the 4-branch token decision tree.
 *
 * @see docs/design/FEATURE-STATUSLINE.md
 */

import type { TranscriptMetricsState } from './types.js'
import type { ContextOverhead } from './context-overhead-reader.js'
import type { ClaudeCodeStatusInput } from './hook-types.js'

/**
 * Result of resolving effective tokens for display.
 */
export interface TokenResolutionResult {
  /** The effective token count to display */
  effectiveTokens: number
  /** Whether baseline metrics were used as a floor */
  usingBaseline: boolean
  /** Whether transcript metrics were used as fallback */
  usingTranscript: boolean
}

/**
 * Resolve the effective token count for statusline display.
 *
 * Decision tree (4 branches):
 * 1. hookInput with current_usage present: sum all usage fields
 * 2. hookInput with null current_usage but transcript data: use transcript
 * 3. hookInput with null current_usage and no transcript: use 0 (baseline floor applies)
 * 4. No hookInput (fallback): use currentContextTokens or total tokens
 *
 * After branches 1-3, a baseline minimum floor is applied when the hook input
 * is available but effectiveTokens falls below the known system overhead.
 *
 * @param state - Transcript metrics state with token data
 * @param baseline - Context overhead metrics for baseline floor
 * @param hookInput - Optional Claude Code hook input with current_usage
 * @returns Resolved token count with source indicators
 */
export function resolveEffectiveTokens(
  state: TranscriptMetricsState,
  baseline: ContextOverhead,
  hookInput?: ClaudeCodeStatusInput
): TokenResolutionResult {
  let effectiveTokens: number
  let usingBaseline = false
  let usingTranscript = false

  if (hookInput) {
    const usage = hookInput.context_window.current_usage

    if (usage) {
      // Branch 1: Normal case — use current_usage from hook input
      // Include output_tokens — model responses in conversation history consume context window space
      effectiveTokens =
        usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
    } else {
      // current_usage is null (can happen at session start) — fallback to transcript metrics
      // This prevents "flashing" baseline values when hook input arrives before current_usage is populated
      const transcriptTokens = state.currentContextTokens
      if (transcriptTokens != null && transcriptTokens > 0) {
        // Branch 2: Transcript fallback
        effectiveTokens = transcriptTokens
        usingTranscript = true
      } else {
        // Branch 3: No transcript data either, use 0 (baseline floor will apply below)
        effectiveTokens = 0
      }
    }

    // Apply baseline minimum floor.
    // At session start, current_usage may have incomplete data (cache fields unpopulated
    // until the first API response arrives), producing artificially low values.
    // totalOverhead includes autocompactBufferTokens, but that's reserved buffer, not actual usage.
    const baselineMinimum = baseline.totalOverhead - baseline.autocompactBufferTokens
    if (effectiveTokens < baselineMinimum) {
      effectiveTokens = baselineMinimum
      usingBaseline = true
    }
  } else {
    // Branch 4: Fallback when no hook input (shouldn't happen in normal statusline flow)
    effectiveTokens = state.currentContextTokens ?? state.tokens.total
  }

  return { effectiveTokens, usingBaseline, usingTranscript }
}
