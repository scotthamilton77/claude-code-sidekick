import type { TranscriptLine, TranscriptFilter, SidekickEventType } from '../types'
import { SIDEKICK_EVENT_TO_FILTER } from '../types'

const CLAUDE_CODE_TYPES = new Set([
  'user-message', 'assistant-message', 'tool-use', 'tool-result',
  'compaction', 'turn-duration', 'api-error', 'pr-link',
])

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
