/**
 * Generic JSON Tree Viewer Component
 *
 * A read-only, collapsible tree viewer for arbitrary JSON data structures.
 * Supports nested objects and arrays with syntax highlighting and type-specific rendering.
 *
 * Features:
 * - Recursive tree structure with expand/collapse controls
 * - Type-specific styling (string, number, boolean, null, array, object)
 * - Performance-optimized for moderately large JSON (100+ keys)
 * - Accessible keyboard navigation
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2.C State Inspector
 */

import React, { useState, useMemo } from 'react'
import Icon from '../Icon'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any // Accept any valid JSON structure
interface JsonObject {
  [key: string]: JsonValue
}
type JsonArray = JsonValue[]

interface JsonTreeNodeProps {
  /** The key/property name (omitted for root) */
  keyName?: string
  /** The value to render */
  value: JsonValue
  /** Nesting level for indentation (0-indexed) */
  level?: number
  /** Whether this is the last item in a parent collection (for comma rendering) */
  isLast?: boolean
  /** Default expanded state for this node */
  defaultExpanded?: boolean
}

/**
 * Determines if a value is a primitive (leaf node in the tree).
 */
function isPrimitive(value: JsonValue): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

/**
 * Determines if a value is an array.
 */
function isArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value)
}

/**
 * Determines if a value is an object.
 */
function isObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Renders a single node in the JSON tree.
 * Recursively renders children for objects and arrays.
 */
const JsonTreeNode: React.FC<JsonTreeNodeProps> = ({
  keyName,
  value,
  level = 0,
  isLast = true,
  defaultExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  // Calculate indentation padding (4px per level)
  const paddingLeft = level * 16 + 8

  // Primitive rendering
  if (isPrimitive(value)) {
    let displayValue: string
    let valueClassName: string

    if (value === null) {
      displayValue = 'null'
      valueClassName = 'text-slate-400 italic'
    } else if (typeof value === 'boolean') {
      displayValue = String(value)
      valueClassName = 'text-purple-600'
    } else if (typeof value === 'number') {
      displayValue = String(value)
      valueClassName = 'text-blue-600'
    } else {
      // String
      displayValue = `"${value}"`
      valueClassName = 'text-green-700'
    }

    return (
      <div className="font-mono text-xs leading-relaxed" style={{ paddingLeft }}>
        {keyName && <span className="text-slate-700">&quot;{keyName}&quot;: </span>}
        <span className={valueClassName}>{displayValue}</span>
        {!isLast && <span className="text-slate-500">,</span>}
      </div>
    )
  }

  // Array rendering
  if (isArray(value)) {
    const isEmpty = value.length === 0

    if (isEmpty) {
      return (
        <div className="font-mono text-xs leading-relaxed" style={{ paddingLeft }}>
          {keyName && <span className="text-slate-700">&quot;{keyName}&quot;: </span>}
          <span className="text-slate-500">[]</span>
          {!isLast && <span className="text-slate-500">,</span>}
        </div>
      )
    }

    return (
      <div className="font-mono text-xs leading-relaxed">
        <div style={{ paddingLeft }} className="flex items-start gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex-shrink-0 hover:bg-slate-100 rounded transition-colors p-0.5 -ml-0.5"
            aria-label={isExpanded ? 'Collapse array' : 'Expand array'}
          >
            <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} className="w-3 h-3 text-slate-500" />
          </button>
          {keyName && <span className="text-slate-700">&quot;{keyName}&quot;: </span>}
          <span className="text-slate-500">[</span>
          {!isExpanded && (
            <span className="text-slate-400 italic text-[10px] ml-1">
              {value.length} {value.length === 1 ? 'item' : 'items'}
            </span>
          )}
          {!isExpanded && <span className="text-slate-500">]</span>}
          {!isExpanded && !isLast && <span className="text-slate-500">,</span>}
        </div>

        {/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Dynamic JSON requires any */}
        {isExpanded && (
          <>
            {value.map((item, index) => (
              <JsonTreeNode
                key={index}
                value={item}
                level={level + 1}
                isLast={index === value.length - 1}
                defaultExpanded={false}
              />
            ))}
            <div className="text-slate-500" style={{ paddingLeft }}>
              ]{!isLast && ','}
            </div>
          </>
        )}
        {/* eslint-enable @typescript-eslint/no-unsafe-assignment */}
      </div>
    )
  }

  // Object rendering
  if (isObject(value)) {
    const entries = Object.entries(value)
    const isEmpty = entries.length === 0

    if (isEmpty) {
      return (
        <div className="font-mono text-xs leading-relaxed" style={{ paddingLeft }}>
          {keyName && <span className="text-slate-700">&quot;{keyName}&quot;: </span>}
          <span className="text-slate-500">{'{}'}</span>
          {!isLast && <span className="text-slate-500">,</span>}
        </div>
      )
    }

    return (
      <div className="font-mono text-xs leading-relaxed">
        <div style={{ paddingLeft }} className="flex items-start gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex-shrink-0 hover:bg-slate-100 rounded transition-colors p-0.5 -ml-0.5"
            aria-label={isExpanded ? 'Collapse object' : 'Expand object'}
          >
            <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} className="w-3 h-3 text-slate-500" />
          </button>
          {keyName && <span className="text-slate-700">&quot;{keyName}&quot;: </span>}
          <span className="text-slate-500">{'{'}</span>
          {!isExpanded && (
            <span className="text-slate-400 italic text-[10px] ml-1">
              {entries.length} {entries.length === 1 ? 'property' : 'properties'}
            </span>
          )}
          {!isExpanded && <span className="text-slate-500">{'}'}</span>}
          {!isExpanded && !isLast && <span className="text-slate-500">,</span>}
        </div>

        {/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Dynamic JSON requires any */}
        {isExpanded && (
          <>
            {entries.map(([key, val], index) => (
              <JsonTreeNode
                key={key}
                keyName={key}
                value={val}
                level={level + 1}
                isLast={index === entries.length - 1}
                defaultExpanded={false}
              />
            ))}
            <div className="text-slate-500" style={{ paddingLeft }}>
              {'}'}
              {!isLast && ','}
            </div>
          </>
        )}
        {/* eslint-enable @typescript-eslint/no-unsafe-assignment */}
      </div>
    )
  }

  // Fallback for unknown types (should not happen with proper JsonValue typing)
  return (
    <div className="font-mono text-xs text-red-500" style={{ paddingLeft }}>
      [Unknown type]
    </div>
  )
}

interface JsonTreeViewerProps {
  /** JSON data to display - accepts any valid JSON structure */
  data: JsonValue
  /** Default expanded state for root-level nodes */
  defaultExpanded?: boolean
  /** Maximum height for scrollable container (in pixels) */
  maxHeight?: number
  /** Additional CSS classes */
  className?: string
}

/**
 * Main JSON Tree Viewer component.
 * Renders arbitrary JSON data as a collapsible tree structure.
 */
const JsonTreeViewer: React.FC<JsonTreeViewerProps> = ({
  data,
  defaultExpanded = false,
  maxHeight,
  className = '',
}) => {
  // Memoize the root expansion state to avoid re-computing
  const rootExpanded = useMemo(() => defaultExpanded, [defaultExpanded])

  return (
    <div className={`overflow-y-auto p-4 ${className}`} style={{ maxHeight: maxHeight ? `${maxHeight}px` : undefined }}>
      {/* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Dynamic JSON tree requires any */}
      <JsonTreeNode value={data} level={0} isLast={true} defaultExpanded={rootExpanded} />
    </div>
  )
}

export default JsonTreeViewer
