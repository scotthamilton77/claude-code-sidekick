import { useMemo } from 'react'

export interface ToolPair {
  toolUseId: string
  useIndex: number
  resultIndex: number
  color: string
  level: number
}

/** Max nesting levels for connector lines (0-based, so 4 means levels 0–3) */
export const MAX_CONNECTOR_LEVELS = 4
/** Pixels between each nesting level */
export const LEVEL_SPACING_PX = 5
/** Total horizontal width (px) of the connector column between LED gutter and content */
export const CONNECTOR_WIDTH_PX = 20

const PAIR_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6']

/**
 * Assign nesting levels via greedy interval coloring.
 * Level 0 = outermost (closest to LED gutter), higher = closer to bubble.
 * Mutates pairs in place.
 */
function assignNestingLevels(pairs: ToolPair[]): void {
  const sorted = [...pairs].sort((a, b) => a.useIndex - b.useIndex)
  // levelEnds[l] = resultIndex of pair currently occupying level l
  const levelEnds: number[] = []

  for (const pair of sorted) {
    let assigned = -1
    for (let l = 0; l < levelEnds.length; l++) {
      if (levelEnds[l] < pair.useIndex) {
        // Level freed — reuse it
        assigned = l
        levelEnds[l] = pair.resultIndex
        break
      }
    }
    if (assigned === -1) {
      assigned = levelEnds.length
      levelEnds.push(pair.resultIndex)
    }
    pair.level = Math.min(assigned, MAX_CONNECTOR_LEVELS - 1)
  }
}

/**
 * Compute tool pairs from visible lines.
 * Returns pairs with assigned colors and nesting levels.
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
          level: 0,
        })
        colorIndex++
      }
    }
  }

  assignNestingLevels(pairs)
  return pairs
}

/** Hook: compute tool pairs with memoization */
export function useToolPairs(lines: { type: string; toolUseId?: string }[]): ToolPair[] {
  return useMemo(() => computeToolPairs(lines), [lines])
}

/**
 * Per-line gutter info: which pair(s) span this line, and what role each plays.
 * - 'start': the tool-use line
 * - 'end': the tool-result line
 * - 'span': an intermediate line between use and result
 */
export interface GutterPairInfo {
  color: string
  role: 'start' | 'end' | 'span'
  toolUseId: string
  level: number
}

/** Hook: compute tool pairs, build lookup maps by toolUseId AND by line index */
export function useToolPairLookup(lines: { type: string; toolUseId?: string }[]): {
  toolPairs: ToolPair[]
  pairByToolUseId: Map<string, ToolPair>
  gutterByIndex: Map<number, GutterPairInfo[]>
} {
  const toolPairs = useToolPairs(lines)
  const pairByToolUseId = useMemo(() => {
    const map = new Map<string, ToolPair>()
    for (const pair of toolPairs) map.set(pair.toolUseId, pair)
    return map
  }, [toolPairs])

  // Build gutter info arrays — one entry per active pair at each line index
  const gutterByIndex = useMemo(() => {
    const map = new Map<number, GutterPairInfo[]>()

    const add = (index: number, info: GutterPairInfo) => {
      let arr = map.get(index)
      if (!arr) { arr = []; map.set(index, arr) }
      arr.push(info)
    }

    for (const pair of toolPairs) {
      const base = { color: pair.color, toolUseId: pair.toolUseId, level: pair.level }
      add(pair.useIndex, { ...base, role: 'start' })
      add(pair.resultIndex, { ...base, role: 'end' })
      for (let i = pair.useIndex + 1; i < pair.resultIndex; i++) {
        add(i, { ...base, role: 'span' })
      }
    }

    return map
  }, [toolPairs])

  return { toolPairs, pairByToolUseId, gutterByIndex }
}
