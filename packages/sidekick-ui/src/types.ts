// Event types displayed on the timeline
export type EventType =
  | 'session-start'
  | 'user-message'
  | 'assistant-message'
  | 'tool-use'
  | 'hook-execution'
  | 'decision'
  | 'state-change'
  | 'reminder'
  | 'compaction'
  | 'persona-change'
  | 'llm-call'
  | 'error'
  | 'statusline-call'

// A single event on the timeline
export interface TimelineEvent {
  id: string
  timestamp: number
  type: EventType
  label: string
  content?: string
  // Tool events
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: Record<string, unknown>
  toolDurationMs?: number
  // State/summary events
  confidence?: number
  stateSnapshot?: Record<string, unknown>
  previousSnapshot?: Record<string, unknown>
  // Reminder events
  reminderAction?: 'staged' | 'consumed' | 'cleared'
  reminderHook?: string
  reminderBlocking?: boolean
  reminderPriority?: number
  // Decision events
  decisionCategory?: 'summary' | 'reminder' | 'context-prune' | 'handler'
  decisionReasoning?: string
  decisionImpact?: string
  // LLM call events
  llmModel?: string
  llmTokensIn?: number
  llmTokensOut?: number
  llmCostUsd?: number
  llmLatencyMs?: number
  // Persona change events
  personaFrom?: string
  personaTo?: string
  // Compaction events
  compactionSegment?: number
  compactionTokensBefore?: number
  compactionTokensAfter?: number
  // Hook execution events
  hookName?: string
  hookDurationMs?: number
  hookSuccess?: boolean
  hookOutput?: string
  // Error events
  errorMessage?: string
  errorStack?: string
  // Statusline events
  statuslineContent?: string
}

// Session metadata
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
  events: TimelineEvent[]
}

// Project grouping
export interface Project {
  id: string
  name: string
  sessions: Session[]
}

// Focus filter types (matches EventType categories)
export type FocusFilter =
  | 'hooks'
  | 'transcript'
  | 'decisions'
  | 'reminders'
  | 'llm-calls'
  | 'state-changes'
  | 'errors'

// Map EventType → FocusFilter for filtering logic
export const EVENT_TO_FILTER: Partial<Record<EventType, FocusFilter>> = {
  'hook-execution': 'hooks',
  'tool-use': 'hooks',
  'user-message': 'transcript',
  'assistant-message': 'transcript',
  'decision': 'decisions',
  'state-change': 'state-changes',
  'reminder': 'reminders',
  'llm-call': 'llm-calls',
  'error': 'errors',
  // statusline-call, session-start, compaction, persona-change → always visible
}

// Navigation depth
export type NavigationDepth = 'selector' | 'dashboard' | 'detail'

// Panel state
export interface PanelState {
  expanded: boolean
}

// Full navigation state
export interface NavigationState {
  depth: NavigationDepth
  selectedProjectId: string | null
  selectedSessionId: string | null
  selectedEventId: string | null
  selectorPanel: PanelState
  dashboardPanel: PanelState
  detailPanel: PanelState
  activeFilters: Set<FocusFilter>
  searchQuery: string
  darkMode: boolean
}
