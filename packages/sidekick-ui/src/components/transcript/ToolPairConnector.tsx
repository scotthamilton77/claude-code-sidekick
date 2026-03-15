import { useMemo } from 'react'

export interface ToolPair {
  toolUseId: string
  useIndex: number
  resultIndex: number
  color: string
}

const PAIR_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6']

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

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
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
  }

  return pairs
}

/** Hook: compute tool pairs with memoization */
export function useToolPairs(lines: { type: string; toolUseId?: string }[]): ToolPair[] {
  return useMemo(() => computeToolPairs(lines), [lines])
}

/**
 * Per-line gutter info: which pair spans this line, and what role it plays.
 * - 'start': the tool-use line
 * - 'end': the tool-result line
 * - 'span': an intermediate line between use and result
 */
export interface GutterPairInfo {
  color: string
  role: 'start' | 'end' | 'span'
  toolUseId: string
}

/** Hook: compute tool pairs, build lookup maps by toolUseId AND by line index */
export function useToolPairLookup(lines: { type: string; toolUseId?: string }[]): {
  toolPairs: ToolPair[]
  pairByToolUseId: Map<string, ToolPair>
  gutterByIndex: Map<number, GutterPairInfo>
} {
  const toolPairs = useToolPairs(lines)
  const pairByToolUseId = useMemo(() => {
    const map = new Map<string, ToolPair>()
    for (const pair of toolPairs) map.set(pair.toolUseId, pair)
    return map
  }, [toolPairs])

  // Build gutter info for every line index spanned by a pair
  const gutterByIndex = useMemo(() => {
    const map = new Map<number, GutterPairInfo>()
    for (const pair of toolPairs) {
      map.set(pair.useIndex, { color: pair.color, role: 'start', toolUseId: pair.toolUseId })
      map.set(pair.resultIndex, { color: pair.color, role: 'end', toolUseId: pair.toolUseId })
      for (let i = pair.useIndex + 1; i < pair.resultIndex; i++) {
        // Only set if not already claimed by another pair (nested pairs: inner wins)
        if (!map.has(i)) {
          map.set(i, { color: pair.color, role: 'span', toolUseId: pair.toolUseId })
        }
      }
    }
    return map
  }, [toolPairs])

  return { toolPairs, pairByToolUseId, gutterByIndex }
}
