/**
 * Transcript Excerpt Builder
 *
 * Builds filtered transcript excerpts from the in-memory circular buffer.
 * Extracted from TranscriptServiceImpl.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import { isExcludedBuiltinCommand, type BufferedEntry } from './transcript-helpers.js'
import type { ExcerptOptions, TranscriptExcerpt, Logger } from '@sidekick/types'
import { toErrorMessage } from './error-utils.js'

// ============================================================================
// Excerpt Options (filter configuration)
// ============================================================================

/** Internal filter options passed to formatExcerptLine */
export interface ExcerptFilterOptions {
  includeToolMessages: boolean
  includeToolOutputs: boolean
  includeAssistantThinking: boolean
}

// ============================================================================
// Circular Buffer Operations
// ============================================================================

/**
 * Get entries from circular buffer in chronological order.
 * Returns entries from oldest to newest.
 */
export function getBufferedEntries(
  buffer: BufferedEntry[],
  head: number,
  count: number,
  bufferSize: number
): BufferedEntry[] {
  if (count === 0) return []

  if (count < bufferSize) {
    // Buffer not full - entries are in order from 0 to count-1
    return buffer.slice(0, count)
  }

  // Buffer is full - head points to oldest entry
  // Order: [head, head+1, ..., SIZE-1, 0, 1, ..., head-1]
  const result: BufferedEntry[] = []
  for (let i = 0; i < bufferSize; i++) {
    const idx = (head + i) % bufferSize
    result.push(buffer[idx])
  }
  return result
}

// ============================================================================
// Excerpt Building
// ============================================================================

/**
 * Build a filtered transcript excerpt from the in-memory buffer.
 *
 * FILTERING RULES (see packages/sidekick-core/AGENTS.md for full documentation):
 *
 * ALWAYS INCLUDED:
 * - User prompts (human text only, system injections stripped)
 * - Assistant responses (model text only)
 * - Summary entries (only if leafUuid references entry in excerpt)
 *
 * CONDITIONALLY INCLUDED (via options):
 * - Tool use/result: includeToolMessages (default: true for messages, false for outputs)
 * - Thinking blocks: includeAssistantThinking (default: false)
 *
 * ALWAYS EXCLUDED (no config override):
 * - File history snapshots (type: 'file-history-snapshot')
 * - System reminders (<system-reminder> in content)
 * - Hook feedback ('hook feedback:' in content)
 * - Meta messages (isMeta: true)
 * - Local command stdout (<local-command-stdout> in content)
 *
 * KEY BEHAVIOR: maxLines counts POST-FILTER lines, ensuring caller gets
 * N useful conversation lines, not N raw transcript entries.
 */
export function buildExcerpt(
  bufferedEntries: BufferedEntry[],
  knownUuids: Set<string>,
  options: ExcerptOptions,
  logger: Logger
): TranscriptExcerpt {
  const maxLines = options.maxLines ?? 80
  const bookmarkLine = options.bookmarkLine ?? 0
  const includeToolMessages = options.includeToolMessages ?? true
  const includeToolOutputs = options.includeToolOutputs ?? false
  const includeAssistantThinking = options.includeAssistantThinking ?? false

  try {
    const filterOptions: ExcerptFilterOptions = { includeToolMessages, includeToolOutputs, includeAssistantThinking }

    // Apply bookmark filter (find entries AFTER bookmark line)
    // Bookmark semantics: bookmarkLine is the last line already processed
    // We want lines where lineNumber > bookmarkLine (strictly greater)
    // bookmarkApplied is only true if bookmark is valid AND there are lines after it
    let startIdx = 0
    let bookmarkApplied = false

    if (bookmarkLine > 0 && bufferedEntries.length > 0) {
      // Get the max line number in buffer to check if bookmark is valid
      const maxLineNumber = bufferedEntries[bufferedEntries.length - 1].lineNumber

      // Bookmark is only valid if it's less than the max line number
      if (bookmarkLine < maxLineNumber) {
        // Find first entry with lineNumber > bookmarkLine
        for (let i = 0; i < bufferedEntries.length; i++) {
          if (bufferedEntries[i].lineNumber > bookmarkLine) {
            startIdx = i
            bookmarkApplied = true
            break
          }
        }
      }
    }

    // Filter entries from startIdx to end
    const filteredLines: { lineNumber: number; formatted: string }[] = []
    for (let i = startIdx; i < bufferedEntries.length; i++) {
      const entry = bufferedEntries[i]
      const formatted = formatExcerptLine(entry.rawLine, knownUuids, filterOptions)
      if (formatted !== null) {
        filteredLines.push({ lineNumber: entry.lineNumber, formatted })
      }
    }

    // Take the last maxLines from filtered results
    const tailFiltered = filteredLines.slice(-maxLines)
    const formattedContent = tailFiltered.map((l) => l.formatted).join('\n')

    return {
      content: formattedContent,
      lineCount: tailFiltered.length,
      startLine: tailFiltered.length > 0 ? tailFiltered[0].lineNumber : 0,
      endLine: tailFiltered.length > 0 ? tailFiltered[tailFiltered.length - 1].lineNumber : 0,
      bookmarkApplied,
    }
  } catch (err) {
    logger.error('Failed to extract transcript excerpt from buffer', {
      error: toErrorMessage(err),
    })
    return {
      content: '',
      lineCount: 0,
      startLine: 0,
      endLine: 0,
      bookmarkApplied: false,
    }
  }
}

// ============================================================================
// Line Formatting
// ============================================================================

/**
 * Format a single excerpt line based on entry type.
 * Returns null for lines that should be filtered out.
 *
 * FILTERING RULES (see packages/sidekick-core/AGENTS.md):
 *
 * ALWAYS EXCLUDED (return null, no placeholders):
 * - type: 'file-history-snapshot'
 * - isMeta: true
 * - Content containing <system-reminder>
 * - Content containing 'hook feedback:' (case-insensitive)
 * - Content containing <local-command-stdout>
 * - Built-in slash commands (see EXCLUDED_BUILTIN_COMMANDS)
 *   - Note: /rename is NOT excluded (helps infer session title)
 *   - Custom commands are preserved (may have task-relevant parameters)
 *
 * CONDITIONALLY EXCLUDED:
 * - type: 'tool_use' / 'tool_result' -> unless includeToolMessages
 * - type: 'thinking' -> unless includeAssistantThinking
 * - Nested tool_use/tool_result blocks -> stripped from user/assistant messages
 *
 * For user/assistant messages, nested tool blocks are stripped and only
 * actual text content is extracted via extractTextContent().
 */
export function formatExcerptLine(line: string, knownUuids: Set<string>, options: ExcerptFilterOptions): string | null {
  try {
    const entry = JSON.parse(line) as {
      type?: string
      name?: string
      content?: string
      thinking?: string
      summary?: string
      leafUuid?: string
      isMeta?: boolean
      message?: { content?: unknown }
    }

    const entryType = entry.type ?? 'unknown'

    // ========================================================================
    // ALWAYS EXCLUDED: No config override for these
    // ========================================================================

    // File history snapshots - internal Claude Code bookkeeping
    if (entryType === 'file-history-snapshot') return null

    // Meta messages - system-injected disclaimers/caveats
    if (entry.isMeta === true) return null

    // Get raw content for system injection checks
    const rawContent = getRawContentString(entry)

    // System reminders - injected context, not user/assistant content
    if (rawContent && rawContent.includes('<system-reminder>')) return null

    // Hook feedback - sidekick system messages
    if (rawContent && /hook feedback:/i.test(rawContent)) return null

    // Local command stdout - slash command output, not conversation
    if (rawContent && rawContent.includes('<local-command-stdout>')) return null

    // Built-in slash commands - session management, settings, status queries
    // Custom commands are preserved since their parameters may be task-relevant
    // Note: /rename is intentionally NOT excluded (helps infer session title)
    if (isExcludedBuiltinCommand(rawContent)) return null

    // ========================================================================
    // ENTRY TYPE HANDLING
    // ========================================================================

    const messageContent = entry.message?.content ?? entry.content

    switch (entryType) {
      case 'user': {
        const text = extractTextContent(messageContent, options)
        if (!text || text.trim() === '') return null
        return `[USER]: ${text}`
      }

      case 'assistant': {
        const text = extractTextContent(messageContent, options)
        if (!text || text.trim() === '') return null
        return `[ASSISTANT]: ${text}`
      }

      case 'thinking':
        if (!options.includeAssistantThinking) return null
        return `[THINKING]: ${String(entry.thinking ?? entry.content ?? '').slice(0, 200)}`

      case 'tool_use':
        if (!options.includeToolMessages) return null
        return `[TOOL]: ${entry.name ?? 'unknown'}`

      case 'tool_result':
        // Return null (not placeholder) when excluded - no line at all
        if (!options.includeToolMessages) return null
        if (!options.includeToolOutputs) return null
        return `[RESULT]: ${JSON.stringify(entry).slice(0, 500)}`

      case 'summary':
        // Include only summaries that reference entries within this transcript
        if (!entry.leafUuid || !knownUuids.has(entry.leafUuid)) {
          return null
        }
        return `[SESSION_HINT]: ${entry.summary ?? ''}`

      default:
        // Unknown types are excluded to avoid noise
        return null
    }
  } catch {
    // Malformed JSON - exclude
    return null
  }
}

/**
 * Extract text content from message, filtering out tool/thinking blocks.
 *
 * For user/assistant messages with nested content blocks:
 * - text blocks: Always included
 * - tool_use blocks: Excluded (stripped entirely, no placeholder)
 * - tool_result blocks: Excluded (stripped entirely, no placeholder)
 * - thinking blocks: Excluded unless includeAssistantThinking
 *
 * Returns null if no text content remains after filtering.
 */
export function extractTextContent(
  content: unknown,
  options: { includeToolMessages: boolean; includeToolOutputs: boolean; includeAssistantThinking: boolean }
): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null

  // Claude API content blocks: [{type: 'text', text: '...'}, {type: 'tool_use', ...}, etc.]
  const textParts: string[] = []

  for (const block of content as Array<{ type?: string; text?: string; thinking?: string; name?: string }>) {
    if (block.type === 'text' && block.text) {
      textParts.push(block.text)
    } else if (block.type === 'thinking' && options.includeAssistantThinking && block.thinking) {
      textParts.push(`(thinking: ${block.thinking.slice(0, 100)}...)`)
    }
    // tool_use and tool_result blocks are stripped entirely - no placeholders
  }

  const result = textParts.join(' ').trim()
  return result || null
}

/**
 * Get raw content string from entry for system injection detection.
 */
export function getRawContentString(entry: { message?: { content?: unknown }; content?: unknown }): string | null {
  const content = entry.message?.content ?? entry.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    // Check all text blocks for system content
    const textParts: string[] = []
    for (const block of content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        (block as { type: unknown }).type === 'text' &&
        'text' in block &&
        typeof (block as { text: unknown }).text === 'string'
      ) {
        textParts.push((block as { text: string }).text)
      }
    }
    return textParts.join(' ')
  }
  return null
}
