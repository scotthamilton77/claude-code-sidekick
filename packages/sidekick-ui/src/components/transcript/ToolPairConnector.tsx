import { useMemo } from 'react'

export interface ToolPair {
  toolUseId: string
  useIndex: number
  resultIndex: number
  color: string
}

const PAIR_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6']

interface ToolPairConnectorProps {
  pairs: ToolPair[]
  lineHeight: number
  hoveredToolUseId: string | null
}

/**
 * SVG overlay that draws vertical connector lines in the gutter area
 * between paired tool-use and tool-result entries.
 */
export function ToolPairConnector({ pairs, lineHeight, hoveredToolUseId }: ToolPairConnectorProps) {
  if (pairs.length === 0) return null

  const maxIndex = Math.max(...pairs.map(p => p.resultIndex))
  const totalHeight = (maxIndex + 1) * lineHeight

  return (
    <svg
      className="absolute left-0 top-0 pointer-events-none"
      width={28}
      height={totalHeight}
      style={{ zIndex: 1 }}
    >
      {pairs.map((pair) => {
        const isHovered = hoveredToolUseId === pair.toolUseId
        const y1 = pair.useIndex * lineHeight + lineHeight / 2
        const y2 = pair.resultIndex * lineHeight + lineHeight / 2
        const x = 14

        return (
          <g key={pair.toolUseId}>
            {/* Vertical connector line */}
            <line
              x1={x} y1={y1} x2={x} y2={y2}
              stroke={pair.color}
              strokeWidth={isHovered ? 3 : 1.5}
              strokeOpacity={isHovered ? 0.9 : 0.35}
              strokeLinecap="round"
            />
            {/* Top dot (tool-use) */}
            <circle
              cx={x} cy={y1} r={isHovered ? 3 : 2}
              fill={pair.color}
              fillOpacity={isHovered ? 0.9 : 0.5}
            />
            {/* Bottom dot (tool-result) */}
            <circle
              cx={x} cy={y2} r={isHovered ? 3 : 2}
              fill={pair.color}
              fillOpacity={isHovered ? 0.9 : 0.5}
            />
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Compute tool pairs from visible lines.
 * Returns pairs with assigned colors from the cycling palette.
 */
export function computeToolPairs(
  lines: { type: string; toolUseId?: string }[]
): ToolPair[] {
  const useMap = new Map<string, number>()
  const pairs: ToolPair[] = []
  let colorIndex = 0

  lines.forEach((line, index) => {
    if (line.type === 'tool-use' && line.toolUseId) {
      useMap.set(line.toolUseId, index)
    }
    if (line.type === 'tool-result' && line.toolUseId) {
      const useIndex = useMap.get(line.toolUseId)
      if (useIndex !== undefined) {
        pairs.push({
          toolUseId: line.toolUseId,
          useIndex,
          resultIndex: index,
          color: PAIR_COLORS[colorIndex % PAIR_COLORS.length],
        })
        colorIndex++
      }
    }
  })

  return pairs
}

/** Hook: compute tool pairs with memoization */
export function useToolPairs(lines: { type: string; toolUseId?: string }[]): ToolPair[] {
  return useMemo(() => computeToolPairs(lines), [lines])
}
