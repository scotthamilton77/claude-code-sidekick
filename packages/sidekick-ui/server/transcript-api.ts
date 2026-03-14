import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Transcript line types visible in the UI.
 * Mirrors TranscriptLineType from src/types.ts — kept inline to avoid
 * cross-tsconfig imports (server uses tsconfig.node.json, src uses tsconfig.json).
 */
export type ApiTranscriptLineType =
  | 'user-message'
  | 'assistant-message'
  | 'tool-use'
  | 'tool-result'
  | 'compaction'
  | 'turn-duration'
  | 'api-error'
  | 'pr-link'

/** Transcript line returned by the API. Matches TranscriptLine from src/types.ts (subset). */
export interface ApiTranscriptLine {
  id: string
  timestamp: number
  type: string // ApiTranscriptLineType values
  content?: string
  thinking?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  toolSuccess?: boolean
  compactionTokensBefore?: number
  durationMs?: number
  retryAttempt?: number
  maxRetries?: number
  errorMessage?: string
  prUrl?: string
  prNumber?: number
  model?: string
  isSidechain?: boolean
  isCompactSummary?: boolean
  isMeta?: boolean
}

/** Raw entry types to skip entirely (noise). */
const SKIP_TYPES = new Set([
  'queue-operation',
  'file-history-snapshot',
  'last-prompt',
  'progress',
])

/** System subtypes to skip. */
const SKIP_SYSTEM_SUBTYPES = new Set([
  'stop_hook_summary',
  'local_command',
])

/**
 * Resolve the path to a session's transcript JSONL file.
 *
 * Two layouts exist:
 *   Directory: {projectDir}/{sessionId}/{sessionId}.jsonl
 *   Bare file: {projectDir}/{sessionId}.jsonl
 *
 * Returns the path if found, null otherwise.
 */
export async function resolveTranscriptPath(
  projectDir: string,
  sessionId: string
): Promise<string | null> {
  // Try directory layout first
  const dirPath = join(projectDir, sessionId, `${sessionId}.jsonl`)
  try {
    await stat(dirPath)
    return dirPath
  } catch {
    // fall through
  }

  // Try bare file layout
  const barePath = join(projectDir, `${sessionId}.jsonl`)
  try {
    await stat(barePath)
    return barePath
  } catch {
    return null
  }
}

/**
 * Parse a timestamp string to epoch milliseconds.
 * Returns 0 if the timestamp is missing or invalid.
 */
function parseTimestamp(ts: unknown): number {
  if (typeof ts !== 'string') return 0
  const ms = new Date(ts).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * Extract text content from a tool_result content field.
 * Handles both string and array-of-blocks formats.
 */
function extractToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: Record<string, unknown>) => b.type === 'text')
      .map((b: Record<string, unknown>) => b.text as string)
      .join('\n')
  }
  return String(content ?? '')
}

/**
 * Process content blocks from a user entry.
 * User entries can have string content (simple text) or array content
 * (text blocks, tool_result blocks, etc.).
 */
function processUserEntry(
  entry: Record<string, unknown>,
  lineIndex: number,
  timestamp: number
): ApiTranscriptLine[] {
  const message = entry.message as Record<string, unknown> | undefined
  const content = message?.content ?? entry.content
  const meta = extractMetadata(entry)

  // String content → single user-message
  if (typeof content === 'string') {
    return [{
      id: `transcript-${lineIndex}-0`,
      timestamp,
      type: 'user-message',
      content,
      ...meta,
    }]
  }

  // Array content → iterate blocks
  if (!Array.isArray(content)) return []

  const lines: ApiTranscriptLine[] = []
  let blockIndex = 0

  for (const block of content) {
    const b = block as Record<string, unknown>

    if (b.type === 'text') {
      lines.push({
        id: `transcript-${lineIndex}-${blockIndex}`,
        timestamp,
        type: 'user-message',
        content: b.text as string,
        ...meta,
      })
    } else if (b.type === 'tool_result') {
      lines.push({
        id: `transcript-${lineIndex}-${blockIndex}`,
        timestamp,
        type: 'tool-result',
        toolOutput: extractToolResultContent(b.content),
        toolSuccess: !b.is_error,
        ...meta,
      })
    }

    blockIndex++
  }

  return lines
}

/**
 * Process content blocks from an assistant entry.
 * Assistant entries have an array of content blocks (text, thinking, tool_use).
 */
function processAssistantEntry(
  entry: Record<string, unknown>,
  lineIndex: number,
  timestamp: number
): ApiTranscriptLine[] {
  const message = entry.message as Record<string, unknown> | undefined
  const content = message?.content
  const model = message?.model as string | undefined
  const meta = { ...extractMetadata(entry), ...(model ? { model } : {}) }

  if (!Array.isArray(content)) return []

  const lines: ApiTranscriptLine[] = []
  let blockIndex = 0

  for (const block of content) {
    const b = block as Record<string, unknown>

    if (b.type === 'text') {
      lines.push({
        id: `transcript-${lineIndex}-${blockIndex}`,
        timestamp,
        type: 'assistant-message',
        content: b.text as string,
        ...meta,
      })
    } else if (b.type === 'thinking') {
      lines.push({
        id: `transcript-${lineIndex}-${blockIndex}`,
        timestamp,
        type: 'assistant-message',
        thinking: b.thinking as string,
        ...meta,
      })
    } else if (b.type === 'tool_use') {
      lines.push({
        id: `transcript-${lineIndex}-${blockIndex}`,
        timestamp,
        type: 'tool-use',
        toolName: b.name as string,
        toolInput: b.input as Record<string, unknown>,
        ...meta,
      })
    }

    blockIndex++
  }

  return lines
}

/**
 * Process a system entry based on its subtype.
 */
function processSystemEntry(
  entry: Record<string, unknown>,
  lineIndex: number,
  timestamp: number
): ApiTranscriptLine[] {
  const subtype = entry.subtype as string | undefined
  if (!subtype) return []

  // Skip noise subtypes
  if (SKIP_SYSTEM_SUBTYPES.has(subtype)) return []

  const meta = extractMetadata(entry)

  if (subtype === 'compact_boundary') {
    const compactMetadata = entry.compactMetadata as Record<string, unknown> | undefined
    return [{
      id: `transcript-${lineIndex}-0`,
      timestamp,
      type: 'compaction',
      compactionTokensBefore: compactMetadata?.preTokens as number | undefined,
      ...meta,
    }]
  }

  if (subtype === 'turn_duration') {
    return [{
      id: `transcript-${lineIndex}-0`,
      timestamp,
      type: 'turn-duration',
      durationMs: entry.durationMs as number | undefined,
      ...meta,
    }]
  }

  if (subtype === 'api_error') {
    return [{
      id: `transcript-${lineIndex}-0`,
      timestamp,
      type: 'api-error',
      retryAttempt: entry.retryAttempt as number | undefined,
      maxRetries: entry.maxRetries as number | undefined,
      errorMessage: entry.error != null ? String(entry.error) : undefined,
      ...meta,
    }]
  }

  // Unknown system subtype — skip
  return []
}

/**
 * Process a pr-link entry.
 */
function processPrLinkEntry(
  entry: Record<string, unknown>,
  lineIndex: number,
  timestamp: number
): ApiTranscriptLine[] {
  const meta = extractMetadata(entry)
  return [{
    id: `transcript-${lineIndex}-0`,
    timestamp,
    type: 'pr-link',
    prUrl: entry.prUrl as string | undefined,
    prNumber: entry.prNumber as number | undefined,
    ...meta,
  }]
}

/**
 * Extract metadata flags common to all entry types.
 */
function extractMetadata(entry: Record<string, unknown>): Pick<
  ApiTranscriptLine,
  'isSidechain' | 'isMeta' | 'isCompactSummary'
> {
  const result: Pick<ApiTranscriptLine, 'isSidechain' | 'isMeta' | 'isCompactSummary'> = {}
  if (entry.isSidechain === true) result.isSidechain = true
  if (entry.isMeta === true) result.isMeta = true
  if (entry.isCompactSummary === true) result.isCompactSummary = true
  return result
}

/**
 * Parse a Claude Code transcript JSONL file into ApiTranscriptLine[].
 *
 * Reads the JSONL file, skips noise entry types, and transforms each
 * relevant entry into one or more ApiTranscriptLine objects.
 * Returns lines in file order (no sorting).
 */
export async function parseTranscriptLines(
  projectDir: string,
  sessionId: string
): Promise<ApiTranscriptLine[]> {
  const filePath = await resolveTranscriptPath(projectDir, sessionId)
  if (!filePath) return []

  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return []
  }

  if (!content.trim()) return []

  const results: ApiTranscriptLine[] = []
  const rawLines = content.split('\n')

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    const trimmed = rawLines[lineIndex].trim()
    if (!trimmed) continue

    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      // Skip malformed JSON lines
      continue
    }

    const entryType = entry.type as string | undefined
    if (!entryType) continue

    // Skip noise types
    if (SKIP_TYPES.has(entryType)) continue

    const timestamp = parseTimestamp(entry.timestamp)

    let lines: ApiTranscriptLine[]

    switch (entryType) {
      case 'user':
        lines = processUserEntry(entry, lineIndex, timestamp)
        break
      case 'assistant':
        lines = processAssistantEntry(entry, lineIndex, timestamp)
        break
      case 'system':
        lines = processSystemEntry(entry, lineIndex, timestamp)
        break
      case 'pr-link':
        lines = processPrLinkEntry(entry, lineIndex, timestamp)
        break
      default:
        // Unknown type — skip
        lines = []
    }

    results.push(...lines)
  }

  return results
}
