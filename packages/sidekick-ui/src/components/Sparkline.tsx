/**
 * Sparkline Component
 *
 * Lightweight SVG sparkline for visualizing metric trends.
 * Used in MetricsPanel to show turnCount, toolCount evolution over time.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §4.2 TranscriptMetrics
 */

import React, { useMemo } from 'react'

interface SparklineProps {
  /** Data points to visualize */
  data: number[]
  /** Height of the sparkline in pixels */
  height?: number
  /** Width of the sparkline in pixels (auto-scales to container if not set) */
  width?: number
  /** Stroke color */
  color?: string
  /** Fill color (gradient from color to transparent) */
  fillColor?: string
  /** Stroke width */
  strokeWidth?: number
  /** Whether to show the fill area under the line */
  showFill?: boolean
  /** Whether to show a dot at the current (last) value */
  showDot?: boolean
  /** Class name for the container */
  className?: string
}

/**
 * Calculate SVG path for sparkline data.
 */
function calculatePath(
  data: number[],
  width: number,
  height: number,
  padding: number
): { linePath: string; fillPath: string } {
  if (data.length === 0) {
    return { linePath: '', fillPath: '' }
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1 // Avoid division by zero

  const effectiveWidth = width - padding * 2
  const effectiveHeight = height - padding * 2

  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1 || 1)) * effectiveWidth
    const y = padding + effectiveHeight - ((value - min) / range) * effectiveHeight
    return { x, y }
  })

  // Build line path
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  // Build fill path (closes at bottom)
  const fillPath =
    linePath + ` L ${points[points.length - 1].x} ${height - padding}` + ` L ${points[0].x} ${height - padding}` + ' Z'

  return { linePath, fillPath }
}

const Sparkline: React.FC<SparklineProps> = ({
  data,
  height = 32,
  width,
  color = '#6366f1', // indigo-500
  fillColor,
  strokeWidth = 1.5,
  showFill = true,
  showDot = true,
  className = '',
}) => {
  const padding = 2
  const effectiveWidth = width ?? 100 // Default width, container will stretch it

  const { linePath, fillPath } = useMemo(
    () => calculatePath(data, effectiveWidth, height, padding),
    [data, effectiveWidth, height]
  )

  // Last point position for dot
  const lastPoint = useMemo(() => {
    if (data.length === 0) return null
    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1

    const effectiveWidthCalc = effectiveWidth - padding * 2
    const effectiveHeight = height - padding * 2

    const lastIndex = data.length - 1
    const x = padding + (lastIndex / (data.length - 1 || 1)) * effectiveWidthCalc
    const y = padding + effectiveHeight - ((data[lastIndex] - min) / range) * effectiveHeight

    return { x, y }
  }, [data, effectiveWidth, height])

  // Gradient ID (unique per instance)
  const gradientId = useMemo(() => `sparkline-fill-${Math.random().toString(36).slice(2, 9)}`, [])

  if (data.length < 2) {
    return (
      <div className={`flex items-center justify-center text-slate-400 text-xs ${className}`} style={{ height }}>
        --
      </div>
    )
  }

  return (
    <svg
      className={className}
      viewBox={`0 0 ${effectiveWidth} ${height}`}
      preserveAspectRatio="none"
      style={{ width: width ?? '100%', height }}
    >
      {/* Gradient definition */}
      {showFill && (
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={fillColor ?? color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={fillColor ?? color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}

      {/* Fill area */}
      {showFill && fillPath && <path d={fillPath} fill={`url(#${gradientId})`} />}

      {/* Line */}
      {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />}

      {/* Current value dot */}
      {showDot && lastPoint && <circle cx={lastPoint.x} cy={lastPoint.y} r={2.5} fill={color} />}
    </svg>
  )
}

export default Sparkline
