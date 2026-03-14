import { useRef, useCallback, useMemo } from 'react'

interface PanelRegistration {
  ref: React.RefObject<HTMLDivElement | null>
  timestamps: number[]
}

/**
 * Scroll synchronization coordinator for multi-panel transcript views.
 *
 * Maps scroll positions to timestamps across panels. When one panel scrolls,
 * the coordinator computes the corresponding timestamp and scrolls other
 * panels to match.
 *
 * This is a lightweight approach that uses timestamp-based binary search
 * rather than full spacer insertion — simpler and more performant for
 * the initial implementation.
 */
export function useScrollSync() {
  const panels = useRef<Map<string, PanelRegistration>>(new Map())
  const isScrolling = useRef(false)

  const registerPanel = useCallback((
    panelId: string,
    ref: React.RefObject<HTMLDivElement | null>,
    timestamps: number[],
  ) => {
    panels.current.set(panelId, { ref, timestamps })
  }, [])

  const unregisterPanel = useCallback((panelId: string) => {
    panels.current.delete(panelId)
  }, [])

  /**
   * When a panel scrolls, find the timestamp at the current scroll position
   * and scroll other panels to their nearest matching timestamp.
   */
  const onScroll = useCallback((panelId: string) => {
    if (isScrolling.current) return

    const source = panels.current.get(panelId)
    if (!source?.ref.current || source.timestamps.length === 0) return

    const el = source.ref.current
    const scrollFraction = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)

    // Map scroll fraction to a timestamp index
    const sourceIndex = Math.round(scrollFraction * (source.timestamps.length - 1))
    const targetTimestamp = source.timestamps[sourceIndex]
    if (targetTimestamp == null) return

    isScrolling.current = true

    // Scroll other panels to their nearest timestamp
    for (const [id, panel] of panels.current) {
      if (id === panelId) continue
      if (!panel.ref.current || panel.timestamps.length === 0) continue

      // Binary search for nearest timestamp
      const targetIndex = findNearestIndex(panel.timestamps, targetTimestamp)
      const targetFraction = targetIndex / Math.max(1, panel.timestamps.length - 1)
      const targetScrollTop = targetFraction * (panel.ref.current.scrollHeight - panel.ref.current.clientHeight)

      panel.ref.current.scrollTop = targetScrollTop
    }

    // Reset flag on next frame
    requestAnimationFrame(() => {
      isScrolling.current = false
    })
  }, [])

  return useMemo(() => ({
    registerPanel,
    unregisterPanel,
    onScroll,
  }), [registerPanel, unregisterPanel, onScroll])
}

/**
 * Find the index of the nearest timestamp using binary search.
 */
function findNearestIndex(timestamps: number[], target: number): number {
  if (timestamps.length === 0) return 0
  if (target <= timestamps[0]) return 0
  if (target >= timestamps[timestamps.length - 1]) return timestamps.length - 1

  let lo = 0
  let hi = timestamps.length - 1

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (timestamps[mid] < target) lo = mid + 1
    else hi = mid
  }

  // Check if previous index is closer
  if (lo > 0 && Math.abs(timestamps[lo - 1] - target) < Math.abs(timestamps[lo] - target)) {
    return lo - 1
  }

  return lo
}
