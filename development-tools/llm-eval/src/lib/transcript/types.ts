/**
 * Type definitions for transcript processing
 *
 * This module provides types for working with Claude Code transcripts,
 * designed to be reusable across benchmark and sidekick implementations.
 */

/**
 * Message after preprocessing (metadata stripped)
 * Only keeps essential fields: role and content
 */
export interface ProcessedMessage {
  role: string
  content: string | object[]
}

/**
 * Options for excerpt extraction
 */
export interface ExcerptOptions {
  /**
   * Number of lines to extract from the end of the transcript
   * @default 80
   */
  lineCount?: number

  /**
   * Whether to filter out tool_use and tool_result messages
   * @default true
   */
  filterToolMessages?: boolean

  /**
   * Whether to strip metadata fields (model, id, type, stop_reason, stop_sequence, usage)
   * @default true
   */
  stripMetadata?: boolean
}

/**
 * Result of excerpt extraction with metadata
 */
export interface ExcerptResult {
  /**
   * Preprocessed messages
   */
  messages: ProcessedMessage[]

  /**
   * Number of lines extracted from original transcript
   */
  linesExtracted: number

  /**
   * Number of messages after filtering
   */
  messageCount: number
}
