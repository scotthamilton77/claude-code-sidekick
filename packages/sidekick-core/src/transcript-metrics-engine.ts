/**
 * Transcript Metrics Engine
 *
 * Processes transcript entries to compute and update metrics.
 * Extracted from TranscriptServiceImpl.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import { isExcludedBuiltinCommand, type RawUsageMetadata } from './transcript-helpers.js'
import type { TranscriptEntry, TranscriptMetrics, TranscriptEventType } from '@sidekick/types'

// ============================================================================
// Event Emitter Type
// ============================================================================

/** Callback to emit transcript events to the handler registry */
export type TranscriptEventEmitter = (
  eventType: TranscriptEventType,
  entry: TranscriptEntry,
  lineNumber: number
) => Promise<void>

// ============================================================================
// Entry Processing
// ============================================================================

/**
 * Process a single transcript entry and update metrics.
 * Emits corresponding TranscriptEvent after updating metrics.
 *
 * Real Claude Code transcripts structure:
 * - tool_use blocks are nested in assistant.message.content[]
 * - tool_result blocks are nested in user.message.content[]
 * - Other entry types (summary, file-history-snapshot) are skipped
 *
 * Messages that should NOT increment turnCount:
 * - tool_result wrappers (arrays containing only tool_result blocks)
 * - isMeta messages (disclaimer/caveat messages injected by Claude Code)
 * - local-command-stdout messages (output from slash commands like /context)
 * - excluded builtin command invocations (e.g. /clear, /compact -- see EXCLUDED_BUILTIN_COMMANDS)
 *   Note: unlike local-command-stdout, these do NOT emit UserPrompt events
 */
export async function processEntry(
  entry: TranscriptEntry,
  lineNumber: number,
  metrics: TranscriptMetrics,
  toolUseIdToName: Map<string, string>,
  emitEvent: TranscriptEventEmitter
): Promise<void> {
  const entryType = entry.type as string | undefined

  switch (entryType) {
    case 'user': {
      // Check conditions that should NOT increment turnCount
      const isToolResultWrapper = isToolResultOnlyMessage(entry)
      const isMetaMessage = (entry as { isMeta?: boolean }).isMeta === true
      const isLocalCommandOutput = isLocalCommandStdoutMessage(entry)
      const isExcludedBuiltin = isExcludedBuiltinCommandInvocation(entry)

      if (isToolResultWrapper || isMetaMessage || isLocalCommandOutput || isExcludedBuiltin) {
        // Non-user-prompt message: increment messageCount but DON'T increment turnCount
        // This allows toolsThisTurn to accumulate across multiple tool calls
        metrics.messageCount++

        // Still emit UserPrompt for local command output (e.g., /context) so handlers can process it
        // Handlers that want to scrape /context output need to receive these events
        // Don't emit UserPrompt for excluded builtin command invocations -- no handler needs them
        if (isLocalCommandOutput) {
          await emitEvent('UserPrompt', entry, lineNumber)
        }
      } else {
        // Real user prompt: new turn, reset toolsThisTurn
        metrics.turnCount++
        metrics.messageCount++
        metrics.toolsThisTurn = 0
        updateToolsPerTurn(metrics)
        await emitEvent('UserPrompt', entry, lineNumber)
      }

      // Process tool_result blocks nested in user message content
      await processNestedToolResults(entry, lineNumber, toolUseIdToName, emitEvent)
      break
    }

    case 'assistant':
      // Assistant message: increment messageCount, extract token usage
      metrics.messageCount++
      extractTokenUsage(entry, metrics)
      await emitEvent('AssistantMessage', entry, lineNumber)

      // Process tool_use blocks nested in assistant message content
      await processNestedToolUses(entry, lineNumber, metrics, toolUseIdToName, emitEvent)
      break

    case 'system': {
      // Check for compact_boundary entry (indicates compaction occurred)
      const subtype = (entry as { subtype?: string }).subtype
      if (subtype === 'compact_boundary') {
        await handleCompactBoundary(entry, lineNumber, metrics, emitEvent)
      }
      // Skip other system entry types
      break
    }

    // Skip other entry types (summary, file-history-snapshot, etc.)
  }
}

// ============================================================================
// Token Usage Extraction
// ============================================================================

/**
 * Extract token usage from assistant message metadata.
 *
 * Token calculation per TOKEN_TRACKING_PLAN.md:
 * - currentContextTokens: input + cache_creation + cache_read (actual context window size)
 * - tokenUsage: cumulative totals including all cache tokens
 */
export function extractTokenUsage(entry: TranscriptEntry, metrics: TranscriptMetrics): void {
  const message = entry.message as { usage?: RawUsageMetadata; model?: string } | undefined
  if (!message?.usage) return

  const usage = message.usage
  const model = message.model

  // Extract all token fields
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0

  // Current context window size: all input tokens including cache
  // This represents the actual tokens in the context window for this request
  const contextWindowTokens = inputTokens + cacheCreationTokens + cacheReadTokens
  metrics.currentContextTokens = contextWindowTokens

  // Clear indeterminate state - we now have accurate context size
  metrics.isPostCompactIndeterminate = false

  // Cumulative usage (all tokens sent to model, for cost tracking)
  metrics.tokenUsage.inputTokens += inputTokens + cacheCreationTokens + cacheReadTokens
  metrics.tokenUsage.outputTokens += outputTokens
  metrics.tokenUsage.totalTokens += inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens

  // Cache metrics (for detailed breakdown)
  metrics.tokenUsage.cacheCreationInputTokens += cacheCreationTokens
  metrics.tokenUsage.cacheReadInputTokens += cacheReadTokens

  // Cache tiers
  if (usage.cache_creation) {
    metrics.tokenUsage.cacheTiers.ephemeral5mInputTokens += usage.cache_creation.ephemeral_5m_input_tokens ?? 0
    metrics.tokenUsage.cacheTiers.ephemeral1hInputTokens += usage.cache_creation.ephemeral_1h_input_tokens ?? 0
  }

  // Service tier tracking
  if (usage.service_tier) {
    const tier = usage.service_tier
    metrics.tokenUsage.serviceTierCounts[tier] = (metrics.tokenUsage.serviceTierCounts[tier] ?? 0) + 1
  }

  // Per-model breakdown
  if (model) {
    const modelStats = metrics.tokenUsage.byModel[model] ?? {
      inputTokens: 0,
      outputTokens: 0,
      requestCount: 0,
    }
    modelStats.inputTokens += inputTokens
    modelStats.outputTokens += outputTokens
    modelStats.requestCount++
    metrics.tokenUsage.byModel[model] = modelStats
  }
}

// ============================================================================
// Nested Block Processing
// ============================================================================

/**
 * Process nested tool_use blocks inside assistant message content.
 * Real transcripts have: assistant.message.content[{type: 'tool_use', name: '...'}]
 */
export async function processNestedToolUses(
  entry: TranscriptEntry,
  lineNumber: number,
  metrics: TranscriptMetrics,
  toolUseIdToName: Map<string, string>,
  emitEvent: TranscriptEventEmitter
): Promise<void> {
  const message = entry.message as { content?: Array<{ type?: string; id?: string; name?: string }> } | undefined
  if (!message?.content || !Array.isArray(message.content)) return

  for (const block of message.content) {
    if (block.type === 'tool_use') {
      // Track tool_use_id -> name so ToolResult events can resolve the tool name
      if (block.id && block.name) {
        toolUseIdToName.set(block.id, block.name)
      }

      // Count the tool call (increment here so metrics are current when ToolCall event fires)
      metrics.toolCount++
      metrics.toolsThisTurn++
      updateToolsPerTurn(metrics)

      // Emit ToolCall event for each tool_use block
      // Create a synthetic entry for the event with the tool info
      const toolEntry: TranscriptEntry = {
        type: 'tool_use',
        name: block.name,
        ...block,
      }
      await emitEvent('ToolCall', toolEntry, lineNumber)
    }
  }
}

/**
 * Process nested tool_result blocks inside user message content.
 * Real transcripts have: user.message.content[{type: 'tool_result', ...}]
 * Note: Tool counting happens in processNestedToolUses (on ToolCall), not here.
 */
export async function processNestedToolResults(
  entry: TranscriptEntry,
  lineNumber: number,
  toolUseIdToName: Map<string, string>,
  emitEvent: TranscriptEventEmitter
): Promise<void> {
  const message = entry.message as { content?: Array<{ type?: string; tool_use_id?: string }> } | undefined
  if (!message?.content || !Array.isArray(message.content)) return

  for (const block of message.content) {
    if (block.type === 'tool_result') {
      // Resolve tool name from preceding tool_use block
      const toolName = block.tool_use_id ? toolUseIdToName.get(block.tool_use_id) : undefined

      // Emit ToolResult event for each tool_result block
      const toolEntry: TranscriptEntry = {
        type: 'tool_result',
        ...block,
        ...(toolName ? { tool_name: toolName } : {}),
      }
      await emitEvent('ToolResult', toolEntry, lineNumber)
    }
  }
}

// ============================================================================
// Compact Boundary Handling
// ============================================================================

/**
 * Handle compact_boundary entry detected in transcript.
 * Sets indeterminate state until next usage block arrives.
 */
export async function handleCompactBoundary(
  entry: TranscriptEntry,
  lineNumber: number,
  metrics: TranscriptMetrics,
  emitEvent: TranscriptEventEmitter
): Promise<void> {
  // Set indeterminate state - context size unknown until next API response
  metrics.currentContextTokens = null
  metrics.isPostCompactIndeterminate = true

  // Emit Compact event for handlers
  await emitEvent('Compact', entry, lineNumber)
}

// ============================================================================
// Message Classification
// ============================================================================

/**
 * Check if a user message contains ONLY tool_result blocks (no actual user text).
 * Tool result wrappers should not reset toolsThisTurn or increment turnCount.
 *
 * Real user prompts have:
 * - content as a string (plain text)
 * - content as array with 'text' blocks
 * - content as array with 'document' blocks (file uploads)
 *
 * Tool result wrappers have:
 * - content as array with ONLY 'tool_result' blocks
 */
export function isToolResultOnlyMessage(entry: TranscriptEntry): boolean {
  const message = entry.message as { content?: string | Array<{ type?: string }> } | undefined
  if (!message?.content) return false

  // String content = real user prompt
  if (typeof message.content === 'string') return false

  // Not an array = unknown format, treat as real user prompt
  if (!Array.isArray(message.content)) return false

  // Empty array = treat as real user prompt (edge case)
  if (message.content.length === 0) return false

  // Check if ALL blocks are tool_result type
  return message.content.every((block) => block.type === 'tool_result')
}

/**
 * Check if a user message is a local command stdout injection.
 * These are output from slash commands like /context, /clear, etc.
 * They should not increment turnCount as they're not actual user prompts.
 *
 * Local command stdout messages have string content containing <local-command-stdout>.
 */
export function isLocalCommandStdoutMessage(entry: TranscriptEntry): boolean {
  const message = entry.message as { content?: string } | undefined
  if (!message?.content) return false

  // Only check string content
  if (typeof message.content !== 'string') return false

  return message.content.includes('<local-command-stdout>')
}

/**
 * Check if a transcript entry is an excluded builtin command invocation that should be suppressed.
 *
 * When the user runs `/clear`, `/compact`, etc., Claude Code emits a user message with
 * `<command-name>/clear</command-name>` content. These are not real user prompts and
 * should not increment turnCount or emit UserPrompt events.
 */
export function isExcludedBuiltinCommandInvocation(entry: TranscriptEntry): boolean {
  const message = entry.message as { content?: unknown } | undefined
  if (!message?.content) return false

  if (typeof message.content !== 'string') return false

  return isExcludedBuiltinCommand(message.content)
}

// ============================================================================
// Derived Metrics
// ============================================================================

/**
 * Update the derived toolsPerTurn ratio.
 */
export function updateToolsPerTurn(metrics: TranscriptMetrics): void {
  metrics.toolsPerTurn = metrics.turnCount > 0 ? metrics.toolCount / metrics.turnCount : 0
}
