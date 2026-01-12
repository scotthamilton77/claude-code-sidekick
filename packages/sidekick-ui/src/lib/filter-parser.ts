/**
 * Filter Query Parser
 *
 * Parses filter query syntax for searching/filtering events in the UI.
 *
 * Supported syntax:
 * - kind:hook, kind:transcript, kind:internal - Filter by event kind
 * - type:ReminderStaged, type:SummaryUpdated - Filter by event type
 * - hook:UserPromptSubmit, hook:PreToolUse - Filter by hook name
 * - source:cli, source:daemon - Filter by log source
 * - Free text - Matches against content, label, type
 *
 * Examples:
 * - "kind:hook hook:Stop" - Only Stop hook events
 * - "kind:transcript tool" - Transcript events containing "tool"
 * - "source:daemon Summary" - Daemon events with "Summary"
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §5.2 Search Bar
 */

import type { UIEvent } from '../types'
import type { ParsedLogRecord } from './log-parser'
import { getEventKind, type EventKind } from './event-adapter'

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed filter token.
 */
export type FilterToken =
  | { type: 'kind'; value: EventKind }
  | { type: 'eventType'; value: string }
  | { type: 'hook'; value: string }
  | { type: 'source'; value: 'cli' | 'daemon' }
  | { type: 'text'; value: string }

/**
 * Compiled filter predicate.
 */
export interface CompiledFilter {
  /** Original query string */
  query: string
  /** Parsed tokens */
  tokens: FilterToken[]
  /** Test a UIEvent against the filter */
  matchEvent: (event: UIEvent) => boolean
  /** Test a ParsedLogRecord against the filter */
  matchRecord: (record: ParsedLogRecord) => boolean
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Valid event kinds for filtering.
 */
const VALID_KINDS = new Set<EventKind>(['hook', 'transcript', 'internal'])

/**
 * Valid sources for filtering.
 */
const VALID_SOURCES = new Set(['cli', 'daemon'])

/**
 * Parse a single filter token from a query term.
 */
function parseToken(term: string): FilterToken {
  // Check for prefixed filters (prefix:value)
  const colonIndex = term.indexOf(':')
  if (colonIndex > 0) {
    const prefix = term.slice(0, colonIndex).toLowerCase()
    const value = term.slice(colonIndex + 1)

    if (!value) {
      // Empty value after colon - treat as text
      return { type: 'text', value: term }
    }

    switch (prefix) {
      case 'kind':
        if (VALID_KINDS.has(value as EventKind)) {
          return { type: 'kind', value: value as EventKind }
        }
        break
      case 'type':
        return { type: 'eventType', value }
      case 'hook':
        return { type: 'hook', value }
      case 'source':
        if (VALID_SOURCES.has(value)) {
          return { type: 'source', value: value as 'cli' | 'daemon' }
        }
        break
    }
  }

  // Default to free text search
  return { type: 'text', value: term.toLowerCase() }
}

/**
 * Tokenize a query string into filter tokens.
 *
 * Splits on whitespace, respecting quoted strings.
 */
function tokenizeQuery(query: string): string[] {
  const terms: string[] = []
  let current = ''
  let inQuotes = false
  let quoteChar = ''

  for (const char of query) {
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true
      quoteChar = char
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false
      if (current) {
        terms.push(current)
        current = ''
      }
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        terms.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) {
    terms.push(current)
  }

  return terms
}

/**
 * Parse a query string into filter tokens.
 */
export function parseFilterQuery(query: string): FilterToken[] {
  const terms = tokenizeQuery(query.trim())
  return terms.map(parseToken)
}

// ============================================================================
// Matching
// ============================================================================

/**
 * Check if a UIEvent matches a filter token.
 */
function matchEventToken(event: UIEvent, token: FilterToken): boolean {
  switch (token.type) {
    case 'kind': {
      // Infer kind from event
      if (event.rawEvent) {
        const kind = event.rawEvent.kind === 'hook' ? 'hook' : 'transcript'
        return kind === token.value
      }
      // For events without rawEvent, internal events typically come from daemon
      if (token.value === 'internal') {
        return event.source === 'daemon' && !event.rawEvent
      }
      return token.value === 'hook' ? event.source === 'cli' : event.source === 'daemon'
    }

    case 'eventType': {
      // Match against event type or label
      const searchValue = token.value.toLowerCase()
      if (event.rawEvent) {
        if (event.rawEvent.kind === 'hook') {
          return event.rawEvent.hook.toLowerCase().includes(searchValue)
        }
        return event.rawEvent.eventType.toLowerCase().includes(searchValue)
      }
      return event.label.toLowerCase().includes(searchValue)
    }

    case 'hook': {
      // Match hook name
      const searchValue = token.value.toLowerCase()
      if (event.rawEvent?.kind === 'hook') {
        return event.rawEvent.hook.toLowerCase().includes(searchValue)
      }
      return event.label.toLowerCase().includes(searchValue)
    }

    case 'source':
      return event.source === token.value

    case 'text': {
      // Free text search against label, content, and structured payload fields
      const searchValue = token.value.toLowerCase()

      // Search in label and content
      if (event.label.toLowerCase().includes(searchValue)) return true
      if (event.content?.toLowerCase().includes(searchValue)) return true

      // Search in structured reminder data
      if (event.reminderData) {
        const rd = event.reminderData
        if (rd.reminderName?.toLowerCase().includes(searchValue)) return true
        if (rd.hookName?.toLowerCase().includes(searchValue)) return true
        if (rd.action.toLowerCase().includes(searchValue)) return true
      }

      // Search in structured summary data
      if (event.summaryData) {
        const sd = event.summaryData
        if (sd.sessionTitle?.toLowerCase().includes(searchValue)) return true
        if (sd.latestIntent?.toLowerCase().includes(searchValue)) return true
        if (sd.oldTitle?.toLowerCase().includes(searchValue)) return true
        if (sd.oldIntent?.toLowerCase().includes(searchValue)) return true
        if (sd.reason.toLowerCase().includes(searchValue)) return true
      }

      // Search in structured decision data
      if (event.decisionData) {
        const dd = event.decisionData
        if (dd.category.toLowerCase().includes(searchValue)) return true
        if (dd.handlerId?.toLowerCase().includes(searchValue)) return true
        if (dd.error?.toLowerCase().includes(searchValue)) return true
      }

      return false
    }
  }
}

/**
 * Check if a ParsedLogRecord matches a filter token.
 */
function matchRecordToken(record: ParsedLogRecord, token: FilterToken): boolean {
  switch (token.type) {
    case 'kind': {
      const kind = getEventKind(record)
      return kind === token.value
    }

    case 'eventType': {
      const searchValue = token.value.toLowerCase()
      if (record.type) {
        return record.type.toLowerCase().includes(searchValue)
      }
      if (record.event) {
        if (record.event.kind === 'hook') {
          return record.event.hook.toLowerCase().includes(searchValue)
        }
        return record.event.eventType.toLowerCase().includes(searchValue)
      }
      return false
    }

    case 'hook': {
      const searchValue = token.value.toLowerCase()
      if (record.context?.hook) {
        return record.context.hook.toLowerCase().includes(searchValue)
      }
      if (record.event?.kind === 'hook') {
        return record.event.hook.toLowerCase().includes(searchValue)
      }
      return false
    }

    case 'source':
      return record.source === token.value

    case 'text': {
      const searchValue = token.value.toLowerCase()
      // Search in msg, type, and payload
      if (record.pino.msg?.toLowerCase().includes(searchValue)) return true
      if (record.type?.toLowerCase().includes(searchValue)) return true
      if (record.payload) {
        const payloadStr = JSON.stringify(record.payload).toLowerCase()
        if (payloadStr.includes(searchValue)) return true
      }
      return false
    }
  }
}

// ============================================================================
// Compiled Filter
// ============================================================================

/**
 * Compile a query string into a reusable filter.
 * All tokens must match (AND logic).
 */
export function compileFilter(query: string): CompiledFilter {
  const tokens = parseFilterQuery(query)

  return {
    query,
    tokens,
    matchEvent: (event: UIEvent) => {
      if (tokens.length === 0) return true
      return tokens.every((token) => matchEventToken(event, token))
    },
    matchRecord: (record: ParsedLogRecord) => {
      if (tokens.length === 0) return true
      return tokens.every((token) => matchRecordToken(record, token))
    },
  }
}

/**
 * Filter an array of UIEvents using a query string.
 */
export function filterEvents(events: UIEvent[], query: string): UIEvent[] {
  if (!query.trim()) return events
  const filter = compileFilter(query)
  return events.filter(filter.matchEvent)
}

/**
 * Filter an array of ParsedLogRecords using a query string.
 */
export function filterRecords(records: ParsedLogRecord[], query: string): ParsedLogRecord[] {
  if (!query.trim()) return records
  const filter = compileFilter(query)
  return records.filter(filter.matchRecord)
}

// ============================================================================
// Query Builder Helpers
// ============================================================================

/**
 * Build a filter query from structured options.
 * Useful for building queries programmatically.
 */
export function buildFilterQuery(options: {
  kind?: EventKind
  type?: string
  hook?: string
  source?: 'cli' | 'daemon'
  text?: string
}): string {
  const parts: string[] = []

  if (options.kind) parts.push(`kind:${options.kind}`)
  if (options.type) parts.push(`type:${options.type}`)
  if (options.hook) parts.push(`hook:${options.hook}`)
  if (options.source) parts.push(`source:${options.source}`)
  if (options.text) parts.push(options.text)

  return parts.join(' ')
}

/**
 * Parse a query string back into structured options.
 */
export function parseQueryToOptions(query: string): {
  kind?: EventKind
  type?: string
  hook?: string
  source?: 'cli' | 'daemon'
  text?: string
} {
  const tokens = parseFilterQuery(query)
  const options: ReturnType<typeof parseQueryToOptions> = {}

  for (const token of tokens) {
    switch (token.type) {
      case 'kind':
        options.kind = token.value
        break
      case 'eventType':
        options.type = token.value
        break
      case 'hook':
        options.hook = token.value
        break
      case 'source':
        options.source = token.value
        break
      case 'text':
        options.text = options.text ? `${options.text} ${token.value}` : token.value
        break
    }
  }

  return options
}
