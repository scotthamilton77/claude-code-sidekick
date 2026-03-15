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

/** Hook: compute tool pairs and build a lookup map by toolUseId */
export function useToolPairLookup(lines: { type: string; toolUseId?: string }[]): {
  toolPairs: ToolPair[]
  pairByToolUseId: Map<string, ToolPair>
} {
  const toolPairs = useToolPairs(lines)
  const pairByToolUseId = useMemo(() => {
    const map = new Map<string, ToolPair>()
    for (const pair of toolPairs) map.set(pair.toolUseId, pair)
    return map
  }, [toolPairs])
  return { toolPairs, pairByToolUseId }
}
