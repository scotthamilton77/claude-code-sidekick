import type { TranscriptLine, TranscriptLineType, TranscriptFilter, SidekickEventType } from '../types'
import { SIDEKICK_EVENT_TO_FILTER } from '../types'

export const CLAUDE_CODE_TYPES: ReadonlySet<TranscriptLineType> = new Set<TranscriptLineType>([
  'user-message', 'assistant-message', 'tool-use', 'tool-result',
  'compaction', 'turn-duration', 'api-error', 'pr-link',
])

/**
 * Returns true if the line matches the active transcript filters.
 * Assistant messages with both content+thinking match either 'conversation' or 'thinking'.
 */
export function matchesTranscriptFilter(line: TranscriptLine, filters: Set<TranscriptFilter>): boolean {
  if (line.type === 'assistant-message' && line.thinking && line.content) {
    return filters.has('conversation') || filters.has('thinking')
  }
  return filters.has(classifyLineCategory(line))
}

export function classifyLineCategory(line: TranscriptLine): TranscriptFilter {
  const type = line.type
  if (type === 'assistant-message' && line.thinking && !line.content) return 'thinking'
  // User messages: prompts and commands are 'conversation'; everything else is 'system'
  if (type === 'user-message') {
    return (line.userSubtype === 'prompt' || line.userSubtype === 'command') ? 'conversation' : 'system'
  }
  if (type === 'assistant-message') return 'conversation'
  if (type === 'tool-use' || type === 'tool-result') return 'tools'
  if (type === 'compaction' || type === 'turn-duration' || type === 'api-error' || type === 'pr-link') return 'system'
  // Sidekick events: map to their specific timeline filter category
  if (!CLAUDE_CODE_TYPES.has(type)) {
    const filterCategory = SIDEKICK_EVENT_TO_FILTER[type as SidekickEventType]
    if (filterCategory) return filterCategory
  }
  return 'system'
}
