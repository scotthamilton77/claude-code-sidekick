import React, { useState, useMemo } from 'react'
import Icon from '../Icon'

/**
 * Safely stringify a value, handling circular references and BigInt.
 * Returns [serialized, error?] tuple.
 */
function safeStringify(value: unknown): [string, string | null] {
  try {
    const seen = new WeakSet<object>()
    const serialized = JSON.stringify(
      value,
      (_, v: unknown) => {
        // Handle BigInt
        if (typeof v === 'bigint') {
          return v.toString() + 'n'
        }
        // Handle circular references
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) {
            return '[Circular]'
          }
          seen.add(v)
        }
        return v
      },
      2
    )
    return [serialized, null]
  } catch (err) {
    return ['{}', err instanceof Error ? err.message : 'Unknown serialization error']
  }
}

interface ExpandablePayloadProps {
  /** Payload to display - accepts any serializable value */
  payload: unknown
  defaultExpanded?: boolean
  maxHeight?: number
  className?: string
}

const ExpandablePayload: React.FC<ExpandablePayloadProps> = ({
  payload,
  defaultExpanded = false,
  maxHeight = 400,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [copySuccess, setCopySuccess] = useState(false)

  // Memoize serialization to avoid re-running on every render
  const [serialized, serializeError] = useMemo(() => safeStringify(payload), [payload])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(serialized)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className={`rounded-lg border border-slate-200 bg-white ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
        >
          <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} className="w-4 h-4 text-slate-500" />
          Payload
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleCopy()}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
            title="Copy to clipboard"
          >
            <Icon name={copySuccess ? 'check' : 'copy'} className="w-3.5 h-3.5" />
            {copySuccess ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="overflow-y-auto p-3 font-mono text-xs leading-relaxed" style={{ maxHeight: `${maxHeight}px` }}>
          {serializeError && (
            <div className="text-amber-600 mb-2 text-xs">⚠ Serialization warning: {serializeError}</div>
          )}
          <pre className="text-slate-700 whitespace-pre-wrap">{serialized}</pre>
        </div>
      )}
    </div>
  )
}

export default ExpandablePayload
