/**
 * Transcript Content Extraction Utilities
 *
 * Extracts preview content from Claude transcript entries for logging.
 * Handles various content structures in Claude transcripts:
 * - UserPrompt: message.content can be string or array of content blocks
 * - AssistantMessage: message.content is array of {type: "text", text} or {type: "tool_use", ...}
 * - ToolResult: message.content is array of {type: "tool_result", content}
 * - ToolCall: message.content is array with tool_use blocks
 */

import type { TranscriptEntry, TranscriptEventType } from '@sidekick/types'

/**
 * Extract text from content that may be string or array of content blocks.
 */
export function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    // Find first text block
    for (const block of content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>
        if (b.type === 'text' && typeof b.text === 'string') {
          return b.text
        }
        // Also handle tool_result content (for user messages containing results)
        if (b.type === 'tool_result' && typeof b.content === 'string') {
          return b.content
        }
      }
    }
  }
  return undefined
}

/**
 * Extract preview from tool_use content blocks.
 */
export function extractToolCallPreview(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (typeof block === 'object' && block !== null) {
      const b = block as Record<string, unknown>
      if (b.type === 'tool_use' && typeof b.name === 'string') {
        return `${b.name}(...)`
      }
    }
  }
  return undefined
}

/**
 * Extract preview from tool_result content blocks.
 */
export function extractToolResultPreview(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (typeof block === 'object' && block !== null) {
      const b = block as Record<string, unknown>
      if (b.type === 'tool_result' && typeof b.content === 'string') {
        return b.content
      }
    }
  }
  return undefined
}

/**
 * Extract a brief content preview from a transcript entry for logging.
 * Truncates to maxLen characters to avoid log bloat.
 */
export function extractContentPreview(
  entry: TranscriptEntry,
  eventType: TranscriptEventType,
  maxLen: number = 100
): string | undefined {
  let content: string | undefined

  const message = (entry as { message?: { content?: unknown } }).message
  const rawContent = message?.content

  if (eventType === 'UserPrompt') {
    // User prompts can be string or array (tool_result wrapped in array)
    content = extractTextFromContent(rawContent)
  } else if (eventType === 'AssistantMessage') {
    // Assistant messages are always arrays of content blocks
    content = extractTextFromContent(rawContent)
  } else if (eventType === 'ToolCall') {
    // Tool calls - extract tool name and brief input preview
    content = extractToolCallPreview(rawContent)
  } else if (eventType === 'ToolResult') {
    // Tool results - extract result content
    content = extractToolResultPreview(rawContent)
  }

  if (content && content.length > maxLen) {
    return content.slice(0, maxLen) + '...'
  }
  return content
}
