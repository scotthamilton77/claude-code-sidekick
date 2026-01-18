/**
 * SnapshotDiffView - Generic computed diff visualization between consecutive snapshots.
 *
 * Implements Git-style diff rendering for ANY JSON structure, not hard-coded fields.
 * Displays additions (green), deletions (red), and modifications (yellow) with nested path support.
 *
 * Design: packages/sidekick-ui/docs/MONITORING-UI.md §3.2.C State Inspector
 */

import React from 'react'
import { computeDiff, type DiffEntry } from '../lib/json-diff'

interface SnapshotDiffViewProps {
  /** Previous snapshot (baseline for comparison) */
  previous: unknown
  /** Current snapshot (comparison target) */
  current: unknown
  /** Optional: Maximum number of changes to display (defaults to unlimited) */
  maxChanges?: number
}

/**
 * Renders a computed diff between two snapshots with visual distinction for change types.
 *
 * @example
 * ```tsx
 * <SnapshotDiffView
 *   previous={{ count: 5, user: { name: "Alice" } }}
 *   current={{ count: 10, user: { name: "Alice", role: "admin" } }}
 * />
 * ```
 */
const SnapshotDiffView: React.FC<SnapshotDiffViewProps> = ({ previous, current, maxChanges }) => {
  const changes = computeDiff(previous, current)
  const displayChanges = maxChanges ? changes.slice(0, maxChanges) : changes
  const hasMore = maxChanges && changes.length > maxChanges

  if (changes.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-slate-500">No changes detected</p>
      </div>
    )
  }

  return (
    <div className="font-mono text-xs leading-relaxed">
      {/* Header summary */}
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-3 text-xs">
        <span className="text-slate-600">
          {changes.length} {changes.length === 1 ? 'change' : 'changes'}
        </span>
        <div className="flex items-center gap-3 text-slate-500">
          <span className="flex items-center gap-1">
            <span className="text-green-600">+{changes.filter((c) => c.type === 'add').length}</span>
            <span>additions</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-red-600">-{changes.filter((c) => c.type === 'remove').length}</span>
            <span>deletions</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-amber-600">~{changes.filter((c) => c.type === 'modify').length}</span>
            <span>modifications</span>
          </span>
        </div>
      </div>

      {/* Change list */}
      <div className="divide-y divide-slate-100">
        {displayChanges.map((change, idx) => (
          <DiffEntryRow key={idx} entry={change} />
        ))}
      </div>

      {/* Truncation indicator */}
      {hasMore && (
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-center">
          <p className="text-xs text-slate-500">
            ... and {changes.length - displayChanges.length} more{' '}
            {changes.length - displayChanges.length === 1 ? 'change' : 'changes'}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Renders a single diff entry with color-coded background and change indicators
 */
const DiffEntryRow: React.FC<{ entry: DiffEntry }> = ({ entry }) => {
  const { type, path, oldValue, newValue } = entry

  // Color scheme based on change type
  const colorClasses = {
    add: {
      bg: 'bg-green-50',
      border: 'border-l-2 border-green-400',
      text: 'text-green-700',
      indicator: 'text-green-400',
      symbol: '+',
    },
    remove: {
      bg: 'bg-red-50',
      border: 'border-l-2 border-red-400',
      text: 'text-red-700',
      indicator: 'text-red-400',
      symbol: '-',
    },
    modify: {
      bg: 'bg-amber-50',
      border: 'border-l-2 border-amber-400',
      text: 'text-amber-700',
      indicator: 'text-amber-400',
      symbol: '~',
    },
  }

  const colors = colorClasses[type]

  return (
    <div className={`${colors.bg} ${colors.border} px-4 py-2`}>
      {/* Path header */}
      <div className="flex items-center gap-2 mb-1">
        <span className={`select-none ${colors.indicator} font-bold`}>{colors.symbol}</span>
        <span className="font-semibold text-slate-700">{path}</span>
        <span className="text-xs text-slate-400 uppercase">{type}</span>
      </div>

      {/* Value changes */}
      <div className={`pl-5 ${colors.text}`}>
        {type === 'remove' && (
          <div className="flex items-start gap-2">
            <span className="text-slate-400 select-none">-</span>
            <span className="break-all">{formatValue(oldValue)}</span>
          </div>
        )}

        {type === 'add' && (
          <div className="flex items-start gap-2">
            <span className="text-slate-400 select-none">+</span>
            <span className="break-all">{formatValue(newValue)}</span>
          </div>
        )}

        {type === 'modify' && (
          <div className="space-y-0.5">
            <div className="flex items-start gap-2 text-red-600">
              <span className="text-slate-400 select-none">-</span>
              <span className="break-all">{formatValue(oldValue)}</span>
            </div>
            <div className="flex items-start gap-2 text-green-600">
              <span className="text-slate-400 select-none">+</span>
              <span className="break-all">{formatValue(newValue)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Format a value for display in the diff view
 *
 * Handles primitives, objects, and arrays with reasonable truncation for readability.
 */
function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
      // Truncate long strings for readability
      return value.length > 100 ? `"${value.slice(0, 97)}..."` : `"${value}"`
    case 'number':
    case 'boolean':
      return String(value)
    case 'object': {
      // For objects/arrays, show compact JSON (truncated if large)
      const json = JSON.stringify(value)
      return json.length > 100 ? `${json.slice(0, 97)}...` : json
    }
    default:
      // Fallback: attempt stringification, with safe default
      try {
        return JSON.stringify(value) ?? '[unknown]'
      } catch {
        return '[unstringifiable]'
      }
  }
}

export default SnapshotDiffView
