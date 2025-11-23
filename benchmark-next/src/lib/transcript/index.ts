/**
 * Transcript processing module
 *
 * Provides utilities for extracting and preprocessing Claude Code transcripts.
 * Designed to be reusable across benchmark and sidekick implementations.
 */

export { extractExcerpt, extractExcerptFromFile } from './excerpt.js'

export type { ProcessedMessage, ExcerptOptions, ExcerptResult } from './types.js'
