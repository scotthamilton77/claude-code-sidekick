/**
 * Transcript Normalizer
 *
 * Converts raw transcript entries into canonical form and provides
 * rendering utilities. Extracted from TranscriptServiceImpl.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import { TranscriptEntrySchema, TranscriptUuidSchema } from './state/index.js'
import type { TranscriptEntry, CanonicalTranscriptEntry, Logger } from '@sidekick/types'
import type { BufferedEntry } from './transcript-helpers.js'

// ============================================================================
// Entry Normalization
// ============================================================================

/**
 * Normalize a raw transcript entry into canonical form.
 * Handles nested tool_use and tool_result blocks.
 * Returns array because one raw entry can produce multiple canonical entries.
 */
export function normalizeEntry(rawEntry: TranscriptEntry, lineNumber: number): CanonicalTranscriptEntry[] | null {
  const entryType = rawEntry.type as string | undefined

  // Handle compaction summary entries (type: 'summary')
  if (entryType === 'summary') {
    const raw = rawEntry as { uuid?: string; timestamp?: string; summary?: unknown; leafUuid?: unknown }
    const summaryText = typeof raw.summary === 'string' ? raw.summary.trim() : ''
    if (!summaryText) return null
    const uuid = raw.uuid ?? `line-${lineNumber}`
    const timestamp = new Date(raw.timestamp ?? Date.now())
    return [
      {
        id: uuid,
        timestamp,
        role: 'system',
        type: 'recap',
        content: summaryText,
        metadata: {
          provider: 'claude',
          lineNumber,
          recapSource: 'compaction',
          leafUuid: raw.leafUuid as string | undefined,
        },
      },
    ]
  }

  // Handle away_summary system entries (type: 'system', subtype: 'away_summary')
  if (entryType === 'system') {
    const raw = rawEntry as { uuid?: string; timestamp?: string; subtype?: string; content?: unknown }
    if (raw.subtype === 'away_summary') {
      const contentText = typeof raw.content === 'string' ? raw.content.trim() : ''
      if (!contentText) return null
      const uuid = raw.uuid ?? `line-${lineNumber}`
      const timestamp = new Date(raw.timestamp ?? Date.now())
      return [
        {
          id: uuid,
          timestamp,
          role: 'system',
          type: 'recap',
          content: contentText,
          metadata: {
            provider: 'claude',
            lineNumber,
            recapSource: 'away',
          },
        },
      ]
    }
    return null
  }

  // Skip remaining non-message types (file-history-snapshot, attachment, etc.)
  if (entryType !== 'user' && entryType !== 'assistant') {
    return null
  }

  const results: CanonicalTranscriptEntry[] = []
  const message = rawEntry.message as {
    role?: string
    content?: string | Array<{ type?: string; text?: string; [key: string]: unknown }>
    model?: string
    id?: string
  }

  if (!message) {
    return null
  }

  const role = message.role as 'user' | 'assistant' | 'system'
  const timestamp = new Date((rawEntry.timestamp as string) ?? Date.now())
  const uuid = (rawEntry.uuid as string) ?? `line-${lineNumber}`

  // Extract flags for filtering system-generated messages
  const isMeta = (rawEntry as { isMeta?: boolean }).isMeta === true
  const isCompactSummary = (rawEntry as { isCompactSummary?: boolean }).isCompactSummary === true

  // Handle message content
  const content = message.content

  if (typeof content === 'string') {
    // Simple text message
    results.push({
      id: uuid,
      timestamp,
      role,
      type: 'text',
      content,
      metadata: {
        provider: 'claude',
        originalId: message.id,
        lineNumber,
        isMeta,
        isCompactSummary,
      },
    })
  } else if (Array.isArray(content)) {
    // Complex message with nested blocks
    for (const block of content) {
      const blockType = block.type

      if (blockType === 'text') {
        // Text block
        results.push({
          id: `${uuid}-text-${results.length}`,
          timestamp,
          role,
          type: 'text',
          content: (block.text as string) ?? '',
          metadata: {
            provider: 'claude',
            originalId: message.id,
            lineNumber,
            isMeta,
            isCompactSummary,
          },
        })
      } else if (blockType === 'tool_use') {
        // Tool use block (nested in assistant message)
        results.push({
          id: (block.id as string) ?? `${uuid}-tool-${results.length}`,
          timestamp,
          role: 'assistant',
          type: 'tool_use',
          content: {
            name: block.name,
            input: block.input,
          },
          metadata: {
            provider: 'claude',
            originalId: message.id,
            lineNumber,
            toolName: block.name as string,
          },
        })
      } else if (blockType === 'tool_result') {
        // Tool result block (nested in user message)
        results.push({
          id: (block.tool_use_id as string) ?? `${uuid}-result-${results.length}`,
          timestamp,
          role: 'user',
          type: 'tool_result',
          content: block,
          metadata: {
            provider: 'claude',
            originalId: message.id,
            lineNumber,
            toolUseId: block.tool_use_id as string,
            isError: block.is_error as boolean,
          },
        })
      }
    }
  }

  return results.length > 0 ? results : null
}

// ============================================================================
// Raw Line Parsing
// ============================================================================

/**
 * Parse a raw JSON line into a validated TranscriptEntry.
 * Returns null for unparseable or invalid lines.
 *
 * This is the single source of truth for "JSON string -> TranscriptEntry"
 * parsing, used by both streaming processing and full-file reads.
 */
export function parseRawLine(line: string, lineNumber: number, logger: Logger): TranscriptEntry | null {
  try {
    const parsed = TranscriptEntrySchema.safeParse(JSON.parse(line))
    if (!parsed.success) {
      logger.warn('Skipping invalid transcript line', {
        line: lineNumber,
        error: parsed.error.message,
      })
      return null
    }
    return parsed.data as TranscriptEntry
  } catch {
    logger.warn('Skipping malformed transcript line', {
      line: lineNumber,
      rawLine: line,
    })
    return null
  }
}

// ============================================================================
// Buffered Entry Parsing
// ============================================================================

/**
 * Parse and normalize a buffered entry into canonical entries.
 * Returns null for unparseable or non-message entries.
 */
export function parseBufferedEntry(entry: BufferedEntry, logger: Logger): CanonicalTranscriptEntry[] | null {
  const rawEntry = parseRawLine(entry.rawLine, entry.lineNumber, logger)
  if (!rawEntry) return null
  return normalizeEntry(rawEntry, entry.lineNumber)
}

// ============================================================================
// UUID Parsing
// ============================================================================

/**
 * Safely parse UUID from a JSON line, returning null on failure.
 */
export function parseUuid(line: string): string | null {
  try {
    const parsed = TranscriptUuidSchema.safeParse(JSON.parse(line))
    if (!parsed.success) {
      return null
    }
    return parsed.data.uuid ?? null
  } catch {
    return null
  }
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render transcript as a human-readable string.
 */
export function renderTranscriptString(entries: CanonicalTranscriptEntry[]): string {
  return entries
    .map((entry) => {
      const timestamp = entry.timestamp.toISOString()
      const role = entry.role.toUpperCase()
      const type = entry.type

      if (type === 'text') {
        const content = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content)
        return `[${timestamp}] ${role}: ${content}`
      } else if (type === 'tool_use') {
        const toolContent = entry.content as Record<string, unknown>
        return `[${timestamp}] ${role} TOOL_USE: ${String(toolContent.name)}`
      } else if (type === 'tool_result') {
        return `[${timestamp}] ${role} TOOL_RESULT`
      } else if (type === 'recap') {
        const content = typeof entry.content === 'string' ? entry.content : ''
        return `[${timestamp}] RECAP: ${content}`
      }
      return `[${timestamp}] ${role}: ${JSON.stringify(entry.content)}`
    })
    .join('\n')
}
