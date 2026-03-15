import type { TranscriptLine, TranscriptFilter } from '../types'

const CLAUDE_CODE_TYPES = new Set(['user-message', 'assistant-message', 'tool-use', 'tool-result', 'compaction', 'turn-duration', 'api-error', 'pr-link'])

export function classifyLineCategory(line: TranscriptLine): TranscriptFilter {
  const type = line.type
  if (type === 'assistant-message' && line.thinking && !line.content) return 'thinking'
  if (type === 'user-message' || type === 'assistant-message') return 'conversation'
  if (type === 'tool-use' || type === 'tool-result') return 'tools'
  if (type === 'compaction' || type === 'turn-duration' || type === 'api-error' || type === 'pr-link') return 'system'
  if (!CLAUDE_CODE_TYPES.has(type)) return 'sidekick'
  return 'system'
}
