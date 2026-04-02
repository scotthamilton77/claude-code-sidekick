import { useState, useMemo, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsibleContentProps {
  content: string
  previewLines?: number
  previewChars?: number
  className?: string
  mono?: boolean
  label?: string
  defaultExpanded?: boolean
  highlight?: 'json'
}

const JSON_TOKEN_RE = /("(?:[^"\\]|\\.)*")(\s*:)?|(true|false|null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

function highlightJson(text: string): ReactNode {
  const parts: ReactNode[] = []
  let lastIndex = 0

  for (const match of text.matchAll(JSON_TOKEN_RE)) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[1] != null) {
      // Key (followed by `:`) vs string value
      if (match[2] != null) {
        parts.push(
          <span key={match.index} className="text-cyan-600 dark:text-cyan-400">{match[1]}</span>
        )
        parts.push(match[2])
      } else {
        parts.push(
          <span key={match.index} className="text-green-600 dark:text-green-400">{match[1]}</span>
        )
      }
    } else if (match[3] != null) {
      parts.push(
        <span key={match.index} className="text-purple-600 dark:text-purple-400">{match[3]}</span>
      )
    } else if (match[4] != null) {
      parts.push(
        <span key={match.index} className="text-amber-600 dark:text-amber-400">{match[4]}</span>
      )
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : text
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
  highlight,
}: CollapsibleContentProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const { preview, totalLines, isLong } = useMemo(
    () => computePreview(content, previewLines, previewChars),
    [content, previewLines, previewChars]
  )

  const displayText = isLong ? (expanded ? content : preview) : content
  const rendered = useMemo(
    () => highlight === 'json' ? highlightJson(displayText) : displayText,
    [highlight, displayText]
  )

  if (!isLong) {
    return (
      <pre className={`text-[10px] leading-relaxed whitespace-pre-wrap ${mono ? 'font-mono' : ''} ${className}`}>
        {rendered}
      </pre>
    )
  }

  return (
    <div>
      <pre className={`text-[10px] leading-relaxed whitespace-pre-wrap ${mono ? 'font-mono' : ''} ${className}`}>
        {rendered}
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
