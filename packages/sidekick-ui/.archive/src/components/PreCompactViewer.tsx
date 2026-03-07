/**
 * PreCompactViewer Component
 *
 * Modal/panel for viewing pre-compaction transcript snapshots.
 * Allows users to inspect the full transcript before compaction occurred.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.1 Compaction Timeline
 */

import React, { useMemo } from 'react'
import type { CompactionEntry } from './CompactionMarker'
import Icon from './Icon'

interface PreCompactViewerProps {
  /** Compaction entry being viewed */
  entry: CompactionEntry
  /** Raw NDJSON snapshot content */
  content: string | null
  /** Whether content is being loaded */
  loading: boolean
  /** Close handler */
  onClose: () => void
  /** Class name override */
  className?: string
}

/**
 * Parse NDJSON content into structured entries.
 */
interface TranscriptLine {
  lineNumber: number
  type: string
  content: string
  raw: Record<string, unknown>
}

function parseSnapshot(content: string): TranscriptLine[] {
  const lines = content.split('\n').filter((line) => line.trim())
  return lines.map((line, index) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const type = inferEntryType(parsed)
      const displayContent = extractContent(parsed, type)
      return {
        lineNumber: index + 1,
        type,
        content: displayContent,
        raw: parsed,
      }
    } catch {
      return {
        lineNumber: index + 1,
        type: 'unknown',
        content: line.slice(0, 100),
        raw: {},
      }
    }
  })
}

/**
 * Infer entry type from parsed JSON.
 */
function inferEntryType(entry: Record<string, unknown>): string {
  // Check for message array (conversation entry)
  if (Array.isArray(entry.message)) {
    const messages = entry.message as Array<{ role?: string; type?: string }>
    const firstMsg = messages[0]
    if (firstMsg?.role === 'user') return 'user'
    if (firstMsg?.role === 'assistant') return 'assistant'
  }

  // Check role directly
  if (entry.role === 'user') return 'user'
  if (entry.role === 'assistant') return 'assistant'

  // Check for tool-related entries
  if (entry.type === 'tool_use' || entry.tool_name) return 'tool'
  if (entry.type === 'tool_result') return 'tool_result'

  return 'unknown'
}

/**
 * Extract display content from entry.
 */
function extractContent(entry: Record<string, unknown>, type: string): string {
  // Handle message arrays
  if (Array.isArray(entry.message)) {
    const messages = entry.message as Array<{ content?: unknown; text?: string }>
    const firstMsg = messages[0]
    if (typeof firstMsg?.content === 'string') return firstMsg.content.slice(0, 200)
    if (typeof firstMsg?.text === 'string') return firstMsg.text.slice(0, 200)
    // Handle content blocks
    if (Array.isArray(firstMsg?.content)) {
      const textBlock = (firstMsg.content as Array<{ type?: string; text?: string }>).find((b) => b.type === 'text')
      if (textBlock?.text) return textBlock.text.slice(0, 200)
    }
  }

  // Handle direct content
  if (typeof entry.content === 'string') return entry.content.slice(0, 200)
  if (typeof entry.text === 'string') return entry.text.slice(0, 200)

  // Handle tool entries
  if (type === 'tool' && typeof entry.tool_name === 'string') {
    return `Tool: ${entry.tool_name}`
  }

  return JSON.stringify(entry).slice(0, 100)
}

/**
 * Format timestamp for display.
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

/**
 * Entry type badge colors.
 */
function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    user: 'bg-blue-100 text-blue-700',
    assistant: 'bg-emerald-100 text-emerald-700',
    tool: 'bg-purple-100 text-purple-700',
    tool_result: 'bg-cyan-100 text-cyan-700',
    unknown: 'bg-slate-100 text-slate-600',
  }
  return colors[type] ?? colors.unknown
}

const PreCompactViewer: React.FC<PreCompactViewerProps> = ({ entry, content, loading, onClose, className = '' }) => {
  const parsedLines = useMemo(() => (content ? parseSnapshot(content) : []), [content])

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 ${className}`} onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[800px] max-w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100">
              <Icon name="scissors" className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Pre-Compaction Snapshot</h2>
              <p className="text-sm text-slate-500">{formatTime(entry.compactedAt)}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
            <Icon name="x" className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Metrics Summary */}
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-6 text-sm">
          <div>
            <span className="text-slate-500">Turns:</span>{' '}
            <span className="font-medium">{entry.metricsAtCompaction.turnCount}</span>
          </div>
          <div>
            <span className="text-slate-500">Tools:</span>{' '}
            <span className="font-medium">{entry.metricsAtCompaction.toolCount}</span>
          </div>
          <div>
            <span className="text-slate-500">Messages:</span>{' '}
            <span className="font-medium">{entry.metricsAtCompaction.messageCount}</span>
          </div>
          <div>
            <span className="text-slate-500">Tokens:</span>{' '}
            <span className="font-medium">{entry.metricsAtCompaction.tokenUsage.totalTokens.toLocaleString()}</span>
          </div>
          <div className="ml-auto">
            <span className="text-slate-500">Lines after:</span>{' '}
            <span className="font-medium">{entry.postCompactLineCount}</span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Icon name="loader-2" className="w-8 h-8 text-slate-400 animate-spin" />
            </div>
          ) : parsedLines.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-slate-400">
              <span>No transcript content available</span>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {parsedLines.map((line) => (
                <div key={line.lineNumber} className="px-4 py-2 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-slate-400 w-8">#{line.lineNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getTypeColor(line.type)}`}>
                      {line.type}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 pl-10 line-clamp-2">{line.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-sm text-slate-500">
          <span>{parsedLines.length} transcript entries</span>
          <button onClick={onClose} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default PreCompactViewer
