import type { TranscriptLine, TranscriptFilter } from '../types'

export function classifyLineCategory(line: TranscriptLine): TranscriptFilter {
  const type = line.type
  if (type === 'assistant-message' && line.thinking && !line.content) return 'thinking'
  // User messages: only real prompts are 'conversation'
  if (type === 'user-message') {
    return line.userSubtype === 'prompt' ? 'conversation' : 'system'
  }
  if (type === 'assistant-message') return 'conversation'
  if (type === 'tool-use' || type === 'tool-result') return 'tools'
  if (type === 'compaction' || type === 'turn-duration' || type === 'api-error' || type === 'pr-link') return 'system'
  return 'sidekick'  // anything not in Claude Code types is a sidekick event
}
