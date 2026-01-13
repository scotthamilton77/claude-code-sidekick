/**
 * Transcript excerpt extraction
 *
 * Extracts and preprocesses excerpts from Claude Code transcripts,
 * matching the behavior of Track 1's preprocessing.sh::preprocess_transcript()
 *
 * This module is designed to be reusable across benchmark and sidekick implementations.
 */

import { readFileSync } from 'fs'
import type { TranscriptMessage } from '../../benchmark/data/types.js'
import type { ProcessedMessage, ExcerptOptions, ExcerptResult } from './types.js'

/**
 * Default options for excerpt extraction
 */
const DEFAULT_OPTIONS: Required<ExcerptOptions> = {
  lineCount: 80,
  filterToolMessages: true,
  stripMetadata: true,
}

/**
 * Extracts and preprocesses an excerpt from a transcript
 *
 * @param transcript - Array of transcript messages (pre-loaded)
 * @param options - Extraction options
 * @returns Excerpt result with processed messages and metadata
 *
 * @example
 * ```typescript
 * const transcript = loadTranscript('session.jsonl')
 * const excerpt = extractExcerpt(transcript, { lineCount: 50 })
 * console.log(`Extracted ${excerpt.messageCount} messages`)
 * ```
 */
export function extractExcerpt(
  transcript: TranscriptMessage[],
  options: ExcerptOptions = {}
): ExcerptResult {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Handle edge case: empty transcript
  if (transcript.length === 0) {
    return {
      messages: [],
      linesExtracted: 0,
      messageCount: 0,
    }
  }

  // Handle edge case: lineCount is 0
  if (opts.lineCount === 0) {
    return {
      messages: [],
      linesExtracted: 0,
      messageCount: 0,
    }
  }

  // Extract last N lines (or all if transcript is shorter)
  const linesToExtract = Math.min(opts.lineCount, transcript.length)
  const excerpt = transcript.slice(-linesToExtract)

  // Process each line
  const messages: ProcessedMessage[] = []

  for (const line of excerpt) {
    // Skip lines without a message field
    if (!line.message) {
      continue
    }

    // Filter tool messages if enabled
    if (opts.filterToolMessages && isToolMessage(line)) {
      continue
    }

    // Create processed message
    const processed = processMessage(line, opts.stripMetadata)
    messages.push(processed)
  }

  return {
    messages,
    linesExtracted: linesToExtract,
    messageCount: messages.length,
  }
}

/**
 * Loads a transcript from a file and extracts an excerpt
 *
 * Convenience function that combines file loading with excerpt extraction.
 *
 * @param filePath - Path to the transcript JSONL file
 * @param options - Extraction options
 * @returns Excerpt result with processed messages and metadata
 *
 * @throws {Error} If file doesn't exist or contains invalid JSON
 *
 * @example
 * ```typescript
 * const excerpt = extractExcerptFromFile('transcript.jsonl', {
 *   lineCount: 100,
 *   filterToolMessages: false
 * })
 * ```
 */
export function extractExcerptFromFile(
  filePath: string,
  options: ExcerptOptions = {}
): ExcerptResult {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as TranscriptMessage)

  return extractExcerpt(lines, options)
}

/**
 * Checks if a transcript message is a tool message (tool_use or tool_result)
 *
 * @param line - Transcript message to check
 * @returns true if the message is a tool message
 */
function isToolMessage(line: TranscriptMessage): boolean {
  const { message } = line

  if (!message) {
    return false
  }

  // Check if content is an array (content blocks)
  if (Array.isArray(message.content)) {
    // Check if first content block is tool_use or tool_result
    const firstBlock = message.content[0]
    if (firstBlock && typeof firstBlock === 'object' && 'type' in firstBlock) {
      return firstBlock.type === 'tool_use' || firstBlock.type === 'tool_result'
    }
  }

  return false
}

/**
 * Processes a message by extracting essential fields and optionally stripping metadata
 *
 * @param line - Transcript message to process
 * @param stripMetadata - Whether to strip metadata fields
 * @returns Processed message with only essential fields
 */
function processMessage(line: TranscriptMessage, stripMetadata: boolean): ProcessedMessage {
  const { message } = line

  if (!message) {
    throw new Error('Cannot process message: message field is missing')
  }

  if (stripMetadata) {
    // Keep only role and content
    return {
      role: message.role ?? '',
      content: message.content,
    }
  } else {
    // Keep all fields (but still destructure to avoid reference issues)
    return {
      role: message.role ?? '',
      content: message.content,
      ...(message.model && { model: message.model }),
      ...(message.id && { id: message.id }),
      ...(message.stop_reason !== undefined && {
        stop_reason: message.stop_reason,
      }),
      ...(message.stop_sequence !== undefined && {
        stop_sequence: message.stop_sequence,
      }),
      ...(message.usage && { usage: message.usage }),
    }
  }
}
