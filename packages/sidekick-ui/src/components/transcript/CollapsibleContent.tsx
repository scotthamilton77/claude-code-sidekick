import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsibleContentProps {
  content: string
  previewLines?: number
  previewChars?: number
  className?: string
  mono?: boolean
  label?: string
  defaultExpanded?: boolean
}

function computePreview(content: string, previewLines: number, previewChars: number): { preview: string; totalLines: number; isLong: boolean } {
  const lines = content.split('\n')
  const totalLines = lines.length

  // Take first N lines
  const lineSlice = lines.slice(0, previewLines).join('\n')

  // Also enforce character limit
  const preview = lineSlice.length > previewChars
    ? lineSlice.slice(0, previewChars) + '\u2026'
    : lineSlice

  const isLong = totalLines > previewLines || content.length > previewChars

  return { preview, totalLines, isLong }
}

export function CollapsibleContent({
  content,
  previewLines = 3,
  previewChars = 300,
  className = '',
  mono = false,
  label,
  defaultExpanded = false,
}: CollapsibleContentProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const { preview, totalLines, isLong } = useMemo(
    () => computePreview(content, previewLines, previewChars),
    [content, previewLines, previewChars]
  )

  if (!isLong) {
    return (
      <pre className={`text-[10px] leading-relaxed whitespace-pre-wrap ${mono ? 'font-mono' : ''} ${className}`}>
        {content}
      </pre>
    )
  }

  return (
    <div>
      <pre className={`text-[10px] leading-relaxed whitespace-pre-wrap ${mono ? 'font-mono' : ''} ${className}`}>
        {expanded ? content : preview}
      </pre>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setExpanded(!expanded)
        }}
        className="flex items-center gap-1 mt-1 text-[9px] text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {expanded
          ? 'Show less'
          : `Show more${label ? ` ${label}` : ''} (${totalLines} lines)`
        }
      </button>
    </div>
  )
}
