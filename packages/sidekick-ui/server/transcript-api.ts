import { readFile, stat, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findLogFiles, readLogFile, generateLabel, TIMELINE_EVENT_TYPES, type RawLogEntry, type TimelineSidekickEventType } from './timeline-api.js'

/**
 * Transcript line types visible in the UI.
 * Mirrors TranscriptLineType from src/types.ts — kept inline to avoid
 * cross-tsconfig imports (server uses tsconfig.node.json, src uses tsconfig.json).
 *
 * Includes all 17 SidekickEventType values for interleaved events.
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
  | TimelineSidekickEventType

export type ApiUserSubtype = 'prompt' | 'system-injection' | 'command' | 'skill-content'

/** Transcript line returned by the API. Matches TranscriptLine from src/types.ts (subset). */
export interface ApiTranscriptLine {
  id: string
  timestamp: number
  type: ApiTranscriptLineType
  content?: string
  userSubtype?: ApiUserSubtype
  thinking?: string
  toolUseId?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  toolSuccess?: boolean
  compactionTokensBefore?: number
  compactionTokensAfter?: number
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
  // subagent drill-down
  agentId?: string

  // LED state (computed server-side during merge)
  ledState?: {
    vcBuild: boolean
    vcTypecheck: boolean
    vcTest: boolean
    vcLint: boolean
    verifyCompletion: boolean
    pauseAndReflect: boolean
    titleConfidence: 'red' | 'amber' | 'green'
    titleConfidencePct: number
  }
  // Hook event fields
  hookName?: string
  hookDurationMs?: number
  // Sidekick event fields
  reminderId?: string
  reminderBlocking?: boolean
  decisionCategory?: string
  decisionReasoning?: string
  previousValue?: string
  newValue?: string
  confidence?: number
  personaFrom?: string
  personaTo?: string
  statuslineContent?: string
  errorStack?: string
  generatedMessage?: string
}

/** Raw entry types to skip entirely (noise). */
const SKIP_TYPES = new Set(['queue-operation', 'file-history-snapshot', 'last-prompt', 'progress'])

/** System subtypes to skip. */
const SKIP_SYSTEM_SUBTYPES = new Set(['stop_hook_summary', 'local_command'])

/**
 * Resolve the path to a session's transcript JSONL file.
 *
 * Claude Code stores transcripts under ~/.claude/projects/{projectId}/.
 * The projectId is the registry-style ID (e.g. `-Users-foo`).
 *
 * Two layouts exist:
 *   Directory: ~/.claude/projects/{projectId}/{sessionId}/{sessionId}.jsonl
 *   Bare file: ~/.claude/projects/{projectId}/{sessionId}.jsonl
 *
 * Returns the path if found, null otherwise.
 */
export async function resolveTranscriptPath(projectId: string, sessionId: string): Promise<string | null> {
  const claudeProjectDir = join(homedir(), '.claude', 'projects', projectId)

  // Try directory layout first
  const dirPath = join(claudeProjectDir, sessionId, `${sessionId}.jsonl`)
  try {
    const st = await stat(dirPath)
    if (st.isFile()) return dirPath
  } catch {
    // fall through
  }

  // Try bare file layout
  const barePath = join(claudeProjectDir, `${sessionId}.jsonl`)
  try {
    const st = await stat(barePath)
    if (st.isFile()) return barePath
  } catch {
    // fall through
  }

  return null
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
      .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null && b.type === 'text')
      .map((b) => b.text as string)
      .join('\n')
  }
  return String(content ?? '')
}

/**
 * Classify a user message into subtypes for distinct rendering.
 * Detection order matters: command > skill-content > system-injection > prompt.
 */
function classifyUserSubtype(entry: Record<string, unknown>, content: string): ApiUserSubtype {
  if (entry.isMeta === true) {
    if (content.includes('<command-name>')) return 'command'
    if (content.includes('Base directory for this skill:')) return 'skill-content'
    return 'system-injection'
  }
  if (content.includes('<system-reminder>')) return 'system-injection'
  if (content.includes('<command-name>')) return 'command'
  return 'prompt'
}

/**
 * Process content blocks from a user entry.
 * User entries can have string content (simple text) or array content
 * (text blocks, tool_result blocks, etc.).
 */
function processUserEntry(entry: Record<string, unknown>, lineIndex: number, timestamp: number): ApiTranscriptLine[] {
  const message = entry.message as Record<string, unknown> | undefined
  const content = message?.content ?? entry.content
  const meta = extractMetadata(entry)

  // String content → single user-message
  if (typeof content === 'string') {
    return [
      {
        id: `transcript-${lineIndex}-0`,
        timestamp,
        type: 'user-message',
        content,
        userSubtype: classifyUserSubtype(entry, content),
        ...meta,
      },
    ]
  }

  // Array content → iterate blocks
  if (!Array.isArray(content)) return []

  const lines: ApiTranscriptLine[] = []
  let blockIndex = 0

  for (const block of content) {
    if (typeof block !== 'object' || block === null) {
      blockIndex++
      continue
    }
    const b = block as Record<string, unknown>

    if (b.type === 'text') {
      const text = b.text as string
      lines.push({
        id: `transcript-${lineIndex}-${blockIndex}`,
        timestamp,
        type: 'user-message',
        content: text,
        userSubtype: classifyUserSubtype(entry, text),
        ...meta,
      })
    } else if (b.type === 'tool_result') {
      lines.push({
        id: `transcript-${lineIndex}-${blockIndex}`,
        timestamp,
        type: 'tool-result',
        toolUseId: b.tool_use_id as string,
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
    if (typeof block !== 'object' || block === null) {
      blockIndex++
      continue
    }
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
      const thinkingText = b.thinking as string
      if (thinkingText) {
        lines.push({
          id: `transcript-${lineIndex}-${blockIndex}`,
          timestamp,
          type: 'assistant-message',
          thinking: thinkingText,
          ...meta,
        })
      }
    } else if (b.type === 'tool_use') {
      lines.push({
        id: `transcript-${lineIndex}-${blockIndex}`,
        timestamp,
        type: 'tool-use',
        toolUseId: b.id as string,
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
function processSystemEntry(entry: Record<string, unknown>, lineIndex: number, timestamp: number): ApiTranscriptLine[] {
  const subtype = entry.subtype as string | undefined
  if (!subtype) return []

  // Skip noise subtypes
  if (SKIP_SYSTEM_SUBTYPES.has(subtype)) return []

  const meta = extractMetadata(entry)

  if (subtype === 'compact_boundary') {
    const compactMetadata = entry.compactMetadata as Record<string, unknown> | undefined
    return [
      {
        id: `transcript-${lineIndex}-0`,
        timestamp,
        type: 'compaction',
        compactionTokensBefore: compactMetadata?.preTokens as number | undefined,
        compactionTokensAfter: compactMetadata?.postTokens as number | undefined,
        ...meta,
      },
    ]
  }

  if (subtype === 'turn_duration') {
    return [
      {
        id: `transcript-${lineIndex}-0`,
        timestamp,
        type: 'turn-duration',
        durationMs: entry.durationMs as number | undefined,
        ...meta,
      },
    ]
  }

  if (subtype === 'api_error') {
    return [
      {
        id: `transcript-${lineIndex}-0`,
        timestamp,
        type: 'api-error',
        retryAttempt: entry.retryAttempt as number | undefined,
        maxRetries: entry.maxRetries as number | undefined,
        errorMessage: entry.error != null ? String(entry.error) : undefined,
        ...meta,
      },
    ]
  }

  // Unknown system subtype — skip
  return []
}

/**
 * Process a pr-link entry.
 */
function processPrLinkEntry(entry: Record<string, unknown>, lineIndex: number, timestamp: number): ApiTranscriptLine[] {
  const meta = extractMetadata(entry)
  return [
    {
      id: `transcript-${lineIndex}-0`,
      timestamp,
      type: 'pr-link',
      prUrl: entry.prUrl as string | undefined,
      prNumber: entry.prNumber as number | undefined,
      ...meta,
    },
  ]
}

/**
 * Extract metadata flags common to all entry types.
 */
function extractMetadata(
  entry: Record<string, unknown>
): Pick<ApiTranscriptLine, 'isSidechain' | 'isMeta' | 'isCompactSummary'> {
  const result: Pick<ApiTranscriptLine, 'isSidechain' | 'isMeta' | 'isCompactSummary'> = {}
  if (entry.isSidechain === true) result.isSidechain = true
  if (entry.isMeta === true) result.isMeta = true
  if (entry.isCompactSummary === true) result.isCompactSummary = true
  return result
}


/**
 * Convert a Sidekick NDJSON log entry to an ApiTranscriptLine.
 */
function sidekickEventToTranscriptLine(entry: RawLogEntry): ApiTranscriptLine {
  const payload = entry.payload ?? {}
  const { label } = generateLabel(entry.type, payload)

  // Use stable ID based on timestamp + type so timeline scroll-sync can
  // reference the same ID (timeline-api.ts generates matching transcriptLineId).
  const line: ApiTranscriptLine = {
    id: `sidekick-${entry.time}-${entry.type}`,
    timestamp: entry.time,
    type: entry.type as ApiTranscriptLineType,
    content: label,
  }

  // Copy event-specific payload fields (use ?? for fallback semantics)
  line.reminderId = (payload.reminderName ?? payload.reminderType) as string | undefined
  if (payload.blocking === true) line.reminderBlocking = true
  line.decisionCategory = (payload.decision ?? payload.category) as string | undefined
  if (payload.reason) line.decisionReasoning = payload.reason as string
  if (payload.previousValue) line.previousValue = payload.previousValue as string
  if (payload.newValue) line.newValue = payload.newValue as string
  if (payload.confidence != null) line.confidence = payload.confidence as number
  if (payload.personaFrom) line.personaFrom = payload.personaFrom as string
  line.personaTo = (payload.personaTo ?? payload.personaId) as string | undefined
  // Statusline: build rich content from available fields
  if (entry.type === 'statusline:rendered') {
    const parts: string[] = []
    if (payload.displayMode) parts.push((payload.displayMode as string).replace(/_/g, ' '))
    if (payload.staleData === true) parts.push('(stale)')
    if (payload.tokens) parts.push(`${payload.tokens} tokens`)
    if (payload.durationMs != null) parts.push(`${payload.durationMs}ms`)
    if (parts.length > 0) line.statuslineContent = parts.join(' · ')
  }
  // Hook events
  if (payload.hook) line.hookName = payload.hook as string
  if (payload.durationMs != null && entry.type === 'hook:completed') line.hookDurationMs = payload.durationMs as number
  if (payload.errorMessage) line.errorMessage = payload.errorMessage as string
  if (payload.errorStack) line.errorStack = payload.errorStack as string
  if (payload.generatedMessage) line.generatedMessage = payload.generatedMessage as string
  if (payload.snarky_comment) line.generatedMessage = payload.snarky_comment as string

  return line
}

/**
 * Read Sidekick events for a session from NDJSON log files.
 */
async function readSidekickEvents(projectDir: string, sessionId: string): Promise<ApiTranscriptLine[]> {
  const logsDir = join(projectDir, '.sidekick', 'logs')

  const [cliFiles, daemonFiles] = await Promise.all([
    findLogFiles(logsDir, 'sidekick.'),
    findLogFiles(logsDir, 'sidekickd.'),
  ])

  const allFiles = [...cliFiles, ...daemonFiles]
  const fileResults = await Promise.all(allFiles.map(readLogFile))
  const allEntries = fileResults.flat()

  // Filter by sessionId and visible event types
  const filtered = allEntries.filter(
    (entry) =>
      entry.context?.sessionId === sessionId &&
      TIMELINE_EVENT_TYPES.has(entry.type)
  )

  // Deduplicate IDs: if two events share the same timestamp+type, suffix with a counter.
  // The first occurrence keeps the base ID (for timeline scroll-sync matching).
  const seen = new Map<string, number>()
  return filtered.map((entry) => {
    const line = sidekickEventToTranscriptLine(entry)
    const count = (seen.get(line.id) ?? 0) + 1
    seen.set(line.id, count)
    if (count > 1) line.id = `${line.id}-${count}`
    return line
  })
}

/**
 * Parse a JSONL transcript file into ApiTranscriptLine[].
 * Shared core loop for both main transcripts and subagent transcripts.
 *
 * @param onExtra - Optional callback for entry types beyond user/assistant/system.
 *   Receives the entry, its type, line index, timestamp, and accumulated results.
 *   Return lines to add, or empty array to skip.
 */
function parseJsonlContent(
  content: string,
  onExtra?: (
    entry: Record<string, unknown>,
    entryType: string,
    lineIndex: number,
    timestamp: number,
    results: ApiTranscriptLine[],
  ) => ApiTranscriptLine[],
): ApiTranscriptLine[] {
  const results: ApiTranscriptLine[] = []
  const rawLines = content.split('\n')

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    const trimmed = rawLines[lineIndex].trim()
    if (!trimmed) continue

    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }

    const entryType = entry.type as string | undefined
    if (!entryType) continue
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
      default:
        lines = onExtra?.(entry, entryType, lineIndex, timestamp, results) ?? []
    }

    results.push(...lines)
  }

  return results
}

/**
 * Parse a Claude Code transcript JSONL file into ApiTranscriptLine[].
 *
 * When projectDir is provided, also reads Sidekick NDJSON logs and
 * interleaves events by timestamp.
 */
export async function parseTranscriptLines(
  projectId: string,
  sessionId: string,
  projectDir?: string,
): Promise<ApiTranscriptLine[]> {
  const filePath = await resolveTranscriptPath(projectId, sessionId)
  if (!filePath) return []

  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return []
  }

  if (!content.trim()) return []

  const results = parseJsonlContent(content, (entry, entryType, lineIndex, timestamp, accumulated) => {
    if (entryType === 'pr-link') return processPrLinkEntry(entry, lineIndex, timestamp)

    if (entryType === 'agent_progress') {
      const data = entry.data as Record<string, unknown> | undefined
      const agentId = data?.agentId as string | undefined
      if (agentId) {
        for (let i = accumulated.length - 1; i >= 0; i--) {
          if (accumulated[i].type === 'tool-use') {
            accumulated[i].agentId = agentId
            break
          }
        }
      }
    }

    return []
  })

  // Clamp timestamps to preserve file order (JSONL sequence is authoritative).
  // Out-of-order timestamps in the file must not cause visual reordering.
  let lastTs = 0
  for (const line of results) {
    if (line.timestamp < lastTs) {
      line.timestamp = lastTs
    }
    lastTs = line.timestamp
  }

  // If projectDir provided, interleave Sidekick events and compute LED states
  if (projectDir) {
    const sidekickLines = await readSidekickEvents(projectDir, sessionId)
    results.push(...sidekickLines)
    // Sort merged results by timestamp (stable sort preserves file order for same timestamp)
    results.sort((a, b) => a.timestamp - b.timestamp)
    // Compute LED states after merge
    computeLEDStates(results)
  }

  return results
}

/** LED state fields tracked across transcript lines. */
interface RunningLEDState {
  vcBuild: boolean
  vcTypecheck: boolean
  vcTest: boolean
  vcLint: boolean
  verifyCompletion: boolean
  pauseAndReflect: boolean
  titleConfidence: 'red' | 'amber' | 'green'
  titleConfidencePct: number
}

/** Map reminder names to LED state keys. */
function mapReminderToLED(reminderId: string | undefined): keyof RunningLEDState | null {
  switch (reminderId) {
    case 'vc-build': return 'vcBuild'
    case 'vc-typecheck': return 'vcTypecheck'
    case 'vc-test': return 'vcTest'
    case 'vc-lint': return 'vcLint'
    case 'verify-completion': return 'verifyCompletion'
    case 'pause-and-reflect': return 'pauseAndReflect'
    default: return null
  }
}

/**
 * Walk the merged transcript top-to-bottom, computing LED states.
 * Each line gets a snapshot of the current LED state after any mutations it causes.
 */
function computeLEDStates(lines: ApiTranscriptLine[]): void {
  const state: RunningLEDState = {
    vcBuild: false, vcTypecheck: false, vcTest: false, vcLint: false,
    verifyCompletion: false, pauseAndReflect: false,
    titleConfidence: 'green', titleConfidencePct: 85,
  }
  let currentSnapshot = { ...state }
  let dirty = true  // first line always gets a fresh snapshot

  for (const line of lines) {
    if (line.type === 'reminder:staged') {
      const key = mapReminderToLED(line.reminderId)
      if (key && typeof state[key] === 'boolean') {
        ;(state as Record<string, boolean>)[key] = true
        dirty = true
      }
    } else if (line.type === 'reminder:unstaged' || line.type === 'reminder:consumed') {
      const key = mapReminderToLED(line.reminderId)
      if (key && typeof state[key] === 'boolean') {
        ;(state as Record<string, boolean>)[key] = false
        dirty = true
      }
    } else if (line.type === 'reminder:cleared') {
      if (!line.reminderId) {
        // Clear-all: reset every boolean LED field
        state.vcBuild = false; state.vcTypecheck = false
        state.vcTest = false; state.vcLint = false
        state.verifyCompletion = false; state.pauseAndReflect = false
        dirty = true
      } else {
        const key = mapReminderToLED(line.reminderId)
        if (key && typeof state[key] === 'boolean') {
          ;(state as Record<string, boolean>)[key] = false
          dirty = true
        }
      }
    } else if (line.type === 'session-title:changed' && line.confidence != null) {
      const pct = Math.round(line.confidence * 100)
      state.titleConfidencePct = pct
      state.titleConfidence = pct >= 80 ? 'green' : pct >= 50 ? 'amber' : 'red'
      dirty = true
    }

    if (dirty) {
      currentSnapshot = { ...state }
      dirty = false
    }
    line.ledState = currentSnapshot
  }
}

// ============================================================================
// Subagent Transcript Support
// ============================================================================

export interface SubagentMeta {
  agentType?: string
  worktreePath?: string
  parentToolUseId?: string
}

export interface SubagentTranscriptResult {
  lines: ApiTranscriptLine[]
  meta: SubagentMeta
}

/**
 * Resolve the path to a subagent's JSONL transcript file.
 */
function resolveSubagentPath(projectId: string, sessionId: string, agentId: string): string {
  return join(homedir(), '.claude', 'projects', projectId, sessionId, 'subagents', `agent-${agentId}.jsonl`)
}

/**
 * Parse a subagent's transcript and metadata.
 * No Sidekick event interleaving or LED state computation.
 */
export async function parseSubagentTranscript(
  projectId: string,
  sessionId: string,
  agentId: string,
): Promise<SubagentTranscriptResult | null> {
  const filePath = resolveSubagentPath(projectId, sessionId, agentId)

  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return null
  }

  if (!content.trim()) return { lines: [], meta: {} }

  const lines = parseJsonlContent(content)

  // Read meta.json if present
  const metaPath = filePath.replace('.jsonl', '.meta.json')
  let meta: SubagentMeta = {}
  try {
    const metaContent = await readFile(metaPath, 'utf-8')
    const metaData = JSON.parse(metaContent) as Record<string, unknown>
    meta = {
      agentType: metaData.agentType as string | undefined,
      worktreePath: metaData.worktreePath as string | undefined,
      parentToolUseId: metaData.parentToolUseId as string | undefined,
    }
  } catch {
    // No meta file or malformed — OK
  }

  return { lines, meta }
}

/**
 * List available subagent IDs for a session.
 */
export async function listSubagents(projectId: string, sessionId: string): Promise<string[]> {
  const subagentsDir = join(homedir(), '.claude', 'projects', projectId, sessionId, 'subagents')
  try {
    const files = await readdir(subagentsDir)
    return files
      .filter(f => f.startsWith('agent-') && f.endsWith('.jsonl'))
      .map(f => f.replace(/^agent-/, '').replace(/\.jsonl$/, ''))
  } catch {
    return []
  }
}
