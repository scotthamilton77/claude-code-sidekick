// ============================================================================
// Sidekick Event Types (16 types — what Sidekick itself did)
// ============================================================================

export type SidekickEventType =
  | 'reminder:staged'
  | 'reminder:unstaged'
  | 'reminder:consumed'
  | 'decision:recorded'
  | 'session-summary:start'
  | 'session-summary:finish'
  | 'session-title:changed'
  | 'intent:changed'
  | 'snarky-message:start'
  | 'snarky-message:finish'
  | 'resume-message:start'
  | 'resume-message:finish'
  | 'persona:selected'
  | 'persona:changed'
  | 'statusline:rendered'
  | 'error:occurred'

// ============================================================================
// Transcript Line Types (conversation + Sidekick events inline)
// ============================================================================

export type TranscriptLineType =
  | 'user-message'
  | 'assistant-message'
  | 'tool-use'
  | 'tool-result'
  | 'compaction'
  | SidekickEventType

// A single line in the transcript
export interface TranscriptLine {
  id: string
  timestamp: number
  type: TranscriptLineType
  content?: string

  // assistant-message
  thinking?: string

  // tool-use
  toolName?: string
  toolInput?: Record<string, unknown>
  toolDurationMs?: number

  // tool-result
  toolOutput?: string
  toolSuccess?: boolean

  // compaction
  compactionSegment?: number
  compactionTokensBefore?: number
  compactionTokensAfter?: number

  // reminder:staged / reminder:unstaged / reminder:consumed
  reminderId?: string
  reminderBlocking?: boolean

  // decision:recorded
  decisionCategory?: string
  decisionReasoning?: string

  // session-title:changed / intent:changed
  previousValue?: string
  newValue?: string
  confidence?: number

  // persona:selected / persona:changed
  personaFrom?: string
  personaTo?: string

  // statusline:rendered
  statuslineContent?: string

  // error:occurred
  errorMessage?: string
  errorStack?: string

  // snarky-message:finish / resume-message:finish
  generatedMessage?: string
}

// ============================================================================
// Sidekick Event (timeline-only, references transcript line)
// ============================================================================

export interface SidekickEvent {
  id: string
  timestamp: number
  type: SidekickEventType
  label: string
  detail?: string
  transcriptLineId: string // for scroll-sync
}

// ============================================================================
// LED State (blocking reminder indicators per transcript line)
// ============================================================================

export interface LEDState {
  vcBuild: boolean
  vcTypecheck: boolean
  vcTest: boolean
  vcLint: boolean
  verifyCompletion: boolean
  pauseAndReflect: boolean
  titleConfidence: 'red' | 'amber' | 'green'
  titleConfidencePct: number
}

// ============================================================================
// State Snapshot (Sidekick state files at a point in time)
// ============================================================================

export interface StateSnapshot {
  timestamp: number
  sessionSummary?: Record<string, unknown>
  sessionPersona?: Record<string, unknown>
  snarkyMessage?: Record<string, unknown>
  resumeMessage?: Record<string, unknown>
  transcriptMetrics?: Record<string, unknown>
  llmMetrics?: Record<string, unknown>
  summaryCountdown?: Record<string, unknown>
}

// ============================================================================
// Session & Project
// ============================================================================

export interface Session {
  id: string
  title: string
  date: string
  branch: string
  projectId: string
  persona?: string
  intent?: string
  intentConfidence?: number
  tokenCount?: number
  costUsd?: number
  durationSec?: number
  taskQueueCount?: number
  contextWindowPct?: number
  status: 'active' | 'completed'
  transcriptLines: TranscriptLine[]
  sidekickEvents: SidekickEvent[]
  ledStates: Map<string, LEDState> // keyed by transcript line ID
  stateSnapshots: StateSnapshot[]
}

export interface Project {
  id: string
  name: string
  projectDir?: string
  sessions: Session[]
}

// ============================================================================
// Timeline Filter
// ============================================================================

export type TimelineFilter = 'reminders' | 'decisions' | 'session-analysis' | 'statusline' | 'errors'

export const SIDEKICK_EVENT_TO_FILTER: Record<SidekickEventType, TimelineFilter> = {
  'reminder:staged': 'reminders',
  'reminder:unstaged': 'reminders',
  'reminder:consumed': 'reminders',
  'decision:recorded': 'decisions',
  'session-summary:start': 'session-analysis',
  'session-summary:finish': 'session-analysis',
  'session-title:changed': 'session-analysis',
  'intent:changed': 'session-analysis',
  'snarky-message:start': 'session-analysis',
  'snarky-message:finish': 'session-analysis',
  'resume-message:start': 'session-analysis',
  'resume-message:finish': 'session-analysis',
  'persona:selected': 'session-analysis',
  'persona:changed': 'session-analysis',
  'statusline:rendered': 'statusline',
  'error:occurred': 'errors',
}

// ============================================================================
// Navigation State
// ============================================================================

export type NavigationDepth = 'selector' | 'dashboard' | 'detail'

export interface PanelState {
  expanded: boolean
}

export interface NavigationState {
  depth: NavigationDepth
  selectedProjectId: string | null
  selectedSessionId: string | null
  selectedTranscriptLineId: string | null
  syncedTranscriptLineId: string | null // for timeline → transcript scroll-sync
  selectorPanel: PanelState
  detailPanel: PanelState
  timelineFilters: Set<TimelineFilter>
  searchQuery: string
  darkMode: boolean
}
